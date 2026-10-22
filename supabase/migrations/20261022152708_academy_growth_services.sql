-- Service inquiries only; no payments, store integration, or access grants.
create function private.valid_growth_service_cadences(value jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select value = '{"website":"one_time","ghl":"one_time","seo-aeo":"one_time","facebook-ads":"month","website-care":"month","ghl-subscription":"month"}'::jsonb;
$$;

-- The existing authoritative access RPC chooses the active Academy context.
create function private.has_growth_community_access(target_community_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select (select auth.uid()) is not null
    and (state->>'hasAccess')::boolean is true
    and state->>'communityId' = target_community_id::text
  from (select public.get_academy_access_state() as state) access;
$$;

create table public.academy_growth_settings (
  academy_community_id uuid primary key references public.academy_communities(id) on delete cascade,
  service_cadences jsonb not null default '{"website":"one_time","ghl":"one_time","seo-aeo":"one_time","facebook-ads":"month","website-care":"month","ghl-subscription":"month"}'::jsonb
    check (private.valid_growth_service_cadences(service_cadences) is true),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.academy_growth_requests (
  id uuid primary key,
  academy_community_id uuid not null references public.academy_communities(id) on delete cascade,
  academy_member_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  service_key text not null check (service_key in ('website','ghl','seo-aeo','facebook-ads','website-care','ghl-subscription')),
  status text not null default 'new' check (status in ('new','contacted','closed')),
  notes text not null default '' check (length(notes) <= 2000),
  member_name text not null default '',
  company_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (academy_community_id, academy_member_id)
    references public.academy_members(academy_community_id, id) on delete cascade
);
create unique index academy_growth_requests_open_member_service_idx
  on public.academy_growth_requests(academy_community_id, academy_member_id, service_key)
  where status in ('new','contacted');
create index academy_growth_requests_community_created_idx
  on public.academy_growth_requests(academy_community_id, created_at desc);
create index academy_growth_requests_user_created_idx
  on public.academy_growth_requests(user_id, created_at desc);
create index academy_growth_requests_member_idx
  on public.academy_growth_requests(academy_community_id, academy_member_id);

create trigger academy_growth_settings_updated_at before update on public.academy_growth_settings
  for each row execute function public.set_updated_at();
create trigger academy_growth_requests_updated_at before update on public.academy_growth_requests
  for each row execute function public.set_updated_at();

alter table public.academy_growth_settings enable row level security;
alter table public.academy_growth_requests enable row level security;
revoke all on public.academy_growth_settings, public.academy_growth_requests from public, anon, authenticated;
grant select, insert, update on public.academy_growth_settings to authenticated;
grant select on public.academy_growth_requests to authenticated;
grant update (status) on public.academy_growth_requests to authenticated;
grant all on public.academy_growth_settings, public.academy_growth_requests to service_role;

create policy "academy_growth_settings_member_read" on public.academy_growth_settings for select to authenticated
  using ((select private.has_growth_community_access(academy_community_id)));
create policy "academy_growth_settings_admin_insert" on public.academy_growth_settings for insert to authenticated
  with check ((select private.has_growth_community_access(academy_community_id)) and (select private.can_manage_academy(academy_community_id)));
create policy "academy_growth_settings_admin_update" on public.academy_growth_settings for update to authenticated
  using ((select private.has_growth_community_access(academy_community_id)) and (select private.can_manage_academy(academy_community_id)))
  with check ((select private.has_growth_community_access(academy_community_id)) and (select private.can_manage_academy(academy_community_id)));
create policy "academy_growth_requests_own_or_admin_read" on public.academy_growth_requests for select to authenticated
  using ((select private.has_growth_community_access(academy_community_id))
    and (user_id = (select auth.uid()) or (select private.can_manage_academy(academy_community_id))));
create policy "academy_growth_requests_admin_status" on public.academy_growth_requests for update to authenticated
  using ((select private.has_growth_community_access(academy_community_id)) and (select private.can_manage_academy(academy_community_id)))
  with check ((select private.has_growth_community_access(academy_community_id)) and (select private.can_manage_academy(academy_community_id)));

-- A private writer is needed to snapshot verified member identity and insert
-- atomically without giving clients direct INSERT or identity-edit privileges.
create function private.create_academy_growth_request(p_service_key text, p_notes text, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := (select auth.uid());
  access_state jsonb;
  member_row public.academy_members%rowtype;
  request_row public.academy_growth_requests%rowtype;
begin
  if caller is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_request_id is null or p_service_key is null or p_service_key not in ('website','ghl','seo-aeo','facebook-ads','website-care','ghl-subscription')
    or p_notes is null or length(p_notes) > 2000 then
    raise exception 'Invalid service request' using errcode = '22023';
  end if;
  access_state := public.get_academy_access_state();
  if (access_state->>'hasAccess')::boolean is not true then
    raise exception 'Active Academy access required' using errcode = '42501';
  end if;
  select * into member_row from public.academy_members
    where id = (access_state->>'memberId')::uuid
      and academy_community_id = (access_state->>'communityId')::uuid
      and user_id = caller and status = 'active' for share;
  if member_row.id is null then raise exception 'Active Academy member required' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(member_row.id::text || ':' || p_service_key, 0));
  select * into request_row from public.academy_growth_requests where id = p_request_id;
  if request_row.id is not null then
    if request_row.user_id <> caller or request_row.academy_member_id <> member_row.id or request_row.service_key <> p_service_key then
      raise exception 'Request identity conflicts' using errcode = '22023';
    end if;
    return jsonb_build_object('id', request_row.id, 'service_key', request_row.service_key, 'status', request_row.status,
      'notes', request_row.notes, 'created_at', request_row.created_at, 'member_name', request_row.member_name, 'company_name', request_row.company_name);
  end if;
  select * into request_row from public.academy_growth_requests
    where academy_community_id = member_row.academy_community_id and academy_member_id = member_row.id
      and service_key = p_service_key and status in ('new','contacted');
  if request_row.id is not null then
    return jsonb_build_object('id', request_row.id, 'service_key', request_row.service_key, 'status', request_row.status,
      'notes', request_row.notes, 'created_at', request_row.created_at, 'member_name', request_row.member_name, 'company_name', request_row.company_name);
  end if;
  insert into public.academy_growth_requests(id, academy_community_id, academy_member_id, user_id,
    service_key, notes, member_name, company_name)
  values (p_request_id, member_row.academy_community_id, member_row.id, caller,
    p_service_key, trim(p_notes), member_row.display_name, member_row.company_name)
  returning * into request_row;
  return jsonb_build_object('id', request_row.id, 'service_key', request_row.service_key, 'status', request_row.status,
    'notes', request_row.notes, 'created_at', request_row.created_at, 'member_name', request_row.member_name, 'company_name', request_row.company_name);
end;
$$;

create function public.create_academy_growth_request(p_service_key text, p_notes text, p_request_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.create_academy_growth_request(p_service_key, p_notes, p_request_id);
$$;

revoke all on function private.valid_growth_service_cadences(jsonb),
  private.has_growth_community_access(uuid), private.create_academy_growth_request(text,text,uuid),
  public.create_academy_growth_request(text,text,uuid) from public, anon, authenticated;
grant execute on function private.valid_growth_service_cadences(jsonb),
  private.has_growth_community_access(uuid), private.create_academy_growth_request(text,text,uuid),
  public.create_academy_growth_request(text,text,uuid) to authenticated;
grant execute on function private.valid_growth_service_cadences(jsonb) to service_role;

insert into public.academy_growth_settings(academy_community_id)
select id from public.academy_communities;
