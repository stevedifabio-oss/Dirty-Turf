-- Preparation only. All store products, purchases, trials and separate-access cutover
-- remain disabled until the owner deliberately activates the reviewed configuration.
alter table public.academy_communities
  add column separate_access_enabled boolean not null default false,
  add column store_purchases_enabled boolean not null default false,
  add column scanner_trial_enabled boolean not null default false;

-- A snapshot identifies the original grant source, so its renewal, expiry or
-- cancellation continues to control grandfathered access. No free grants are minted.
create table private.academy_legacy_access_scopes (
  academy_member_id uuid not null references public.academy_members(id) on delete cascade,
  source_type text not null,
  source_key text not null,
  resource_key text not null,
  primary key (academy_member_id, source_type, source_key, resource_key)
);
alter table private.academy_legacy_access_scopes enable row level security;
revoke all on private.academy_legacy_access_scopes from public, anon, authenticated;

alter table public.academy_access_grants drop constraint academy_access_grants_source_type_check;
alter table public.academy_access_grants add constraint academy_access_grants_source_type_check
  check (source_type in ('import','manual','stripe_subscription','stripe_payment','google_subscription','apple_subscription'));
alter table public.academy_feature_grants drop constraint academy_feature_grants_source_type_check;
alter table public.academy_feature_grants add constraint academy_feature_grants_source_type_check
  check (source_type in ('import','manual','stripe_subscription','stripe_payment','google_subscription','apple_subscription','self_trial'));

create table public.academy_store_products (
  provider text not null check (provider in ('google','apple')),
  product_id text not null check (product_id in ('dirty_turf_community_monthly','dirty_turf_scanner_monthly','dirty_turf_academy_monthly')),
  academy_community_id uuid not null references public.academy_communities(id) on delete cascade,
  resource_key text not null check (resource_key in ('community','measuring_tool','academy')),
  course_id uuid references public.courses(id) on delete cascade,
  active boolean not null default false,
  primary key (provider, product_id),
  check ((resource_key='academy') = (course_id is not null)),
  check ((product_id='dirty_turf_community_monthly' and resource_key='community')
    or (product_id='dirty_turf_scanner_monthly' and resource_key='measuring_tool')
    or (product_id='dirty_turf_academy_monthly' and resource_key='academy'))
);
alter table public.academy_store_products enable row level security;
revoke all on public.academy_store_products from public, anon, authenticated;
grant all on public.academy_store_products to service_role;

create table private.academy_store_test_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true
);
alter table private.academy_store_test_accounts enable row level security;
revoke all on private.academy_store_test_accounts from public, anon, authenticated;

create table public.academy_store_entitlements (
  provider text not null check (provider in ('google','apple')),
  environment text not null check (environment in ('production','sandbox')),
  source_key text not null check (source_key ~ '^[A-Za-z0-9:_-]+$' and char_length(source_key) between 1 and 256),
  -- Keep the immutable original account UUID when Auth is deleted, so account
  -- deletion is possible without making the old purchase transferable.
  user_id uuid not null,
  academy_member_id uuid references public.academy_members(id) on delete set null,
  product_id text not null check (product_id in ('dirty_turf_community_monthly','dirty_turf_scanner_monthly','dirty_turf_academy_monthly')),
  status text not null check (status in ('active','expired','revoked')),
  current_period_end timestamptz not null,
  auto_renew boolean not null default false,
  verified_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Product IDs are retained audit data too; deleting app content or its owning
  -- workspace must not be blocked by a historical store transaction.
  primary key (provider, environment, source_key)
);
create index academy_store_entitlements_user on public.academy_store_entitlements(user_id, status, current_period_end);
alter table public.academy_store_entitlements enable row level security;
revoke all on public.academy_store_entitlements from public, anon, authenticated;
grant all on public.academy_store_entitlements to service_role;

create function private.validate_store_product_scope()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.course_id is not null and not exists(select 1 from public.courses course
    where course.id=new.course_id and course.academy_community_id=new.academy_community_id) then
    raise exception 'Store product course must belong to its Academy';
  end if;
  if tg_op='UPDATE' and (new.provider,new.product_id,new.academy_community_id,new.resource_key,new.course_id)
    is distinct from (old.provider,old.product_id,old.academy_community_id,old.resource_key,old.course_id)
    and exists(select 1 from public.academy_store_entitlements
      where provider=old.provider and product_id=old.product_id) then
    raise exception 'A purchased store product cannot be remapped';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_store_product_scope() from public,anon,authenticated;
create trigger academy_store_product_scope before insert or update on public.academy_store_products
  for each row execute function private.validate_store_product_scope();

create table private.academy_scanner_trial_claims (
  user_id uuid primary key references auth.users(id) on delete cascade,
  academy_member_id uuid references public.academy_members(id) on delete set null,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at = started_at + interval '7 days')
);
alter table private.academy_scanner_trial_claims enable row level security;
revoke all on private.academy_scanner_trial_claims from public, anon, authenticated;

