-- Academy billing and source-aware entitlements. Existing HighLevel members keep
-- imported access independently from future Stripe purchases.

create table public.academy_billing_plans (
  id uuid primary key default gen_random_uuid(),
  academy_community_id uuid not null references public.academy_communities(id) on delete cascade,
  slug text not null,
  name text not null,
  description text not null default '',
  stripe_price_id text,
  billing_type text not null default 'subscription'
    check (billing_type in ('subscription', 'one_time')),
  billing_interval text not null default 'month'
    check (billing_interval in ('month', 'year', 'one_time')),
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  trial_days integer not null default 0 check (trial_days between 0 and 365),
  community_access boolean not null default true,
  active boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academy_community_id, slug),
  unique (stripe_price_id),
  check (
    (billing_type = 'one_time' and billing_interval = 'one_time')
    or (billing_type = 'subscription' and billing_interval in ('month', 'year'))
  )
);

create table public.academy_billing_plan_courses (
  plan_id uuid not null references public.academy_billing_plans(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (plan_id, course_id)
);

create table public.academy_billing_customers (
  id uuid primary key default gen_random_uuid(),
  academy_community_id uuid not null references public.academy_communities(id) on delete cascade,
  academy_member_id uuid not null references public.academy_members(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null default 'stripe' check (provider = 'stripe'),
  provider_customer_id text not null unique,
  email text not null check (position('@' in email) > 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academy_community_id, academy_member_id)
);

create table public.academy_billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  academy_community_id uuid not null references public.academy_communities(id) on delete cascade,
  academy_member_id uuid not null references public.academy_members(id) on delete cascade,
  plan_id uuid not null references public.academy_billing_plans(id) on delete restrict,
  source_type text not null check (source_type in ('stripe_subscription', 'stripe_payment')),
  source_key text not null,
  provider_customer_id text not null,
  provider_subscription_id text,
  checkout_session_id text,
  status text not null default 'pending'
    check (status in ('pending', 'trialing', 'active', 'past_due', 'paused', 'cancelled', 'expired')),
  cancel_at_period_end boolean not null default false,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academy_community_id, source_type, source_key)
);

create table public.academy_access_grants (
  id uuid primary key default gen_random_uuid(),
  academy_community_id uuid not null references public.academy_communities(id) on delete cascade,
  academy_member_id uuid not null references public.academy_members(id) on delete cascade,
  course_id uuid references public.courses(id) on delete cascade,
  source_type text not null check (source_type in ('import', 'manual', 'stripe_subscription', 'stripe_payment')),
  source_key text not null,
  status text not null default 'active'
    check (status in ('active', 'suspended', 'revoked', 'expired')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);

create unique index academy_access_grants_community_source_idx
  on public.academy_access_grants(academy_member_id, source_type, source_key)
  where course_id is null;
create unique index academy_access_grants_course_source_idx
  on public.academy_access_grants(academy_member_id, course_id, source_type, source_key)
  where course_id is not null;
create index academy_access_grants_active_member_idx
  on public.academy_access_grants(academy_member_id, academy_community_id, status, ends_at);
create index academy_billing_subscriptions_member_idx
  on public.academy_billing_subscriptions(academy_member_id, status, updated_at desc);

create or replace function public.validate_academy_billing_plan_course()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.academy_billing_plans p
    join public.courses c on c.id = new.course_id
    where p.id = new.plan_id
      and c.academy_community_id = p.academy_community_id
  ) then
    raise exception 'Billing plan and course must belong to the same Academy community';
  end if;
  return new;
end;
$$;

create trigger academy_billing_plan_courses_scope
  before insert or update on public.academy_billing_plan_courses
  for each row execute function public.validate_academy_billing_plan_course();
create trigger academy_billing_plans_updated_at before update on public.academy_billing_plans
  for each row execute function public.set_updated_at();
create trigger academy_billing_customers_updated_at before update on public.academy_billing_customers
  for each row execute function public.set_updated_at();
create trigger academy_billing_subscriptions_updated_at before update on public.academy_billing_subscriptions
  for each row execute function public.set_updated_at();
create trigger academy_access_grants_updated_at before update on public.academy_access_grants
  for each row execute function public.set_updated_at();

