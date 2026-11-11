-- Source preparation only: no settings activation, queue backfill, or sending.
-- Course notification authorization is evaluated for the recipient, never the
-- current publishing actor. Keep special own-cancellation notices unchanged.
create function private.academy_notification_course_access(p_member uuid,p_community uuid,p_course uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.courses c
    join public.academy_communities community on community.id=c.academy_community_id
    join public.academy_members m on m.academy_community_id=community.id and m.id=p_member and m.status='active'
    where c.id=p_course and community.id=p_community and c.status='published'
      and (m.role in ('owner','admin') or (
        not exists(select 1 from public.academy_course_access_denials denial where denial.academy_member_id=m.id and denial.course_id=c.id)
        and (private.has_active_academy_grant(m.id,c.id) or exists(
          select 1 from public.academy_access_grants g where g.academy_member_id=m.id and g.course_id is null
            and g.status='active' and g.starts_at<=now() and (g.ends_at is null or g.ends_at>now())
            and not(g.source_type='manual' and g.source_key='owner-free:community')
            and g.source_type not in ('google_subscription','apple_subscription')
            and ((not community.separate_access_enabled and (c.access_type='open' or (c.access_type='level' and m.level>=coalesce(c.required_level,1))))
              or (community.separate_access_enabled and exists(select 1 from private.academy_legacy_access_scopes scope
                where scope.academy_member_id=m.id and scope.source_type=g.source_type and scope.source_key=g.source_key and scope.resource_key=c.id::text))))))));
$$;
revoke all on function private.academy_notification_course_access(uuid,uuid,uuid) from public,anon,authenticated;
alter function private.academy_notification_access(uuid,uuid,text,uuid,text) rename to academy_notification_access_before_independent_courses;
create function private.academy_notification_access(p_member uuid,p_community uuid,p_type text,p_target uuid,p_template text)
returns boolean language sql stable security definer set search_path='' as $$
  select private.academy_notification_access_before_independent_courses(p_member,p_community,p_type,p_target,p_template)
    and (p_type<>'course' or p_template='course_subscription_cancelled'
      or private.academy_notification_course_access(p_member,p_community,p_target));
$$;
revoke all on function private.academy_notification_access(uuid,uuid,text,uuid,text),private.academy_notification_access_before_independent_courses(uuid,uuid,text,uuid,text) from public,anon,authenticated;

-- Additive consent keeps the existing followed-author preference unchanged.
alter table public.notification_preferences
  add column push_all_new_posts boolean not null default false,
  add column push_new_members boolean not null default false;

-- New activity has no email producer. Existing email templates/opt-outs and
-- native provider payloads remain unchanged (generic lock-screen text only).
create function private.academy_activity_target_access(p_member uuid,p_community uuid,p_template text,p_target_type text,p_target uuid,p_actor uuid,p_context jsonb)
returns boolean language sql stable security definer set search_path='' as $$
  select private.academy_notification_access(p_member,p_community,p_target_type,p_target,p_template)
    and case
      when p_template='lesson_updated' then p_target_type='course' and exists (
        select 1 from public.course_lessons l join public.course_modules m on m.id=l.module_id
        where l.id::text=p_context->>'lessonId' and m.course_id=p_target and l.status='published'
          and m.source_archived_at is null and (m.sync_owner='local' or m.source_visibility='published')
          and (coalesce(m.drip_after_days,0)=0 or exists (
            select 1 from public.course_enrollments e where e.course_id=m.course_id
              and e.academy_member_id=p_member and e.status='active' and e.enrolled_at+make_interval(days=>m.drip_after_days)<=now()))
      )
      when p_template='member_joined' then p_target_type='community' and p_target=p_community and exists (
        select 1 from public.academy_members actor join auth.users u on u.id=actor.user_id
        where actor.id=p_actor and actor.academy_community_id=p_community and actor.status='active'
          and u.email_confirmed_at is not null and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
          and private.has_active_academy_grant(actor.id,null)
      )
      when p_template='community_post' then p_target_type='post'
      else true
    end
    and not exists(select 1 from public.academy_member_blocks b where b.academy_community_id=p_community
      and ((b.blocker_member_id=p_member and b.blocked_member_id=p_actor) or (b.blocked_member_id=p_member and b.blocker_member_id=p_actor)));
