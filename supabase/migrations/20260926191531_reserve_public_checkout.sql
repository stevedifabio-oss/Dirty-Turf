-- One open purchase per community/email. Service-only reservation prevents two
-- tabs/devices from creating independent sessions before the paid webhook lands.
create table public.academy_checkout_reservations (
  id uuid primary key default gen_random_uuid(),
  academy_community_id uuid not null references public.academy_communities(id),
  email text not null,
  plan_id uuid not null references public.academy_billing_plans(id),
  request_id uuid not null,
  checkout_session_id text,
  checkout_url text,
  expires_at timestamptz not null,
  unique (academy_community_id, email)
);
alter table public.academy_checkout_reservations enable row level security;
revoke all on public.academy_checkout_reservations from public, anon, authenticated;
grant all on public.academy_checkout_reservations to service_role;

create or replace function public.reserve_academy_checkout(p_plan_id uuid, p_email text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  community_id uuid;
  normalized_email text := lower(trim(p_email));
  reservation public.academy_checkout_reservations%rowtype;
begin
  select academy_community_id into community_id from public.academy_billing_plans where id = p_plan_id and active;
  if community_id is null or p_request_id is null or length(normalized_email) > 254 or position('@' in normalized_email) <= 1 then
    raise exception 'Invalid checkout request';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(community_id::text || ':' || normalized_email, 0));
  -- Includes imported identities whose Auth account has never been claimed.
  if exists (
    select 1 from public.academy_members m
    left join auth.users u on u.id = m.user_id
    left join public.academy_member_invites i on i.academy_member_id = m.id
    where m.academy_community_id = community_id and m.status = 'active'
      and exists (select 1 from public.academy_access_grants g where g.academy_member_id = m.id
        and g.status = 'active' and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now()))
      and (lower(u.email) = normalized_email or lower(i.email) = normalized_email)
  ) then
    return jsonb_build_object('blocked', true, 'reason', 'existing_access');
  end if;
  select * into reservation from public.academy_checkout_reservations
    where academy_community_id = community_id and email = normalized_email;
  if reservation.id is not null and reservation.expires_at > now() then
    if reservation.request_id <> p_request_id or reservation.plan_id <> p_plan_id then
      return jsonb_build_object('blocked', true, 'reason', 'checkout_in_progress');
    end if;
  else
    insert into public.academy_checkout_reservations(academy_community_id,email,plan_id,request_id,expires_at)
      values(community_id,normalized_email,p_plan_id,p_request_id,now() + interval '1 hour')
      on conflict(academy_community_id,email) do update
      set id = gen_random_uuid(), plan_id = excluded.plan_id, request_id = excluded.request_id,
          expires_at = excluded.expires_at, checkout_session_id = null, checkout_url = null
      returning * into reservation;
  end if;
  return jsonb_build_object('blocked', false, 'id', reservation.id, 'url', reservation.checkout_url,
    'expiresAt', floor(extract(epoch from reservation.expires_at)));
