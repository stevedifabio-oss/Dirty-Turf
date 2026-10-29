-- Prepared only: neither this migration nor deployment activates publication.
create table private.academy_post_scheduler_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into private.academy_post_scheduler_settings(id) values(true);
alter table private.academy_post_scheduler_settings enable row level security;
revoke all on private.academy_post_scheduler_settings from public,anon,authenticated;
grant select,update on private.academy_post_scheduler_settings to service_role;
create policy academy_post_scheduler_service on private.academy_post_scheduler_settings
  for all to service_role using(true) with check(true);

create table public.academy_post_schedules (
  id uuid primary key default gen_random_uuid(),
  academy_community_id uuid not null references public.academy_communities(id),
  author_member_id uuid not null references public.academy_members(id),
  category_id uuid not null references public.community_categories(id),
  title text not null check(char_length(title) between 2 and 120),
  body text not null check(char_length(body) between 2 and 5000),
  is_announcement boolean not null default false,
  kind text not null check(kind in ('once','weekly')),
  time_zone text not null,
  starts_on date not null,
  ends_on date,
  local_time time without time zone not null,
  weekdays integer[] not null default '{}',
  state text not null default 'draft' check(state in ('draft','active','paused','cancelled')),
  catchup_minutes integer not null default 15 check(catchup_minutes between 1 and 60),
  revision integer not null default 1 check(revision>0),
  active_since timestamptz,
  last_evaluated_at timestamptz,
  created_by uuid not null references auth.users(id),
  client_request_id uuid not null,
  create_request_payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(ends_on is null or ends_on>=starts_on),
  check(isfinite(starts_on) and (ends_on is null or isfinite(ends_on))),
  check(starts_on between date '1970-01-01' and date '2199-12-31'
    and (ends_on is null or ends_on between date '1970-01-01' and date '2199-12-31')),
  check(extract(second from local_time)=0),
  check((kind='once' and cardinality(weekdays)=0 and ends_on is null)
    or (kind='weekly' and cardinality(weekdays) between 1 and 7 and weekdays <@ array[1,2,3,4,5,6,7])),
  check((state='active')=(active_since is not null))
);
create unique index academy_post_schedule_create_request on public.academy_post_schedules(academy_community_id,created_by,client_request_id);
create index academy_post_schedules_due on public.academy_post_schedules(last_evaluated_at nulls first,created_at) where state='active';
alter table public.academy_post_schedules enable row level security;
revoke all on public.academy_post_schedules from public,anon,authenticated;
grant select on public.academy_post_schedules to authenticated;
grant select,insert,update on public.academy_post_schedules to service_role;
create policy academy_post_schedule_admin_read on public.academy_post_schedules
  for select to authenticated using((select private.can_manage_academy(academy_community_id)));

create table public.academy_post_schedule_occurrences (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.academy_post_schedules(id),
  academy_community_id uuid not null references public.academy_communities(id),
  scheduled_for timestamptz not null,
  local_date date not null,
  time_zone text not null,
  state text not null check(state in ('published','skipped','failed')),
  post_id uuid references public.community_posts(id) on delete set null,
  reason_code text,
  schedule_revision integer not null,
  approved_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique(schedule_id,scheduled_for),
  -- Changing a weekly rule's wall time cannot publish a second post that day.
  unique(schedule_id,local_date),
  check((state='published' and reason_code is null) or (state<>'published' and reason_code is not null))
);
create index academy_post_schedule_history on public.academy_post_schedule_occurrences(academy_community_id,created_at desc);
alter table public.academy_post_schedule_occurrences enable row level security;
revoke all on public.academy_post_schedule_occurrences from public,anon,authenticated;
grant select on public.academy_post_schedule_occurrences to authenticated;
grant select,insert,update on public.academy_post_schedule_occurrences to service_role;
create policy academy_post_occurrence_admin_read on public.academy_post_schedule_occurrences
  for select to authenticated using((select private.can_manage_academy(academy_community_id)));

