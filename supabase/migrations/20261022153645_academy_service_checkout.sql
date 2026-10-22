-- Business-service quotes/payments are isolated from Academy access fulfillment.
create function private.valid_service_quote(p_key text,p_amount integer,p_interval text)
returns boolean language sql immutable set search_path='' as $$
  select p_amount is not null and (
    (p_key in ('website','ghl','seo-aeo') and p_amount between 149500 and 249500 and p_interval='one_time')
    or (p_key='facebook-ads' and p_amount between 49500 and 89500 and p_interval='month')
    or (p_key='website-care' and p_amount=9700 and p_interval='month')
    or (p_key='ghl-subscription' and p_amount=19700 and p_interval='month'));
$$;
create table public.academy_service_quotes(
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.academy_growth_requests(id) on delete restrict,
  academy_community_id uuid not null references public.academy_communities(id) on delete restrict,
  academy_member_id uuid not null references public.academy_members(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  service_key text not null,
  stripe_price_id text check(stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
  amount_cents integer not null,
  currency text not null default 'usd' check(currency='usd'),
  billing_interval text not null check(billing_interval in ('one_time','month')),
  status text not null default 'offered' check(status in ('offered','paid','withdrawn')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(private.valid_service_quote(service_key,amount_cents,billing_interval) is true)
);
create unique index academy_service_quotes_one_offer_idx on public.academy_service_quotes(request_id) where status='offered';
create index academy_service_quotes_community_idx on public.academy_service_quotes(academy_community_id,created_at desc);
create index academy_service_quotes_user_idx on public.academy_service_quotes(user_id,created_at desc);
create table public.academy_service_orders(
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.academy_service_quotes(id) on delete restrict,
  academy_community_id uuid not null references public.academy_communities(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  service_key text not null,
  stripe_price_id text,
  amount_cents integer not null,
  currency text not null default 'usd' check(currency='usd'),
  billing_interval text not null,
  status text not null default 'pending' check(status in ('pending','paid','failed','cancelled')),
  stripe_session_id text unique,
  checkout_url text,
  stripe_livemode boolean not null,
  expires_at timestamptz not null default now()+interval '1 hour',
  provider_customer_id text,
  provider_subscription_id text,
  provider_payment_intent_id text,
  paid_event_id text,
  subscription_status text check(subscription_status in ('incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid','paused')),
  cancel_at_period_end boolean not null default false,
  current_period_end timestamptz,
  last_subscription_event_created bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(private.valid_service_quote(service_key,amount_cents,billing_interval) is true)
);
create unique index academy_service_orders_single_checkout_idx on public.academy_service_orders(quote_id) where status in ('pending','paid');
create index academy_service_orders_user_idx on public.academy_service_orders(user_id,created_at desc);
create index academy_service_orders_community_idx on public.academy_service_orders(academy_community_id,created_at desc);
create index academy_service_orders_subscription_idx on public.academy_service_orders(provider_subscription_id) where provider_subscription_id is not null;
create trigger academy_service_quotes_updated_at before update on public.academy_service_quotes for each row execute function public.set_updated_at();
create trigger academy_service_orders_updated_at before update on public.academy_service_orders for each row execute function public.set_updated_at();

alter table public.academy_service_quotes enable row level security;
alter table public.academy_service_orders enable row level security;
revoke all on public.academy_service_quotes,public.academy_service_orders from public,anon,authenticated;
-- Price IDs and provider/Checkout identifiers are not member-facing columns.
grant select(id,request_id,academy_community_id,user_id,service_key,amount_cents,currency,billing_interval,status,created_at) on public.academy_service_quotes to authenticated;
grant select(id,quote_id,academy_community_id,user_id,service_key,amount_cents,billing_interval,status,created_at,subscription_status,cancel_at_period_end,current_period_end) on public.academy_service_orders to authenticated;
grant all on public.academy_service_quotes,public.academy_service_orders to service_role;
create policy "service_quotes_own_or_admin_read" on public.academy_service_quotes for select to authenticated
  using ((select private.has_growth_community_access(academy_community_id)) and (user_id=(select auth.uid()) or (select private.can_manage_academy(academy_community_id))));
create policy "service_orders_own_or_admin_read" on public.academy_service_orders for select to authenticated
  using (user_id=(select auth.uid()) or ((select private.has_growth_community_access(academy_community_id)) and (select private.can_manage_academy(academy_community_id))));

create function private.create_academy_service_quote(p_request_id uuid,p_stripe_price_id text,p_amount_cents integer,p_billing_interval text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.academy_growth_requests%rowtype; q public.academy_service_quotes%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into r from public.academy_growth_requests where id=p_request_id for update;
  if r.id is null or not private.has_growth_community_access(r.academy_community_id) or not private.can_manage_academy(r.academy_community_id) then raise exception 'Academy administrator required' using errcode='42501'; end if;
  if r.status='closed' or exists(select 1 from public.academy_service_quotes where request_id=r.id and status='paid') then raise exception 'Closed or paid request cannot receive another quote' using errcode='22023'; end if;
  if (p_stripe_price_id is not null and (p_stripe_price_id !~ '^price_[A-Za-z0-9]+$' or p_stripe_price_id ~ '[[:space:]]'))
    or private.valid_service_quote(r.service_key,p_amount_cents,p_billing_interval) is not true
    or exists(select 1 from public.academy_billing_plans where stripe_price_id=p_stripe_price_id)
    then raise exception 'Invalid or Academy-mapped service quote terms' using errcode='22023'; end if;
  select * into q from public.academy_service_quotes where request_id=r.id and status='offered';
  if q.id is not null then
    if q.stripe_price_id is distinct from p_stripe_price_id or q.amount_cents<>p_amount_cents or q.billing_interval<>p_billing_interval then raise exception 'Withdraw the previous quote before changing its terms' using errcode='22023'; end if;
    return to_jsonb(q);
  end if;
  insert into public.academy_service_quotes(request_id,academy_community_id,academy_member_id,user_id,service_key,stripe_price_id,amount_cents,billing_interval,created_by)
    values(r.id,r.academy_community_id,r.academy_member_id,r.user_id,r.service_key,p_stripe_price_id,p_amount_cents,p_billing_interval,(select auth.uid())) returning * into q;
  return to_jsonb(q);
end;
$$;

create function public.apply_academy_service_subscription(p_order_id uuid,p_subscription_id text,p_customer_id text,p_status text,p_cancel_at_period_end boolean,p_current_period_end timestamptz,p_event_created bigint)
returns void language plpgsql security invoker set search_path='' as $$
declare o public.academy_service_orders%rowtype;
begin
  if p_subscription_id is null or p_subscription_id !~ '^sub_[A-Za-z0-9]+$' or p_customer_id is null or p_customer_id !~ '^cus_[A-Za-z0-9]+$'
    or p_status is null or p_status not in ('incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid','paused') or p_event_created is null then raise exception 'Invalid service subscription event' using errcode='22023'; end if;
  select * into o from public.academy_service_orders where id=p_order_id for update;
  if o.id is null or o.billing_interval<>'month' or (o.provider_subscription_id is not null and o.provider_subscription_id<>p_subscription_id)
    or (o.provider_customer_id is not null and o.provider_customer_id<>p_customer_id) then raise exception 'Service subscription identity conflict' using errcode='22023'; end if;
  if o.last_subscription_event_created is not null and o.last_subscription_event_created>p_event_created then return; end if;
  update public.academy_service_orders set provider_subscription_id=p_subscription_id,provider_customer_id=p_customer_id,subscription_status=p_status,cancel_at_period_end=coalesce(p_cancel_at_period_end,false),current_period_end=p_current_period_end,last_subscription_event_created=p_event_created where id=o.id;
end;
$$;
create function public.create_academy_service_quote(p_request_id uuid,p_stripe_price_id text,p_amount_cents integer,p_billing_interval text)
returns jsonb language sql security invoker set search_path='' as $$ select private.create_academy_service_quote(p_request_id,p_stripe_price_id,p_amount_cents,p_billing_interval); $$;

create function private.list_academy_service_quotes(p_community_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or not private.has_growth_community_access(p_community_id) or not private.can_manage_academy(p_community_id) then raise exception 'Academy administrator required' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(to_jsonb(q) order by (q.status='offered') desc,q.created_at desc) from (
    (select * from public.academy_service_quotes where academy_community_id=p_community_id and status='offered' order by created_at desc limit 250)
    union all
    (select * from public.academy_service_quotes where academy_community_id=p_community_id and status<>'offered' order by created_at desc limit 250)
  ) q),'[]');
end;
$$;
create function public.list_academy_service_quotes(p_community_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$ select private.list_academy_service_quotes(p_community_id); $$;

create function private.withdraw_academy_service_quote(p_quote_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare q public.academy_service_quotes%rowtype;
begin
  select * into q from public.academy_service_quotes where id=p_quote_id for update;
  if q.id is null or (select auth.uid()) is null or not private.has_growth_community_access(q.academy_community_id) or not private.can_manage_academy(q.academy_community_id) then raise exception 'Academy administrator required' using errcode='42501'; end if;
  if q.status='paid' or exists(select 1 from public.academy_service_orders where quote_id=q.id and status in ('pending','paid')) then raise exception 'Pending or paid checkout cannot be withdrawn' using errcode='22023'; end if;
  update public.academy_service_quotes set status='withdrawn' where id=q.id;
end;
$$;
create function public.withdraw_academy_service_quote(p_quote_id uuid)
returns void language sql security invoker set search_path='' as $$ select private.withdraw_academy_service_quote(p_quote_id); $$;

-- Service-role only. The Edge function supplies the user verified with getUser.
create function public.reserve_academy_service_checkout(p_quote_id uuid,p_user_id uuid,p_request_id uuid,p_livemode boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare q public.academy_service_quotes%rowtype; o public.academy_service_orders%rowtype;
begin
  if p_user_id is null or p_request_id is null or p_livemode is null then raise exception 'Verified checkout identity required' using errcode='42501'; end if;
  select * into q from public.academy_service_quotes where id=p_quote_id for update;
  if q.id is null or q.user_id<>p_user_id or q.status<>'offered'
    or not exists(select 1 from public.academy_growth_requests where id=q.request_id and status<>'closed')
    or not exists(select 1 from public.academy_members m where m.id=q.academy_member_id and m.user_id=p_user_id and m.status='active' and m.academy_community_id=q.academy_community_id
      and (exists(select 1 from public.academy_access_grants g where g.academy_member_id=m.id and g.status='active' and g.starts_at<=now() and (g.ends_at is null or g.ends_at>now()))
        or exists(select 1 from public.academy_feature_grants g where g.academy_member_id=m.id and g.status='active' and g.starts_at<=now() and (g.ends_at is null or g.ends_at>now()))))
    then raise exception 'Service quote is unavailable for this identity' using errcode='42501'; end if;
  select * into o from public.academy_service_orders where quote_id=q.id and status in ('pending','paid') for update;
  if o.id is not null then
    if o.stripe_livemode<>p_livemode then raise exception 'Service checkout mode changed' using errcode='22023'; end if;
    return to_jsonb(o);
  end if;
  insert into public.academy_service_orders(quote_id,academy_community_id,user_id,service_key,stripe_price_id,amount_cents,billing_interval,stripe_livemode)
    values(q.id,q.academy_community_id,q.user_id,q.service_key,q.stripe_price_id,q.amount_cents,q.billing_interval,p_livemode) returning * into o;
  return to_jsonb(o);
end;
$$;
create function public.record_academy_service_checkout(p_order_id uuid,p_session_id text,p_url text)
returns void language plpgsql security invoker set search_path='' as $$
declare o public.academy_service_orders%rowtype;
begin
  select * into o from public.academy_service_orders where id=p_order_id for update;
  if o.id is null or o.status not in ('pending','paid') or p_session_id is null or p_url is null or p_session_id !~ '^cs_[A-Za-z0-9_]+$' or p_url !~ '^https://checkout[.]stripe[.]com/'
    or (o.stripe_session_id is not null and o.stripe_session_id<>p_session_id) then raise exception 'Service checkout identity conflict' using errcode='22023'; end if;
  update public.academy_service_orders set stripe_session_id=p_session_id,checkout_url=p_url where id=o.id;
end;
$$;
create function public.apply_academy_service_checkout(p_order_id uuid,p_session_id text,p_event_id text,p_status text,p_customer_id text,p_subscription_id text,p_payment_intent_id text)
returns void language plpgsql security invoker set search_path='' as $$
declare o public.academy_service_orders%rowtype;
begin
  if p_status is null or p_status not in ('paid','failed','cancelled') or p_event_id is null or length(p_event_id)=0 or p_session_id is null then raise exception 'Invalid service payment event' using errcode='22023'; end if;
  select * into o from public.academy_service_orders where id=p_order_id for update;
  if o.id is null or (o.stripe_session_id is not null and o.stripe_session_id<>p_session_id)
    or (o.provider_customer_id is not null and o.provider_customer_id is distinct from p_customer_id and p_status='paid')
    or (o.provider_subscription_id is not null and o.provider_subscription_id is distinct from p_subscription_id and p_status='paid')
    then raise exception 'Service payment identity conflict' using errcode='22023'; end if;
  if o.status='paid' then return; end if;
  -- A later authentic payment may arrive before the original Checkout response.
  if p_status='paid' then
    if exists(select 1 from public.academy_service_orders where quote_id=o.quote_id and status='paid' and id<>o.id) then raise exception 'Service quote already paid' using errcode='22023'; end if;
    update public.academy_service_orders set status='paid',stripe_session_id=p_session_id,paid_event_id=p_event_id,provider_customer_id=p_customer_id,provider_subscription_id=p_subscription_id,provider_payment_intent_id=p_payment_intent_id where id=o.id;
    update public.academy_service_quotes set status='paid' where id=o.quote_id;
    -- Payment starts the service workflow; it does not mean the work is delivered.
    update public.academy_growth_requests set status='contacted' where id=(select request_id from public.academy_service_quotes where id=o.quote_id) and status='new';
  elsif o.status='pending' then update public.academy_service_orders set status=p_status,stripe_session_id=p_session_id where id=o.id;
  end if;
end;
$$;

revoke all on function private.valid_service_quote(text,integer,text),private.create_academy_service_quote(uuid,text,integer,text),public.create_academy_service_quote(uuid,text,integer,text),private.list_academy_service_quotes(uuid),public.list_academy_service_quotes(uuid),private.withdraw_academy_service_quote(uuid),public.withdraw_academy_service_quote(uuid) from public,anon,authenticated;
grant execute on function private.valid_service_quote(text,integer,text) to authenticated,service_role;
grant execute on function private.create_academy_service_quote(uuid,text,integer,text),public.create_academy_service_quote(uuid,text,integer,text),private.list_academy_service_quotes(uuid),public.list_academy_service_quotes(uuid),private.withdraw_academy_service_quote(uuid),public.withdraw_academy_service_quote(uuid) to authenticated;
revoke all on function public.reserve_academy_service_checkout(uuid,uuid,uuid,boolean),public.record_academy_service_checkout(uuid,text,text),public.apply_academy_service_checkout(uuid,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.reserve_academy_service_checkout(uuid,uuid,uuid,boolean),public.record_academy_service_checkout(uuid,text,text),public.apply_academy_service_checkout(uuid,text,text,text,text,text,text) to service_role;
revoke all on function public.apply_academy_service_subscription(uuid,text,text,text,boolean,timestamptz,bigint) from public,anon,authenticated;
grant execute on function public.apply_academy_service_subscription(uuid,text,text,text,boolean,timestamptz,bigint) to service_role;

-- Preserve every existing server-only Vault name and add only service settings.
create or replace function private.get_server_runtime_config(p_names text[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','')<>'service_role' then
    raise insufficient_privilege using message='Service role required';
  end if;
  return coalesce((select jsonb_object_agg(s.name,s.decrypted_secret) from vault.decrypted_secrets s
    where s.name=any(p_names) and s.name=any(array[
      'STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','STRIPE_MODE','STRIPE_CHECKOUT_ENABLED','STRIPE_PORTAL_CONFIGURATION_ID',
      'GHL_COURSE_SYNC_SECRET','GHL_COURSE_SYNC_ENABLED','GHL_PRIVATE_INTEGRATION_TOKEN','GHL_LOCATION_ID',
      'ACADEMY_EMAIL_DELIVERY_ENABLED','NOTIFICATION_DISPATCH_SECRET','NOTIFICATION_SIGNING_SECRET',
      'MAILGUN_API_KEY','MAILGUN_DOMAIN','MAILGUN_FROM_EMAIL','MAILGUN_FROM_NAME','MAILGUN_REGION',
      'ACADEMY_EMAIL_PROVIDER','GHL_EMAIL_FROM','GHL_COMMUNITY_SYNC_SECRET','GHL_COMMUNITY_SYNC_CONFIG_ID',
      'STRIPE_SERVICE_CHECKOUT_ENABLED','STRIPE_SERVICE_RECURRING_ENABLED','STRIPE_SERVICE_WEBHOOK_SECRET'
    ]::text[])), '{}'::jsonb);
end;
$$;
revoke all on function private.get_server_runtime_config(text[]) from public,anon,authenticated;
grant execute on function private.get_server_runtime_config(text[]) to service_role;