-- Preserve every active imported member and enrollment before access checks are
-- switched to grants. These rows can never be revoked by Stripe events.
insert into public.academy_access_grants (
  academy_community_id, academy_member_id, source_type, source_key, status, starts_at,
  metadata
)
select m.academy_community_id, m.id, 'import', 'member:' || m.id::text, 'active',
       coalesce(m.joined_at, m.created_at), jsonb_build_object('preserved_at_cutover', true)
from public.academy_members m
where m.status = 'active'
on conflict (academy_member_id, source_type, source_key) where course_id is null
do nothing;

insert into public.academy_access_grants (
  academy_community_id, academy_member_id, course_id, source_type, source_key,
  status, starts_at, ends_at, metadata
)
select e.academy_community_id, e.academy_member_id, e.course_id, 'import',
       'enrollment:' || e.id::text,
       case
         when e.status in ('active', 'completed')
           and (e.access_expires_at is null or e.access_expires_at > now()) then 'active'
         when e.status = 'expired'
           or (e.access_expires_at is not null and e.access_expires_at <= now()) then 'expired'
         when e.status = 'pending' then 'suspended'
         else 'revoked'
       end,
       coalesce(e.enrolled_at, e.created_at),
       case
         when e.access_expires_at > coalesce(e.enrolled_at, e.created_at)
           then e.access_expires_at
         else null
       end,
       jsonb_build_object('preserved_at_cutover', true, 'source_status', e.status)
from public.course_enrollments e
on conflict (academy_member_id, course_id, source_type, source_key)
  where course_id is not null
do nothing;

create or replace function private.has_active_academy_grant(
  target_member_id uuid,
  target_course_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.academy_access_grants grant_row
    where grant_row.academy_member_id = target_member_id
      and grant_row.status = 'active'
      and grant_row.starts_at <= now()
      and (grant_row.ends_at is null or grant_row.ends_at > now())
      and (
        (target_course_id is null and grant_row.course_id is null)
        or (target_course_id is not null and grant_row.course_id = target_course_id)
      )
  );
$$;

create or replace function private.is_academy_member(target_community_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.can_manage_academy(target_community_id)) or exists (
    select 1
    from public.academy_members m
    where m.academy_community_id = target_community_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and (select private.has_active_academy_grant(m.id, null))
  );
$$;

create or replace function private.is_academy_identity(target_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.academy_members m
    where m.id = target_member_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and (
        (select private.can_manage_academy(m.academy_community_id))
        or (select private.has_active_academy_grant(m.id, null))
      )
  );
$$;

create or replace function private.can_access_course(target_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.courses c
    where c.id = target_course_id
      and (select private.can_manage_academy(c.academy_community_id))
  ) or exists (
    select 1
    from public.courses c
    join public.academy_members m
      on m.academy_community_id = c.academy_community_id
     and m.user_id = (select auth.uid())
     and m.status = 'active'
    where c.id = target_course_id
      and c.status = 'published'
      and (
        (
          (select private.has_active_academy_grant(m.id, null))
          and (
            c.access_type = 'open'
            or (c.access_type = 'level' and m.level >= coalesce(c.required_level, 1))
          )
        )
        or (select private.has_active_academy_grant(m.id, c.id))
      )
  );
$$;

create or replace function private.can_access_academy_lesson_progress(
  target_member_id uuid,
  target_lesson_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.academy_members m
    join public.course_lessons l on l.id = target_lesson_id
    join public.course_modules cm on cm.id = l.module_id
    join public.courses c on c.id = cm.course_id
    where m.id = target_member_id
      and m.status = 'active'
      and c.academy_community_id = m.academy_community_id
      and (
        (m.user_id = (select auth.uid()) and (select private.can_access_course(c.id)))
        or (select private.can_manage_academy(m.academy_community_id))
      )
  );
$$;

