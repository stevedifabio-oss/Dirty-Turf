-- Owner-authorized Google license acceptance, without opening public store sales.
-- No configuration, product activation, test identity, grant or billing row is created.
-- Authoritative provider verification must supply p_environment; users cannot call
-- verified fulfillment. Existing wrappers, RLS and execute grants remain unchanged.

create or replace function private.get_membership_store_status(p_provider text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=(select auth.uid()); community_id uuid; community public.academy_communities;
  member_id uuid; claim private.academy_scanner_trial_claims; enabled boolean; sandbox_enabled boolean; products jsonb; owned jsonb; restorable jsonb;
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
  -- The private Auth allowlist opens only the Google Scanner test catalog.
  -- It never enables public sales or trusts a client-supplied environment.
  sandbox_enabled:=p_provider='google' and community.separate_access_enabled and community.pricing_gates_enabled
    and exists(select 1 from private.academy_store_test_accounts tester where tester.user_id=uid and tester.enabled);
  select coalesce(jsonb_agg(product_id order by product_id),'[]'::jsonb) into products
    from public.academy_store_products product where product.provider=p_provider
      and ((enabled and product.active) or (sandbox_enabled and product.product_id='dirty_turf_scanner_monthly'))
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
  -- Steve's existing administrative access normally hides Subscribe. In the
  -- allowlisted, held-sales test path only, remove that virtual Scanner ownership
  -- from the catalog projection; actual access and roles are never changed.
  -- Any active paid Scanner source still protects against a duplicate purchase.
  if sandbox_enabled and not enabled and private.can_manage_academy_members(community_id)
    and not exists(select 1 from public.academy_feature_grants grant_row
      where grant_row.academy_member_id=member_id and grant_row.feature_key='measuring_tool'
        and grant_row.source_type in ('google_subscription','apple_subscription','stripe_subscription','stripe_payment')
        and grant_row.status='active' and grant_row.starts_at<=now()
        and (grant_row.ends_at is null or grant_row.ends_at>now())
        and (grant_row.source_type not in ('google_subscription','apple_subscription')
          or private.store_grant_environment_allowed(member_id,grant_row.metadata))) then
    owned:=owned-'dirty_turf_scanner_monthly';
  end if;
  select coalesce(jsonb_agg(prior.product_id order by prior.product_id),'[]'::jsonb) into restorable from (
    select distinct entitlement.product_id from public.academy_store_entitlements entitlement
    where entitlement.user_id=uid and entitlement.provider=p_provider
      and (entitlement.environment='production' or exists(
        select 1 from private.academy_store_test_accounts tester where tester.user_id=uid and tester.enabled))
  ) prior;
  return jsonb_build_object('enabled',(enabled or sandbox_enabled) and jsonb_array_length(products)>0,
    'sandboxOnly',sandbox_enabled and not enabled,
    'products',case when enabled or sandbox_enabled then products else '[]'::jsonb end,
    'ownedProducts',owned,
    'restorableProducts',restorable,
    'trialEligible',community.scanner_trial_enabled and community.separate_access_enabled and community.pricing_gates_enabled
      and claim.user_id is null and not private.has_active_academy_feature(member_id,'measuring_tool')
      and not private.can_manage_academy(community_id),
    'trialUsed',claim.user_id is not null,'trialExpiresAt',claim.expires_at);
end;
$$;

create or replace function public.apply_academy_store_entitlement(
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
  elsif not (community.separate_access_enabled and community.pricing_gates_enabled and (
    (product.active and community.store_purchases_enabled)
    or (p_provider='google' and p_environment='sandbox'
      and p_product_id='dirty_turf_scanner_monthly' and exists(
        select 1 from private.academy_store_test_accounts where user_id=p_user_id and enabled)))) then
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