end;
$$;
revoke all on function public.reserve_academy_checkout(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.reserve_academy_checkout(uuid,text,uuid) to service_role;

-- Reconcile Stripe plan changes without reducing independently granted access.
create or replace function public.apply_academy_billing_event(
  p_plan_id uuid,
  p_member_id uuid,
  p_provider_customer_id text,
  p_provider_subscription_id text,
  p_checkout_session_id text,
  p_status text,
  p_cancel_at_period_end boolean,
  p_current_period_end timestamptz,
  p_source_type text,
  p_source_key text,
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  plan_row public.academy_billing_plans%rowtype;
  member_row public.academy_members%rowtype;
  grant_status text;
  enrollment_status text;
  target_course_id uuid;
begin
  if p_status not in ('pending', 'trialing', 'active', 'past_due', 'paused', 'cancelled', 'expired') then
    raise exception 'Invalid billing status';
  end if;
  if p_source_type not in ('stripe_subscription', 'stripe_payment') then
    raise exception 'Invalid billing source';
  end if;
  if nullif(trim(p_provider_customer_id), '') is null
     or nullif(trim(p_source_key), '') is null
     or position('@' in coalesce(p_email, '')) <= 1 then
    raise exception 'Incomplete billing identity';
  end if;

  select * into plan_row from public.academy_billing_plans where id = p_plan_id;
  select * into member_row from public.academy_members where id = p_member_id for update;
  if plan_row.id is null or member_row.id is null
     or plan_row.academy_community_id <> member_row.academy_community_id then
    raise exception 'Billing plan and Academy member do not match';
  end if;

  -- Stripe source identity cannot silently move to a different Academy member
  -- if a customer email is edited later in the Stripe dashboard.
  if exists (select 1 from public.academy_billing_subscriptions s
    where s.academy_community_id = member_row.academy_community_id
      and s.source_type = p_source_type and s.source_key = trim(p_source_key)
      and s.academy_member_id <> member_row.id) then
    raise exception 'Billing source belongs to a different Academy identity';
  end if;

  insert into public.academy_billing_customers (
    academy_community_id, academy_member_id, user_id, provider_customer_id, email
  ) values (
    member_row.academy_community_id, member_row.id, member_row.user_id,
    trim(p_provider_customer_id), lower(trim(p_email))
  )
  on conflict (academy_community_id, academy_member_id) do update
  set provider_customer_id = excluded.provider_customer_id,
      user_id = excluded.user_id,
      email = excluded.email,
      updated_at = now();

  insert into public.academy_billing_subscriptions (
    academy_community_id, academy_member_id, plan_id, source_type, source_key,
    provider_customer_id, provider_subscription_id, checkout_session_id,
    status, cancel_at_period_end, current_period_end
  ) values (
    member_row.academy_community_id, member_row.id, plan_row.id, p_source_type,
    trim(p_source_key), trim(p_provider_customer_id), nullif(trim(p_provider_subscription_id), ''),
    nullif(trim(p_checkout_session_id), ''), p_status,
    coalesce(p_cancel_at_period_end, false), p_current_period_end
  )
  on conflict (academy_community_id, source_type, source_key) do update
  set plan_id = excluded.plan_id,
      academy_member_id = excluded.academy_member_id,
      provider_customer_id = excluded.provider_customer_id,
      provider_subscription_id = excluded.provider_subscription_id,
      checkout_session_id = coalesce(excluded.checkout_session_id, public.academy_billing_subscriptions.checkout_session_id),
      status = excluded.status,
      cancel_at_period_end = excluded.cancel_at_period_end,
      current_period_end = excluded.current_period_end,
      updated_at = now();

  -- A delayed event cannot insert an already-ended grant with starts_at now.
  if p_status in ('active', 'trialing') and p_current_period_end <= now() then
    p_status := 'expired';
    update public.academy_billing_subscriptions set status = p_status
      where academy_community_id = member_row.academy_community_id
        and source_type = p_source_type and source_key = trim(p_source_key);
  end if;

  -- A plan change removes only this Stripe source's former entitlements. All
  -- imported/manual grants and grants from separate purchases are untouched.
  update public.academy_access_grants g set status = 'revoked', updated_at = now()
    where g.academy_member_id = member_row.id and g.source_type = p_source_type
      and g.source_key = trim(p_source_key)
      and ((g.course_id is null and not plan_row.community_access)
        or (g.course_id is not null and not exists (
          select 1 from public.academy_billing_plan_courses pc
          where pc.plan_id = plan_row.id and pc.course_id = g.course_id)));
  update public.course_enrollments e set status = 'cancelled', updated_at = now()
    where e.academy_member_id = member_row.id
      and exists (select 1 from public.academy_access_grants g where g.academy_member_id = e.academy_member_id
        and g.course_id = e.course_id and g.source_type = p_source_type and g.source_key = trim(p_source_key) and g.status = 'revoked')
      and not exists (select 1 from public.academy_access_grants g where g.academy_member_id = e.academy_member_id
        and g.course_id = e.course_id and g.status = 'active' and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now()));

  grant_status := case
    when p_status in ('active', 'trialing') then 'active'
    when p_status = 'expired' then 'expired'
    when p_status in ('cancelled') then 'revoked'
    else 'suspended'
  end;
  enrollment_status := case
    when grant_status = 'active' then 'active'
    when grant_status = 'expired' then 'expired'
    else 'cancelled'
  end;

  if plan_row.community_access then
    insert into public.academy_access_grants (
      academy_community_id, academy_member_id, source_type, source_key,
      status, starts_at, ends_at, metadata
    ) values (
      member_row.academy_community_id, member_row.id, p_source_type, trim(p_source_key),
      grant_status, now(), case when grant_status = 'active' then p_current_period_end else null end,
      jsonb_build_object('plan_id', plan_row.id)
    )
    on conflict (academy_member_id, source_type, source_key) where course_id is null
    do update set status = excluded.status,
                  ends_at = excluded.ends_at,
                  metadata = excluded.metadata,
                  updated_at = now();
  end if;

  for target_course_id in
    select pc.course_id
    from public.academy_billing_plan_courses pc
    join public.courses c on c.id = pc.course_id
    where pc.plan_id = plan_row.id
      and c.academy_community_id = plan_row.academy_community_id
  loop
    insert into public.academy_access_grants (
      academy_community_id, academy_member_id, course_id, source_type, source_key,
      status, starts_at, ends_at, metadata
    ) values (
      member_row.academy_community_id, member_row.id, target_course_id,
      p_source_type, trim(p_source_key), grant_status, now(),
      case when grant_status = 'active' then p_current_period_end else null end,
      jsonb_build_object('plan_id', plan_row.id)
    )
    on conflict (academy_member_id, course_id, source_type, source_key)
      where course_id is not null
    do update set status = excluded.status,
                  ends_at = excluded.ends_at,
                  metadata = excluded.metadata,
                  updated_at = now();

    insert into public.course_enrollments (
      academy_community_id, academy_member_id, course_id, status,
      source_provider, external_id, enrolled_at, access_expires_at
    ) values (
      member_row.academy_community_id, member_row.id, target_course_id,
      enrollment_status, 'stripe', trim(p_source_key), now(), p_current_period_end
    )
    on conflict (academy_member_id, course_id) do update
    set status = case
          when excluded.status = 'active' and public.course_enrollments.status = 'completed' then 'completed'
          when excluded.status = 'active' then 'active'
          when exists (
            select 1 from public.academy_access_grants g
            where g.academy_member_id = excluded.academy_member_id
              and g.course_id = excluded.course_id
              and g.status = 'active'
              and (g.ends_at is null or g.ends_at > now())
          ) then public.course_enrollments.status
          else excluded.status
        end,
        access_expires_at = case
          when exists (select 1 from public.academy_access_grants g
            where g.academy_member_id = excluded.academy_member_id and g.course_id = excluded.course_id
              and g.status = 'active' and g.starts_at <= now() and g.ends_at is null) then null
          when excluded.status = 'active' then (select max(g.ends_at) from public.academy_access_grants g
            where g.academy_member_id = excluded.academy_member_id and g.course_id = excluded.course_id
              and g.status = 'active' and g.starts_at <= now() and g.ends_at > now())
          else public.course_enrollments.access_expires_at
        end,
        updated_at = now();
  end loop;

  return jsonb_build_object(
    'memberId', member_row.id,
    'communityId', member_row.academy_community_id,
    'planId', plan_row.id,
    'status', p_status,
    'grantStatus', grant_status
  );
end;
$$;