create or replace function public.get_academy_access_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  member_row public.academy_members%rowtype;
  managed_community_id uuid;
  manager_access boolean := false;
  granted_access boolean := false;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into member_row
  from public.academy_members
  where user_id = current_user_id and status = 'active'
  order by created_at
  limit 1;

  if member_row.id is null then
    select c.id into managed_community_id
    from public.academy_communities c
    where (select private.can_manage_academy(c.id))
    order by c.created_at
    limit 1;

    return jsonb_build_object(
      'authenticated', true,
      'hasAccess', managed_community_id is not null,
      'canManage', managed_community_id is not null,
      'communityId', managed_community_id
    );
  end if;

  manager_access := (select private.can_manage_academy(member_row.academy_community_id));
  granted_access := (select private.has_active_academy_grant(member_row.id, null))
    or exists (
      select 1 from public.academy_access_grants g
      where g.academy_member_id = member_row.id
        and g.status = 'active'
        and g.starts_at <= now()
        and (g.ends_at is null or g.ends_at > now())
    );

  return jsonb_build_object(
    'authenticated', true,
    'hasAccess', manager_access or granted_access,
    'canManage', manager_access,
    'memberId', member_row.id,
    'communityId', member_row.academy_community_id
  );
end;
$$;

create or replace function public.get_academy_billing_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  member_row public.academy_members%rowtype;
  plan_rows jsonb := '[]'::jsonb;
  subscription_row jsonb;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into member_row
  from public.academy_members
  where user_id = current_user_id and status = 'active'
  order by created_at
  limit 1;
  if member_row.id is null then
    return jsonb_build_object('plans', plan_rows, 'subscription', null);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'description', p.description,
    'billingType', p.billing_type,
    'billingInterval', p.billing_interval,
    'amountCents', p.amount_cents,
    'currency', p.currency,
    'trialDays', p.trial_days
  ) order by p.amount_cents), '[]'::jsonb)
  into plan_rows
  from public.academy_billing_plans p
  where p.academy_community_id = member_row.academy_community_id
    and p.active = true
    and p.stripe_price_id is not null;

  select jsonb_build_object(
    'status', s.status,
    'cancelAtPeriodEnd', s.cancel_at_period_end,
    'currentPeriodEnd', s.current_period_end,
    'planName', p.name,
    'billingType', p.billing_type
  )
  into subscription_row
  from public.academy_billing_subscriptions s
  join public.academy_billing_plans p on p.id = s.plan_id
  where s.academy_member_id = member_row.id
  order by s.updated_at desc
  limit 1;

  return jsonb_build_object('plans', plan_rows, 'subscription', subscription_row);
end;
$$;

