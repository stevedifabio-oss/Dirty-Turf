-- Local-only rollout. No historical email is queued or sent by this migration.
alter table public.notification_preferences add column timezone text not null default 'UTC';
create or replace function private.validate_notification_timezone() returns trigger
language plpgsql set search_path = '' as $$ begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Invalid notification timezone';
  end if; return new;
end; $$;
revoke all on function private.validate_notification_timezone() from public, anon, authenticated;
create trigger notification_timezone_valid before insert or update of timezone on public.notification_preferences
for each row execute function private.validate_notification_timezone();

create table private.academy_email_cutover (
  id boolean primary key default true check (id), enabled boolean not null default false,
  enabled_at timestamptz, check (not enabled or enabled_at is not null)
);
alter table private.academy_email_cutover enable row level security;
revoke all on private.academy_email_cutover from public, anon, authenticated;
grant select, update on private.academy_email_cutover to service_role;
insert into private.academy_email_cutover(id) values (true);
-- Old pending outbox entries are intentionally not replayed during cutover.
update public.academy_email_deliveries set status = 'cancelled', last_error = 'Pre-cutover queue retired'
where status in ('pending', 'processing');

alter table public.academy_email_deliveries drop constraint academy_email_deliveries_template_key_check;
alter table public.academy_email_deliveries add constraint academy_email_deliveries_template_key_check check (template_key in (
 'welcome','new_post','announcement','comment','reply','mention','post_reaction','comment_reaction',
 'new_event','event_reminder','event_updated','event_cancelled','event_rsvp','new_course','course_unlocked','weekly_digest','membership_requested','membership_request_admin','membership_approved','membership_declined','membership_removed','membership_removed_admin','private_channel_added','role_changed','ownership_transferred','content_reported_admin','group_payment_received','group_payment_received_admin','course_payment_received','course_payment_received_admin','group_subscription_cancelled','group_subscription_cancelled_admin','course_subscription_cancelled','course_subscription_cancelled_admin','course_certificate','lesson_published','mention_everyone_post','mention_everyone_comment'
));

