-- Source archives may also contain mirrored storage metadata; compare source fields on both sides.
-- Avoid PL/pgSQL record-variable ambiguity when adopting existing comments.
create or replace function public.enroll_academy_community_sync(p_config_id uuid) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare cfg public.academy_community_sync_configs; p public.community_posts; c public.community_comments; v jsonb; n_posts integer:=0;n_comments integer:=0; previous_sync text:=current_setting('app.academy_community_sync',true);
begin
 select * into strict cfg from public.academy_community_sync_configs where id=p_config_id for update;
 perform set_config('app.academy_community_sync','on',true);
 for p in select * from public.community_posts where academy_community_id=cfg.academy_community_id and source_provider='highlevel' and external_id is not null and sync_owner='local' for update loop
  select payload into v from public.source_import_records where academy_community_id=cfg.academy_community_id and record_type='post' and external_id=p.external_id and imported_id=p.id order by captured_at desc limit 1;
  if v is not null and p.title=v->>'title' and p.body=v->>'body' and p.is_pinned=coalesce((v->>'pinned')::boolean,false) and p.status='published'
   and private.community_source_media(p.media)=private.community_source_media(coalesce(v->'media','[]'::jsonb))
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
   and exists(select 1 from public.community_posts parent_post where parent_post.id=c.post_id and parent_post.academy_community_id=cfg.academy_community_id and parent_post.source_provider='highlevel' and parent_post.external_id=v->>'postExternalId')
   and ((c.parent_id is null and v->>'parentExternalId' is null) or exists(select 1 from public.community_comments parent_comment where parent_comment.id=c.parent_id and parent_comment.post_id=c.post_id and parent_comment.source_provider='highlevel' and parent_comment.external_id=v->>'parentExternalId'))
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

