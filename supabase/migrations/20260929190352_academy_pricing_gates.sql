-- Pricing preparation only: nothing becomes chargeable until an explicit cutover.
alter table public.academy_communities add column pricing_gates_enabled boolean not null default false;
alter table public.academy_billing_plans
  add column offer_kind text not null default 'membership' check (offer_kind in ('membership','course','tool')),
  add column requires_membership boolean not null default false;

create table public.academy_billing_plan_features (
  plan_id uuid not null references public.academy_billing_plans(id) on delete cascade,
  feature_key text not null check (feature_key in ('measuring_tool','seo_tools')),
  primary key (plan_id,feature_key)
);
create table public.academy_feature_grants (
  id uuid primary key default gen_random_uuid(),
  academy_community_id uuid not null references public.academy_communities(id) on delete cascade,
  academy_member_id uuid not null references public.academy_members(id) on delete cascade,
  feature_key text not null check (feature_key in ('measuring_tool','seo_tools')),
  source_type text not null check (source_type in ('import','manual','stripe_subscription','stripe_payment')),
  source_key text not null check (length(trim(source_key)) > 0),
  status text not null default 'active' check (status in ('active','suspended','revoked','expired')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(academy_member_id,feature_key,source_type,source_key),
  check(ends_at is null or ends_at > starts_at)
);
create index academy_feature_grants_member_active on public.academy_feature_grants(academy_member_id,status,ends_at);
alter table public.academy_billing_plan_features enable row level security;
alter table public.academy_feature_grants enable row level security;
revoke all on public.academy_billing_plan_features,public.academy_feature_grants from public,anon,authenticated;
grant all on public.academy_billing_plan_features,public.academy_feature_grants to service_role;

create function private.validate_academy_feature_grant_scope() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.academy_members m where m.id=new.academy_member_id and m.academy_community_id=new.academy_community_id) then
    raise exception 'Feature grant and member must belong to the same Academy community';
  end if;
  return new;
end;
$$;
create trigger academy_feature_grant_scope before insert or update on public.academy_feature_grants
  for each row execute function private.validate_academy_feature_grant_scope();
create trigger academy_feature_grants_updated_at before update on public.academy_feature_grants
  for each row execute function public.set_updated_at();
revoke all on function private.validate_academy_feature_grant_scope() from public,anon,authenticated;

create function private.has_active_academy_feature(target_member_id uuid,target_feature text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.academy_feature_grants g where g.academy_member_id=target_member_id
    and g.feature_key=target_feature and g.status='active' and g.starts_at<=now() and (g.ends_at is null or g.ends_at>now()));
$$;
revoke all on function private.has_active_academy_feature(uuid,text) from public,anon,authenticated;

create or replace function public.get_academy_access_state()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  current_user_id uuid := (select auth.uid());
  member_row public.academy_members%rowtype;
  community_id uuid;
  manager_access boolean := false;
  community_access boolean := false;
  gates boolean := false;
  course_ids jsonb := '[]';
  feature_keys jsonb := '[]';
  has_grant boolean := false;
begin
  if current_user_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into member_row from public.academy_members where user_id=current_user_id order by (status='active') desc,
    (select c.pricing_gates_enabled from public.academy_communities c where c.id=academy_community_id) desc,created_at limit 1;
  community_id:=member_row.academy_community_id;
  if community_id is null then
    select c.id into community_id from public.academy_communities c where private.can_manage_academy(c.id) order by c.created_at limit 1;
  end if;
  if community_id is not null then
    manager_access:=private.can_manage_academy(community_id);
    select pricing_gates_enabled into gates from public.academy_communities where id=community_id;
    community_access:=manager_access or (member_row.status='active' and private.has_active_academy_grant(member_row.id,null));
    select coalesce(jsonb_agg(c.id order by c.id),'[]') into course_ids from public.courses c
      where c.academy_community_id=community_id and private.can_access_course(c.id);
    select exists(select 1 from public.academy_access_grants g where g.academy_member_id=member_row.id
      and g.status='active' and g.starts_at<=now() and (g.ends_at is null or g.ends_at>now()))
      or exists(select 1 from public.academy_feature_grants g where g.academy_member_id=member_row.id
      and g.status='active' and g.starts_at<=now() and (g.ends_at is null or g.ends_at>now())) into has_grant;
    -- A compatibility flag never turns an expired account into a paying member.
    has_grant:=coalesce(member_row.status='active',false) and has_grant;
    if manager_access or has_grant then
      select coalesce(jsonb_agg(f.key order by f.key),'[]') into feature_keys
      from (values('measuring_tool'),('seo_tools')) as f(key)
      where manager_access or not gates or private.has_active_academy_feature(member_row.id,f.key);
    end if;
  end if;
  if community_id is null then
    select exists(select 1 from public.academy_communities where pricing_gates_enabled) into gates;
  end if;
  return jsonb_build_object('authenticated',true,'hasAccess',manager_access or has_grant,
    'canManage',manager_access,'memberId',case when member_row.status='active' then member_row.id else null end,'communityId',community_id,
    'communityAccess',community_access,'courseIds',course_ids,'features',feature_keys,'pricingGatesEnabled',gates);