-- Seed only the reviewed mapping, never an invented or unpublished Academy course.
-- Products stay inactive and no provider resources or access records are created.
insert into public.academy_store_products(provider, product_id, academy_community_id, resource_key, course_id)
select provider, product_id, community.id, resource_key,
  case when resource_key='academy' then course.id else null end
from public.academy_communities community
cross join (values ('google'),('apple')) providers(provider)
cross join (values
  ('dirty_turf_community_monthly','community'),
  ('dirty_turf_scanner_monthly','measuring_tool'),
  ('dirty_turf_academy_monthly','academy')
) products(product_id,resource_key)
left join public.courses course on course.id='a0238fea-1bfd-46de-978d-f476492edec8'::uuid
  and course.academy_community_id=community.id and course.status='published'
where community.id='fac17da0-bdb9-48c0-9c67-591d087e9912'::uuid
  and (resource_key<>'academy' or course.id is not null);

create function private.store_grant_environment_allowed(target_member_id uuid, grant_metadata jsonb)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(grant_metadata->>'environment','production')='production'
    or (grant_metadata->>'environment'='sandbox' and exists(
      select 1 from public.academy_members member
      join private.academy_store_test_accounts tester on tester.user_id=member.user_id and tester.enabled
      where member.id=target_member_id));
$$;
revoke all on function private.store_grant_environment_allowed(uuid,jsonb) from public,anon,authenticated;

create or replace function private.has_active_academy_grant(target_member_id uuid,target_course_id uuid default null)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.academy_access_grants grant_row
    join public.academy_communities community on community.id=grant_row.academy_community_id
    where grant_row.academy_member_id=target_member_id
      and grant_row.course_id is not distinct from target_course_id
      and grant_row.status='active' and grant_row.starts_at<=now()
      and (grant_row.ends_at is null or grant_row.ends_at>now())
      and (not community.separate_access_enabled or grant_row.source_type<>'import' or exists(
        select 1 from private.academy_legacy_access_scopes scope
        where scope.academy_member_id=grant_row.academy_member_id
          and scope.source_type=grant_row.source_type and scope.source_key=grant_row.source_key
          and scope.resource_key=coalesce(grant_row.course_id::text,'community')))
      and (grant_row.source_type not in ('google_subscription','apple_subscription')
        or private.store_grant_environment_allowed(target_member_id,grant_row.metadata)));
$$;

create or replace function private.has_active_academy_feature(target_member_id uuid,target_feature text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.academy_feature_grants grant_row
    join public.academy_communities community on community.id=grant_row.academy_community_id
    where grant_row.academy_member_id=target_member_id and grant_row.feature_key=target_feature
      and grant_row.status='active' and grant_row.starts_at<=now()
      and (grant_row.ends_at is null or grant_row.ends_at>now())
      and (not community.separate_access_enabled or grant_row.source_type<>'import' or exists(
        select 1 from private.academy_legacy_access_scopes scope
        where scope.academy_member_id=grant_row.academy_member_id
          and scope.source_type=grant_row.source_type and scope.source_key=grant_row.source_key
          and scope.resource_key='feature:'||target_feature))
      and (grant_row.source_type not in ('google_subscription','apple_subscription')
        or private.store_grant_environment_allowed(target_member_id,grant_row.metadata)));
$$;

create or replace function private.can_access_course(target_course_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.courses course where course.id=target_course_id
    and private.can_manage_academy(course.academy_community_id))
  or exists(select 1 from public.courses course
    join public.academy_communities community on community.id=course.academy_community_id
    join public.academy_members member on member.academy_community_id=community.id
      and member.user_id=(select auth.uid()) and member.status='active'
    where course.id=target_course_id and course.status='published'
      and not exists(select 1 from public.academy_course_access_denials denial
        where denial.academy_member_id=member.id and denial.course_id=course.id)
      and (private.has_active_academy_grant(member.id,course.id) or exists(
        select 1 from public.academy_access_grants grant_row
        where grant_row.academy_member_id=member.id and grant_row.course_id is null
          and grant_row.status='active' and grant_row.starts_at<=now()
          and (grant_row.ends_at is null or grant_row.ends_at>now())
          and not (grant_row.source_type='manual' and grant_row.source_key='owner-free:community')
          and grant_row.source_type not in ('google_subscription','apple_subscription')
          and ((not community.separate_access_enabled
            and (course.access_type='open' or (course.access_type='level' and member.level>=coalesce(course.required_level,1))))
            or (community.separate_access_enabled and exists(
              select 1 from private.academy_legacy_access_scopes scope
              where scope.academy_member_id=member.id and scope.source_type=grant_row.source_type
                and scope.source_key=grant_row.source_key and scope.resource_key=course.id::text))))));
$$;

