-- Incremental source mirroring. No access grants, accounts, or destructive deletes.
alter table public.community_posts add column sync_owner text not null default 'local' check(sync_owner in ('local','highlevel'));
alter table public.community_comments add column sync_owner text not null default 'local' check(sync_owner in ('local','highlevel'));
create table public.academy_community_sync_configs (
 id uuid primary key default gen_random_uuid(),
 academy_community_id uuid not null references public.academy_communities(id) on delete cascade,
 location_id text not null, group_id text not null,
 enabled boolean not null default false,
 last_success_at timestamptz,
 unique(location_id,group_id),unique(academy_community_id)
);
create table public.academy_community_sync_events (
 config_id uuid not null references public.academy_community_sync_configs(id) on delete cascade,
 event_id text not null, payload jsonb not null,
 status text not null default 'pending' check(status in ('pending','applied','stale','conflict')),
 error_code text, attempts integer not null default 0,
 created_at timestamptz not null default now(), processed_at timestamptz,
 primary key(config_id,event_id)
);
create table public.academy_community_sync_inbox (
 id uuid primary key default gen_random_uuid(),
 config_id uuid not null references public.academy_community_sync_configs(id) on delete cascade,
 payload_hash text not null check(payload_hash ~ '^[0-9a-f]{64}$'), payload jsonb not null,
 created_at timestamptz not null default now(), status text not null default 'needs_mapping',
 unique(config_id,payload_hash)
);
alter table public.academy_community_sync_inbox enable row level security;
revoke all on public.academy_community_sync_inbox from public,anon,authenticated;
grant select,insert,update,delete on public.academy_community_sync_inbox to service_role;
create index academy_community_pending_events on public.academy_community_sync_events(config_id,created_at) where status='pending';
create table public.academy_community_sync_state (
 config_id uuid not null references public.academy_community_sync_configs(id) on delete cascade,
 entity text not null check(entity in ('post','comment')), external_id text not null,
 row_id uuid, source_version timestamptz, last_payload jsonb,
 deleted boolean not null default false, local_override boolean not null default false,
 primary key(config_id,entity,external_id)
);
alter table public.academy_community_sync_configs enable row level security;
alter table public.academy_community_sync_events enable row level security;
alter table public.academy_community_sync_state enable row level security;
revoke all on public.academy_community_sync_configs,public.academy_community_sync_events,public.academy_community_sync_state from public,anon,authenticated;
grant select,insert,update,delete on public.academy_community_sync_configs,public.academy_community_sync_events,public.academy_community_sync_state to service_role;

-- Keep only source attributes when comparing a historical import to current media.
create function private.community_source_media(p_media jsonb) returns jsonb language sql immutable set search_path='' as $$
 select coalesce(jsonb_agg(value - array['storage_bucket','storage_path','mime_type','byte_size','content_hash'] order by ord),'[]'::jsonb)
 from jsonb_array_elements(coalesce(p_media,'[]'::jsonb)) with ordinality a(value,ord)
$$;

-- Local edits/deletions win. Deleted imported identities remain reserved so an
-- automatic source update cannot resurrect content removed by local moderation.
create function private.protect_local_community_content() returns trigger language plpgsql security definer set search_path='' as $$
declare config uuid; entity_type text;
begin
 if current_setting('app.academy_community_sync',true)='on' then return coalesce(new,old); end if;
 if tg_op='UPDATE' then
  if (to_jsonb(new)-array['updated_at']) is not distinct from (to_jsonb(old)-array['updated_at']) then return new; end if;
  new.sync_owner:='local';
 end if;
 if old.source_provider='highlevel' and old.external_id is not null then
  select id into config from public.academy_community_sync_configs where academy_community_id=old.academy_community_id;
  if config is not null then
   entity_type:=case when tg_table_name='community_posts' then 'post' else 'comment' end;
   insert into public.academy_community_sync_state(config_id,entity,external_id,row_id,local_override)
   values(config,entity_type,old.external_id,old.id,true)
   on conflict(config_id,entity,external_id) do update set local_override=true;
  end if;
 end if;
 return coalesce(new,old);
end $$;
create trigger protect_local_community_post before update or delete on public.community_posts for each row execute function private.protect_local_community_content();
create trigger protect_local_community_comment before update or delete on public.community_comments for each row execute function private.protect_local_community_content();
revoke all on function private.protect_local_community_content(),private.community_source_media(jsonb) from public,anon,authenticated;
grant execute on function private.community_source_media(jsonb) to service_role;

