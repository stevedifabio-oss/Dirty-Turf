-- Browser observations have their own ordered lease. They are not fabricated
-- source update versions. Imported records keep IDs, reactions and local replies.
alter table public.community_comments add column media jsonb not null default '[]'::jsonb check(jsonb_typeof(media)='array');
alter table public.academy_community_sync_configs
 add column snapshot_sequence bigint not null default 0,
 add column snapshot_capture_id text,
 add column snapshot_lease_token uuid,
 add column snapshot_lease_until timestamptz,
 add column last_snapshot_state jsonb;
create table public.academy_community_snapshot_runs (
 config_id uuid not null references public.academy_community_sync_configs(id) on delete cascade,
 capture_id text not null check(capture_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'),
 observation_sequence bigint not null,
 started_at timestamptz not null default now(), finished_at timestamptz,
 status text not null default 'capturing' check(status in ('capturing','applied','failed','superseded')),
 capture_hash text, snapshot_state jsonb, result jsonb, error_code text,
 primary key(config_id,capture_id), unique(config_id,observation_sequence)
);
create table public.academy_community_snapshot_records (
 config_id uuid not null references public.academy_community_sync_configs(id) on delete cascade,
 entity text not null check(entity in ('post','comment')), external_id text not null,
 content_hash text not null check(content_hash ~ '^[0-9a-f]{64}$'),
 target_fingerprint jsonb, row_id uuid,
 observation_sequence bigint not null,
 status text not null check(status in ('applied','conflict')),
 error_code text,
 primary key(config_id,entity,external_id)
);
alter table public.academy_community_snapshot_runs enable row level security;
alter table public.academy_community_snapshot_records enable row level security;
revoke all on public.academy_community_snapshot_runs,public.academy_community_snapshot_records from public,anon,authenticated;
grant select,insert,update,delete on public.academy_community_snapshot_runs,public.academy_community_snapshot_records to service_role;

-- Canonical JSON matches the planner's sorted-object JSON.stringify hashes.
create function private.community_snapshot_canonical(p_value jsonb) returns text
language plpgsql immutable strict set search_path='' as $$
#variable_conflict use_variable
declare result text;
begin
 case jsonb_typeof(p_value)
 when 'object' then
  select '{'||coalesce(string_agg(to_jsonb(key)::text||':'||private.community_snapshot_canonical(value),',' order by key collate "C"),'')||'}' into result from jsonb_each(p_value);
 when 'array' then
  select '['||coalesce(string_agg(private.community_snapshot_canonical(value),',' order by ord),'')||']' into result from jsonb_array_elements(p_value) with ordinality a(value,ord);
 else result:=p_value::text;
 end case;
 return result;
end $$;
create function private.community_snapshot_hash(p_value jsonb) returns text language sql immutable strict set search_path='' as $$
 select encode(sha256(convert_to(private.community_snapshot_canonical(p_value),'UTF8')),'hex')
$$;
create function private.community_snapshot_target(p_entity text,p_row_id uuid) returns jsonb language sql stable set search_path='' as $$
 select case when p_entity='post' then
  (select jsonb_build_object('id',p.id,'academy_author_id',p.academy_author_id,'author_id',p.author_id,'title',p.title,'body',p.body,'category_id',p.category_id,'pinned',p.is_pinned,'status',p.status,'media',private.community_source_media(p.media),'sync_owner',p.sync_owner,'source_version',p.source_updated_at) from public.community_posts p where p.id=p_row_id)
 else
  (select jsonb_build_object('id',c.id,'academy_author_id',c.academy_author_id,'author_id',c.author_id,'body',c.body,'post_id',c.post_id,'parent_id',c.parent_id,'is_answer',c.is_answer,'media',private.community_source_media(c.media),'sync_owner',c.sync_owner,'source_version',c.source_updated_at) from public.community_comments c where c.id=p_row_id)
 end
$$;
create function private.community_snapshot_media(p_new jsonb,p_existing jsonb) returns jsonb language sql immutable set search_path='' as $$
 select coalesce(jsonb_agg(n.value||coalesce((select jsonb_object_agg(k.key,k.value) from jsonb_array_elements(coalesce(p_existing,'[]'::jsonb)) old,lateral jsonb_each(old) k where old->>'url'=n.value->>'url' and k.key in ('storage_bucket','storage_path','mime_type','byte_size','content_hash')),'{}'::jsonb) order by n.ord),'[]'::jsonb)
 from jsonb_array_elements(p_new) with ordinality n(value,ord)
$$;
revoke all on function private.community_snapshot_canonical(jsonb),private.community_snapshot_hash(jsonb),private.community_snapshot_target(text,uuid),private.community_snapshot_media(jsonb,jsonb) from public,anon,authenticated;
grant execute on function private.community_snapshot_canonical(jsonb),private.community_snapshot_hash(jsonb),private.community_snapshot_target(text,uuid),private.community_snapshot_media(jsonb,jsonb) to service_role;

create function public.begin_academy_community_snapshot(p_config_id uuid,p_capture_id text,p_lease_seconds integer default 1800) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
#variable_conflict use_variable
declare cfg public.academy_community_sync_configs; run public.academy_community_snapshot_runs; token uuid;
begin
 if p_capture_id is null or p_capture_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$' or p_lease_seconds not between 60 and 3600 then raise exception 'Invalid capture lease'; end if;
 select * into strict cfg from public.academy_community_sync_configs where id=p_config_id for update;
 if not cfg.enabled then return jsonb_build_object('status','disabled'); end if;
 select * into run from public.academy_community_snapshot_runs where config_id=cfg.id and capture_id=p_capture_id;
 if run.status='applied' then return jsonb_build_object('status','duplicate','result',run.result,'previousState',cfg.last_snapshot_state); end if;
 if cfg.snapshot_lease_until>now() then
  if cfg.snapshot_capture_id=p_capture_id then return jsonb_build_object('status','capturing','observationSequence',run.observation_sequence,'leaseToken',cfg.snapshot_lease_token,'previousState',cfg.last_snapshot_state,'scope',jsonb_build_object('locationId',cfg.location_id,'groupId',cfg.group_id)); end if;
  return jsonb_build_object('status','busy','retryAt',cfg.snapshot_lease_until);
 end if;
 if run.capture_id is not null then raise exception 'Expired capture identity cannot be reused'; end if;
 update public.academy_community_snapshot_runs set status='superseded',finished_at=now(),error_code='lease_expired' where config_id=cfg.id and status='capturing';
 token:=gen_random_uuid();
 update public.academy_community_sync_configs set snapshot_sequence=snapshot_sequence+1,snapshot_capture_id=p_capture_id,snapshot_lease_token=token,snapshot_lease_until=now()+make_interval(secs=>p_lease_seconds) where id=cfg.id returning * into cfg;
 insert into public.academy_community_snapshot_runs(config_id,capture_id,observation_sequence) values(cfg.id,p_capture_id,cfg.snapshot_sequence);
 return jsonb_build_object('status','capturing','observationSequence',cfg.snapshot_sequence,'leaseToken',token,'previousState',cfg.last_snapshot_state,'scope',jsonb_build_object('locationId',cfg.location_id,'groupId',cfg.group_id));
end $$;
create function public.renew_academy_community_snapshot(p_config_id uuid,p_capture_id text,p_lease_token uuid,p_lease_seconds integer default 1800) returns boolean
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if p_lease_seconds not between 60 and 3600 then raise exception 'Invalid capture lease'; end if;
 update public.academy_community_sync_configs set snapshot_lease_until=now()+make_interval(secs=>p_lease_seconds)
 where id=p_config_id and enabled and snapshot_capture_id=p_capture_id and snapshot_lease_token=p_lease_token and snapshot_lease_until>now();
 return found;
end $$;
create function public.fail_academy_community_snapshot(p_config_id uuid,p_capture_id text,p_lease_token uuid,p_error_code text) returns boolean
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if p_error_code is null or p_error_code !~ '^[a-z0-9_]{1,120}$' then raise exception 'Invalid failure code'; end if;
 update public.academy_community_sync_configs set snapshot_lease_until=null,snapshot_lease_token=null,snapshot_capture_id=null
 where id=p_config_id and snapshot_capture_id=p_capture_id and snapshot_lease_token=p_lease_token;
 if not found then return false; end if;
 update public.academy_community_snapshot_runs set status='failed',finished_at=now(),error_code=p_error_code where config_id=p_config_id and capture_id=p_capture_id and status='capturing';
 return true;
end $$;

create function public.apply_academy_community_snapshot(p_config_id uuid,p_capture_id text,p_lease_token uuid,p_plan jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
#variable_conflict use_variable
declare cfg public.academy_community_sync_configs; run public.academy_community_snapshot_runs; state jsonb; records jsonb; r jsonb; content jsonb; prior jsonb; change jsonb;
 baseline public.academy_community_snapshot_records; st public.academy_community_sync_state; p public.community_posts; c public.community_comments;
 author uuid; category uuid; post_id uuid; parent_id uuid; row_id uuid; batch uuid; source_version timestamptz; source_created timestamptz;
 reason text; media jsonb; result jsonb; conflicts jsonb:='[]'; n_added integer:=0; n_updated integer:=0; n_unchanged integer:=0;
 previous_sync text:=current_setting('app.academy_community_sync',true);
begin
 select * into strict cfg from public.academy_community_sync_configs where id=p_config_id for update;
 select * into strict run from public.academy_community_snapshot_runs where config_id=cfg.id and capture_id=p_capture_id for update;
 state:=p_plan->'nextState'; records:=state->'records';
 if run.status='applied' then
  if run.capture_hash is distinct from state->>'captureHash' or run.snapshot_state is distinct from state then raise exception 'Capture identity reused'; end if;
  return jsonb_build_object('status','duplicate','result',run.result);
 end if;
 if not cfg.enabled or cfg.snapshot_capture_id is distinct from p_capture_id or cfg.snapshot_lease_token is distinct from p_lease_token or cfg.snapshot_lease_until<=now() or run.status<>'capturing' or run.observation_sequence<>cfg.snapshot_sequence then raise exception 'Capture lease lost'; end if;
 if p_plan->>'captureAccepted' is distinct from 'true' or jsonb_typeof(p_plan->'blocked') is distinct from 'array' or jsonb_array_length(p_plan->'blocked')<>0
  or state->>'schemaVersion' is distinct from '1' or state->>'captureId' is distinct from p_capture_id or state->'scope'->>'locationId' is distinct from cfg.location_id or state->'scope'->>'groupId' is distinct from cfg.group_id
  or state->>'captureHash' is null or state->>'captureHash' !~ '^[0-9a-f]{64}$' or jsonb_typeof(records) is distinct from 'array' or jsonb_array_length(records)>60000
  or jsonb_typeof(p_plan->'changes') is distinct from 'array' then raise exception 'Invalid accepted allowlisted snapshot'; end if;
 if state->>'observedStartedAt' is null or state->>'observedCompletedAt' is null or not isfinite((state->>'observedStartedAt')::timestamptz) or not isfinite((state->>'observedCompletedAt')::timestamptz)
  or (state->>'observedStartedAt')::timestamptz>(state->>'observedCompletedAt')::timestamptz
  or (state->>'observedCompletedAt')::timestamptz>now()+interval '1 minute'
  or (cfg.last_snapshot_state is not null and (state->>'observedStartedAt')::timestamptz <= (cfg.last_snapshot_state->>'observedCompletedAt')::timestamptz) then raise exception 'Invalid observation order'; end if;
 if exists(select 1 from jsonb_array_elements(records) x group by x->>'entity',x->>'externalId' having count(*)>1)
  or exists(select 1 from jsonb_array_elements(p_plan->'changes') x group by x->>'entity',x->>'externalId' having count(*)>1) then raise exception 'Duplicate source identity'; end if;
 if exists(select 1 from jsonb_array_elements(p_plan->'changes') q_change where not exists(select 1 from jsonb_array_elements(records) q_record where q_record->>'entity'=q_change->>'entity' and q_record->>'externalId'=q_change->>'externalId')) then raise exception 'Change outside snapshot'; end if;
 if state->>'snapshotHash' is distinct from private.community_snapshot_hash((select coalesce(jsonb_agg(jsonb_build_object('entity',x->>'entity','externalId',x->>'externalId','contentHash',x->>'contentHash') order by ord),'[]') from jsonb_array_elements(records) with ordinality a(x,ord))) then raise exception 'Invalid snapshot content hash'; end if;
 -- Validate the whole graph and every expected previous hash before any row writes.
 for r in select value from jsonb_array_elements(records) loop
  content:=r->'content';
  if r->>'entity' is null or r->>'entity' not in ('post','comment') or r->>'externalId' is null or r->>'externalId' !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
   or jsonb_typeof(content) is distinct from 'object' or r->>'contentHash' is distinct from private.community_snapshot_hash(content)
   or nullif(content->>'authorExternalId','') is null or jsonb_typeof(content->'authorExternalId') is distinct from 'string'
   or nullif(content->>'body','') is null or jsonb_typeof(content->'body') is distinct from 'string'
   or (content ? 'pinned' and jsonb_typeof(content->'pinned') is distinct from 'boolean')
   or (r->>'entity'='post' and jsonb_typeof(content->'title') is distinct from 'string')
   or (r->>'entity'='post' and content - array['authorExternalId','title','body','categoryExternalId','pinned','media'] <> '{}'::jsonb)
   or (r->>'entity'='comment' and content - array['authorExternalId','body','postExternalId','parentExternalId','media'] <> '{}'::jsonb)
   or char_length(content->>'body')>(case when r->>'entity'='post' then 5000 else 3000 end)
   or (r->>'entity'='post' and (char_length(content->>'title') not between 2 and 120 or char_length(content->>'body')<2))
   or (content ? 'media' and (jsonb_typeof(content->'media') is distinct from 'array' or jsonb_array_length(content->'media')>20)) then raise exception 'Invalid snapshot record'; end if;
  if exists(select 1 from jsonb_array_elements(coalesce(content->'media','[]')) a where a->>'type' is null or a->>'type' not in ('source-asset','image','video','file') or a->>'url' is null or a->>'url' !~ '^https://[^/@:[:space:]]+[.][^/@:[:space:]]+(/[^[:space:]]*)?$' or position(chr(92) in a->>'url')>0 or a - array['url','type','name'] <> '{}'::jsonb) then raise exception 'Invalid snapshot attachment'; end if;
  select value into prior from jsonb_array_elements(coalesce(cfg.last_snapshot_state->'records','[]')) where value->>'entity'=r->>'entity' and value->>'externalId'=r->>'externalId';
  select value into change from jsonb_array_elements(p_plan->'changes') where value->>'entity'=r->>'entity' and value->>'externalId'=r->>'externalId';
  if prior is null or prior->>'contentHash' is distinct from r->>'contentHash' then
   if change is null or change->>'contentHash' is distinct from r->>'contentHash' or change->>'expectedPreviousContentHash' is distinct from prior->>'contentHash' then raise exception 'Previous source hash mismatch'; end if;
  elsif change is not null then raise exception 'Unexpected unchanged record change'; end if;
  if r->>'entity'='comment' then
   if not(content ? 'parentExternalId') or not exists(select 1 from jsonb_array_elements(records) x where x->>'entity'='post' and x->>'externalId'=content->>'postExternalId') then raise exception 'Comment post missing'; end if;
   if content->>'parentExternalId' is not null and not exists(select 1 from jsonb_array_elements(records) x where x->>'entity'='comment' and x->>'externalId'=content->>'parentExternalId' and x->'content'->>'postExternalId'=content->>'postExternalId') then raise exception 'Comment parent missing'; end if;
  end if;
 end loop;
 if exists(with recursive graph as (
  select x->>'externalId' origin,x->'content'->>'parentExternalId' parent,array[x->>'externalId'] path,false cycle from jsonb_array_elements(records) x where x->>'entity'='comment'
  union all select g.origin,x->'content'->>'parentExternalId',g.path||(x->>'externalId'),(x->>'externalId')=any(g.path) from graph g join jsonb_array_elements(records) x on x->>'entity'='comment' and x->>'externalId'=g.parent where not g.cycle and cardinality(g.path)<=50
 ) select 1 from graph where cycle or cardinality(path)>50) then raise exception 'Invalid comment ancestry'; end if;
 perform set_config('app.academy_community_sync','on',true);
 insert into public.source_import_batches(academy_community_id,provider,status,manifest,source_exported_at,imported_at)
 values(cfg.academy_community_id,'highlevel','imported',jsonb_build_object('communityBrowserCapture',p_capture_id,'observationSequence',run.observation_sequence),null,now()) returning id into batch;
 -- Ancestors precede replies; previously absent parents can be inserted in this transaction.
 for r in with recursive ordered as (
  (select value r,0 depth from jsonb_array_elements(records) where value->>'entity'='post'
  union all select value,1 from jsonb_array_elements(records) where value->>'entity'='comment' and value->'content'->>'parentExternalId' is null)
  union all select x.value,o.depth+1 from ordered o join jsonb_array_elements(records) x on x.value->>'entity'='comment' and o.r->>'entity'='comment' and x.value->'content'->>'parentExternalId'=o.r->>'externalId'
 ) select ordered.r from ordered order by depth,r->>'externalId' loop
  content:=r->'content'; reason:=null; row_id:=null; author:=null; category:=null; post_id:=null; parent_id:=null;
  select * into baseline from public.academy_community_snapshot_records where config_id=cfg.id and entity=r->>'entity' and external_id=r->>'externalId' for update;
  select * into st from public.academy_community_sync_state where config_id=cfg.id and entity=r->>'entity' and external_id=r->>'externalId' for update;
  if r->>'entity'='post' then select * into p from public.community_posts where academy_community_id=cfg.academy_community_id and source_provider='highlevel' and external_id=r->>'externalId' for update; row_id:=p.id;
  else select * into c from public.community_comments where academy_community_id=cfg.academy_community_id and source_provider='highlevel' and external_id=r->>'externalId' for update; row_id:=c.id; end if;
  if st.local_override or (row_id is not null and (case when r->>'entity'='post' then p.sync_owner else c.sync_owner end)<>'highlevel') then reason:='local_edit_or_delete';
  elsif baseline.target_fingerprint is not null and private.community_snapshot_target(r->>'entity',row_id) is distinct from baseline.target_fingerprint then reason:='target_changed_since_capture';
  elsif st.deleted then reason:='source_tombstone';
  elsif st.source_version is not null and st.last_payload is not null and r->'source'->>'sourceUpdatedAt' is null and (baseline.row_id is null or st.source_version>(case when r->>'entity'='post' then p.source_updated_at else c.source_updated_at end)) then reason:='unversioned_observation_after_versioned_event';
  end if;
  source_version:=(r->'source'->>'sourceUpdatedAt')::timestamptz; source_created:=(r->'source'->>'sourceCreatedAt')::timestamptz;
  if source_version is not null and (not isfinite(source_version) or source_version>now()+interval '1 day' or st.source_version>source_version) then reason:='source_version_regressed'; end if;
  if source_created is not null and not isfinite(source_created) then raise exception 'Invalid source creation time'; end if;
  if reason is null and baseline.content_hash=r->>'contentHash' and baseline.target_fingerprint is not null then n_unchanged:=n_unchanged+1;
  elsif reason is null then
   select min(l.academy_member_id::text)::uuid into author from public.academy_member_links l where l.academy_community_id=cfg.academy_community_id and l.external_provider='highlevel' and (l.external_contact_id=content->>'authorExternalId' or l.external_member_id=content->>'authorExternalId') having count(distinct l.academy_member_id)=1;
   if author is null then reason:='unknown_or_ambiguous_author'; end if;
   if r->>'entity'='post' and content->>'categoryExternalId' is not null then select id into category from public.community_categories where academy_community_id=cfg.academy_community_id and external_id=content->>'categoryExternalId'; if category is null then reason:='unknown_category'; end if; end if;
   if r->>'entity'='comment' then
    select id into post_id from public.community_posts where academy_community_id=cfg.academy_community_id and source_provider='highlevel' and external_id=content->>'postExternalId';
    if post_id is null then reason:='unknown_post'; end if;
    if content->>'parentExternalId' is not null then select id into parent_id from public.community_comments where academy_community_id=cfg.academy_community_id and source_provider='highlevel' and external_id=content->>'parentExternalId' and public.community_comments.post_id=post_id; if parent_id is null then reason:='unknown_parent'; end if; end if;
    if c.id is not null and (c.post_id is distinct from post_id or c.parent_id is distinct from parent_id) then reason:='comment_relationship_changed'; end if;
   end if;
   if row_id is null and (not(content ? 'media') or (r->>'entity'='post' and (not(content ? 'pinned') or not(content ? 'categoryExternalId')))) then reason:='new_content_fields_unobserved'; end if;
   if reason is null then
    media:=case when content ? 'media' then private.community_snapshot_media(content->'media',case when r->>'entity'='post' then p.media else c.media end) else case when r->>'entity'='post' then p.media else c.media end end;
    if r->>'entity'='post' then
     if row_id is null then
      insert into public.community_posts(organization_id,academy_community_id,academy_author_id,external_id,source_provider,source_created_at,source_updated_at,source_url,source_import_batch_id,title,body,is_pinned,category_id,media,status,sync_owner,created_at)
      select owner_organization_id,cfg.academy_community_id,author,r->>'externalId','highlevel',source_created,source_version,r->'source'->>'sourceUrl',batch,content->>'title',content->>'body',(content->>'pinned')::boolean,category,media,'published','highlevel',coalesce(source_created,now()) from public.academy_communities where id=cfg.academy_community_id returning id into row_id;
     else update public.community_posts set title=content->>'title',body=content->>'body',academy_author_id=author,is_pinned=case when content ? 'pinned' then (content->>'pinned')::boolean else is_pinned end,category_id=case when content ? 'categoryExternalId' then category else category_id end,media=media,source_updated_at=coalesce(source_version,source_updated_at),source_import_batch_id=batch where id=row_id; end if;
    else
     if row_id is null then
      insert into public.community_comments(organization_id,academy_community_id,academy_author_id,external_id,source_provider,source_created_at,source_updated_at,source_url,source_import_batch_id,post_id,parent_id,body,media,sync_owner,created_at)
      select owner_organization_id,cfg.academy_community_id,author,r->>'externalId','highlevel',source_created,source_version,r->'source'->>'sourceUrl',batch,post_id,parent_id,content->>'body',media,'highlevel',coalesce(source_created,now()) from public.academy_communities where id=cfg.academy_community_id returning id into row_id;
     else update public.community_comments set body=content->>'body',academy_author_id=author,media=media,source_updated_at=coalesce(source_version,source_updated_at),source_import_batch_id=batch where id=row_id; end if;
    end if;
    if (case when r->>'entity'='post' then p.id else c.id end) is null then n_added:=n_added+1; else n_updated:=n_updated+1; end if;
    insert into public.academy_community_sync_state(config_id,entity,external_id,row_id,source_version) values(cfg.id,r->>'entity',r->>'externalId',row_id,source_version)
    on conflict(config_id,entity,external_id) do update set row_id=excluded.row_id,source_version=coalesce(excluded.source_version,public.academy_community_sync_state.source_version);
   end if;
  end if;
  if reason is not null then conflicts:=conflicts||jsonb_build_array(jsonb_build_object('entity',r->>'entity','externalId',r->>'externalId','reason',reason)); end if;
  insert into public.academy_community_snapshot_records(config_id,entity,external_id,content_hash,row_id,target_fingerprint,observation_sequence,status,error_code)
  values(cfg.id,r->>'entity',r->>'externalId',r->>'contentHash',row_id,case when reason is null then private.community_snapshot_target(r->>'entity',row_id) else baseline.target_fingerprint end,run.observation_sequence,case when reason is null then 'applied' else 'conflict' end,reason)
  on conflict(config_id,entity,external_id) do update set content_hash=excluded.content_hash,row_id=excluded.row_id,target_fingerprint=excluded.target_fingerprint,observation_sequence=excluded.observation_sequence,status=excluded.status,error_code=excluded.error_code;
 end loop;
 result:=jsonb_build_object('status','applied','observationSequence',run.observation_sequence,'added',n_added,'updated',n_updated,'unchanged',n_unchanged,'conflicts',conflicts,'missingReviewOnly',coalesce(p_plan->'missing','[]'));
 update public.academy_community_snapshot_runs set status='applied',finished_at=now(),capture_hash=state->>'captureHash',snapshot_state=state,result=result where config_id=cfg.id and capture_id=p_capture_id;
 update public.academy_community_sync_configs set last_snapshot_state=state,last_success_at=now(),snapshot_capture_id=null,snapshot_lease_token=null,snapshot_lease_until=null where id=cfg.id;
 perform set_config('app.academy_community_sync',coalesce(previous_sync,'off'),true);
 return result;
end $$;
revoke all on function public.begin_academy_community_snapshot(uuid,text,integer),public.renew_academy_community_snapshot(uuid,text,uuid,integer),public.fail_academy_community_snapshot(uuid,text,uuid,text),public.apply_academy_community_snapshot(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.begin_academy_community_snapshot(uuid,text,integer),public.renew_academy_community_snapshot(uuid,text,uuid,integer),public.fail_academy_community_snapshot(uuid,text,uuid,text),public.apply_academy_community_snapshot(uuid,text,uuid,jsonb) to service_role;

create or replace view public.academy_comment_feed with (security_invoker = true) as
select
  comment.id,
  comment.academy_community_id,
  comment.post_id,
  comment.parent_id,
  coalesce(nullif(profile.full_name, ''), nullif(member.display_name, ''), 'Member') as author_name,
  comment.body,
  comment.is_answer,
  comment.created_at,
  (
    (select count(*) from public.community_comment_reactions reaction where reaction.comment_id = comment.id)
    + (select count(*) from public.academy_comment_reactions reaction where reaction.comment_id = comment.id)
  )::integer as like_count,
  comment.academy_author_id,
  comment.media
from public.community_comments comment
left join public.profiles profile on profile.id = comment.author_id
left join public.academy_members member on member.id = comment.academy_author_id
where not exists (
  select 1
  from public.academy_member_blocks block
  join public.academy_members viewer on viewer.id = block.blocker_member_id
  where viewer.user_id = (select auth.uid())
    and block.blocked_member_id = comment.academy_author_id
)
group by comment.id, profile.full_name, member.display_name;



-- Verified versioned events share comment attachment support with observations.
create or replace function public.apply_academy_community_event(p_config_id uuid,p_event jsonb) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare cfg public.academy_community_sync_configs; ev public.academy_community_sync_events; st public.academy_community_sync_state;
 p public.community_posts; c public.community_comments; batch uuid; author uuid; category uuid; target_post uuid; parent uuid; rowid uuid;
 source_time timestamptz; created_time timestamptz; v_media jsonb; result_status text:='applied'; reason text; op text; ent text; ext text; eventid text; previous_sync text:=current_setting('app.academy_community_sync',true);
begin
 select * into strict cfg from public.academy_community_sync_configs where id=p_config_id for update;
 if not cfg.enabled then return jsonb_build_object('status','disabled'); end if;
 ent:=p_event->>'entity';op:=p_event->>'operation';ext:=p_event->>'externalId';eventid:=p_event->>'eventId';
 if p_event->>'schemaVersion' is distinct from '1' or p_event->>'locationId' is distinct from cfg.location_id or p_event->>'groupId' is distinct from cfg.group_id
  or ent is null or ent not in ('post','comment') or op is null or op not in ('upsert','delete') or ext is null or char_length(ext) not between 1 and 200 or eventid is null or char_length(eventid) not between 1 and 200
  or p_event->>'sourceUpdatedAt' is null then raise exception 'Invalid source event'; end if;
 source_time:=(p_event->>'sourceUpdatedAt')::timestamptz;created_time:=coalesce((p_event->>'sourceCreatedAt')::timestamptz,source_time);
 if not isfinite(source_time) or not isfinite(created_time) or source_time>now()+interval '1 day' then raise exception 'Invalid source timestamp'; end if;
 if ent='comment' and nullif(p_event->>'postExternalId','') is null then raise exception 'Comment post identity required'; end if;
 if op='upsert' then
  if nullif(p_event->>'authorExternalId','') is null or p_event->>'body' is null or char_length(p_event->>'body') not between (case when ent='post' then 2 else 1 end) and (case when ent='post' then 5000 else 3000 end)
   or (ent='post' and (p_event->>'title' is null or char_length(p_event->>'title') not between 2 and 120))
   or (p_event ? 'media' and (jsonb_typeof(p_event->'media') is distinct from 'array'))
  then raise exception 'Invalid source content'; end if;
 end if;
 insert into public.academy_community_sync_events(config_id,event_id,payload) values(cfg.id,eventid,p_event) on conflict do nothing;
 select * into strict ev from public.academy_community_sync_events where config_id=cfg.id and event_id=eventid for update;
 if ev.payload is distinct from p_event then raise exception 'Event identity reused with different payload'; end if;
 if ev.status<>'pending' then return jsonb_build_object('status','duplicate','originalStatus',ev.status); end if;
 update public.academy_community_sync_events set attempts=attempts+1 where config_id=cfg.id and event_id=eventid;
 insert into public.academy_community_sync_state(config_id,entity,external_id) values(cfg.id,ent,ext) on conflict do nothing;
 select * into strict st from public.academy_community_sync_state where config_id=cfg.id and entity=ent and external_id=ext for update;
 if st.local_override then result_status:='conflict';reason:='local_edit_or_delete';
 elsif st.source_version>source_time then result_status:='stale';
 elsif st.source_version=source_time then
  if st.last_payload=(p_event-'eventId') then result_status:='stale'; else result_status:='conflict';reason:='same_version_changed'; end if;
 end if;
 if result_status='applied' then
  if ent='post' then
   select * into p from public.community_posts where academy_community_id=cfg.academy_community_id and source_provider='highlevel' and external_id=ext for update;
   rowid:=p.id;
   if p.id is not null and p.sync_owner<>'highlevel' then result_status:='conflict';reason:='local_edit'; end if;
  else
   select * into c from public.community_comments where academy_community_id=cfg.academy_community_id and source_provider='highlevel' and external_id=ext for update;
   rowid:=c.id;
   if c.id is not null and c.sync_owner<>'highlevel' then result_status:='conflict';reason:='local_edit'; end if;
   if c.id is not null and not exists(select 1 from public.community_posts pp where pp.id=c.post_id and pp.external_id=p_event->>'postExternalId' and pp.source_provider='highlevel' and pp.academy_community_id=cfg.academy_community_id) then raise exception 'Comment post cannot change'; end if;
  end if;
 end if;
 if result_status='applied' and op='upsert' then
  select academy_member_id into author from public.academy_member_links where academy_community_id=cfg.academy_community_id and external_provider='highlevel' and (external_contact_id=p_event->>'authorExternalId' or external_member_id=p_event->>'authorExternalId');
  if author is null then result_status:='pending';reason:='unknown_author';
  elsif (select count(distinct academy_member_id) from public.academy_member_links where academy_community_id=cfg.academy_community_id and external_provider='highlevel' and (external_contact_id=p_event->>'authorExternalId' or external_member_id=p_event->>'authorExternalId'))<>1 then result_status:='pending';reason:='ambiguous_author'; end if;
  if ent='post' and p_event->>'categoryExternalId' is not null then
   select id into category from public.community_categories where academy_community_id=cfg.academy_community_id and external_id=p_event->>'categoryExternalId';
   if category is null then result_status:='pending';reason:='unknown_category'; end if;
  end if;
  if ent='comment' then
   select id into target_post from public.community_posts where academy_community_id=cfg.academy_community_id and source_provider='highlevel' and external_id=p_event->>'postExternalId';
   if target_post is null then result_status:='pending';reason:='unknown_post'; end if;
   if p_event->>'parentExternalId' is not null then
    if p_event->>'parentExternalId'=ext then raise exception 'Comment cannot parent itself'; end if;
    select id into parent from public.community_comments where academy_community_id=cfg.academy_community_id and source_provider='highlevel' and external_id=p_event->>'parentExternalId' and post_id=target_post;
    if parent is null then result_status:='pending';reason:='unknown_parent'; end if;
    if c.id is not null and exists(with recursive ancestry as (select id,parent_id from public.community_comments where id=parent union select cc.id,cc.parent_id from public.community_comments cc join ancestry a on cc.id=a.parent_id) select 1 from ancestry where id=c.id) then raise exception 'Comment parent cycle'; end if;
   end if;
  end if;
 end if;
 if result_status='applied' then
  perform set_config('app.academy_community_sync','on',true);
  if op='delete' then
   if ent='post' then update public.community_posts set status='archived',source_updated_at=source_time where id=p.id;
   else update public.community_comments set body='[Comment removed]',is_answer=false,media='[]'::jsonb,source_updated_at=source_time where id=c.id; end if;
  else
   insert into public.source_import_batches(academy_community_id,provider,status,manifest,source_exported_at,imported_at)
   values(cfg.academy_community_id,'highlevel','imported',jsonb_build_object('communitySyncEvent',eventid),source_time,now()) returning id into batch;
   if ent='post' then
    if p_event ? 'media' then
     select coalesce(jsonb_agg(n.value || coalesce((select jsonb_object_agg(k.key,k.value) from jsonb_array_elements(coalesce(p.media,'[]'::jsonb)) old, lateral jsonb_each(old) k where old->>'url'=n.value->>'url' and k.key in ('storage_bucket','storage_path','mime_type','byte_size','content_hash')),'{}'::jsonb) order by n.ord),'[]'::jsonb) into v_media from jsonb_array_elements(p_event->'media') with ordinality n(value,ord);
    else v_media:=coalesce(p.media,'[]'::jsonb); end if;
    if p.id is null then
     insert into public.community_posts(organization_id,academy_community_id,academy_author_id,external_id,source_provider,source_created_at,source_updated_at,source_import_batch_id,title,body,is_pinned,category_id,media,status,sync_owner,created_at)
     select owner_organization_id,cfg.academy_community_id,author,ext,'highlevel',created_time,source_time,batch,p_event->>'title',p_event->>'body',coalesce((p_event->>'pinned')::boolean,false),category,v_media,'published','highlevel',created_time from public.academy_communities where id=cfg.academy_community_id returning id into rowid;
    else
     update public.community_posts set title=p_event->>'title',body=p_event->>'body',academy_author_id=author,is_pinned=case when p_event ? 'pinned' then (p_event->>'pinned')::boolean else is_pinned end,category_id=case when p_event ? 'categoryExternalId' then category else category_id end,media=v_media,status='published',source_updated_at=source_time,source_import_batch_id=batch where id=p.id;
    end if;
   else
    v_media:=case when p_event ? 'media' then private.community_snapshot_media(p_event->'media',c.media) else coalesce(c.media,'[]'::jsonb) end;
    if c.id is null then
     insert into public.community_comments(organization_id,academy_community_id,academy_author_id,post_id,parent_id,external_id,source_provider,source_created_at,source_updated_at,source_import_batch_id,body,media,sync_owner,created_at)
     select owner_organization_id,cfg.academy_community_id,author,target_post,parent,ext,'highlevel',created_time,source_time,batch,p_event->>'body',v_media,'highlevel',created_time from public.academy_communities where id=cfg.academy_community_id returning id into rowid;
    else
     update public.community_comments set body=p_event->>'body',media=v_media,academy_author_id=author,parent_id=case when p_event ? 'parentExternalId' then parent else parent_id end,source_updated_at=source_time,source_import_batch_id=batch where id=c.id;
    end if;
   end if;
  end if;
  update public.academy_community_sync_state set row_id=rowid,source_version=source_time,last_payload=p_event-'eventId',deleted=(op='delete') where config_id=cfg.id and entity=ent and external_id=ext;
  update public.academy_community_sync_configs set last_success_at=now() where id=cfg.id;
 end if;
 update public.academy_community_sync_events set status=result_status,error_code=reason,processed_at=case when result_status='pending' then null else now() end where config_id=cfg.id and event_id=eventid;
 perform set_config('app.academy_community_sync',coalesce(previous_sync,'off'),true);
 return jsonb_build_object('status',result_status,'reason',reason,'rowId',rowid);
end $$;


-- Service-only source mapping/context. Status never returns the opaque lease token.
create function public.get_academy_community_snapshot_context(p_config_id uuid,p_capture_id text default null,p_lease_token uuid default null) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare cfg public.academy_community_sync_configs; run public.academy_community_snapshot_runs; authors jsonb; categories jsonb;
begin
 select * into strict cfg from public.academy_community_sync_configs where id=p_config_id;
 if p_capture_id is not null then select * into run from public.academy_community_snapshot_runs where config_id=cfg.id and capture_id=p_capture_id; end if;
 if p_lease_token is not null and run.status is distinct from 'applied' and (p_capture_id is null or cfg.snapshot_capture_id is distinct from p_capture_id or cfg.snapshot_lease_token is distinct from p_lease_token or cfg.snapshot_lease_until<=now()) then raise exception 'Capture lease lost'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('externalId',external_id) order by external_id),'[]') into authors from (
  select external_id from (
   select external_contact_id external_id,academy_member_id from public.academy_member_links where academy_community_id=cfg.academy_community_id and external_provider='highlevel'
   union select external_member_id,academy_member_id from public.academy_member_links where academy_community_id=cfg.academy_community_id and external_provider='highlevel'
  ) ids where external_id is not null and external_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$' group by external_id having count(distinct academy_member_id)=1
 ) allowed;
 select coalesce(jsonb_agg(jsonb_build_object('externalId',external_id) order by external_id),'[]') into categories from public.community_categories where academy_community_id=cfg.academy_community_id and external_id is not null;
 if p_capture_id is not null then select * into run from public.academy_community_snapshot_runs where config_id=cfg.id and capture_id=p_capture_id; end if;
 return jsonb_build_object('enabled',cfg.enabled,'scope',jsonb_build_object('locationId',cfg.location_id,'groupId',cfg.group_id),'previousState',cfg.last_snapshot_state,'identities',jsonb_build_object('authors',authors,'categories',categories),'capabilities',jsonb_build_object('commentMedia',true))
 ||case when run.capture_id is null then '{}'::jsonb else jsonb_build_object('run',jsonb_build_object('status',run.status,'observationSequence',run.observation_sequence,'leaseExpiresAt',case when run.capture_id=cfg.snapshot_capture_id then cfg.snapshot_lease_until else null end,'result',run.result,'errorCode',run.error_code,'captureHash',run.capture_hash)) end;
end $$;
revoke all on function public.get_academy_community_snapshot_context(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.get_academy_community_snapshot_context(uuid,text,uuid) to service_role;
