-- Missing snapshot identities remain review-only even after mappings recover.
-- Applied migrations are immutable; this replaces only the guarded writer.
create or replace function public.apply_academy_community_snapshot(p_config_id uuid,p_capture_id text,p_lease_token uuid,p_plan jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
#variable_conflict use_variable
declare cfg public.academy_community_sync_configs; run public.academy_community_snapshot_runs; state jsonb; records jsonb; r jsonb; content jsonb; prior jsonb; change jsonb;
 baseline public.academy_community_snapshot_records; st public.academy_community_sync_state; p public.community_posts; c public.community_comments;
 author uuid; category uuid; post_id uuid; parent_id uuid; row_id uuid; batch uuid; source_version timestamptz; source_created timestamptz;
 reason text; hold_reason text; held jsonb; media jsonb; media_inventory jsonb; result jsonb; conflicts jsonb:='[]'; n_added integer:=0; n_updated integer:=0; n_unchanged integer:=0;
 previous_sync text:=current_setting('app.academy_community_sync',true);
begin
 select * into strict cfg from public.academy_community_sync_configs where id=p_config_id for update;
 select * into strict run from public.academy_community_snapshot_runs where config_id=cfg.id and capture_id=p_capture_id for update;
 state:=p_plan->'nextState'; records:=state->'records'; held:=coalesce(p_plan->'held','[]'::jsonb);
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
 -- Holds are explicit service-planner decisions, never silently defaulted fields.
 if jsonb_typeof(held) is distinct from 'array' or jsonb_array_length(held)>60000
  or exists(select 1 from jsonb_array_elements(held) h where h->>'reason' is null or h->>'reason' not in ('unknown_author','unobserved_media','unobserved_category','unobserved_pin','unsupported_comment_media','unknown_category','held_post','held_parent','empty_body','unobserved_body')
    or h - array['entity','externalId','reason'] <> '{}'::jsonb
    or (h->>'entity'='post' and h->>'reason' in ('unsupported_comment_media','held_post','held_parent','empty_body'))
    or (h->>'entity'='comment' and h->>'reason' in ('unobserved_category','unknown_category','unobserved_pin'))
    or not exists(select 1 from jsonb_array_elements(records) rr where rr->>'entity'=h->>'entity' and rr->>'externalId'=h->>'externalId'))
  or exists(select 1 from jsonb_array_elements(held) h group by h->>'entity',h->>'externalId' having count(*)>1) then raise exception 'Invalid held source identity'; end if;
 if exists(select 1 from jsonb_array_elements(records) rr where rr->>'entity'='comment'
  and (exists(select 1 from jsonb_array_elements(held) h where h->>'entity'='post' and h->>'externalId'=rr->'content'->>'postExternalId')
   or exists(select 1 from jsonb_array_elements(held) h where h->>'entity'='comment' and h->>'externalId'=rr->'content'->>'parentExternalId'))
  and not exists(select 1 from jsonb_array_elements(held) h where h->>'entity'='comment' and h->>'externalId'=rr->>'externalId')) then raise exception 'Held dependency omitted'; end if;
 if state ? 'held' and state->'held' is distinct from held then raise exception 'Held state mismatch'; end if;
 -- Missing rows are retained only for comparison/review. Their exact previous
 -- canonical record must remain unchanged; they are not observed source writes.
 if jsonb_typeof(coalesce(p_plan->'missing','[]'::jsonb)) is distinct from 'array'
  or jsonb_array_length(coalesce(p_plan->'missing','[]'::jsonb))>60000
  or exists(select 1 from jsonb_array_elements(coalesce(p_plan->'missing','[]'::jsonb)) m
   where m->>'entity' is null or m->>'entity' not in ('post','comment') or m->>'externalId' is null
    or m->>'action' is distinct from 'review_only' or m-array['entity','externalId','action'] <> '{}'::jsonb
    or not exists(select 1 from jsonb_array_elements(records) next_r
     join jsonb_array_elements(coalesce(cfg.last_snapshot_state->'records','[]'::jsonb)) prior_r
      on prior_r->>'entity'=next_r->>'entity' and prior_r->>'externalId'=next_r->>'externalId'
     where next_r->>'entity'=m->>'entity' and next_r->>'externalId'=m->>'externalId' and next_r=prior_r)
    or exists(select 1 from jsonb_array_elements(p_plan->'changes') ch where ch->>'entity'=m->>'entity' and ch->>'externalId'=m->>'externalId'))
  or exists(select 1 from jsonb_array_elements(coalesce(p_plan->'missing','[]'::jsonb)) m group by m->>'entity',m->>'externalId' having count(*)>1)
 then raise exception 'Invalid missing review identity'; end if;
 -- A row absent from this source read cannot release its prior field hold.
 if exists(select 1 from jsonb_array_elements(coalesce(p_plan->'missing','[]')) m
  join jsonb_array_elements(coalesce(cfg.last_snapshot_state->'held','[]')) old_h on old_h->>'entity'=m->>'entity' and old_h->>'externalId'=m->>'externalId'
  where not exists(select 1 from jsonb_array_elements(held) new_h where new_h->>'entity'=old_h->>'entity' and new_h->>'externalId'=old_h->>'externalId')) then raise exception 'Missing source hold cannot be released'; end if;
 -- Validate the whole graph and every expected previous hash before any row writes.
 for r in select value from jsonb_array_elements(records) loop
  content:=r->'content';
  if (r ? 'authorComplete' and jsonb_typeof(r->'authorComplete') is distinct from 'boolean')
   or (r->>'authorComplete'='false' and (jsonb_typeof(r->'unobservedFields') is distinct from 'array' or not coalesce(r->'unobservedFields' ? 'authorExternalId',false)
    or not exists(select 1 from jsonb_array_elements(held) h where h->>'entity'=r->>'entity' and h->>'externalId'=r->>'externalId' and h->>'reason'='unknown_author')))
  then raise exception 'Unobserved author must be held'; end if;
  if (r ? 'bodyComplete' and jsonb_typeof(r->'bodyComplete') is distinct from 'boolean')
   or (r->>'bodyComplete'='false' and (jsonb_typeof(r->'unobservedFields') is distinct from 'array' or not coalesce(r->'unobservedFields' ? 'body',false)
    or not exists(select 1 from jsonb_array_elements(held) h where h->>'entity'=r->>'entity' and h->>'externalId'=r->>'externalId')))
  then raise exception 'Unobserved body must be held'; end if;
  if r->>'entity' is null or r->>'entity' not in ('post','comment') or r->>'externalId' is null or r->>'externalId' !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
   or jsonb_typeof(content) is distinct from 'object' or r->>'contentHash' is distinct from private.community_snapshot_hash(content)
   or ((nullif(content->>'authorExternalId','') is null or jsonb_typeof(content->'authorExternalId') is distinct from 'string')
    and not coalesce(r->>'authorComplete'='false' and not(content ? 'authorExternalId'),false))
   or ((content->>'body' is null or jsonb_typeof(content->'body') is distinct from 'string')
    and not coalesce(r->>'bodyComplete'='false' and not(content ? 'body'),false))
   or (r->>'entity'='comment' and content->>'body'='' and not exists(select 1 from jsonb_array_elements(held) h where h->>'entity'=r->>'entity' and h->>'externalId'=r->>'externalId')
    and (case when jsonb_typeof(content->'media')='array' then jsonb_array_length(content->'media') else 0 end)=0)
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
 -- Capture registered mirrors before correcting attachment ownership. A source
 -- post may lose its mistaken images before their real comment rows are written.
 -- Only this community's source-owned rows can supply stored metadata.
 select coalesce(jsonb_agg(asset),'[]'::jsonb) into media_inventory from (
  select a asset from public.community_posts cp cross join lateral jsonb_array_elements(cp.media) a
   where cp.academy_community_id=cfg.academy_community_id and cp.source_provider='highlevel' and cp.sync_owner='highlevel'
  union all
  select a from public.community_comments cc cross join lateral jsonb_array_elements(cc.media) a
   where cc.academy_community_id=cfg.academy_community_id and cc.source_provider='highlevel' and cc.sync_owner='highlevel'
 ) registered where jsonb_typeof(asset->'storage_path')='string' and nullif(asset->>'storage_path','') is not null;
 perform set_config('app.academy_community_sync','on',true);
 insert into public.source_import_batches(academy_community_id,provider,status,manifest,source_exported_at,imported_at)
 values(cfg.academy_community_id,'highlevel','imported',jsonb_build_object('communityBrowserCapture',p_capture_id,'observationSequence',run.observation_sequence),null,now()) returning id into batch;
 -- Ancestors precede replies; previously absent parents can be inserted in this transaction.
 for r in with recursive ordered as (
  (select value r,0 depth from jsonb_array_elements(records) where value->>'entity'='post'
  union all select value,1 from jsonb_array_elements(records) where value->>'entity'='comment' and value->'content'->>'parentExternalId' is null)
  union all select x.value,o.depth+1 from ordered o join jsonb_array_elements(records) x on x.value->>'entity'='comment' and o.r->>'entity'='comment' and x.value->'content'->>'parentExternalId'=o.r->>'externalId'
 ) select ordered.r from ordered order by depth,r->>'externalId' loop
  -- Never create, retry or update a target from cached content absent this read.
  -- Preserve its earlier baseline, conflict and target fingerprint unchanged.
  if exists(select 1 from jsonb_array_elements(coalesce(p_plan->'missing','[]'::jsonb)) m
   where m->>'entity'=r->>'entity' and m->>'externalId'=r->>'externalId') then continue; end if;
  content:=r->'content'; select h->>'reason' into hold_reason from jsonb_array_elements(held) h where h->>'entity'=r->>'entity' and h->>'externalId'=r->>'externalId'; reason:=hold_reason; row_id:=null; author:=null; category:=null; post_id:=null; parent_id:=null;
  select * into baseline from public.academy_community_snapshot_records where config_id=cfg.id and entity=r->>'entity' and external_id=r->>'externalId' for update;
  select * into st from public.academy_community_sync_state where config_id=cfg.id and entity=r->>'entity' and external_id=r->>'externalId' for update;
  if r->>'entity'='post' then select * into p from public.community_posts where academy_community_id=cfg.academy_community_id and source_provider='highlevel' and external_id=r->>'externalId' for update; row_id:=p.id;
  else select * into c from public.community_comments where academy_community_id=cfg.academy_community_id and source_provider='highlevel' and external_id=r->>'externalId' for update; row_id:=c.id; end if;
  if reason is null then
  if st.local_override or (row_id is not null and (case when r->>'entity'='post' then p.sync_owner else c.sync_owner end)<>'highlevel') then reason:='local_edit_or_delete';
  elsif baseline.target_fingerprint is not null and private.community_snapshot_target(r->>'entity',row_id) is distinct from baseline.target_fingerprint then reason:='target_changed_since_capture';
  elsif st.deleted then reason:='source_tombstone';
  elsif st.source_version is not null and st.last_payload is not null and r->'source'->>'sourceUpdatedAt' is null and (baseline.row_id is null or st.source_version>(case when r->>'entity'='post' then p.source_updated_at else c.source_updated_at end)) then reason:='unversioned_observation_after_versioned_event';
  end if;
  end if;
  source_version:=(r->'source'->>'sourceUpdatedAt')::timestamptz; source_created:=(r->'source'->>'sourceCreatedAt')::timestamptz;
  if reason is null and source_version is not null and (not isfinite(source_version) or source_version>now()+interval '1 day' or st.source_version>source_version) then reason:='source_version_regressed'; end if;
  if source_created is not null and not isfinite(source_created) then raise exception 'Invalid source creation time'; end if;
  if reason is null and baseline.status='applied' and baseline.content_hash=r->>'contentHash' and baseline.target_fingerprint is not null then n_unchanged:=n_unchanged+1;
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
   if reason is null and content ? 'media' and private.community_snapshot_media_conflict(content->'media',case when r->>'entity'='post' then p.media else c.media end,media_inventory) then reason:='ambiguous_media_metadata'; end if;
   if reason is null then
    media:=case when content ? 'media' then private.community_snapshot_media(content->'media',case when r->>'entity'='post' then p.media else c.media end,media_inventory) else case when r->>'entity'='post' then p.media else c.media end end;
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
  if reason is not null and hold_reason is null then conflicts:=conflicts||jsonb_build_array(jsonb_build_object('entity',r->>'entity','externalId',r->>'externalId','reason',reason)); end if;
  insert into public.academy_community_snapshot_records(config_id,entity,external_id,content_hash,row_id,target_fingerprint,observation_sequence,status,error_code)
  values(cfg.id,r->>'entity',r->>'externalId',r->>'contentHash',row_id,case when reason is null then private.community_snapshot_target(r->>'entity',row_id) else baseline.target_fingerprint end,run.observation_sequence,case when reason is null then 'applied' else 'conflict' end,reason)
  on conflict(config_id,entity,external_id) do update set content_hash=excluded.content_hash,row_id=excluded.row_id,target_fingerprint=excluded.target_fingerprint,observation_sequence=excluded.observation_sequence,status=excluded.status,error_code=excluded.error_code;
 end loop;
 result:=jsonb_build_object('status',case when jsonb_array_length(held)>0 or jsonb_array_length(conflicts)>0 or jsonb_array_length(coalesce(p_plan->'missing','[]'))>0 then 'partial' else 'applied' end,'held',held,'fullSync',jsonb_array_length(held)=0 and jsonb_array_length(conflicts)=0 and jsonb_array_length(coalesce(p_plan->'missing','[]'))=0,'observationSequence',run.observation_sequence,'added',n_added,'updated',n_updated,'unchanged',n_unchanged,'conflicts',conflicts,'missingReviewOnly',coalesce(p_plan->'missing','[]'));
 update public.academy_community_snapshot_runs set status='applied',finished_at=now(),capture_hash=state->>'captureHash',snapshot_state=state,result=result where config_id=cfg.id and capture_id=p_capture_id;
 update public.academy_community_sync_configs set last_snapshot_state=state,last_success_at=now(),snapshot_capture_id=null,snapshot_lease_token=null,snapshot_lease_until=null where id=cfg.id;
 perform set_config('app.academy_community_sync',coalesce(previous_sync,'off'),true);
 return result;
end $$;


revoke all on function public.apply_academy_community_snapshot(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.apply_academy_community_snapshot(uuid,text,uuid,jsonb) to service_role;