-- Recipient-specific authorization. Never rely on the dispatcher's service-role identity.
create or replace function private.academy_notification_access(p_member uuid, p_community uuid, p_type text, p_target uuid, p_template text)
returns boolean language sql stable security definer set search_path = '' as $$
 select exists (
  select 1 from public.academy_members m where m.id = p_member and m.academy_community_id = p_community and (m.status = 'active' or p_template in ('membership_requested','membership_declined','membership_removed','group_subscription_cancelled','course_subscription_cancelled'))
  and (p_template in ('membership_requested','membership_declined','membership_removed','group_subscription_cancelled','course_subscription_cancelled') or m.role in ('owner','admin') or private.has_active_academy_grant(m.id,null) or (p_type='course' and private.has_active_academy_grant(m.id,p_target)))
  and (p_template not like '%\_admin' escape '\' or m.role in ('owner','admin') or (p_template='content_reported_admin' and m.role='moderator'))
  and case p_type
    when 'course' then exists (select 1 from public.courses c where c.id = p_target and c.academy_community_id = p_community
      and c.status = 'published' and (m.role in ('owner','admin') or c.access_type = 'open'
        or (c.access_type = 'level' and m.level >= coalesce(c.required_level,1)) or private.has_active_academy_grant(m.id,c.id)))
    when 'event' then p_template = 'event_cancelled' or exists (select 1 from public.academy_events e
      where e.id = p_target and e.academy_community_id = p_community and e.status = 'published'
      and e.ends_at > now() and (p_template<>'new_event' or e.starts_at>now()) and (m.role in ('owner','admin') or m.level >= coalesce(e.required_level,1)))
    when 'post' then exists (select 1 from public.community_posts p where p.id = p_target and p.academy_community_id = p_community and p.status = 'published')
    else p_type = 'community'
  end
 );
$$;
revoke all on function private.academy_notification_access(uuid,uuid,text,uuid,text) from public, anon, authenticated;

create or replace function private.queue_academy_notification(
  p_community_id uuid,
  p_organization_id uuid,
  p_recipient_member_id uuid,
  p_actor_member_id uuid,
  p_kind public.notification_kind,
  p_template_key text,
  p_title text,
  p_detail text,
  p_target_type text,
  p_target_id uuid,
  p_dedupe_key text,
  p_email_preference text,
  p_send_after timestamptz default now(),
  p_payload jsonb default '{}'::jsonb,
  p_create_in_app boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient public.academy_members%rowtype;
  preference public.notification_preferences%rowtype;
  actor_user_id uuid;
  actor_name text;
  community_name text;
  recipient_email text;
  notification_id uuid;
  email_allowed boolean;
begin
  if p_template_key not in (
    'welcome', 'new_post', 'announcement', 'comment', 'reply', 'mention',
    'post_reaction', 'comment_reaction', 'new_event', 'event_reminder',
    'new_course', 'course_unlocked', 'weekly_digest', 'event_updated', 'event_cancelled', 'event_rsvp','membership_requested','membership_request_admin','membership_approved','membership_declined','membership_removed','membership_removed_admin','private_channel_added','role_changed','ownership_transferred','content_reported_admin','group_payment_received','group_payment_received_admin','course_payment_received','course_payment_received_admin','group_subscription_cancelled','group_subscription_cancelled_admin','course_subscription_cancelled','course_subscription_cancelled_admin','course_certificate','lesson_published','mention_everyone_post','mention_everyone_comment'
  ) then
    raise exception 'Unsupported notification template';
  end if;

  select * into recipient
  from public.academy_members
  where id = p_recipient_member_id
    and academy_community_id = p_community_id
;
  if current_setting('app.academy_course_sync', true) = 'on' and coalesce(current_setting('app.academy_course_sync_notifications',true),'off') <> 'on' then return null; end if;
  if recipient.id is null or recipient.id is not distinct from p_actor_member_id
    or not private.academy_notification_access(recipient.id, p_community_id, p_target_type, p_target_id, p_template_key) then
    return null;
  end if;

  if p_actor_member_id is not null and exists (select 1 from public.academy_member_blocks
    where academy_community_id=p_community_id and ((blocker_member_id=recipient.id and blocked_member_id=p_actor_member_id)
      or (blocked_member_id=recipient.id and blocker_member_id=p_actor_member_id))) then return null; end if;

  select user_id, coalesce(nullif(display_name, ''), 'A community member')
  into actor_user_id, actor_name
  from public.academy_members
  where id = p_actor_member_id and academy_community_id = p_community_id;

  select name into community_name
  from public.academy_communities
  where id = p_community_id;

  if p_create_in_app and recipient.user_id is not null then
    insert into public.notifications (
      organization_id, recipient_id, actor_id, kind, title, detail,
      target_type, target_id, dedupe_key
    ) values (
      p_organization_id, recipient.user_id, actor_user_id, p_kind,
      p_title, p_detail, p_target_type, p_target_id, p_dedupe_key
    )
    on conflict (dedupe_key) where dedupe_key is not null do nothing
    returning id into notification_id;

    if notification_id is null then
      select id into notification_id
      from public.notifications where dedupe_key = p_dedupe_key;
    end if;
  end if;

  if recipient.user_id is not null then
    select * into preference
    from public.notification_preferences
    where user_id = recipient.user_id;
  end if;

  email_allowed := coalesce(preference.email_enabled, true) and case p_email_preference
    when 'replies' then coalesce(preference.replies, true)
    when 'mentions' then coalesce(preference.mentions, true)
    when 'reactions' then coalesce(preference.reactions, true)
    when 'event_reminders' then coalesce(preference.event_reminders, true)
    when 'weekly_digest' then coalesce(preference.weekly_digest, true)
    when 'new_posts' then coalesce(preference.new_posts, true)
    when 'course_updates' then coalesce(preference.course_updates, true)
    when 'admin_announcements' then coalesce(preference.admin_announcements, true)
    else true
  end;

  -- No email backlog while GHL remains the sender. In-app notifications still work.
  if not email_allowed or recipient.user_id is null or not exists (
    select 1 from private.academy_email_cutover where id and enabled and enabled_at <= now()
  ) then return notification_id; end if;

  -- An old import invite or Stripe billing address must never override the current login identity.
  select lower(trim(email)) into recipient_email from auth.users where id = recipient.user_id;

  if recipient_email is null or position('@' in recipient_email) <= 1 then
    return notification_id;
  end if;

  -- A mention replaces a generic alert for the same action/recipient, before dispatch.
  if p_template_key = 'mention' then
    update public.academy_email_deliveries set status = 'cancelled', last_error = 'Superseded by mention'
    where recipient_member_id = recipient.id and target_id = p_target_id and status = 'pending'
      and ((p_payload->>'commentId' is not null and template_key in ('comment', 'reply') and payload->>'commentId' = p_payload->>'commentId')
        or (p_payload->>'commentId' is null and template_key = 'new_post'));
  end if;
  insert into public.academy_email_deliveries (
    notification_id, academy_community_id, recipient_member_id, recipient_id,
    recipient_email, recipient_name, kind, template_key, title, detail,
    target_type, target_id, payload, idempotency_key, send_after
  ) values (
    notification_id, p_community_id, recipient.id, recipient.user_id,
    recipient_email, coalesce(nullif(recipient.display_name, ''), 'Academy member'),
    p_kind, p_template_key, p_title, p_detail, p_target_type, p_target_id,
    coalesce(p_payload, '{}'::jsonb) || jsonb_build_object(
      'actorMemberId', p_actor_member_id,
      'actorName', coalesce(actor_name, 'Dirty Turf Academy'),
      'communityName', coalesce(community_name, '7 Figure Turf Cleaning'),
      'timezone', coalesce(preference.timezone, 'UTC')
    ),
    p_dedupe_key, coalesce(p_send_after, now())
  ) on conflict (idempotency_key) do nothing;

  return notification_id;
end;
$$;

revoke all on function private.queue_academy_notification(
  uuid, uuid, uuid, uuid, public.notification_kind, text, text, text,
  text, uuid, text, text, timestamptz, jsonb, boolean
) from public, anon, authenticated;


create or replace function private.academy_event_email_payload(e public.academy_events)
returns jsonb language sql immutable set search_path = '' as $$
 select jsonb_build_object('eventTitle',e.title,'startsAt',e.starts_at,'endsAt',e.ends_at,
  'meetingUrl',e.meeting_url,'description',left(e.description,500));
$$;
revoke all on function private.academy_event_email_payload(public.academy_events) from public, anon, authenticated;

create or replace function private.notify_academy_event_published()
returns trigger language plpgsql security definer set search_path = '' as $$
declare e public.academy_events%rowtype; recipient record; template text; event_key text;
begin
 e := case when tg_op = 'DELETE' then old else new end;
 if e.academy_community_id is null or e.source_import_batch_id is not null then return coalesce(new,old); end if;
 if tg_op = 'DELETE' then
   if old.status <> 'published' or old.ends_at <= now() then return old; end if;
   template := 'event_cancelled';
 elsif tg_op = 'INSERT' then
   if new.status <> 'published' or new.ends_at <= now() then return new; end if;
   template := 'new_event';
 elsif old.status = 'published' and new.status <> 'published' then
   if old.ends_at <= now() then return new; end if;
   template := 'event_cancelled';
 elsif new.status = 'published' and old.status <> 'published' then template := 'new_event';
 elsif new.status = 'published' and row(new.title,new.description,new.starts_at,new.ends_at,new.meeting_url)
       is distinct from row(old.title,old.description,old.starts_at,old.ends_at,old.meeting_url) then
   template := 'event_updated';
 else return new; end if;
 if template <> 'new_event' then
   update public.academy_email_deliveries set status = 'cancelled', last_error = 'Event changed'
   where target_type = 'event' and target_id = e.id and status = 'pending'
     and template_key in ('new_event','event_reminder','event_rsvp','event_updated');
 end if;
 event_key := 'event:' || e.id || ':' || template || ':' || case when template = 'new_event' then 'published' else txid_current()::text end;
 for recipient in
   select m.id from public.academy_members m where m.academy_community_id = e.academy_community_id and m.status = 'active'
    and (m.role in ('owner','admin') or m.level >= coalesce(e.required_level,1))
    and (template = 'new_event' or exists (select 1 from public.academy_member_event_rsvps r where r.event_id=e.id and r.academy_member_id=m.id))
 loop
   perform private.queue_academy_notification(e.academy_community_id,e.organization_id,recipient.id,null,'event',template,
     case template when 'new_event' then 'Register Now: ' || e.title || ' just Launched! 🎉'
       when 'event_updated' then 'Event updated: ' || e.title else 'Event cancelled: ' || e.title end,
     e.title,'event',e.id,event_key || ':' || recipient.id,'event_reminders',now(),private.academy_event_email_payload(e),true);
 end loop;
 return coalesce(new,old);
end; $$;
drop trigger academy_event_published_notification on public.academy_events;
create trigger academy_event_published_notification after insert or update on public.academy_events
for each row execute function private.notify_academy_event_published();
create trigger academy_event_deleted_notification before delete on public.academy_events
for each row execute function private.notify_academy_event_published();

create or replace function private.notify_academy_event_rsvp()
returns trigger language plpgsql security definer set search_path = '' as $$
declare e public.academy_events%rowtype;
begin
 select * into e from public.academy_events where id=new.event_id;
 if e.id is null or e.source_import_batch_id is not null or new.source_updated_at is not null or e.status <> 'published' then return new; end if;
 if tg_op = 'UPDATE' and old.status = new.status then return new; end if;
 perform private.queue_academy_notification(e.academy_community_id,e.organization_id,new.academy_member_id,null,'event','event_rsvp',
  case when new.status='going' then 'You are registered: ' else 'You are interested: ' end || e.title,
  e.title,'event',e.id,'rsvp:' || e.id || ':' || new.academy_member_id || ':' || new.status || ':' || txid_current(),
  'event_reminders',now(),private.academy_event_email_payload(e) || jsonb_build_object('rsvpStatus',new.status),true);
 return new;
end; $$;
revoke all on function private.notify_academy_event_rsvp() from public, anon, authenticated;
create trigger academy_event_rsvp_notification after insert or update of status on public.academy_member_event_rsvps
for each row execute function private.notify_academy_event_rsvp();

create or replace function public.queue_academy_scheduled_notifications(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record; d record; reminders integer := 0; digests integer := 0;
begin
 for r in
  select e.*, rsvp.academy_member_id, reminder_window.hours_before
  from public.academy_events e join public.academy_member_event_rsvps rsvp on rsvp.event_id=e.id
  cross join (values (24),(1)) as reminder_window(hours_before)
  where e.status='published' and e.source_import_batch_id is null
   and e.starts_at > p_now + make_interval(hours=>reminder_window.hours_before) - interval '15 minutes'
   and e.starts_at <= p_now + make_interval(hours=>reminder_window.hours_before)
 loop
  perform private.queue_academy_notification(r.academy_community_id,r.organization_id,r.academy_member_id,null,'event','event_reminder',
   'Reminder: ' || r.title || ' begins in ' || r.hours_before || case when r.hours_before=1 then ' hour' else ' hours' end,
   r.title,'event',r.id,'event:' || r.id || ':' || r.starts_at || ':' || r.hours_before || 'h:' || r.academy_member_id,
   'event_reminders',p_now,jsonb_build_object('eventTitle',r.title,'startsAt',r.starts_at,'endsAt',r.ends_at,'meetingUrl',r.meeting_url,'hoursBefore',r.hours_before),true);
  reminders := reminders+1;
 end loop;
 -- Once per Monday per member, using their own timezone. No imported-history recap.
 for d in
  select c.id community_id,c.owner_organization_id organization_id,m.id member_id,
   (p_now at time zone coalesce(p.timezone,'UTC')) local_now,
   (select count(*) from public.community_posts post where post.academy_community_id=c.id and post.status='published'
    and post.source_import_batch_id is null and post.created_at >= p_now-interval '7 days') post_count
  from public.academy_communities c join public.academy_members m on m.academy_community_id=c.id and m.status='active'
  left join public.notification_preferences p on p.user_id=m.user_id
  where c.owner_organization_id is not null
   and extract(isodow from p_now at time zone coalesce(p.timezone,'UTC'))=1
   and extract(hour from p_now at time zone coalesce(p.timezone,'UTC'))=9
 loop
  if d.post_count > 0 then
   perform private.queue_academy_notification(d.community_id,d.organization_id,d.member_id,null,'admin','weekly_digest',
    'Your week in the Dirty Turf community',d.post_count || ' new discussions this week.','community',d.community_id,
    'digest:' || d.community_id || ':' || d.member_id || ':' || to_char(d.local_now,'YYYY-MM-DD'),
    'weekly_digest',p_now,jsonb_build_object('postCount',d.post_count),false);
   digests := digests+1;
  end if;
 end loop;
 return jsonb_build_object('eventReminders',reminders,'weeklyDigests',digests);
end; $$;

-- Check preferences, identity and access at dispatch time, not only when queued.
create or replace function private.academy_email_eligible(d public.academy_email_deliveries)
returns boolean language sql stable security definer set search_path = '' as $$
 select exists (
  select 1 from public.academy_members m join auth.users u on u.id=m.user_id
  left join public.notification_preferences p on p.user_id=m.user_id
  join private.academy_email_cutover cutover on cutover.id and cutover.enabled and d.created_at >= cutover.enabled_at
  where m.id=d.recipient_member_id and m.user_id=d.recipient_id and lower(trim(u.email))=d.recipient_email
   and private.academy_notification_access(m.id,d.academy_community_id,d.target_type,d.target_id,d.template_key)
   and coalesce(p.email_enabled,true)
   and not exists (select 1 from public.academy_member_blocks b where b.academy_community_id=d.academy_community_id
     and ((b.blocker_member_id=m.id and b.blocked_member_id::text=d.payload->>'actorMemberId')
       or (b.blocked_member_id=m.id and b.blocker_member_id::text=d.payload->>'actorMemberId')))
   and (d.template_key<>'new_post' or exists (select 1 from public.academy_member_follows f
     where f.academy_community_id=d.academy_community_id and f.follower_member_id=m.id and f.followed_member_id::text=d.payload->>'actorMemberId'))
   and (d.payload->>'commentId' is null or exists (select 1 from public.community_comments c where c.id::text=d.payload->>'commentId' and c.post_id=d.target_id))
   and (d.template_key<>'lesson_published' or exists (select 1 from public.course_lessons l join public.course_modules cm on cm.id=l.module_id
      where l.id::text=d.payload->>'lessonId' and cm.course_id=d.target_id and l.status='published'
        and cm.source_archived_at is null and (cm.sync_owner='local' or cm.source_visibility='published')
        and (coalesce(cm.drip_after_days,0)=0 or exists (select 1 from public.course_enrollments ce
          where ce.course_id=cm.course_id and ce.academy_member_id=m.id and ce.enrolled_at + make_interval(days=>cm.drip_after_days)<=now()))))
   and case
    when d.template_key in ('comment','reply') then coalesce(p.replies,true)
    when d.template_key in ('mention','mention_everyone_post','mention_everyone_comment') then coalesce(p.mentions,true)
    when d.template_key in ('post_reaction','comment_reaction') then coalesce(p.reactions,true)
    when d.template_key in ('new_event','event_reminder','event_rsvp','event_updated','event_cancelled') then coalesce(p.event_reminders,true)
    when d.template_key in ('new_course','course_unlocked','course_certificate','lesson_published') then coalesce(p.course_updates,true)
    when d.template_key='weekly_digest' then coalesce(p.weekly_digest,true)
    when d.template_key='new_post' then coalesce(p.new_posts,true)
    else coalesce(p.admin_announcements,true) end
   and (d.template_key not in ('event_reminder','event_rsvp','event_updated') or exists (
    select 1 from public.academy_member_event_rsvps r join public.academy_events e on e.id=r.event_id
    where r.event_id=d.target_id and r.academy_member_id=m.id and r.status in ('going','interested') and e.starts_at>now()
     and e.starts_at=(d.payload->>'startsAt')::timestamptz
     and (d.template_key<>'event_rsvp' or r.status=d.payload->>'rsvpStatus')))
 );
$$;
revoke all on function private.academy_email_eligible(public.academy_email_deliveries) from public,anon,authenticated;

create or replace function public.claim_academy_email_deliveries(p_limit integer,p_lock_token uuid)
returns setof public.academy_email_deliveries language plpgsql security definer set search_path = '' as $$
begin
 if not exists (select 1 from private.academy_email_cutover where id and enabled) then return; end if;
 -- A crash after provider acceptance is ambiguous: never resend automatically.
 update public.academy_email_deliveries set status='failed',last_error='Stale processing lock: review provider before retry',lock_token=null,locked_at=null
 where status='processing' and locked_at < now()-interval '15 minutes';
 update public.academy_email_deliveries d set status='cancelled',last_error='Recipient, preference, access or target changed'
 where status='pending' and not private.academy_email_eligible(d);
 return query update public.academy_email_deliveries d set status='processing',lock_token=p_lock_token,locked_at=now(),attempt_count=d.attempt_count+1
 where d.id in (select q.id from public.academy_email_deliveries q where q.status='pending' and q.send_after<=now() and q.attempt_count<q.max_attempts
 order by q.send_after,q.created_at for update skip locked limit greatest(1,least(coalesce(p_limit,25),100))) returning d.*;
end; $$;

create or replace function public.prepare_academy_email_delivery(p_delivery_id uuid,p_lock_token uuid)
returns setof public.academy_email_deliveries language plpgsql security definer set search_path = '' as $$
begin
 update public.academy_email_deliveries d set status='cancelled',last_error='No longer eligible at send time',lock_token=null,locked_at=null
 where id=p_delivery_id and status='processing' and lock_token=p_lock_token and not private.academy_email_eligible(d);
 return query select d.* from public.academy_email_deliveries d where id=p_delivery_id and status='processing' and lock_token=p_lock_token;
end; $$;
revoke all on function public.prepare_academy_email_delivery(uuid,uuid) from public,anon,authenticated;
grant execute on function public.prepare_academy_email_delivery(uuid,uuid) to service_role;

-- GHL new-post mail follows authors; announcements still address the community.
create or replace function private.notify_academy_post_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient record;
  category_name text;
  actor_name text;
  template_name text;
  preference_name text;
  notification_title text;
begin
  if new.academy_community_id is null or new.source_import_batch_id is not null or new.status <> 'published' then return new; end if;
  select name into category_name from public.community_categories where id = new.category_id;
  select coalesce(nullif(display_name, ''), 'A community member') into actor_name
  from public.academy_members where id = new.academy_author_id;
  template_name := case when lower(coalesce(category_name, '')) = 'announcements' then 'announcement' else 'new_post' end;
  preference_name := case when template_name = 'announcement' then 'admin_announcements' else 'new_posts' end;
  notification_title := case when template_name = 'announcement'
    then 'New Academy announcement'
    else actor_name || ' published a new post'
  end;

  for recipient in
    select id from public.academy_members
    where academy_community_id = new.academy_community_id
      and status = 'active' and id is distinct from new.academy_author_id
      and (template_name='announcement' or exists (select 1 from public.academy_member_follows f
        where f.academy_community_id=new.academy_community_id and f.follower_member_id=academy_members.id and f.followed_member_id=new.academy_author_id))
  loop
    perform private.queue_academy_notification(
      new.academy_community_id, new.organization_id, recipient.id,
      new.academy_author_id, 'admin',
      template_name, notification_title, new.title,
      'post', new.id,
      'post:' || new.id || ':' || template_name || ':' || recipient.id,
      preference_name, now(), jsonb_build_object(
        'postTitle', new.title,
        'excerpt', left(new.body, 280),
        'category', coalesce(category_name, 'General')
      ), true
    );
  end loop;
  return new;
end;
$$;


-- Trusted producers can enqueue catalogued lifecycle messages without exposing a
-- client-send API. The event key must be the stable source event ID for retries.
create or replace function public.queue_academy_lifecycle_email(
 p_community_id uuid,p_recipient_member_id uuid,p_template text,p_event_key text,p_title text,p_detail text,
 p_target_type text default 'community',p_target_id uuid default null,p_payload jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare organization_id uuid;
begin
 if p_template not in ('membership_requested','membership_request_admin','membership_approved','membership_declined','membership_removed',
  'membership_removed_admin','private_channel_added','role_changed','ownership_transferred','content_reported_admin',
  'group_payment_received','group_payment_received_admin','course_payment_received','course_payment_received_admin',
  'group_subscription_cancelled','group_subscription_cancelled_admin','course_subscription_cancelled','course_subscription_cancelled_admin',
  'course_certificate','lesson_published','mention_everyone_post','mention_everyone_comment') then raise exception 'Unsupported lifecycle template'; end if;
 if char_length(coalesce(p_event_key,'')) not between 1 and 240 then raise exception 'Stable lifecycle event key required'; end if;
 if p_target_type not in ('community','course','post') then raise exception 'Unsupported lifecycle target'; end if;
 select owner_organization_id into organization_id from public.academy_communities where id=p_community_id;
 if organization_id is null then raise exception 'Community is not configured'; end if;
 return private.queue_academy_notification(p_community_id,organization_id,p_recipient_member_id,null,'admin',p_template,
  left(p_title,180),left(p_detail,1500),p_target_type,coalesce(p_target_id,p_community_id),
  'lifecycle:' || p_community_id || ':' || p_event_key || ':' || p_template || ':' || p_recipient_member_id,
  case when p_template='course_certificate' then 'course_updates' when p_template like 'mention_everyone_%' then 'mentions' else 'admin_announcements' end,
  now(),p_payload,true);
end; $$;
revoke all on function public.queue_academy_lifecycle_email(uuid,uuid,text,text,text,text,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.queue_academy_lifecycle_email(uuid,uuid,text,text,text,text,text,uuid,jsonb) to service_role;

create or replace function private.notify_academy_member_lifecycle()
returns trigger language plpgsql security definer set search_path = '' as $$
declare recipient record; template text; detail text; event_key text;
begin
 -- Only an authenticated administrator action, not imports, auth linking or billing side effects.
 if auth.uid() is null or not private.can_manage_academy(new.academy_community_id) then return new; end if;
 event_key := 'member:' || new.id || ':' || txid_current();
 if old.status is distinct from new.status then
  template := case when new.status='active' and old.status='pending' then 'membership_approved'
    when old.status='pending' then 'membership_declined' else 'membership_removed' end;
  -- Reactivation is a welcome, not a removal.
  if new.status='active' and old.status<>'pending' then template := 'membership_approved'; end if;
  detail := new.display_name || ': ' || new.status;
  perform public.queue_academy_lifecycle_email(new.academy_community_id,new.id,template,event_key,
    case template when 'membership_approved' then 'Your community membership is approved'
      when 'membership_declined' then 'Your community membership request was declined' else 'Your community membership has changed' end,detail);
  if new.status <> 'active' then
   for recipient in select id from public.academy_members where academy_community_id=new.academy_community_id
     and status='active' and role in ('owner','admin') and id<>new.id loop
    perform public.queue_academy_lifecycle_email(new.academy_community_id,recipient.id,'membership_removed_admin',event_key,'Community member access changed',detail);
   end loop;
  end if;
 end if;
 if old.role is distinct from new.role then
  perform public.queue_academy_lifecycle_email(new.academy_community_id,new.id,
    case when new.role='owner' or old.role='owner' then 'ownership_transferred' else 'role_changed' end,
    event_key,'Your community role has changed','Your role is now ' || new.role || '.');
 end if;
 return new;
end; $$;
revoke all on function private.notify_academy_member_lifecycle() from public,anon,authenticated;
create trigger academy_member_lifecycle_notification after update of status,role on public.academy_members
for each row execute function private.notify_academy_member_lifecycle();

create or replace function private.notify_academy_report()
returns trigger language plpgsql security definer set search_path = '' as $$
declare community_id uuid; recipient record;
begin
 if new.content_type='post' then select academy_community_id into community_id from public.community_posts where id=new.content_id;
 elsif new.content_type='comment' then select academy_community_id into community_id from public.community_comments where id=new.content_id;
 else select academy_community_id into community_id from public.academy_members where id=new.content_id; end if;
 if community_id is null or not exists (select 1 from public.academy_communities where id=community_id and owner_organization_id=new.organization_id) then return new; end if;
 for recipient in select id from public.academy_members where academy_community_id=community_id and status='active' and role in ('owner','admin','moderator') loop
  perform public.queue_academy_lifecycle_email(community_id,recipient.id,'content_reported_admin','report:' || new.id,
   'Community content needs review','A ' || new.content_type || ' was reported. Open moderation to review the report.');
 end loop;
 return new;
end; $$;
revoke all on function private.notify_academy_report() from public,anon,authenticated;
create trigger academy_content_report_notification after insert on public.content_reports
for each row execute function private.notify_academy_report();

create or replace function private.notify_academy_certificate()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if new.status='active' then
  perform public.queue_academy_lifecycle_email(new.academy_community_id,new.academy_member_id,'course_certificate','certificate:' || new.id,
   'Your certificate is ready: ' || new.course_title,new.course_title,'course',new.course_id,jsonb_build_object('certificateId',new.id));
 end if;
 return new;
end; $$;
revoke all on function private.notify_academy_certificate() from public,anon,authenticated;
create trigger academy_certificate_notification after insert on public.academy_certificates
for each row execute function private.notify_academy_certificate();

create or replace function private.notify_academy_lesson_published()
returns trigger language plpgsql security definer set search_path = '' as $$
declare course public.courses%rowtype; recipient record;
begin
 if new.status<>'published' or (tg_op='UPDATE' and old.status='published') then return new; end if;
 if new.source_import_batch_id is not null and coalesce(current_setting('app.academy_course_sync_notifications',true),'off')<>'on' then return new; end if;
 select c.* into course from public.courses c join public.course_modules m on m.course_id=c.id where m.id=new.module_id and c.status='published' and m.source_archived_at is null and (m.sync_owner='local' or m.source_visibility='published');
 if course.id is null or course.academy_community_id is null then return new; end if;
 for recipient in select am.id from public.academy_members am where am.academy_community_id=course.academy_community_id and am.status='active'
  and exists(select 1 from public.course_modules cm where cm.id=new.module_id and (coalesce(cm.drip_after_days,0)=0 or exists (
    select 1 from public.course_enrollments ce where ce.course_id=course.id and ce.academy_member_id=am.id and ce.enrolled_at+make_interval(days=>cm.drip_after_days)<=now()))) loop
  perform private.queue_academy_notification(course.academy_community_id,course.organization_id,recipient.id,null,'course','lesson_published',
   'New lesson: ' || new.title,course.title,'course',course.id,'lesson:' || new.id || ':published:' || recipient.id,
   'course_updates',now(),jsonb_build_object('lessonId',new.id,'lessonTitle',new.title),true);
 end loop;
 return new;
end; $$;
revoke all on function private.notify_academy_lesson_published() from public,anon,authenticated;
create trigger academy_lesson_published_notification after insert or update of status on public.course_lessons
for each row execute function private.notify_academy_lesson_published();

create or replace function private.notify_academy_course_published()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient record;
begin
  if new.academy_community_id is null or (new.source_import_batch_id is not null and coalesce(current_setting('app.academy_course_sync_notifications',true),'off')<>'on') or new.status <> 'published' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'published' then return new; end if;
  for recipient in
    select id from public.academy_members
    where academy_community_id = new.academy_community_id and status = 'active'
  loop
    perform private.queue_academy_notification(
      new.academy_community_id, new.organization_id, recipient.id, null,
      'course', 'new_course', 'New course available', new.title,
      'course', new.id, 'course:' || new.id || ':published:' || recipient.id,
      'course_updates', now(), jsonb_build_object('description', left(new.description, 280)), true
    );
  end loop;
  return new;
end;
$$;


create or replace function public.notify_post_author_on_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  post_row public.community_posts%rowtype;
  parent_row public.community_comments%rowtype;
  actor_name text;
begin
  if new.academy_community_id is null or new.source_import_batch_id is not null then return new; end if;
  select * into post_row from public.community_posts where id = new.post_id;
  select coalesce(nullif(display_name, ''), 'A community member') into actor_name
  from public.academy_members where id = new.academy_author_id;

  if post_row.academy_author_id is not null and post_row.academy_author_id is distinct from new.academy_author_id then
    perform private.queue_academy_notification(
      new.academy_community_id, new.organization_id, post_row.academy_author_id,
      new.academy_author_id, 'reply', 'comment',
      actor_name || ' commented on your post', post_row.title,
      'post', new.post_id,
      'comment:' || new.id || ':post-author:' || post_row.academy_author_id,
      'replies', now(), jsonb_build_object('commentId', new.id, 'excerpt', left(new.body,500)), true
    );
  end if;

  if new.parent_id is not null then
    select * into parent_row from public.community_comments where id = new.parent_id;
    if parent_row.academy_author_id is not null
       and parent_row.academy_author_id is distinct from new.academy_author_id
       and parent_row.academy_author_id is distinct from post_row.academy_author_id then
      perform private.queue_academy_notification(
        new.academy_community_id, new.organization_id, parent_row.academy_author_id,
        new.academy_author_id, 'reply', 'reply',
        actor_name || ' replied to your comment', post_row.title,
        'post', new.post_id,
        'comment:' || new.id || ':parent-author:' || parent_row.academy_author_id,
        'replies', now(), jsonb_build_object('commentId', new.id, 'excerpt', left(new.body,500)), true
      );
    end if;
  end if;
  return new;
end;
$$;


create or replace function private.notify_academy_mention()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_post_id uuid;
  target_title text;
  target_organization_id uuid;
  actor_name text;
  excerpt text;
begin
  if new.post_id is not null then
    select id, title, organization_id, left(body,500) into target_post_id, target_title, target_organization_id, excerpt
    from public.community_posts where id = new.post_id;
  else
    select post.id, post.title, post.organization_id, left(comment.body,500)
    into target_post_id, target_title, target_organization_id, excerpt
    from public.community_comments comment
    join public.community_posts post on post.id = comment.post_id
    where comment.id = new.comment_id;
  end if;
  select coalesce(nullif(display_name, ''), 'A community member') into actor_name
  from public.academy_members where id = new.actor_member_id;
  perform private.queue_academy_notification(
    new.academy_community_id, target_organization_id, new.mentioned_member_id,
    new.actor_member_id, 'mention', 'mention',
    actor_name || ' mentioned you', coalesce(target_title, 'Community discussion'),
    'post', target_post_id,
    'mention:' || new.id || ':' || new.mentioned_member_id,
    'mentions', now(), jsonb_build_object('commentId', new.comment_id, 'excerpt', excerpt), true
  );
  return new;
end;
$$;