$$;
revoke all on function private.academy_activity_target_access(uuid,uuid,text,text,uuid,uuid,jsonb) from public,anon,authenticated;

create function private.queue_academy_activity(p_community uuid,p_organization uuid,p_recipient uuid,p_actor uuid,p_template text,p_title text,p_detail text,p_target_type text,p_target uuid,p_dedupe text,p_preference text,p_context jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare recipient public.academy_members%rowtype; activity_notification_id uuid; actor_user uuid;
begin
  if p_template not in ('lesson_updated','member_joined','community_post') then raise exception 'Unsupported activity'; end if;
  if current_setting('app.academy_course_sync',true)='on' and coalesce(current_setting('app.academy_course_sync_notifications',true),'off')<>'on' then return null; end if;
  select m.* into recipient from public.academy_members m join auth.users u on u.id=m.user_id
    where m.id=p_recipient and m.academy_community_id=p_community and m.status='active'
      and u.email_confirmed_at is not null and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now());
  if recipient.id is null or recipient.id is not distinct from p_actor
    or not private.academy_activity_target_access(recipient.id,p_community,p_template,p_target_type,p_target,p_actor,p_context) then return null; end if;
  select user_id into actor_user from public.academy_members where id=p_actor and academy_community_id=p_community;
  insert into public.notifications(organization_id,recipient_id,actor_id,kind,title,detail,target_type,target_id,dedupe_key)
    values(p_organization,recipient.user_id,actor_user,case when p_target_type='course' then 'course'::public.notification_kind else 'admin'::public.notification_kind end,p_title,p_detail,p_target_type,p_target,p_dedupe)
    on conflict(dedupe_key) where dedupe_key is not null do nothing returning id into activity_notification_id;
  -- A duplicate producer replay cannot backfill phone deliveries after activation.
  if activity_notification_id is null then return null; end if;
  insert into private.academy_push_deliveries(notification_id,device_id,user_id,generation,community_id,member_id,template_key,preference_key,actor_member_id,target_type,target_id,send_after,context)
    select activity_notification_id,d.id,recipient.user_id,d.generation,p_community,recipient.id,p_template,p_preference,p_actor,p_target_type,p_target,
      private.academy_push_next_window(d.timezone,now()),jsonb_build_object('lessonId',p_context->>'lessonId')
    from private.academy_push_devices d join public.notification_preferences p on p.user_id=d.user_id and p.push_enabled
    join private.academy_push_settings s on s.id and s.enabled and s.client_ready and s.environment=d.environment and now()>=s.enabled_at
    where d.user_id=recipient.user_id and d.enabled and d.retired_at is null and d.updated_at>now()-interval '90 days'
      and case p_preference when 'course_updates' then p.push_course_updates when 'all_new_posts' then p.push_all_new_posts
        when 'new_members' then p.push_new_members when 'new_posts' then p.push_new_posts else false end
    on conflict(notification_id,device_id,generation) do nothing;
  return activity_notification_id;
end;
$$;
revoke all on function private.queue_academy_activity(uuid,uuid,uuid,uuid,text,text,text,text,uuid,text,text,jsonb) from public,anon,authenticated;

-- Keep every original eligibility check for original templates. New templates
-- receive the same identity/device/cutover/access checks plus their own category.
alter function private.academy_push_eligible(private.academy_push_deliveries) rename to academy_push_eligible_before_activity;
create function private.academy_push_eligible(q private.academy_push_deliveries)
returns boolean language sql stable security definer set search_path='' as $$
  select case when q.template_key not in ('lesson_updated','member_joined','community_post')
    then private.academy_push_eligible_before_activity(q) else exists (
      select 1 from private.academy_push_devices d
      join public.notifications n on n.id=q.notification_id and n.recipient_id=q.user_id and n.target_type=q.target_type and n.target_id=q.target_id
      join public.academy_members m on m.id=q.member_id and m.user_id=q.user_id and m.academy_community_id=q.community_id and m.status='active'
      join auth.users u on u.id=q.user_id and u.email_confirmed_at is not null and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
      join public.notification_preferences p on p.user_id=q.user_id and p.push_enabled
      join private.academy_push_settings s on s.id and s.enabled and s.client_ready and d.environment=s.environment and q.created_at>=s.enabled_at
      where d.id=q.device_id and d.enabled and d.retired_at is null and d.user_id=q.user_id and d.generation=q.generation
        and d.updated_at>now()-interval '90 days' and q.expires_at>now()
        and private.academy_activity_target_access(m.id,q.community_id,q.template_key,q.target_type,q.target_id,q.actor_member_id,q.context)
        and case q.preference_key when 'course_updates' then q.template_key='lesson_updated' and p.push_course_updates
          when 'all_new_posts' then q.template_key='community_post' and p.push_all_new_posts
          when 'new_members' then q.template_key='member_joined' and p.push_new_members
          when 'new_posts' then q.template_key='community_post' and p.push_new_posts and exists(
            select 1 from public.academy_member_follows f where f.academy_community_id=q.community_id and f.follower_member_id=m.id and f.followed_member_id=q.actor_member_id)
          else false end
    ) end;