end;
$$;

-- Only trusted checkout workers may resolve identities from an email address.
create function public.get_academy_checkout_eligibility(p_plan_id uuid,p_email text,p_user_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  plan_row public.academy_billing_plans%rowtype;
  member_row public.academy_members%rowtype;
  normalized_email text:=lower(trim(p_email));
  reason text;
  matching_members integer;
begin
  select * into plan_row from public.academy_billing_plans where id=p_plan_id;
  if plan_row.id is null or not plan_row.active or nullif(trim(plan_row.stripe_price_id),'') is null then
    return jsonb_build_object('allowed',false,'reason','invalid_plan','memberId',null);
  end if;
  if normalized_email is null or length(normalized_email)>254 or position('@' in normalized_email)<=1 then
    return jsonb_build_object('allowed',false,'reason','invalid_identity','memberId',null);
  end if;
  if p_user_id is not null and not exists(select 1 from auth.users u where u.id=p_user_id and lower(trim(u.email))=normalized_email) then
    return jsonb_build_object('allowed',false,'reason','invalid_identity','memberId',null);
  end if;
  -- Never charge for an unmapped, unpublished, or mixed-scope product.
  if (plan_row.offer_kind='membership' and not plan_row.community_access)
    or (plan_row.offer_kind<>'membership' and plan_row.community_access)
    or (plan_row.offer_kind in ('membership','course') and (not exists(select 1 from public.academy_billing_plan_courses where plan_id=p_plan_id) or exists(select 1 from public.academy_billing_plan_features where plan_id=p_plan_id)))
    or (plan_row.offer_kind='tool' and (not exists(select 1 from public.academy_billing_plan_features where plan_id=p_plan_id) or exists(select 1 from public.academy_billing_plan_courses where plan_id=p_plan_id)))
    or exists(select 1 from public.academy_billing_plan_courses pc join public.courses c on c.id=pc.course_id
      where pc.plan_id=p_plan_id and (c.academy_community_id<>plan_row.academy_community_id or c.status<>'published')) then
    return jsonb_build_object('allowed',false,'reason','invalid_plan','memberId',null);
  end if;
  select count(distinct m.id) into matching_members from public.academy_members m
    left join auth.users u on u.id=m.user_id left join public.academy_member_invites i on i.academy_member_id=m.id
    where m.academy_community_id=plan_row.academy_community_id
      and (lower(trim(u.email))=normalized_email or lower(trim(i.email))=normalized_email);
  if matching_members>1 then return jsonb_build_object('allowed',false,'reason','invalid_identity','memberId',null); end if;
  select m.* into member_row from public.academy_members m
    left join auth.users u on u.id=m.user_id left join public.academy_member_invites i on i.academy_member_id=m.id
    where m.academy_community_id=plan_row.academy_community_id
      and (lower(trim(u.email))=normalized_email or lower(trim(i.email))=normalized_email) limit 1;
  if member_row.id is not null and (member_row.status<>'active' or (p_user_id is not null and member_row.user_id is distinct from p_user_id)) then
    reason:='invalid_identity';
  elsif plan_row.offer_kind<>'membership' and (p_user_id is null or member_row.id is null) then reason:='sign_in_required';
  elsif plan_row.requires_membership and not private.has_active_academy_grant(member_row.id,null) then reason:='membership_required';
  elsif exists(select 1 from public.academy_billing_plan_courses pc join public.academy_course_access_denials d on d.course_id=pc.course_id
      where pc.plan_id=p_plan_id and d.academy_member_id=member_row.id) then reason:='resource_unavailable';
  elsif plan_row.community_access and private.has_active_academy_grant(member_row.id,null) then reason:='existing_access';
  elsif exists(select 1 from public.academy_billing_plan_courses pc join public.courses c on c.id=pc.course_id where pc.plan_id=p_plan_id
      and (private.has_active_academy_grant(member_row.id,c.id) or (private.has_active_academy_grant(member_row.id,null)
      and (c.access_type='open' or (c.access_type='level' and member_row.level>=coalesce(c.required_level,1)))))) then reason:='existing_access';
  elsif exists(select 1 from public.academy_billing_plan_features pf where pf.plan_id=p_plan_id and private.has_active_academy_feature(member_row.id,pf.feature_key)) then reason:='existing_access';
  end if;
  return jsonb_build_object('allowed',reason is null,'reason',reason,'memberId',member_row.id);
end;
$$;
revoke all on function public.get_academy_checkout_eligibility(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.get_academy_checkout_eligibility(uuid,text,uuid) to service_role;

-- Serialize concurrent purchases by identity. Add-ons use the same atomic guard.
drop function public.reserve_academy_checkout(uuid,text,uuid);
create function public.reserve_academy_checkout(p_plan_id uuid,p_email text,p_request_id uuid,p_user_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  community_id uuid;
  normalized_email text:=lower(trim(p_email));
  eligibility jsonb;
  reservation public.academy_checkout_reservations%rowtype;
begin
  select academy_community_id into community_id from public.academy_billing_plans where id=p_plan_id;
  if community_id is null or p_request_id is null then raise exception 'Invalid checkout request'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(community_id::text || ':' || coalesce(normalized_email,''),0));
  eligibility:=public.get_academy_checkout_eligibility(p_plan_id,p_email,p_user_id);
  if not (eligibility->>'allowed')::boolean then return jsonb_build_object('blocked',true,'reason',eligibility->>'reason'); end if;
  select * into reservation from public.academy_checkout_reservations where academy_community_id=community_id and email=normalized_email;
  if reservation.id is not null and reservation.expires_at>now() then
    if reservation.request_id<>p_request_id or reservation.plan_id<>p_plan_id then
      return jsonb_build_object('blocked',true,'reason','checkout_in_progress');
    end if;
  else
    insert into public.academy_checkout_reservations(academy_community_id,email,plan_id,request_id,expires_at)
    values(community_id,normalized_email,p_plan_id,p_request_id,now()+interval '1 hour')
    on conflict(academy_community_id,email) do update set id=gen_random_uuid(),plan_id=excluded.plan_id,
      request_id=excluded.request_id,expires_at=excluded.expires_at,checkout_session_id=null,checkout_url=null returning * into reservation;
  end if;
  return jsonb_build_object('blocked',false,'id',reservation.id,'url',reservation.checkout_url,'expiresAt',floor(extract(epoch from reservation.expires_at)));
end;
$$;
revoke all on function public.reserve_academy_checkout(uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.reserve_academy_checkout(uuid,text,uuid,uuid) to service_role;

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
  target_feature text;
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

  if p_status in ('active','trialing') and (
    (plan_row.offer_kind='membership' and not plan_row.community_access)
    or (plan_row.offer_kind<>'membership' and plan_row.community_access)
    or (plan_row.offer_kind in ('membership','course') and (not exists(select 1 from public.academy_billing_plan_courses where plan_id=plan_row.id) or exists(select 1 from public.academy_billing_plan_features where plan_id=plan_row.id)))
    or (plan_row.offer_kind='tool' and (not exists(select 1 from public.academy_billing_plan_features where plan_id=plan_row.id) or exists(select 1 from public.academy_billing_plan_courses where plan_id=plan_row.id)))
  ) then raise exception 'Billing plan entitlement mapping is incomplete'; end if;

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

  -- Source-scoped feature reconciliation never revokes another purchase/import.
  update public.academy_feature_grants g set status='revoked',updated_at=now()
    where g.academy_member_id=member_row.id and g.source_type=p_source_type and g.source_key=trim(p_source_key)
      and not exists(select 1 from public.academy_billing_plan_features pf where pf.plan_id=plan_row.id and pf.feature_key=g.feature_key);
  for target_feature in select pf.feature_key from public.academy_billing_plan_features pf where pf.plan_id=plan_row.id loop
    insert into public.academy_feature_grants(academy_community_id,academy_member_id,feature_key,source_type,source_key,status,starts_at,ends_at,metadata)
      values(member_row.academy_community_id,member_row.id,target_feature,p_source_type,trim(p_source_key),grant_status,now(),
        case when grant_status='active' then p_current_period_end else null end,jsonb_build_object('plan_id',plan_row.id))
      on conflict(academy_member_id,feature_key,source_type,source_key) do update set status=excluded.status,
        ends_at=excluded.ends_at,metadata=excluded.metadata,updated_at=now();
  end loop;

  -- Completion frees this exact checkout only; delayed/refund events cannot
  -- release a newer reservation for an independent upgrade.
  if p_status in ('active','trialing') and nullif(trim(p_checkout_session_id),'') is not null then
    delete from public.academy_checkout_reservations where academy_community_id=member_row.academy_community_id
      and email=lower(trim(p_email)) and checkout_session_id=trim(p_checkout_session_id);
  end if;

  return jsonb_build_object(
    'memberId', member_row.id,
    'communityId', member_row.academy_community_id,
    'planId', plan_row.id,
    'status', p_status,
    'grantStatus', grant_status
  );
end;
$$;

create or replace function public.get_academy_billing_overview()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  current_user_id uuid:=(select auth.uid());
  member_row public.academy_members%rowtype;
  user_email text;
  plans jsonb:='[]';
  subscriptions jsonb:='[]';
begin
  if current_user_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into member_row from public.academy_members where user_id=current_user_id and status='active' order by created_at limit 1;
  if member_row.id is null then return jsonb_build_object('plans',plans,'subscriptions',subscriptions,'subscription',null); end if;
  select email into user_email from auth.users where id=current_user_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'description',p.description,
    'billingType',p.billing_type,'billingInterval',p.billing_interval,'amountCents',p.amount_cents,'currency',p.currency,
    'trialDays',p.trial_days,'offerKind',p.offer_kind,'requiresMembership',p.requires_membership,'communityAccess',p.community_access,
    'courseIds',(select coalesce(jsonb_agg(pc.course_id order by pc.course_id),'[]') from public.academy_billing_plan_courses pc where pc.plan_id=p.id),
    'features',(select coalesce(jsonb_agg(pf.feature_key order by pf.feature_key),'[]') from public.academy_billing_plan_features pf where pf.plan_id=p.id),
    'canPurchase',(public.get_academy_checkout_eligibility(p.id,user_email,current_user_id)->>'allowed')::boolean,
    'unavailableReason',public.get_academy_checkout_eligibility(p.id,user_email,current_user_id)->>'reason') order by p.amount_cents),'[]')
    into plans from public.academy_billing_plans p where p.academy_community_id=member_row.academy_community_id and p.active and p.stripe_price_id is not null;
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'planId',s.plan_id,'status',s.status,'cancelAtPeriodEnd',s.cancel_at_period_end,
    'currentPeriodEnd',s.current_period_end,'planName',p.name,'billingType',p.billing_type,'offerKind',p.offer_kind) order by s.updated_at desc,s.id),'[]')
    into subscriptions from public.academy_billing_subscriptions s join public.academy_billing_plans p on p.id=s.plan_id where s.academy_member_id=member_row.id;
  return jsonb_build_object('plans',plans,'subscriptions',subscriptions,'subscription',subscriptions->0);