create function private.admin_activate_separate_access(p_community_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or not private.can_manage_academy_members(p_community_id) then
    raise exception 'Master owner access required' using errcode='42501';
  end if;
  perform 1 from public.academy_communities where id=p_community_id for update;
  if not found then raise exception 'Academy community not found'; end if;
  if exists(select 1 from public.academy_communities where id=p_community_id and separate_access_enabled) then return; end if;
  lock table public.academy_access_grants,public.academy_feature_grants,public.academy_members,
    public.courses,public.academy_course_access_denials in share row exclusive mode;
  insert into private.academy_legacy_access_scopes
    select member.id,grant_row.source_type,grant_row.source_key,coalesce(grant_row.course_id::text,'community')
    from public.academy_members member join public.academy_access_grants grant_row on grant_row.academy_member_id=member.id
    where member.academy_community_id=p_community_id and grant_row.source_type='import'
      and grant_row.status='active' and grant_row.starts_at<=now() and (grant_row.ends_at is null or grant_row.ends_at>now())
    on conflict do nothing;
  insert into private.academy_legacy_access_scopes
    select member.id,grant_row.source_type,grant_row.source_key,'feature:'||grant_row.feature_key
    from public.academy_members member join public.academy_feature_grants grant_row on grant_row.academy_member_id=member.id
    where member.academy_community_id=p_community_id and grant_row.source_type='import'
      and grant_row.status='active' and grant_row.starts_at<=now() and (grant_row.ends_at is null or grant_row.ends_at>now())
    on conflict do nothing;
  insert into private.academy_legacy_access_scopes
    select member.id,grant_row.source_type,grant_row.source_key,course.id::text
    from public.academy_members member
    join public.courses course on course.academy_community_id=member.academy_community_id and course.status='published'
    join public.academy_access_grants grant_row on grant_row.academy_member_id=member.id and grant_row.course_id is null
      and grant_row.status='active' and grant_row.starts_at<=now() and (grant_row.ends_at is null or grant_row.ends_at>now())
    where member.academy_community_id=p_community_id
      and not (grant_row.source_type='manual' and grant_row.source_key='owner-free:community')
      and (course.access_type='open' or (course.access_type='level' and member.level>=coalesce(course.required_level,1)))
      and not exists(select 1 from public.academy_course_access_denials denial
        where denial.academy_member_id=member.id and denial.course_id=course.id)
    on conflict do nothing;
  update public.academy_communities set separate_access_enabled=true,pricing_gates_enabled=true where id=p_community_id;
end;
$$;
revoke all on function private.admin_activate_separate_access(uuid) from public,anon,authenticated;
grant execute on function private.admin_activate_separate_access(uuid) to authenticated;
create function public.admin_activate_separate_access(p_community_id uuid)
returns void language sql security invoker set search_path='' as $$ select private.admin_activate_separate_access(p_community_id); $$;
revoke all on function public.admin_activate_separate_access(uuid) from public,anon,authenticated;
grant execute on function public.admin_activate_separate_access(uuid) to authenticated;

-- The existing master-only free-grant implementations and invoker wrappers are
-- intentionally untouched. New native sources cannot overwrite their source keys.

create function private.membership_store_community()
returns uuid language plpgsql stable security definer set search_path='' as $$
declare target uuid; communities integer;
begin
  select min(academy_community_id::text)::uuid,count(distinct academy_community_id)
    into target,communities from public.academy_store_products;
  if communities<>1 then raise exception 'Membership products are not configured'; end if;
  return target;
end;
$$;
revoke all on function private.membership_store_community() from public,anon,authenticated;

create function private.ensure_membership_store_member(p_user_id uuid,p_community_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare account auth.users; member_row public.academy_members; invite_id uuid; matching integer;
begin
  select * into account from auth.users where id=p_user_id and email_confirmed_at is not null
    and deleted_at is null and (banned_until is null or banned_until<now());
  if account.id is null then raise exception 'Verified sign-in required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text||':'||p_community_id::text,0));
  select * into member_row from public.academy_members
    where academy_community_id=p_community_id and user_id=p_user_id for update;
  if member_row.id is not null then
    if member_row.status<>'active' then raise exception 'Member access is restricted' using errcode='42501'; end if;
    return member_row.id;
  end if;
  select count(distinct academy_member_id) into matching from public.academy_member_invites
    where academy_community_id=p_community_id and lower(trim(email))=lower(trim(account.email)) and status<>'cancelled';
  if matching>1 then raise exception 'Academy identity needs review'; end if;
  select academy_member_id into invite_id from public.academy_member_invites
    where academy_community_id=p_community_id and lower(trim(email))=lower(trim(account.email)) and status<>'cancelled' limit 1;
  if invite_id is not null then
    select * into member_row from public.academy_members where id=invite_id for update;
    if member_row.status<>'active' or (member_row.user_id is not null and member_row.user_id<>p_user_id) then
      raise exception 'Academy identity needs review' using errcode='42501';
    end if;
    update public.academy_members set user_id=p_user_id where id=member_row.id;
    return member_row.id;
  end if;
  perform public.ensure_academy_user_workspace(p_user_id,'','');
  insert into public.academy_members(academy_community_id,user_id,display_name,status,role,joined_at)
    values(p_community_id,p_user_id,split_part(account.email,'@',1),'active','member',now()) returning id into invite_id;
  return invite_id;
end;
$$;
revoke all on function private.ensure_membership_store_member(uuid,uuid) from public,anon,authenticated;

create function private.get_membership_store_status(p_provider text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=(select auth.uid()); community_id uuid; community public.academy_communities;
  member_id uuid; claim private.academy_scanner_trial_claims; enabled boolean; products jsonb; owned jsonb; restorable jsonb;
begin
  if p_provider not in ('google','apple') or p_provider is null then raise exception 'Invalid store provider'; end if;
  if uid is null or not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null
    and deleted_at is null and (banned_until is null or banned_until<now())) then
    raise exception 'Verified sign-in required' using errcode='42501';
  end if;
  community_id:=private.membership_store_community();
  select * into community from public.academy_communities where id=community_id;
  select id into member_id from public.academy_members where academy_community_id=community_id and user_id=uid and status='active';
  if exists(select 1 from public.academy_members where academy_community_id=community_id and user_id=uid and status<>'active') then
    raise exception 'Member access is restricted' using errcode='42501';
  end if;
  enabled:=community.store_purchases_enabled and community.separate_access_enabled and community.pricing_gates_enabled;
  select coalesce(jsonb_agg(product_id order by product_id),'[]'::jsonb) into products
    from public.academy_store_products product where product.provider=p_provider and product.active
      and product.academy_community_id=community_id and (product.course_id is null or exists(
        select 1 from public.courses course where course.id=product.course_id
          and course.academy_community_id=community_id and course.status='published'));
  select * into claim from private.academy_scanner_trial_claims where user_id=uid;
  select coalesce(jsonb_agg(product.product_id order by product.product_id),'[]'::jsonb) into owned
    from public.academy_store_products product where product.provider=p_provider
      and product.academy_community_id=community_id and (
        private.can_manage_academy(community_id)
        or (product.resource_key='community' and private.has_active_academy_grant(member_id,null))
        or (product.resource_key='academy' and private.can_access_course(product.course_id))
        or (product.resource_key='measuring_tool' and exists(
          select 1 from public.academy_feature_grants grant_row
          where grant_row.academy_member_id=member_id and grant_row.feature_key='measuring_tool'
            and grant_row.source_type<>'self_trial' and grant_row.status='active' and grant_row.starts_at<=now()
            and (grant_row.ends_at is null or grant_row.ends_at>now())
            and (not community.separate_access_enabled or grant_row.source_type<>'import' or exists(
              select 1 from private.academy_legacy_access_scopes scope
              where scope.academy_member_id=member_id and scope.source_type=grant_row.source_type
                and scope.source_key=grant_row.source_key and scope.resource_key='feature:measuring_tool'))
            and (grant_row.source_type not in ('google_subscription','apple_subscription')
              or private.store_grant_environment_allowed(member_id,grant_row.metadata)))));
  select coalesce(jsonb_agg(prior.product_id order by prior.product_id),'[]'::jsonb) into restorable from (
    select distinct entitlement.product_id from public.academy_store_entitlements entitlement
    where entitlement.user_id=uid and entitlement.provider=p_provider
      and (entitlement.environment='production' or exists(
        select 1 from private.academy_store_test_accounts tester where tester.user_id=uid and tester.enabled))
  ) prior;
  return jsonb_build_object('enabled',enabled and jsonb_array_length(products)>0,
    'products',case when enabled then products else '[]'::jsonb end,
    'ownedProducts',owned,
    'restorableProducts',restorable,
    'trialEligible',community.scanner_trial_enabled and community.separate_access_enabled and community.pricing_gates_enabled
      and claim.user_id is null and not private.has_active_academy_feature(member_id,'measuring_tool')
      and not private.can_manage_academy(community_id),
    'trialUsed',claim.user_id is not null,'trialExpiresAt',claim.expires_at);
end;
$$;
revoke all on function private.get_membership_store_status(text) from public,anon,authenticated;
grant execute on function private.get_membership_store_status(text) to authenticated;
create function public.get_membership_store_status(p_provider text)
returns jsonb language sql stable security invoker set search_path='' as $$ select private.get_membership_store_status(p_provider); $$;
revoke all on function public.get_membership_store_status(text) from public,anon,authenticated;
grant execute on function public.get_membership_store_status(text) to authenticated;

create function private.start_turf_scanner_trial()
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=(select auth.uid()); community_id uuid; member_id uuid; claim private.academy_scanner_trial_claims;
begin
  if uid is null then raise exception 'Verified sign-in required' using errcode='42501'; end if;
  community_id:=private.membership_store_community();
  if not exists(select 1 from public.academy_communities where id=community_id
    and scanner_trial_enabled and separate_access_enabled and pricing_gates_enabled) then
    raise exception 'Turf Scanner trial is not open yet';
  end if;
  member_id:=private.ensure_membership_store_member(uid,community_id);
  select * into claim from private.academy_scanner_trial_claims where user_id=uid for update;
  if claim.user_id is not null then
    return jsonb_build_object('started',false,'alreadyUsed',true,'expiresAt',claim.expires_at,'memberId',member_id);
  end if;
  if private.has_active_academy_feature(member_id,'measuring_tool') or private.can_manage_academy(community_id)
    then raise exception 'Turf Scanner access is already active'; end if;
  insert into private.academy_scanner_trial_claims(user_id,academy_member_id,started_at,expires_at)
    values(uid,member_id,now(),now()+interval '7 days') returning * into claim;
  insert into public.academy_feature_grants(academy_community_id,academy_member_id,feature_key,source_type,source_key,ends_at,metadata)
    values(community_id,member_id,'measuring_tool','self_trial','seven-day-scanner',claim.expires_at,
      jsonb_build_object('trial',true,'automatic_charge',false));
  return jsonb_build_object('started',true,'alreadyUsed',false,'expiresAt',claim.expires_at,'memberId',member_id);
end;
$$;
revoke all on function private.start_turf_scanner_trial() from public,anon,authenticated;
grant execute on function private.start_turf_scanner_trial() to authenticated;
create function public.start_turf_scanner_trial()
returns jsonb language sql security invoker set search_path='' as $$ select private.start_turf_scanner_trial(); $$;
revoke all on function public.start_turf_scanner_trial() from public,anon,authenticated;
grant execute on function public.start_turf_scanner_trial() to authenticated;

-- Called only after a trusted worker verifies the provider's current signed/API
-- state AND its appAccountToken/obfuscatedAccountId binding to p_user_id. This RPC
-- never accepts a client receipt as proof, and grants cannot be written by users.
create function public.apply_academy_store_entitlement(
  p_provider text,
  p_source_key text,
  p_user_id uuid,
  p_product_id text,
  p_status text,
  p_current_period_end timestamptz,
  p_auto_renew boolean default false,
  p_environment text default 'production',
  p_verified_at timestamptz default now()
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare product public.academy_store_products; prior public.academy_store_entitlements;
  community public.academy_communities; member_id uuid; grant_source text; grant_key text;
  grant_status text; effective_status text; grant_metadata jsonb;
begin
  if p_provider is null or p_provider not in ('google','apple')
    or p_environment is null or p_environment not in ('production','sandbox')
    or p_source_key is null or p_source_key !~ '^[A-Za-z0-9:_-]+$' or char_length(p_source_key) not between 1 and 256
    or p_user_id is null or p_product_id is null or p_status is null
    or p_status not in ('active','expired','revoked') or p_auto_renew is null
    or p_current_period_end is null or p_verified_at is null or p_verified_at>now()+interval '5 minutes'
    or not isfinite(p_current_period_end) or not isfinite(p_verified_at) then
    raise exception 'Invalid verified store entitlement' using errcode='22023';
  end if;
  select * into product from public.academy_store_products
    where provider=p_provider and product_id=p_product_id;
  if product.product_id is null then raise exception 'Store product is not mapped'; end if;
  select * into community from public.academy_communities where id=product.academy_community_id;
  perform pg_advisory_xact_lock(hashtextextended(p_provider||':'||p_environment||':'||p_source_key,0));
  select * into prior from public.academy_store_entitlements
    where provider=p_provider and environment=p_environment and source_key=p_source_key for update;
  if prior.source_key is not null then
    if prior.user_id<>p_user_id or prior.product_id<>p_product_id then
      raise exception 'Store purchase belongs to a different account or product' using errcode='42501';
    end if;
    if p_verified_at<=prior.verified_at then
      return jsonb_build_object('applied',false,'ignored',true,'status',prior.status,'memberId',prior.academy_member_id);
    end if;
  elsif not (product.active and community.store_purchases_enabled
    and community.separate_access_enabled and community.pricing_gates_enabled) then
    raise exception 'Store purchases are not open yet';
  end if;
  if p_environment='sandbox' and not exists(
    select 1 from private.academy_store_test_accounts where user_id=p_user_id and enabled) then
    raise exception 'Sandbox purchases are restricted to approved test accounts' using errcode='42501';
  end if;
  effective_status:=case when p_status='active' and p_current_period_end<=now() then 'expired' else p_status end;
  if effective_status='active' and product.course_id is not null and not exists(
    select 1 from public.courses course where course.id=product.course_id
      and course.academy_community_id=product.academy_community_id and course.status='published') then
    raise exception 'Academy content is not available for this product';
  end if;
  member_id:=private.ensure_membership_store_member(p_user_id,product.academy_community_id);
  if effective_status='active' and product.course_id is not null and exists(
    select 1 from public.academy_course_access_denials
    where academy_member_id=member_id and course_id=product.course_id) then
    raise exception 'Academy course access is restricted' using errcode='42501';
  end if;
  insert into public.academy_store_entitlements(provider,environment,source_key,user_id,
    academy_member_id,product_id,status,current_period_end,auto_renew,verified_at)
    values(p_provider,p_environment,p_source_key,p_user_id,member_id,p_product_id,
      effective_status,p_current_period_end,p_auto_renew,p_verified_at)
    on conflict(provider,environment,source_key) do update set status=excluded.status,
      academy_member_id=excluded.academy_member_id,
      current_period_end=excluded.current_period_end,auto_renew=excluded.auto_renew,
      verified_at=excluded.verified_at,updated_at=now();
  grant_source:=case p_provider when 'google' then 'google_subscription' else 'apple_subscription' end;
  grant_key:=p_environment||':'||p_source_key;
  grant_status:=case when effective_status='active' then 'active'
    when effective_status='revoked' then 'revoked' else 'expired' end;
  grant_metadata:=jsonb_build_object('environment',p_environment,'store_product_id',p_product_id,
    'store_source_key',p_source_key,'verified_at',p_verified_at);
  if product.resource_key='measuring_tool' then
    insert into public.academy_feature_grants(academy_community_id,academy_member_id,feature_key,
      source_type,source_key,status,starts_at,ends_at,metadata)
      values(product.academy_community_id,member_id,'measuring_tool',grant_source,grant_key,
        grant_status,now(),case when grant_status='active' then p_current_period_end else null end,grant_metadata)
      on conflict(academy_member_id,feature_key,source_type,source_key) do update set status=excluded.status,
        starts_at=least(public.academy_feature_grants.starts_at,excluded.starts_at),
        ends_at=excluded.ends_at,metadata=excluded.metadata;
  elsif product.resource_key='community' then
    insert into public.academy_access_grants(academy_community_id,academy_member_id,
      source_type,source_key,status,starts_at,ends_at,metadata)
      values(product.academy_community_id,member_id,grant_source,grant_key,grant_status,now(),
        case when grant_status='active' then p_current_period_end else null end,grant_metadata)
      on conflict(academy_member_id,source_type,source_key) where course_id is null
      do update set status=excluded.status,starts_at=least(public.academy_access_grants.starts_at,excluded.starts_at),
        ends_at=excluded.ends_at,metadata=excluded.metadata;
  else
    insert into public.academy_access_grants(academy_community_id,academy_member_id,course_id,
      source_type,source_key,status,starts_at,ends_at,metadata)
      values(product.academy_community_id,member_id,product.course_id,grant_source,grant_key,grant_status,now(),
        case when grant_status='active' then p_current_period_end else null end,grant_metadata)
      on conflict(academy_member_id,course_id,source_type,source_key) where course_id is not null
      do update set status=excluded.status,starts_at=least(public.academy_access_grants.starts_at,excluded.starts_at),
        ends_at=excluded.ends_at,metadata=excluded.metadata;
    insert into public.course_enrollments(academy_community_id,academy_member_id,course_id,status,
      source_provider,external_id,enrolled_at,access_expires_at)
      values(product.academy_community_id,member_id,product.course_id,
        case when grant_status='active' then 'active' when grant_status='expired' then 'expired' else 'cancelled' end,
        p_provider,grant_key,now(),p_current_period_end)
      on conflict(academy_member_id,course_id) do update set
        status=case
          when excluded.status='active' and public.course_enrollments.status='completed' then 'completed'
          when excluded.status='active' then 'active'
          when exists(select 1 from public.academy_access_grants g
            where g.academy_member_id=member_id and g.course_id=product.course_id
              and g.status='active' and g.starts_at<=now() and (g.ends_at is null or g.ends_at>now()))
            then public.course_enrollments.status
          else excluded.status end,
        access_expires_at=case
          when exists(select 1 from public.academy_access_grants g where g.academy_member_id=member_id
            and g.course_id=product.course_id and g.status='active' and g.starts_at<=now() and g.ends_at is null) then null
          else (select max(g.ends_at) from public.academy_access_grants g where g.academy_member_id=member_id
            and g.course_id=product.course_id and g.status='active' and g.starts_at<=now() and g.ends_at>now()) end;
  end if;
  return jsonb_build_object('applied',true,'ignored',false,'status',effective_status,'memberId',member_id);
end;
$$;
revoke all on function public.apply_academy_store_entitlement(text,text,uuid,text,text,timestamptz,boolean,text,timestamptz)
  from public,anon,authenticated;
grant execute on function public.apply_academy_store_entitlement(text,text,uuid,text,text,timestamptz,boolean,text,timestamptz)
  to service_role;

-- Academy subscribers can read their own enrollment without buying Community.
-- Other Community identity policies retain their existing membership requirement.
create function private.can_read_store_course_enrollment(target_member_id uuid,target_course_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.academy_members member where member.id=target_member_id
    and member.user_id=(select auth.uid()) and member.status='active')
    and private.can_access_course(target_course_id);
$$;
revoke all on function private.can_read_store_course_enrollment(uuid,uuid) from public,anon,authenticated;
grant execute on function private.can_read_store_course_enrollment(uuid,uuid) to authenticated;
create policy course_enrollments_course_subscriber_select on public.course_enrollments
  for select to authenticated using ((select private.can_read_store_course_enrollment(academy_member_id,course_id)));

-- Stripe compatibility: existing sources remain independently reconciled.
-- Independent Community, Academy/course and tool eligibility.
create or replace function public.get_academy_checkout_eligibility(p_plan_id uuid,p_email text,p_user_id uuid default null)
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
    or (plan_row.offer_kind='membership' and exists(select 1 from public.academy_billing_plan_features where plan_id=p_plan_id))
    or (plan_row.offer_kind='course' and (not exists(select 1 from public.academy_billing_plan_courses where plan_id=p_plan_id) or exists(select 1 from public.academy_billing_plan_features where plan_id=p_plan_id)))
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
  elsif plan_row.offer_kind<>'membership' and member_row.id is not null and p_user_id is null then reason:='sign_in_required';
  elsif plan_row.requires_membership and not private.has_active_academy_grant(member_row.id,null) then reason:='membership_required';
  elsif exists(select 1 from public.academy_billing_plan_courses pc join public.academy_course_access_denials d on d.course_id=pc.course_id
      where pc.plan_id=p_plan_id and d.academy_member_id=member_row.id) then reason:='resource_unavailable';
  elsif plan_row.community_access and private.has_active_academy_grant(member_row.id,null) then reason:='existing_access';
  elsif exists(select 1 from public.academy_billing_plan_courses pc join public.courses c on c.id=pc.course_id where pc.plan_id=p_plan_id
      and (private.has_active_academy_grant(member_row.id,c.id) or (private.has_active_academy_grant(member_row.id,null)
      and not (select separate_access_enabled from public.academy_communities where id=plan_row.academy_community_id)
      and (c.access_type='open' or (c.access_type='level' and member_row.level>=coalesce(c.required_level,1)))))) then reason:='existing_access';
  elsif exists(select 1 from public.academy_billing_plan_features pf where pf.plan_id=p_plan_id and private.has_active_academy_feature(member_row.id,pf.feature_key)) then reason:='existing_access';
  end if;
  return jsonb_build_object('allowed',reason is null,'reason',reason,'memberId',member_row.id,'trialEligible',not exists(select 1 from public.academy_feature_grants prior where prior.academy_member_id=member_row.id and prior.feature_key='measuring_tool' and prior.source_type='stripe_subscription'));
end;
$$;
revoke all on function public.get_academy_checkout_eligibility(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.get_academy_checkout_eligibility(uuid,text,uuid) to service_role;


-- Fulfillment accepts a Community-only plan; existing plan/source reconciliation is retained.
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
    or (plan_row.offer_kind='membership' and exists(select 1 from public.academy_billing_plan_features where plan_id=plan_row.id))
    or (plan_row.offer_kind='course' and (not exists(select 1 from public.academy_billing_plan_courses where plan_id=plan_row.id) or exists(select 1 from public.academy_billing_plan_features where plan_id=plan_row.id)))
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


-- After separate-access cutover only effective rights open the paid workspace.
create or replace function public.get_academy_access_state()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  current_user_id uuid := (select auth.uid());
  member_row public.academy_members%rowtype;
  community_id uuid;
  manager_access boolean := false;
  community_access boolean := false;
  gates boolean := false; separate_access boolean := false;
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
    select pricing_gates_enabled,separate_access_enabled into gates,separate_access from public.academy_communities where id=community_id;
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
  return jsonb_build_object('authenticated',true,'hasAccess',manager_access or (has_grant and (not separate_access or community_access or jsonb_array_length(course_ids)>0 or jsonb_array_length(feature_keys)>0)),
    'canManage',manager_access,'memberId',case when member_row.status='active' then member_row.id else null end,'communityId',community_id,
    'communityAccess',community_access,'courseIds',course_ids,'features',feature_keys,'pricingGatesEnabled',gates,
    'separateAccessEnabled',separate_access);
end;
$$;

-- Every Scanner measurement method requires the feature after the explicit
-- membership cutover. Before cutover, keep the older manual-calculator behavior.
-- The table trigger covers legacy/new RPCs and direct writes; saved records remain
-- readable after expiry. It does not mint or change any existing access grants.
create or replace function private.enforce_academy_measurement_feature()
returns trigger language plpgsql security definer set search_path='' as $$
declare state jsonb;
begin
  if (select auth.uid()) is not null then
    state:=public.get_academy_access_state();
    if coalesce((state->>'separateAccessEnabled')::boolean,false)
      or new.method in ('map','camera') or (tg_op='UPDATE' and old.method in ('map','camera')) then
      if coalesce((state->>'pricingGatesEnabled')::boolean,false)
        and (not coalesce((state->>'hasAccess')::boolean,false) or not (state->'features' ? 'measuring_tool')) then
        raise exception 'Turf Scanner access required' using errcode='42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- Product-only subscribers need their own membership ID to load entitled course
-- content. The narrow row policy below preserves the existing client query and
-- does not expose the Community directory or another member's ID.
create function private.get_own_academy_context()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=(select auth.uid()); access_state jsonb;
begin
  if uid is null or not exists(select 1 from auth.users where id=uid
    and email_confirmed_at is not null and deleted_at is null
    and (banned_until is null or banned_until<now())) then
    raise exception 'Verified sign-in required' using errcode='42501';
  end if;
  access_state:=public.get_academy_access_state();
  if not coalesce((access_state->>'hasAccess')::boolean,false)
    or access_state->>'memberId' is null or access_state->>'communityId' is null then
    return null;
  end if;
  return jsonb_build_object('id',access_state->>'memberId','academy_community_id',access_state->>'communityId');
end;
$$;
revoke all on function private.get_own_academy_context() from public,anon,authenticated;
grant execute on function private.get_own_academy_context() to authenticated;
create policy academy_members_product_subscriber_own_select on public.academy_members
  for select to authenticated using (
    user_id=(select auth.uid())
    and id=((select private.get_own_academy_context())->>'id')::uuid
  );

-- One fixed-size row per account bounds provider verification traffic. The
-- protected worker reserves before calling either store API; clients cannot reset
-- the window or choose a different account by invoking this function themselves.
create table private.academy_store_verification_rate_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count between 1 and 20)
);
alter table private.academy_store_verification_rate_limits enable row level security;
revoke all on private.academy_store_verification_rate_limits from public,anon,authenticated;

create function public.reserve_store_verification(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare accepted integer; started timestamptz; checked_at timestamptz:=clock_timestamp();
begin
  if p_user_id is null or not exists(select 1 from auth.users where id=p_user_id
    and email_confirmed_at is not null and deleted_at is null
    and (banned_until is null or banned_until<now())) then
    raise exception 'Verified sign-in required' using errcode='42501';
  end if;
  insert into private.academy_store_verification_rate_limits(user_id,window_started_at,request_count)
    values(p_user_id,checked_at,1)
    on conflict(user_id) do update set
      window_started_at=case when private.academy_store_verification_rate_limits.window_started_at<=checked_at-interval '60 seconds'
        then checked_at else private.academy_store_verification_rate_limits.window_started_at end,
      request_count=case when private.academy_store_verification_rate_limits.window_started_at<=checked_at-interval '60 seconds'
        then 1 else private.academy_store_verification_rate_limits.request_count+1 end
    where private.academy_store_verification_rate_limits.window_started_at<=checked_at-interval '60 seconds'
      or private.academy_store_verification_rate_limits.request_count<20
    returning request_count,window_started_at into accepted,started;
  if found then return jsonb_build_object('allowed',true,'retryAfterSeconds',0); end if;
  select window_started_at into started from private.academy_store_verification_rate_limits where user_id=p_user_id;
  return jsonb_build_object('allowed',false,'retryAfterSeconds',greatest(1,least(60,ceil(extract(epoch from started+interval '60 seconds'-checked_at))::integer)));
end;
$$;
revoke all on function public.reserve_store_verification(uuid) from public,anon,authenticated;
grant execute on function public.reserve_store_verification(uuid) to service_role;

-- Google can complete a purchase while the app is closed. The protected RTDN
-- worker obtains this hash only from the authoritative Publisher API response,
-- resolves its original Auth account here, then re-verifies the full purchase
-- binding before fulfillment. An unsigned notification never supplies identity.
create function public.resolve_google_store_account(p_account_hash text)
returns uuid language plpgsql stable security definer set search_path='' as $$
begin
  if p_account_hash is null or p_account_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid verified store account hash' using errcode='22023';
  end if;
  return (select account.id from auth.users account
    where account.email_confirmed_at is not null and account.deleted_at is null
      and (account.banned_until is null or account.banned_until<now())
      and encode(sha256(convert_to(lower(account.id::text),'UTF8')),'hex')=p_account_hash);
end;
$$;
revoke all on function public.resolve_google_store_account(text) from public,anon,authenticated;
grant execute on function public.resolve_google_store_account(text) to service_role;