$$;
revoke all on function private.academy_push_eligible(private.academy_push_deliveries),private.academy_push_eligible_before_activity(private.academy_push_deliveries) from public,anon,authenticated;

-- Taps still resolve after opting out of future delivery, but must recheck the
-- actual lesson/member target. The former resolver is no longer a public API.
alter function public.resolve_academy_push_notification(uuid) rename to resolve_academy_push_notification_before_activity;
alter function public.resolve_academy_push_notification_before_activity(uuid) set schema private;
revoke all on function private.resolve_academy_push_notification_before_activity(uuid) from public,anon,authenticated;
create function public.resolve_academy_push_notification(p_notification_id uuid)
returns table(target_type text,target_id uuid,comment_id uuid) language sql stable security definer set search_path='' as $$
  select resolved.* from private.resolve_academy_push_notification_before_activity(p_notification_id) resolved
  where exists(select 1 from private.academy_push_deliveries q where q.notification_id=p_notification_id
    and q.user_id=auth.uid() and q.target_type=resolved.target_type and q.target_id=resolved.target_id
    and private.academy_activity_target_access(q.member_id,q.community_id,q.template_key,q.target_type,q.target_id,q.actor_member_id,q.context));
$$;
revoke all on function public.resolve_academy_push_notification(uuid) from public,anon;
grant execute on function public.resolve_academy_push_notification(uuid) to authenticated;

create or replace function private.notify_academy_lesson_published()
returns trigger language plpgsql security definer set search_path='' as $$
declare course public.courses%rowtype; recipient record; is_update boolean; meaningful_change boolean;
begin
  if new.status<>'published' then return new; end if;
  is_update := tg_op='UPDATE' and old.status='published';
  if is_update then
    meaningful_change := (new.title,new.lesson_type,new.body,new.video_url,new.transcript,new.resources,new.duration_seconds)
      is distinct from (old.title,old.lesson_type,old.body,old.video_url,old.transcript,old.resources,old.duration_seconds);
    if not meaningful_change then return new; end if;
  end if;
  if current_setting('app.academy_course_sync',true)='on' and coalesce(current_setting('app.academy_course_sync_notifications',true),'off')<>'on' then return new; end if;
  if tg_op='INSERT' and new.source_import_batch_id is not null
    and coalesce(current_setting('app.academy_course_sync_notifications',true),'off')<>'on' then return new; end if;
  select c.* into course from public.courses c join public.course_modules m on m.course_id=c.id
    where m.id=new.module_id and c.status='published' and m.source_archived_at is null and (m.sync_owner='local' or m.source_visibility='published');
  if course.id is null or course.academy_community_id is null then return new; end if;
  -- Local admin edits to an imported lesson are real edits; initial/bulk imports
  -- remain silent unless the established sync producer explicitly opts in.
  if new.source_import_batch_id is not null and coalesce(current_setting('app.academy_course_sync_notifications',true),'off')<>'on'
    and not coalesce(private.can_manage_academy(course.academy_community_id),false)
    and not coalesce(public.is_organization_admin(course.organization_id),false) then return new; end if;
  for recipient in select am.id from public.academy_members am where am.academy_community_id=course.academy_community_id and am.status='active'
    and exists(select 1 from public.course_modules cm where cm.id=new.module_id and (coalesce(cm.drip_after_days,0)=0 or exists(
      select 1 from public.course_enrollments ce where ce.course_id=course.id and ce.academy_member_id=am.id and ce.status='active' and ce.enrolled_at+make_interval(days=>cm.drip_after_days)<=now()))) loop
    if is_update then
      perform private.queue_academy_activity(course.academy_community_id,course.organization_id,recipient.id,null,'lesson_updated',
        'Lesson updated: '||new.title,course.title,'course',course.id,'lesson:'||new.id||':updated:'||txid_current()||':'||recipient.id,
        'course_updates',jsonb_build_object('lessonId',new.id));
    else
      perform private.queue_academy_notification(course.academy_community_id,course.organization_id,recipient.id,null,'course','lesson_published',
        'New lesson: '||new.title,course.title,'course',course.id,'lesson:'||new.id||':published:'||recipient.id,
        'course_updates',now(),jsonb_build_object('lessonId',new.id,'lessonTitle',new.title),true);
    end if;
  end loop;
  return new;