create or replace function public.upsert_academy_import_access_grant(
  p_member_id uuid,
  p_course_id uuid,
  p_source_key text,
  p_status text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_metadata jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_community_id uuid;
  course_community_id uuid;
  grant_id uuid;
  safe_start timestamptz := coalesce(p_starts_at, now());
  safe_end timestamptz;
begin
  if p_status not in ('active', 'suspended', 'revoked', 'expired') then
    raise exception 'Invalid import grant status';
  end if;
  if nullif(trim(p_source_key), '') is null then
    raise exception 'Import grant source key is required';
  end if;

  select academy_community_id into member_community_id
  from public.academy_members
  where id = p_member_id;
  if member_community_id is null then
    raise exception 'Academy member does not exist';
  end if;

  if p_course_id is not null then
    select academy_community_id into course_community_id
    from public.courses
    where id = p_course_id;
    if course_community_id is null or course_community_id <> member_community_id then
      raise exception 'Academy member and course do not match';
    end if;
  end if;

  safe_end := case when p_ends_at > safe_start then p_ends_at else null end;

  if p_course_id is null then
    insert into public.academy_access_grants (
      academy_community_id, academy_member_id, source_type, source_key,
      status, starts_at, ends_at, metadata
    ) values (
      member_community_id, p_member_id, 'import', trim(p_source_key),
      p_status, safe_start, safe_end, coalesce(p_metadata, '{}'::jsonb)
    )
    on conflict (academy_member_id, source_type, source_key) where course_id is null
    do update set status = excluded.status,
                  starts_at = excluded.starts_at,
                  ends_at = excluded.ends_at,
                  metadata = excluded.metadata,
                  updated_at = now()
    returning id into grant_id;
  else
    insert into public.academy_access_grants (
      academy_community_id, academy_member_id, course_id, source_type, source_key,
      status, starts_at, ends_at, metadata
    ) values (
      member_community_id, p_member_id, p_course_id, 'import', trim(p_source_key),
      p_status, safe_start, safe_end, coalesce(p_metadata, '{}'::jsonb)
    )
    on conflict (academy_member_id, course_id, source_type, source_key)
      where course_id is not null
    do update set status = excluded.status,
                  starts_at = excluded.starts_at,
                  ends_at = excluded.ends_at,
                  metadata = excluded.metadata,
                  updated_at = now()
    returning id into grant_id;
  end if;

  return grant_id;
end;
$$;

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
  select * into member_row from public.academy_members where id = p_member_id;
  if plan_row.id is null or member_row.id is null
     or plan_row.academy_community_id <> member_row.academy_community_id then
    raise exception 'Billing plan and Academy member do not match';
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
          when excluded.status = 'active' then excluded.access_expires_at
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

alter table public.academy_billing_plans enable row level security;
alter table public.academy_billing_plan_courses enable row level security;
alter table public.academy_billing_customers enable row level security;
alter table public.academy_billing_subscriptions enable row level security;
alter table public.academy_access_grants enable row level security;

revoke all on public.academy_billing_plans from anon;
revoke all on public.academy_billing_plan_courses from anon;
revoke all on public.academy_billing_customers from anon;
revoke all on public.academy_billing_subscriptions from anon;
revoke all on public.academy_access_grants from anon;

grant select on public.academy_billing_plans to authenticated;
grant select on public.academy_billing_plan_courses to authenticated;
grant select on public.academy_billing_customers to authenticated;
grant select on public.academy_billing_subscriptions to authenticated;
grant select on public.academy_access_grants to authenticated;
grant all on public.academy_billing_plans to service_role;
grant all on public.academy_billing_plan_courses to service_role;
grant all on public.academy_billing_customers to service_role;
grant all on public.academy_billing_subscriptions to service_role;
grant all on public.academy_access_grants to service_role;

create policy "academy_billing_plans_member_select" on public.academy_billing_plans
  for select to authenticated
  using ((select private.is_academy_member(academy_community_id)) or (select private.can_manage_academy(academy_community_id)));
create policy "academy_billing_plan_courses_member_select" on public.academy_billing_plan_courses
  for select to authenticated
  using (exists (
    select 1 from public.academy_billing_plans p
    where p.id = plan_id
      and ((select private.is_academy_member(p.academy_community_id)) or (select private.can_manage_academy(p.academy_community_id)))
  ));
create policy "academy_billing_customers_self_select" on public.academy_billing_customers
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.can_manage_academy(academy_community_id)));
create policy "academy_billing_subscriptions_self_select" on public.academy_billing_subscriptions
  for select to authenticated
  using ((select private.is_academy_identity(academy_member_id)) or (select private.can_manage_academy(academy_community_id)));
create policy "academy_access_grants_self_select" on public.academy_access_grants
  for select to authenticated
  using (
    academy_member_id in (select id from public.academy_members where user_id = (select auth.uid()))
    or (select private.can_manage_academy(academy_community_id))
  );

revoke all on function private.has_active_academy_grant(uuid, uuid) from public, anon;
grant usage on schema private to service_role;
grant execute on function private.has_active_academy_grant(uuid, uuid) to authenticated, service_role;
revoke all on function public.validate_academy_billing_plan_course() from public, anon, authenticated;
revoke all on function public.get_academy_access_state() from public, anon;
grant execute on function public.get_academy_access_state() to authenticated;
revoke all on function public.get_academy_billing_overview() from public, anon;
grant execute on function public.get_academy_billing_overview() to authenticated;
revoke all on function public.upsert_academy_import_access_grant(
  uuid, uuid, text, text, timestamptz, timestamptz, jsonb
) from public, anon, authenticated;
grant execute on function public.upsert_academy_import_access_grant(
  uuid, uuid, text, text, timestamptz, timestamptz, jsonb
) to service_role;
revoke all on function public.apply_academy_billing_event(
  uuid, uuid, text, text, text, text, boolean, timestamptz, text, text, text
) from public, anon, authenticated;
grant execute on function public.apply_academy_billing_event(
  uuid, uuid, text, text, text, text, boolean, timestamptz, text, text, text
) to service_role;