create function public.save_academy_post_schedule(p_schedule jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  old_row public.academy_post_schedules%rowtype;
  saved public.academy_post_schedules%rowtype;
  author public.academy_members%rowtype;
  category public.community_categories%rowtype;
  community_id uuid;
  schedule_id uuid;
  requested_state text;
  days integer[];
  request_id uuid;
begin
  if (select auth.uid()) is null or jsonb_typeof(p_schedule)<>'object' or p_schedule is null then
    raise exception 'Academy administrator access required' using errcode='42501';
  end if;
  if exists(select 1 from jsonb_object_keys(p_schedule) k where k not in
    ('id','communityId','authorMemberId','categoryId','title','body','kind','timeZone','startsOn','endsOn','localTime','weekdays','state','catchupMinutes','expectedRevision','isAnnouncement','clientRequestId')) then
    raise exception 'Unsupported schedule field' using errcode='22023';
  end if;
  community_id:=(p_schedule->>'communityId')::uuid;
  if community_id is null or not private.can_manage_academy(community_id) then
    raise exception 'Academy administrator access required' using errcode='42501';
  end if;
  schedule_id:=nullif(p_schedule->>'id','')::uuid;
  if schedule_id is not null then
    select * into old_row from public.academy_post_schedules where id=schedule_id for update;
    if old_row.id is null or old_row.academy_community_id<>community_id then
      raise exception 'Schedule is unavailable' using errcode='42501';
    end if;
    if old_row.state='cancelled' then raise exception 'Cancelled schedules cannot be changed' using errcode='22023'; end if;
    if old_row.created_by is distinct from (select auth.uid()) then
      raise exception 'Only the schedule author can edit its content; administrators can pause or cancel it' using errcode='42501';
    end if;
    if (p_schedule->>'expectedRevision')::integer is distinct from old_row.revision then
      raise exception 'Schedule changed; refresh before saving' using errcode='40001';
    end if;
    if old_row.kind='once' and exists(select 1 from public.academy_post_schedule_occurrences o where o.schedule_id=old_row.id) then
      raise exception 'This one-time schedule has finished; create a new schedule' using errcode='22023';
    end if;
  end if;
  select * into author from public.academy_members where id=(p_schedule->>'authorMemberId')::uuid for share;
  if author.academy_community_id is distinct from community_id or author.user_id is distinct from (select auth.uid())
     or author.status<>'active' or author.role not in ('owner','admin') then
    raise exception 'Use your own active Academy administrator identity as author' using errcode='42501';
  end if;
  select * into category from public.community_categories where id=(p_schedule->>'categoryId')::uuid for share;
  if category.academy_community_id is distinct from community_id then raise exception 'Channel is unavailable' using errcode='22023'; end if;
  if p_schedule ? 'isAnnouncement' and (p_schedule->>'isAnnouncement')::boolean is distinct from (lower(category.name)='announcements') then
    raise exception 'Announcement audience must match the selected channel' using errcode='22023';
  end if;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_schedule->>'timeZone') then
    raise exception 'Choose a valid IANA timezone' using errcode='22023';
  end if;
  if coalesce(p_schedule->>'localTime','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:00)?$' then
    raise exception 'Local time must use minute precision' using errcode='22023';
  end if;
  if jsonb_typeof(coalesce(p_schedule->'weekdays','[]'::jsonb))<>'array' then raise exception 'Weekdays must be an array' using errcode='22023'; end if;
  select coalesce(array_agg(distinct d order by d),'{}'::integer[]) into days
    from (select value::integer d from jsonb_array_elements_text(coalesce(p_schedule->'weekdays','[]'::jsonb))) q;
  requested_state:=coalesce(p_schedule->>'state','draft');
  if schedule_id is null then
    request_id:=nullif(p_schedule->>'clientRequestId','')::uuid;
    if request_id is null then raise exception 'A unique create request ID is required' using errcode='22023'; end if;
    -- Serialize exact create retries before checking the unique key. A lost
    -- response returns the existing schedule without making another draft.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(community_id::text || ':' || (select auth.uid())::text || ':' || request_id::text,0));
    select * into saved from public.academy_post_schedules existing
      where existing.academy_community_id=community_id and existing.created_by=(select auth.uid()) and existing.client_request_id=request_id for update;
    if saved.id is not null then
      if saved.create_request_payload is distinct from (p_schedule-'clientRequestId') then
        raise exception 'Create request ID was already used for different content; refresh before creating another schedule' using errcode='22023';
      end if;
      return to_jsonb(saved);
    end if;
  end if;
  if requested_state='active' and not exists(select 1 from private.academy_post_scheduler_settings where id and enabled) then
    raise exception 'Publishing is disabled; save a draft until activation is approved' using errcode='22023';
  end if;
  insert into public.academy_post_schedules as target(
    id,academy_community_id,author_member_id,category_id,title,body,is_announcement,kind,time_zone,
    starts_on,ends_on,local_time,weekdays,state,catchup_minutes,revision,active_since,created_by,client_request_id,create_request_payload
  ) values(
    coalesce(schedule_id,gen_random_uuid()),community_id,author.id,category.id,btrim(p_schedule->>'title'),btrim(p_schedule->>'body'),lower(category.name)='announcements',p_schedule->>'kind',p_schedule->>'timeZone',
    (p_schedule->>'startsOn')::date,nullif(p_schedule->>'endsOn','')::date,(p_schedule->>'localTime')::time,days,requested_state,
    coalesce((p_schedule->>'catchupMinutes')::integer,15),coalesce(old_row.revision,0)+1,
    case when requested_state='active' then case when old_row.state='active' then old_row.active_since else clock_timestamp() end end,(select auth.uid()),
    coalesce(old_row.client_request_id,request_id),coalesce(old_row.create_request_payload,p_schedule-'clientRequestId')
  ) on conflict(id) do update set
    author_member_id=excluded.author_member_id,category_id=excluded.category_id,title=excluded.title,body=excluded.body,is_announcement=excluded.is_announcement,
    kind=excluded.kind,time_zone=excluded.time_zone,starts_on=excluded.starts_on,ends_on=excluded.ends_on,local_time=excluded.local_time,
    weekdays=excluded.weekdays,state=excluded.state,catchup_minutes=excluded.catchup_minutes,revision=excluded.revision,
    active_since=excluded.active_since,updated_at=clock_timestamp()
  returning * into saved;
  return to_jsonb(saved);