end;
$$;
drop trigger academy_lesson_published_notification on public.course_lessons;
create trigger academy_lesson_published_notification after insert or update of status,title,lesson_type,body,video_url,transcript,resources,duration_seconds on public.course_lessons
  for each row execute function private.notify_academy_lesson_published();

create or replace function private.notify_academy_post_created()
returns trigger language plpgsql security definer set search_path='' as $$
declare recipient record; category_name text; actor_name text; preference_name text; following boolean;
begin
  if new.academy_community_id is null or new.source_import_batch_id is not null or new.status<>'published'
    or (tg_op='UPDATE' and old.status='published') then return new; end if;
  select name into category_name from public.community_categories where id=new.category_id;
  select coalesce(nullif(display_name,''),'A community member') into actor_name from public.academy_members where id=new.academy_author_id;
  for recipient in select id,user_id from public.academy_members where academy_community_id=new.academy_community_id
    and status='active' and id is distinct from new.academy_author_id loop
    if lower(coalesce(category_name,''))='announcements' then
      perform private.queue_academy_notification(new.academy_community_id,new.organization_id,recipient.id,new.academy_author_id,'admin','announcement',
        'New Academy announcement',new.title,'post',new.id,'post:'||new.id||':announcement:'||recipient.id,
        'admin_announcements',now(),jsonb_build_object('postTitle',new.title,'excerpt',left(new.body,280),'category',category_name),true);
    else
      following := exists(select 1 from public.academy_member_follows f where f.academy_community_id=new.academy_community_id and f.follower_member_id=recipient.id and f.followed_member_id=new.academy_author_id);
      preference_name := case when exists(select 1 from public.notification_preferences p where p.user_id=recipient.user_id and p.push_all_new_posts)
        then 'all_new_posts' when following then 'new_posts' else 'all_new_posts' end;
      perform private.queue_academy_activity(new.academy_community_id,new.organization_id,recipient.id,new.academy_author_id,'community_post',
        coalesce(actor_name,'A community member')||' published a new post',new.title,'post',new.id,'post:'||new.id||':community_post:'||recipient.id,preference_name);
      -- Preserve existing followed-author email consent without a second in-app
      -- notification or phone event. This new category adds no email audience.
      if following then perform private.queue_academy_notification(new.academy_community_id,new.organization_id,recipient.id,new.academy_author_id,'admin','new_post',
        coalesce(actor_name,'A community member')||' published a new post',new.title,'post',new.id,'post:'||new.id||':new_post:'||recipient.id,
        'new_posts',now(),jsonb_build_object('postTitle',new.title,'excerpt',left(new.body,280),'category',coalesce(category_name,'General')),false); end if;
    end if;
  end loop;
  return new;
end;
$$;
drop trigger academy_post_notification on public.community_posts;
create trigger academy_post_notification after insert or update of status on public.community_posts for each row execute function private.notify_academy_post_created();

