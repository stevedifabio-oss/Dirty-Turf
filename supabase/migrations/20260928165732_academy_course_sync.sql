-- Source-owned content only. No accounts, access grants or learning progress are changed.
alter table public.courses add column sync_owner text not null default 'local' check (sync_owner in ('local','highlevel'));
alter table public.course_modules add column sync_owner text not null default 'local' check (sync_owner in ('local','highlevel')), add column source_archived_at timestamptz, add column source_visibility text not null default 'published' check(source_visibility in ('published','draft'));
alter table public.course_lessons add column sync_owner text not null default 'local' check (sync_owner in ('local','highlevel'));

create table public.academy_course_sync_configs (
  id uuid primary key default gen_random_uuid(),
  academy_community_id uuid not null references public.academy_communities(id) on delete cascade,
  location_id text not null check (location_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  course_ids text[] not null check (cardinality(course_ids) between 1 and 20),
  enabled boolean not null default false,
  last_snapshot_hash text,
  last_success_at timestamptz,
  lock_run_id uuid,
  lock_until timestamptz,
  unique(academy_community_id)
);
create table public.academy_course_sync_runs (
  id uuid primary key default gen_random_uuid(),
  config_id uuid not null references public.academy_course_sync_configs(id) on delete cascade,
  status text not null default 'running' check(status in ('running','succeeded','unchanged','failed','abandoned')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  snapshot_hash text,
  counts jsonb,
  error_code text
);
alter table public.academy_course_sync_configs enable row level security;
alter table public.academy_course_sync_runs enable row level security;
revoke all on public.academy_course_sync_configs, public.academy_course_sync_runs from public, anon, authenticated;
grant select,insert,update,delete on public.academy_course_sync_configs, public.academy_course_sync_runs to service_role;
create index academy_course_sync_runs_config_time on public.academy_course_sync_runs(config_id,started_at desc);

-- Any locally edited source field becomes locally owned. Sync requires an explicit
-- release-time baseline enrollment; existing imported rows default to local.
create or replace function private.protect_local_course_content() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if current_setting('app.academy_course_sync',true) = 'on' then return new; end if;
  if (to_jsonb(new) - array['updated_at','sync_owner','source_import_batch_id','source_updated_at','source_archived_at'])
     is distinct from (to_jsonb(old) - array['updated_at','sync_owner','source_import_batch_id','source_updated_at','source_archived_at']) then
    new.sync_owner := 'local';
  end if;
  return new;
end $$;
create trigger protect_local_course_content before update on public.courses for each row execute function private.protect_local_course_content();
create trigger protect_local_module_content before update on public.course_modules for each row execute function private.protect_local_course_content();
create trigger protect_local_lesson_content before update on public.course_lessons for each row execute function private.protect_local_course_content();

create or replace function public.begin_academy_course_sync(p_config_id uuid) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare c public.academy_course_sync_configs; run_id uuid;
begin
  select * into c from public.academy_course_sync_configs where id=p_config_id for update;
  if not found or not c.enabled then return jsonb_build_object('skipped','disabled'); end if;
  if c.lock_until > clock_timestamp() then return jsonb_build_object('skipped','busy'); end if;
  update public.academy_course_sync_runs set status='abandoned',finished_at=now(),error_code='lease_expired' where id=c.lock_run_id and status='running';
  insert into public.academy_course_sync_runs(config_id) values(c.id) returning id into run_id;
  update public.academy_course_sync_configs set lock_run_id=run_id,lock_until=clock_timestamp()+interval '10 minutes' where id=c.id;
  return jsonb_build_object('run_id',run_id,'location_id',c.location_id,'course_ids',c.course_ids);
end $$;

create or replace function public.fail_academy_course_sync(p_run_id uuid,p_error_code text) returns void language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  update public.academy_course_sync_configs set lock_run_id=null,lock_until=null where lock_run_id=p_run_id;
  update public.academy_course_sync_runs set status='failed',finished_at=now(),error_code=left(p_error_code,100) where id=p_run_id and status='running';
end $$;

create or replace function public.apply_academy_course_sync(p_run_id uuid,p_snapshot jsonb,p_hash text) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare cfg public.academy_course_sync_configs; org_id uuid; course jsonb; module jsonb; lesson jsonb;
  cr public.courses; mr public.course_modules; lr public.course_lessons; v_module_id uuid; v_body jsonb; v_video_url text; v_lesson_type text;
  course_count integer:=0; module_count integer:=0; lesson_count integer:=0; skipped_count integer:=0;
begin
  select * into cfg from public.academy_course_sync_configs where lock_run_id=p_run_id for update;
  if not found or not cfg.enabled or cfg.lock_until <= clock_timestamp() then raise exception 'Sync lease is not valid'; end if;
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' or p_snapshot->>'version' is distinct from '1' or p_snapshot->>'complete' is distinct from 'true'
    or p_snapshot->>'location_id' is distinct from cfg.location_id
    or jsonb_typeof(p_snapshot->'courses') is distinct from 'array'
    or (select array_agg(x order by x) from jsonb_array_elements_text(p_snapshot->'course_ids') x) is distinct from (select array_agg(x order by x) from unnest(cfg.course_ids) x)
    or (select array_agg(x->>'external_id' order by x->>'external_id') from jsonb_array_elements(p_snapshot->'courses') x) is distinct from (select array_agg(x order by x) from unnest(cfg.course_ids) x)
  then raise exception 'Invalid complete allowlisted snapshot'; end if;
  if p_hash = cfg.last_snapshot_hash then
    update public.academy_course_sync_runs set status='unchanged',snapshot_hash=p_hash,finished_at=now() where id=p_run_id;
    update public.academy_course_sync_configs set last_success_at=now(),lock_run_id=null,lock_until=null where id=cfg.id;
    return jsonb_build_object('status','unchanged');
  end if;
  select owner_organization_id into strict org_id from public.academy_communities where id=cfg.academy_community_id;
  perform set_config('app.academy_course_sync','on',true);
  perform set_config('app.academy_course_sync_notifications',case when cfg.last_success_at is null then 'off' else 'on' end,true);
  for course in select value from jsonb_array_elements(p_snapshot->'courses') loop
    if jsonb_typeof(course->'modules') is distinct from 'array' or jsonb_typeof(course->'lessons') is distinct from 'array' then raise exception 'Incomplete course collections'; end if;
    if (select count(*) <> count(distinct x->>'external_id') from jsonb_array_elements(course->'modules') x)
      or (select count(*) <> count(distinct x->>'external_id') from jsonb_array_elements(course->'lessons') x) then raise exception 'Duplicate source identity'; end if;
    if (select count(*) from public.courses where academy_community_id=cfg.academy_community_id and external_id=course->>'external_id')>1 then raise exception 'Ambiguous imported course identity'; end if;
    select * into cr from public.courses where academy_community_id=cfg.academy_community_id and external_id=course->>'external_id' for update;
    if found and (cr.source_provider is distinct from 'highlevel' or cr.sync_owner <> 'highlevel') then skipped_count:=skipped_count+1; continue; end if;
    if cr.id is null then
      insert into public.courses(organization_id,academy_community_id,external_id,source_provider,sync_owner,title,description,cover_url,instructor_name,status)
      values(org_id,cfg.academy_community_id,course->>'external_id','highlevel','highlevel',course->>'title',course->>'description',course->>'cover_url',course->>'instructor_name','draft') returning * into cr;
    else
      update public.courses set title=course->>'title',description=course->>'description',cover_url=course->>'cover_url',instructor_name=course->>'instructor_name'
      where id=cr.id and sync_owner='highlevel' and (title,description,cover_url,instructor_name) is distinct from (course->>'title',course->>'description',course->>'cover_url',course->>'instructor_name');
    end if;
    course_count:=course_count+1;
    for module in select value from jsonb_array_elements(course->'modules') loop
      if (select count(*) from public.course_modules where course_id=cr.id and external_id=module->>'external_id')>1 then raise exception 'Ambiguous imported module identity'; end if;
      select * into mr from public.course_modules where course_id=cr.id and external_id=module->>'external_id' for update;
      if found and mr.sync_owner<>'highlevel' then skipped_count:=skipped_count+1; continue; end if;
      if mr.id is null then
        insert into public.course_modules(course_id,external_id,title,sort_order,group_title,drip_after_days,sync_owner,source_visibility)
        values(cr.id,module->>'external_id',module->>'title',(module->>'sort_order')::integer,module->>'group_title',(module->>'drip_after_days')::integer,'highlevel',module->>'status');
      else
        update public.course_modules set title=module->>'title',sort_order=(module->>'sort_order')::integer,group_title=module->>'group_title',drip_after_days=(module->>'drip_after_days')::integer,source_archived_at=null
        where id=mr.id and sync_owner='highlevel' and (title,sort_order,group_title,drip_after_days,source_archived_at) is distinct from (module->>'title',(module->>'sort_order')::integer,module->>'group_title',(module->>'drip_after_days')::integer,null::timestamptz);
      end if;
      update public.course_modules m set source_visibility=case when exists(select 1 from public.course_lessons l where l.module_id=m.id and l.sync_owner='local' and l.status='published') then 'published' else module->>'status' end
      where m.course_id=cr.id and m.external_id=module->>'external_id' and m.sync_owner='highlevel';
      module_count:=module_count+1;
    end loop;
    for lesson in select value from jsonb_array_elements(course->'lessons') loop
      if not exists (select 1 from jsonb_array_elements(course->'modules') m where m->>'external_id'=lesson->>'module_external_id') then raise exception 'Unknown lesson module'; end if;
      select id into strict v_module_id from public.course_modules where course_id=cr.id and external_id=lesson->>'module_external_id';
      -- Stable lesson IDs are resolved across the entire source course, not parent module.
      if (select count(*) from public.course_lessons l join public.course_modules m on m.id=l.module_id where m.course_id=cr.id and l.external_id=lesson->>'external_id')>1 then raise exception 'Ambiguous imported lesson identity'; end if;
      select l.* into lr from public.course_lessons l join public.course_modules m on m.id=l.module_id where m.course_id=cr.id and l.external_id=lesson->>'external_id' for update of l;
      if found and lr.sync_owner<>'highlevel' then skipped_count:=skipped_count+1; continue; end if;
      v_video_url:=case when lesson->>'lesson_type'='quiz' then null when lesson->'body' ? 'sourceVideoUrl' then lesson->'body'->>'sourceVideoUrl' when lr.body ? 'sourceVideoUrl' then null else lr.video_url end;
      v_lesson_type:=case when lesson->>'lesson_type'='quiz' then 'quiz' when v_video_url is not null then 'video' else lesson->>'lesson_type' end;
      v_body:=(coalesce(lr.body,'{}'::jsonb) - array['text','content','description','quiz','sourceVideoUrl']) || (lesson->'body');
      if lr.id is null then
        insert into public.course_lessons(module_id,external_id,title,sort_order,status,lesson_type,body,video_url,sync_owner)
        values(v_module_id,lesson->>'external_id',lesson->>'title',(lesson->>'sort_order')::integer,(lesson->>'status')::public.content_status,v_lesson_type,v_body,v_video_url,'highlevel');
      else
        -- Merge HTML only. Preserve imported quiz details, playable video, private
        -- resources and member progress: collection endpoints omit those fields.
        update public.course_lessons set module_id=v_module_id,title=lesson->>'title',sort_order=(lesson->>'sort_order')::integer,status=(lesson->>'status')::public.content_status,
          lesson_type=v_lesson_type,body=v_body,video_url=v_video_url
        where id=lr.id and sync_owner='highlevel' and (course_lessons.module_id,title,sort_order,status,body,lesson_type,video_url) is distinct from (v_module_id,lesson->>'title',(lesson->>'sort_order')::integer,(lesson->>'status')::public.content_status,v_body,v_lesson_type,v_video_url);
      end if;
      lesson_count:=lesson_count+1;
    end loop;
    -- Soft retirement only, after a complete snapshot is validated and applied.
    update public.course_lessons l set status='archived' from public.course_modules m where l.module_id=m.id and m.course_id=cr.id and l.sync_owner='highlevel' and l.status<>'archived'
      and not exists(select 1 from jsonb_array_elements(course->'lessons') x where x->>'external_id'=l.external_id);
    update public.course_modules m set source_archived_at=now() where m.course_id=cr.id and m.sync_owner='highlevel' and m.source_archived_at is null
      and not exists(select 1 from jsonb_array_elements(course->'modules') x where x->>'external_id'=m.external_id)
      and not exists(select 1 from public.course_lessons l where l.module_id=m.id and l.sync_owner='local' and l.status<>'archived');
  end loop;
  if course_count=0 then raise exception 'No enrolled source-owned courses; baseline enrollment required'; end if;
  update public.academy_course_sync_configs set last_snapshot_hash=p_hash,last_success_at=now(),lock_run_id=null,lock_until=null where id=cfg.id;
  update public.academy_course_sync_runs set status='succeeded',snapshot_hash=p_hash,finished_at=now(),counts=jsonb_build_object('courses',course_count,'modules',module_count,'lessons',lesson_count,'locally_owned_skipped',skipped_count) where id=p_run_id;
  return jsonb_build_object('status','succeeded','courses',course_count,'modules',module_count,'lessons',lesson_count,'locally_owned_skipped',skipped_count);
end $$;
revoke all on function public.begin_academy_course_sync(uuid), public.fail_academy_course_sync(uuid,text), public.apply_academy_course_sync(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.begin_academy_course_sync(uuid), public.fail_academy_course_sync(uuid,text), public.apply_academy_course_sync(uuid,jsonb,text) to service_role;