end;
$$;

-- Defense at the underlying table covers every estimate RPC and direct inserts.
-- Previously saved measurements remain readable and exportable after expiry.
create function private.enforce_academy_measurement_feature()
returns trigger language plpgsql security definer set search_path='' as $$
declare state jsonb;
begin
  if new.method in ('map','camera') or (tg_op='UPDATE' and old.method in ('map','camera')) then
    if (select auth.uid()) is not null then
      state:=public.get_academy_access_state();
      if (state->>'pricingGatesEnabled')::boolean and (not (state->>'hasAccess')::boolean or not (state->'features' ? 'measuring_tool')) then
        raise exception 'Measuring tool subscription required' using errcode='42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_academy_measurement_feature() from public,anon,authenticated;
create trigger academy_measurement_feature_guard before insert or update on public.measurements
  for each row execute function private.enforce_academy_measurement_feature();

-- Explicit privileges for all newly introduced entry points. Existing RPC grants
-- are repeated here so the migration is independently auditable.
revoke all on function public.get_academy_access_state(),public.get_academy_billing_overview() from public,anon;
grant execute on function public.get_academy_access_state(),public.get_academy_billing_overview() to authenticated,service_role;
revoke all on function public.apply_academy_billing_event(uuid,uuid,text,text,text,text,boolean,timestamptz,text,text,text) from public,anon,authenticated;
grant execute on function public.apply_academy_billing_event(uuid,uuid,text,text,text,text,boolean,timestamptz,text,text,text) to service_role;

-- Every signup owns an operator organization. That must not let them mint an
-- Academy community and inherit paid-feature manager access. Provisioning stays
-- service-only; management of existing communities retains its existing RLS.
revoke insert on public.academy_communities from authenticated;