create function private.notify_academy_member_joined(p_member uuid)
returns void language plpgsql security definer set search_path='' as $$
declare actor public.academy_members%rowtype; community public.academy_communities%rowtype; recipient record;
begin
  select * into actor from public.academy_members where id=p_member and status='active' and user_id is not null;
  if actor.id is null
    or exists(select 1 from public.academy_member_links imported where imported.academy_member_id=actor.id)
    or exists(select 1 from public.academy_access_grants imported where imported.academy_member_id=actor.id and imported.source_type='import')
    or not exists(select 1 from public.academy_access_grants g where g.academy_member_id=actor.id
    and g.academy_community_id=actor.academy_community_id and g.course_id is null and g.source_type<>'import'
    and g.status='active' and g.starts_at<=now() and (g.ends_at is null or g.ends_at>now())) then return; end if;
  select * into community from public.academy_communities where id=actor.academy_community_id;
  if community.owner_organization_id is null then return; end if;
  for recipient in select id from public.academy_members where academy_community_id=community.id and status='active' and id<>actor.id loop
    perform private.queue_academy_activity(community.id,community.owner_organization_id,recipient.id,actor.id,'member_joined',
      'A new member joined the community',coalesce(nullif(actor.display_name,''),'Academy member'),'community',community.id,
      'member:'||actor.id||':joined:'||recipient.id,'new_members');
  end loop;
end;
$$;
revoke all on function private.notify_academy_member_joined(uuid) from public,anon,authenticated;
create function private.notify_academy_member_joined_trigger()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='academy_access_grants' then
    if new.source_type<>'import' and new.course_id is null and new.status='active'
      and (tg_op='INSERT' or old.status<>'active') then perform private.notify_academy_member_joined(new.academy_member_id); end if;
  elsif tg_op='UPDATE' and ((old.status='pending' and new.status='active') or (old.user_id is null and new.user_id is not null)) then
    perform private.notify_academy_member_joined(new.id);
  end if;
  return new;
end;
$$;
revoke all on function private.notify_academy_member_joined_trigger() from public,anon,authenticated;
create trigger academy_new_member_grant_notification after insert or update of status on public.academy_access_grants for each row execute function private.notify_academy_member_joined_trigger();
create trigger academy_new_member_status_notification after update of status,user_id on public.academy_members for each row execute function private.notify_academy_member_joined_trigger();

-- Preserve mention supersession for the expanded community-post audience.
create or replace function private.queue_academy_push(p_notification uuid,p_community uuid,p_member uuid,p_template text,p_preference text,p_actor uuid,p_payload jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare n public.notifications%rowtype; comment_uuid uuid;
begin
 select * into n from public.notifications where id=p_notification;
 if n.id is null or n.target_id is null or n.target_type not in ('post','course','event','community')
  or not exists(select 1 from private.academy_push_settings where id and enabled and n.created_at>=enabled_at)
  or p_template not in ('new_post','announcement','comment','reply','mention','post_reaction','comment_reaction','new_event','event_reminder','new_course','course_unlocked','content_reported_admin','lesson_published','course_certificate') then return; end if;
 if p_payload->>'commentId' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' then comment_uuid:=(p_payload->>'commentId')::uuid; end if;
 if p_template='mention' then
  update private.academy_push_deliveries q set status='cancelled',error_code='superseded_by_mention'
   where q.member_id=p_member and q.community_id=p_community and q.target_id=n.target_id and q.status='pending'
    and ((comment_uuid is not null and q.template_key in ('comment','reply') and q.comment_id=comment_uuid)
      or (comment_uuid is null and q.template_key in ('new_post','community_post')));
 end if;
  insert into private.academy_push_deliveries(notification_id,device_id,user_id,generation,community_id,member_id,template_key,preference_key,actor_member_id,comment_id,target_type,target_id,send_after,context)
  select n.id,d.id,n.recipient_id,d.generation,p_community,p_member,p_template,p_preference,p_actor,comment_uuid,n.target_type,n.target_id,private.academy_push_next_window(d.timezone,now()),jsonb_build_object('lessonId',p_payload->>'lessonId','startsAt',p_payload->>'startsAt')
   from private.academy_push_devices d join public.notification_preferences p on p.user_id=d.user_id and p.push_enabled
   where d.user_id=n.recipient_id and d.enabled and d.retired_at is null and d.updated_at>now()-interval '90 days'
  on conflict(notification_id,device_id,generation) do nothing;
end; $$;
revoke all on function private.queue_academy_push(uuid,uuid,uuid,text,text,uuid,jsonb) from public,anon,authenticated;