end; $$;

create function public.set_academy_post_schedule_state(p_schedule_id uuid,p_state text,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.academy_post_schedules%rowtype;
begin
  select * into s from public.academy_post_schedules where id=p_schedule_id for update;
  if s.id is null or (select auth.uid()) is null or not private.can_manage_academy(s.academy_community_id) then
    raise exception 'Academy administrator access required' using errcode='42501';
  end if;
  if s.revision is distinct from p_expected_revision then raise exception 'Schedule changed; refresh before saving' using errcode='40001'; end if;
  if s.state='cancelled' or p_state is null or p_state not in ('active','paused','cancelled','draft') then raise exception 'Invalid schedule state change' using errcode='22023'; end if;
  if p_state='active' and not exists(select 1 from private.academy_post_scheduler_settings where id and enabled) then
    raise exception 'Publishing is disabled; save a draft until activation is approved' using errcode='22023';
  end if;
  if s.kind='once' and p_state='active' and exists(select 1 from public.academy_post_schedule_occurrences where schedule_id=s.id) then
    raise exception 'This one-time schedule has finished; create a new schedule' using errcode='22023';
  end if;
  update public.academy_post_schedules set state=p_state,revision=revision+1,updated_at=clock_timestamp(),
    active_since=case when p_state='active' then case when state='active' then active_since else clock_timestamp() end end
  where id=s.id returning * into s;
  return to_jsonb(s);
end; $$;

create function public.get_academy_post_scheduler_status(p_community_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or not private.can_manage_academy(p_community_id) then
    raise exception 'Academy administrator access required' using errcode='42501';
  end if;
  return jsonb_build_object('databaseEnabled',(select enabled from private.academy_post_scheduler_settings where id),
    'workerActivationVerified',false,'deliveryActivationVerified',false);
end; $$;

create function public.publish_due_academy_posts(p_limit integer default 25,p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  s public.academy_post_schedules%rowtype;
  a public.academy_members%rowtype;
  c public.community_categories%rowtype;
  day date;
  local_now date;
  due timestamptz;
  local_due timestamp;
  occurrence_id uuid;
  new_post_id uuid;
  reason text;
  published integer:=0;
  skipped integer:=0;
  failed integer:=0;
  examined integer:=0;
  finished boolean;
begin
  if p_limit is null or p_limit not between 1 and 100 or p_now is null or not isfinite(p_now) then
    raise exception 'Invalid scheduler batch' using errcode='22023';
  end if;
  -- The lock serializes publication with an operator turning the database switch off.
  perform 1 from private.academy_post_scheduler_settings where id and enabled for share;
  if not found then return jsonb_build_object('enabled',false,'published',0,'skipped',0,'failed',0); end if;
  for s in select * from public.academy_post_schedules where state='active'
    order by last_evaluated_at nulls first,created_at,id for update skip locked limit p_limit
  loop
    examined:=examined+1;
    local_now:=(p_now at time zone s.time_zone)::date;
    for day in select d::date from generate_series(
      case when s.kind='once' then s.starts_on else greatest(s.starts_on,local_now-7) end,
      case when s.kind='once' then s.starts_on else least(coalesce(s.ends_on,local_now),local_now) end,interval '1 day') d
    loop
      if s.kind='weekly' and not (extract(isodow from day)::integer=any(s.weekdays)) then continue; end if;
      local_due:=day+s.local_time;
      -- PostgreSQL chooses the later standard-time occurrence during a repeated
      -- wall time. Roundtrip detects nonexistent spring-forward wall times.
      due:=local_due at time zone s.time_zone;
      if due>p_now then continue; end if;
      if exists(select 1 from public.academy_post_schedule_occurrences o where o.schedule_id=s.id and o.local_date=day) then continue; end if;
      reason:=null;
      if due at time zone s.time_zone<>local_due then reason:='nonexistent_local_time';
      elsif due<s.active_since then reason:='before_activation';
      elsif due<p_now-make_interval(mins=>s.catchup_minutes) then reason:='catchup_expired'; end if;
      select * into a from public.academy_members where id=s.author_member_id for share;
      select * into c from public.community_categories where id=s.category_id for share;
      perform 1 from auth.users where id=a.user_id for share;
      if reason is null and (a.academy_community_id is distinct from s.academy_community_id or a.user_id is distinct from s.created_by
        or a.status<>'active' or a.role not in ('owner','admin') or not exists(
          select 1 from auth.users u where u.id=a.user_id and u.email_confirmed_at is not null and u.deleted_at is null
            and (u.banned_until is null or u.banned_until<=p_now))) then reason:='author_access_changed'; end if;
      if reason is null and (c.academy_community_id is distinct from s.academy_community_id or (lower(c.name)='announcements') is distinct from s.is_announcement) then reason:='channel_changed'; end if;
      occurrence_id:=gen_random_uuid();
      insert into public.academy_post_schedule_occurrences(id,schedule_id,academy_community_id,scheduled_for,local_date,time_zone,state,reason_code,schedule_revision,approved_snapshot)
        values(occurrence_id,s.id,s.academy_community_id,due,day,s.time_zone,'skipped',coalesce(reason,'publication_pending'),s.revision,
          to_jsonb(s)-'last_evaluated_at')
        on conflict do nothing;
      if not found then continue; end if;
      if reason is not null then skipped:=skipped+1; continue; end if;
      begin
        insert into public.community_posts(organization_id,author_id,academy_community_id,academy_author_id,category_id,title,body,status,sync_owner)
          select owner_organization_id,a.user_id,s.academy_community_id,a.id,c.id,s.title,s.body,'published','local'
          from public.academy_communities where id=s.academy_community_id
          returning id into new_post_id;
        if new_post_id is null then raise exception 'Community unavailable'; end if;
        update public.academy_post_schedule_occurrences set state='published',post_id=new_post_id,reason_code=null where id=occurrence_id;
        published:=published+1;
      exception when others then
        -- The subtransaction rolls back post + notification inserts together.
        -- Store a safe reason, never source text, SQL errors or credentials.
        update public.academy_post_schedule_occurrences set state='failed',reason_code='publication_rejected' where id=occurrence_id;
        failed:=failed+1;
      end;
    end loop;
    finished:=(s.kind='once' and exists(select 1 from public.academy_post_schedule_occurrences o where o.schedule_id=s.id))
      or (s.kind='weekly' and s.ends_on is not null and s.ends_on<local_now);
    update public.academy_post_schedules set last_evaluated_at=p_now,
      state=case when finished then 'paused' else state end,
      active_since=case when finished then null else active_since end,
      revision=case when finished then revision+1 else revision end
    where id=s.id;
  end loop;
  return jsonb_build_object('enabled',true,'examined',examined,'published',published,'skipped',skipped,'failed',failed);
end; $$;

revoke all on function public.save_academy_post_schedule(jsonb) from public,anon;
revoke all on function public.set_academy_post_schedule_state(uuid,text,integer) from public,anon;
revoke all on function public.get_academy_post_scheduler_status(uuid) from public,anon;
grant execute on function public.save_academy_post_schedule(jsonb) to authenticated;
grant execute on function public.set_academy_post_schedule_state(uuid,text,integer) to authenticated;
grant execute on function public.get_academy_post_scheduler_status(uuid) to authenticated;
revoke all on function public.publish_due_academy_posts(integer,timestamptz) from public,anon,authenticated;
grant execute on function public.publish_due_academy_posts(integer,timestamptz) to service_role;