-- Adopt only imported rows still identical to their archived source payload.
-- Missing provenance and local edits remain local. No role/access changes occur.
create function public.enroll_academy_community_sync(p_config_id uuid) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare cfg public.academy_community_sync_configs; p public.community_posts; c public.community_comments; v jsonb; n_posts integer:=0;n_comments integer:=0; previous_sync text:=current_setting('app.academy_community_sync',true);
begin
 select * into strict cfg from public.academy_community_sync_configs where id=p_config_id for update;
 perform set_config('app.academy_community_sync','on',true);
 for p in select * from public.community_posts where academy_community_id=cfg.academy_community_id and source_provider='highlevel' and external_id is not null and sync_owner='local' for update loop
  select payload into v from public.source_import_records where academy_community_id=cfg.academy_community_id and record_type='post' and external_id=p.external_id and imported_id=p.id order by captured_at desc limit 1;
  if v is not null and p.title=v->>'title' and p.body=v->>'body' and p.is_pinned=coalesce((v->>'pinned')::boolean,false) and p.status='published'
   and private.community_source_media(p.media)=coalesce(v->'media','[]'::jsonb)
   and exists(select 1 from public.academy_member_links l where l.academy_community_id=cfg.academy_community_id and l.academy_member_id=p.academy_author_id and l.external_provider='highlevel' and (l.external_contact_id=v->>'authorExternalId' or l.external_member_id=v->>'authorExternalId'))
   and ((p.category_id is null and v->>'categoryExternalId' is null) or exists(select 1 from public.community_categories k where k.id=p.category_id and k.academy_community_id=cfg.academy_community_id and k.external_id=v->>'categoryExternalId'))
   and not exists(select 1 from public.academy_community_sync_state s where s.config_id=cfg.id and s.entity='post' and s.external_id=p.external_id)
  then
   update public.community_posts set sync_owner='highlevel' where id=p.id;
   insert into public.academy_community_sync_state(config_id,entity,external_id,row_id,source_version) values(cfg.id,'post',p.external_id,p.id,p.source_updated_at);
   n_posts:=n_posts+1;
  end if;
 end loop;
 for c in select * from public.community_comments where academy_community_id=cfg.academy_community_id and source_provider='highlevel' and external_id is not null and sync_owner='local' for update loop
  select payload into v from public.source_import_records where academy_community_id=cfg.academy_community_id and record_type='comment' and external_id=c.external_id and imported_id=c.id order by captured_at desc limit 1;
  if v is not null and c.body=v->>'body' and c.is_answer=coalesce((v->>'isAnswer')::boolean,false)
   and exists(select 1 from public.academy_member_links l where l.academy_community_id=cfg.academy_community_id and l.academy_member_id=c.academy_author_id and l.external_provider='highlevel' and (l.external_contact_id=v->>'authorExternalId' or l.external_member_id=v->>'authorExternalId'))
   and exists(select 1 from public.community_posts p where p.id=c.post_id and p.academy_community_id=cfg.academy_community_id and p.source_provider='highlevel' and p.external_id=v->>'postExternalId')
   and ((c.parent_id is null and v->>'parentExternalId' is null) or exists(select 1 from public.community_comments p where p.id=c.parent_id and p.post_id=c.post_id and p.source_provider='highlevel' and p.external_id=v->>'parentExternalId'))
   and not exists(select 1 from public.academy_community_sync_state s where s.config_id=cfg.id and s.entity='comment' and s.external_id=c.external_id)
  then
   update public.community_comments set sync_owner='highlevel' where id=c.id;
   insert into public.academy_community_sync_state(config_id,entity,external_id,row_id,source_version) values(cfg.id,'comment',c.external_id,c.id,c.source_updated_at);
   n_comments:=n_comments+1;
  end if;
 end loop;
 perform set_config('app.academy_community_sync',coalesce(previous_sync,'off'),true);
 return jsonb_build_object('posts',n_posts,'comments',n_comments);
end $$;

create function public.apply_academy_community_event(p_config_id uuid,p_event jsonb) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
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
   or (p_event ? 'media' and (jsonb_typeof(p_event->'media') is distinct from 'array' or ent='comment'))
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
   else update public.community_comments set body='[Comment removed]',is_answer=false,source_updated_at=source_time where id=c.id; end if;
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
    if c.id is null then
     insert into public.community_comments(organization_id,academy_community_id,academy_author_id,post_id,parent_id,external_id,source_provider,source_created_at,source_updated_at,source_import_batch_id,body,sync_owner,created_at)
     select owner_organization_id,cfg.academy_community_id,author,target_post,parent,ext,'highlevel',created_time,source_time,batch,p_event->>'body','highlevel',created_time from public.academy_communities where id=cfg.academy_community_id returning id into rowid;
    else
     update public.community_comments set body=p_event->>'body',academy_author_id=author,parent_id=case when p_event ? 'parentExternalId' then parent else parent_id end,source_updated_at=source_time,source_import_batch_id=batch where id=c.id;
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
revoke all on function public.enroll_academy_community_sync(uuid),public.apply_academy_community_event(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.enroll_academy_community_sync(uuid),public.apply_academy_community_event(uuid,jsonb) to service_role;

-- Retry deferred dependencies without relying on webhook redelivery. One malformed
-- queued event is isolated and cannot prevent other valid pending events.
create function public.retry_academy_community_events(p_config_id uuid,p_limit integer default 50) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare ev public.academy_community_sync_events; result jsonb; processed integer:=0; applied integer:=0; pending integer:=0; conflicts integer:=0;
begin
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'Retry limit must be between 1 and 100'; end if;
 for ev in select * from public.academy_community_sync_events where config_id=p_config_id and status='pending' order by attempts,created_at limit p_limit loop
  begin
   result:=public.apply_academy_community_event(p_config_id,ev.payload);
   if result->>'status'='applied' then applied:=applied+1;
   elsif result->>'status'='pending' then pending:=pending+1;
   elsif result->>'status'='conflict' then conflicts:=conflicts+1; end if;
  exception when data_exception or integrity_constraint_violation or raise_exception then
   update public.academy_community_sync_events set status='conflict',error_code='invalid_event_'||SQLSTATE,processed_at=now(),attempts=attempts+1 where config_id=p_config_id and event_id=ev.event_id;
   conflicts:=conflicts+1;
  end;
  processed:=processed+1;
 end loop;
 return jsonb_build_object('processed',processed,'applied',applied,'pending',pending,'conflicts',conflicts);
end $$;
revoke all on function public.retry_academy_community_events(uuid,integer) from public,anon,authenticated;
grant execute on function public.retry_academy_community_events(uuid,integer) to service_role;
