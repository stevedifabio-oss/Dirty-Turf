-- Native push preparation only. All sending defaults OFF; no cron or backlog.
alter table public.notification_preferences
  add column push_replies boolean not null default true,
  add column push_mentions boolean not null default true,
  add column push_reactions boolean not null default false,
  add column push_new_posts boolean not null default false,
  add column push_admin_announcements boolean not null default true,
  add column push_event_reminders boolean not null default true,
  add column push_course_updates boolean not null default true;

create table private.academy_push_settings (
  id boolean primary key default true check(id),
  enabled boolean not null default false,
  client_ready boolean not null default false,
  environment text not null default 'production' check(environment in ('sandbox','production')),
  enabled_at timestamptz,
  check(not enabled or enabled_at is not null)
);
insert into private.academy_push_settings(id) values(true);
create table private.academy_push_installations (
  id uuid primary key,
  secret uuid not null,
  revision bigint not null check(revision between 1 and 9007199254740991),
  intent_user_id uuid references public.profiles(id) on delete set null
);
create table private.academy_push_devices (
  id uuid primary key,
  installation_secret uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null check(platform in ('ios','android')),
  environment text not null check(environment in ('sandbox','production')),
  token text not null check(length(token) between 20 and 4096 and token !~ '[[:space:]]'),
  enabled boolean not null default false,
  timezone text not null default 'UTC',
  generation bigint not null default 1,
  updated_at timestamptz not null default now(),
  retired_at timestamptz
);
create unique index academy_push_token_owner on private.academy_push_devices(platform,environment,token) where retired_at is null;
create table private.academy_push_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  device_id uuid not null references private.academy_push_devices(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  generation bigint not null,
  community_id uuid not null references public.academy_communities(id) on delete cascade,
  member_id uuid not null references public.academy_members(id) on delete cascade,
  template_key text not null,
  preference_key text not null,
  actor_member_id uuid,
  comment_id uuid,
  context jsonb not null default '{}'::jsonb,
  target_type text not null,
  target_id uuid not null,
  status text not null default 'pending' check(status in ('pending','processing','sent','cancelled','failed')),
  attempt_count integer not null default 0,
  send_after timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '1 day',
  lock_token uuid,
  locked_at timestamptz,
  provider_id text,
  error_code text,
  created_at timestamptz not null default now(),
  unique(notification_id,device_id,generation)
);
create index academy_push_pending on private.academy_push_deliveries(send_after) where status='pending';
alter table private.academy_push_settings enable row level security;
alter table private.academy_push_installations enable row level security;
alter table private.academy_push_devices enable row level security;
alter table private.academy_push_deliveries enable row level security;
revoke all on private.academy_push_settings,private.academy_push_devices,private.academy_push_deliveries from public,anon,authenticated;
revoke all on private.academy_push_installations from public,anon,authenticated;
grant all on private.academy_push_settings,private.academy_push_devices,private.academy_push_deliveries to service_role;
grant all on private.academy_push_installations to service_role;

create function public.academy_push_readiness()
returns table(ready boolean,environment text) language sql stable security definer set search_path='' as $$
  select s.enabled and s.client_ready,s.environment from private.academy_push_settings s where s.id and auth.uid() is not null;
$$;
revoke all on function public.academy_push_readiness() from public,anon;
grant execute on function public.academy_push_readiness() to authenticated;

create function private.academy_push_next_window(p_timezone text,p_now timestamptz)
returns timestamptz language sql stable set search_path='' as $$
 select case when extract(hour from p_now at time zone p_timezone)>=22 then
   (((p_now at time zone p_timezone)::date+1)+time '08:00') at time zone p_timezone
  when extract(hour from p_now at time zone p_timezone)<8 then
   (((p_now at time zone p_timezone)::date)+time '08:00') at time zone p_timezone else p_now end;
$$;
revoke all on function private.academy_push_next_window(text,timestamptz) from public,anon,authenticated;

create function public.begin_academy_push_registration(p_installation_id uuid,p_installation_secret uuid,p_revision bigint)
returns void language plpgsql security definer set search_path='' as $$
declare intent private.academy_push_installations%rowtype; uid uuid:=auth.uid();
begin
 if uid is null or not exists(select 1 from auth.users u where u.id=uid and u.email_confirmed_at is not null and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())) then raise insufficient_privilege using message='Confirmed sign-in required'; end if;
 if p_installation_id is null or p_installation_secret is null or p_revision is null or p_revision not between 1 and 9007199254740991 then raise exception 'Invalid installation'; end if;
 perform pg_advisory_xact_lock(hashtext(p_installation_id::text));
 select * into intent from private.academy_push_installations where id=p_installation_id for update;
 if intent.id is not null and (intent.secret<>p_installation_secret or intent.revision>=p_revision) then raise insufficient_privilege using message='Stale installation intent'; end if;
 insert into private.academy_push_installations(id,secret,revision,intent_user_id) values(p_installation_id,p_installation_secret,p_revision,uid)
  on conflict(id) do update set revision=excluded.revision,intent_user_id=excluded.intent_user_id;
 update private.academy_push_devices set enabled=false,generation=generation+1 where id=p_installation_id and user_id<>uid;
end; $$;
revoke all on function public.begin_academy_push_registration(uuid,uuid,bigint) from public,anon;
grant execute on function public.begin_academy_push_registration(uuid,uuid,bigint) to authenticated;

create function public.register_academy_push_device(p_installation_id uuid,p_installation_secret uuid,p_platform text,p_environment text,p_token text,p_enable boolean default false,p_timezone text default 'UTC',p_revision bigint default null)
returns void language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); current_device private.academy_push_devices%rowtype;
begin
  if uid is null or not exists(select 1 from auth.users u where u.id=uid and u.email_confirmed_at is not null and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())) then
    raise insufficient_privilege using message='Confirmed sign-in required';
  end if;
  if p_installation_id is null or p_installation_secret is null or p_platform not in ('ios','android') or p_environment not in ('sandbox','production')
    or p_token is null or length(p_token) not between 20 and 4096 or p_token ~ '[[:space:]]'
    or (p_platform='ios' and p_token !~ '^([a-fA-F0-9]{2})+$') then raise exception 'Invalid push registration'; end if;
  if not exists(select 1 from private.academy_push_settings s where s.id and s.enabled and s.client_ready and s.environment=p_environment) then raise exception 'Phone notifications are not ready'; end if;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then raise exception 'Invalid device timezone'; end if;
  -- Serialize token and installation moves; never leave a token active for two accounts.
  perform pg_advisory_xact_lock(hashtext(p_platform||p_environment||p_token));
  perform pg_advisory_xact_lock(hashtext(p_installation_id::text));
  if not exists(select 1 from private.academy_push_installations i where i.id=p_installation_id and i.secret=p_installation_secret and i.revision=p_revision and i.intent_user_id=uid) then raise insufficient_privilege using message='Stale installation intent'; end if;
  select * into current_device from private.academy_push_devices where id=p_installation_id for update;
  if current_device.id is not null and current_device.installation_secret<>p_installation_secret then raise insufficient_privilege using message='Installation verification failed'; end if;
  if not coalesce(p_enable,false) and (current_device.id is null or current_device.user_id<>uid or not current_device.enabled or current_device.retired_at is not null
    or not exists(select 1 from public.notification_preferences p where p.user_id=uid and p.push_enabled)) then raise insufficient_privilege using message='Explicit push opt-in required'; end if;
  update private.academy_push_devices set enabled=false,retired_at=now(),generation=generation+1
    where platform=p_platform and environment=p_environment and token=p_token and id<>p_installation_id and retired_at is null;
  insert into private.academy_push_devices(id,installation_secret,user_id,platform,environment,token,enabled,timezone)
    values(p_installation_id,p_installation_secret,uid,p_platform,p_environment,p_token,true,p_timezone)
    on conflict(id) do update set user_id=excluded.user_id,platform=excluded.platform,environment=excluded.environment,token=excluded.token,
      enabled=true,timezone=excluded.timezone,retired_at=null,updated_at=now(),generation=case when row(private.academy_push_devices.user_id,private.academy_push_devices.token,private.academy_push_devices.platform,private.academy_push_devices.environment,private.academy_push_devices.enabled,private.academy_push_devices.retired_at)
        is distinct from row(excluded.user_id,excluded.token,excluded.platform,excluded.environment,true,null::timestamptz) then private.academy_push_devices.generation+1 else private.academy_push_devices.generation end;
  if p_enable then insert into public.notification_preferences(user_id,push_enabled) values(uid,true) on conflict(user_id) do update set push_enabled=true; end if;
  update private.academy_push_deliveries q set status='cancelled',error_code='device_changed',lock_token=null,locked_at=null
    where q.status in ('pending','processing') and exists(select 1 from private.academy_push_devices d where d.id=q.device_id and (not d.enabled or d.retired_at is not null or d.generation<>q.generation or d.user_id<>q.user_id));
end; $$;
revoke all on function public.register_academy_push_device(uuid,uuid,text,text,text,boolean,text,bigint) from public,anon;
grant execute on function public.register_academy_push_device(uuid,uuid,text,text,text,boolean,text,bigint) to authenticated;

-- Local opt-out/log-out works without a live auth session, using the unguessable
-- installation secret. This capability can only disable its one installation.
create function public.unregister_academy_push_device(p_installation_id uuid,p_installation_secret uuid,p_revision bigint)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtext(p_installation_id::text));
  update private.academy_push_installations set revision=p_revision,intent_user_id=null where id=p_installation_id and secret=p_installation_secret and p_revision>=revision and p_revision between 1 and 9007199254740991;
  if not found then return; end if;
  update private.academy_push_devices set enabled=false,retired_at=now(),generation=generation+1,updated_at=now()
    where id=p_installation_id and installation_secret=p_installation_secret;
  update private.academy_push_deliveries q set status='cancelled',error_code='device_disabled',lock_token=null,locked_at=null
    where device_id=p_installation_id and status in ('pending','processing') and exists(select 1 from private.academy_push_devices d where d.id=q.device_id and d.installation_secret=p_installation_secret and not d.enabled);
end; $$;
revoke all on function public.unregister_academy_push_device(uuid,uuid,bigint) from public;
grant execute on function public.unregister_academy_push_device(uuid,uuid,bigint) to anon,authenticated;

create function private.academy_push_eligible(q private.academy_push_deliveries)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from private.academy_push_devices d
  join public.notifications n on n.id=q.notification_id and n.recipient_id=q.user_id and n.target_type=q.target_type and n.target_id=q.target_id
  join public.academy_members m on m.id=q.member_id and m.user_id=q.user_id and m.academy_community_id=q.community_id and m.status='active'
  join auth.users u on u.id=q.user_id and u.email_confirmed_at is not null and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
  join public.notification_preferences p on p.user_id=q.user_id and p.push_enabled
  join private.academy_push_settings s on s.id and s.enabled and s.client_ready and d.environment=s.environment and q.created_at>=s.enabled_at
  where d.id=q.device_id and d.enabled and d.retired_at is null and d.user_id=q.user_id and d.generation=q.generation
   and d.updated_at>now()-interval '90 days' and q.expires_at>now()
   and private.academy_notification_access(m.id,q.community_id,q.target_type,q.target_id,q.template_key)
   and case q.preference_key when 'replies' then p.push_replies when 'mentions' then p.push_mentions when 'reactions' then p.push_reactions
     when 'new_posts' then p.push_new_posts when 'admin_announcements' then p.push_admin_announcements when 'event_reminders' then p.push_event_reminders
     when 'course_updates' then p.push_course_updates else false end
   and not exists(select 1 from public.academy_member_blocks b where b.academy_community_id=q.community_id and ((b.blocker_member_id=m.id and b.blocked_member_id=q.actor_member_id) or (b.blocked_member_id=m.id and b.blocker_member_id=q.actor_member_id)))
   and (q.template_key<>'new_post' or exists(select 1 from public.academy_member_follows f where f.academy_community_id=q.community_id and f.follower_member_id=m.id and f.followed_member_id=q.actor_member_id))
   and (q.comment_id is null or exists(select 1 from public.community_comments c where c.id=q.comment_id and c.post_id=q.target_id and c.academy_community_id=q.community_id and c.body<>'[Removed by Academy moderator]'
     and not exists(select 1 from public.academy_member_blocks b where b.academy_community_id=q.community_id and ((b.blocker_member_id=m.id and b.blocked_member_id=c.academy_author_id) or (b.blocked_member_id=m.id and b.blocker_member_id=c.academy_author_id)))))
   and (q.template_key<>'event_reminder' or exists(select 1 from public.academy_member_event_rsvps r join public.academy_events e on e.id=r.event_id where r.event_id=q.target_id and r.academy_member_id=m.id and r.status in ('going','interested') and e.starts_at>now() and e.starts_at=(q.context->>'startsAt')::timestamptz))
   and (q.template_key<>'lesson_published' or exists(select 1 from public.course_lessons l join public.course_modules cm on cm.id=l.module_id where l.id::text=q.context->>'lessonId' and cm.course_id=q.target_id and l.status='published'
     and cm.source_archived_at is null and (cm.sync_owner='local' or cm.source_visibility='published') and (coalesce(cm.drip_after_days,0)=0 or exists(select 1 from public.course_enrollments ce where ce.course_id=cm.course_id and ce.academy_member_id=m.id and ce.enrolled_at+make_interval(days=>cm.drip_after_days)<=now()))))
 );
$$;
revoke all on function private.academy_push_eligible(private.academy_push_deliveries) from public,anon,authenticated;

create function private.queue_academy_push(p_notification uuid,p_community uuid,p_member uuid,p_template text,p_preference text,p_actor uuid,p_payload jsonb)
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
      or (comment_uuid is null and q.template_key='new_post'));
 end if;
  insert into private.academy_push_deliveries(notification_id,device_id,user_id,generation,community_id,member_id,template_key,preference_key,actor_member_id,comment_id,target_type,target_id,send_after,context)
  select n.id,d.id,n.recipient_id,d.generation,p_community,p_member,p_template,p_preference,p_actor,comment_uuid,n.target_type,n.target_id,private.academy_push_next_window(d.timezone,now()),jsonb_build_object('lessonId',p_payload->>'lessonId','startsAt',p_payload->>'startsAt')
   from private.academy_push_devices d join public.notification_preferences p on p.user_id=d.user_id and p.push_enabled
   where d.user_id=n.recipient_id and d.enabled and d.retired_at is null and d.updated_at>now()-interval '90 days'
  on conflict(notification_id,device_id,generation) do nothing;
end; $$;
revoke all on function private.queue_academy_push(uuid,uuid,uuid,text,text,uuid,jsonb) from public,anon,authenticated;

create function public.claim_academy_push_deliveries(p_limit integer,p_lock uuid,p_environment text)
returns table(id uuid) language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from private.academy_push_settings s where s.id and s.enabled and s.client_ready and s.environment=p_environment) then return; end if;
 update private.academy_push_deliveries q set status='failed',error_code='stale_uncertain_provider',lock_token=null,locked_at=null where status='processing' and locked_at<now()-interval '5 minutes';
 update private.academy_push_deliveries q set status='cancelled',error_code='ineligible',lock_token=null,locked_at=null where status='pending' and not private.academy_push_eligible(q);
 update private.academy_push_deliveries q set send_after=private.academy_push_next_window(d.timezone,now()) from private.academy_push_devices d where d.id=q.device_id and q.status='pending' and private.academy_push_next_window(d.timezone,now())>now();
 return query update private.academy_push_deliveries q set status='processing',lock_token=p_lock,locked_at=now(),attempt_count=attempt_count+1
   where q.id in(select d.id from private.academy_push_deliveries d join private.academy_push_devices device on device.id=d.device_id
     where d.status='pending' and d.send_after<=now() and d.attempt_count<5 and device.environment=p_environment
     order by d.send_after,d.created_at for update of d skip locked limit greatest(1,least(coalesce(p_limit,25),100))) returning q.id;
end; $$;
create function public.prepare_academy_push_delivery(p_id uuid,p_lock uuid)
returns table(id uuid,platform text,environment text,token text,notification_id uuid,target_type text,target_id uuid,comment_id uuid)
language plpgsql security definer set search_path='' as $$
begin
 update private.academy_push_deliveries q set status='pending',send_after=private.academy_push_next_window(d.timezone,now()),lock_token=null,locked_at=null from private.academy_push_devices d where q.id=p_id and d.id=q.device_id and q.status='processing' and q.lock_token=p_lock and private.academy_push_next_window(d.timezone,now())>now();
 update private.academy_push_deliveries q set status='cancelled',error_code='ineligible',lock_token=null,locked_at=null where q.id=p_id and status='processing' and lock_token=p_lock and not private.academy_push_eligible(q);
 return query select q.id,d.platform,d.environment,d.token,q.notification_id,q.target_type,q.target_id,q.comment_id from private.academy_push_deliveries q join private.academy_push_devices d on d.id=q.device_id where q.id=p_id and q.status='processing' and q.lock_token=p_lock;
end; $$;
create function public.finish_academy_push_delivery(p_id uuid,p_lock uuid,p_result text,p_provider_id text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare q private.academy_push_deliveries%rowtype;
begin
 select * into q from private.academy_push_deliveries where id=p_id and status='processing' and lock_token=p_lock for update;
 if q.id is null then return false; end if;
 if p_result not in ('sent','invalid_token','retry','uncertain','rejected') then raise exception 'Invalid push outcome'; end if;
 if p_result='invalid_token' then update private.academy_push_devices set enabled=false,retired_at=now(),generation=generation+1 where id=q.device_id and generation=q.generation; end if;
 update private.academy_push_deliveries set status=case when p_result='sent' then 'sent' when p_result='invalid_token' then 'cancelled' when p_result='retry' and attempt_count<5 then 'pending' else 'failed' end,
   provider_id=case when p_result='sent' then left(p_provider_id,240) else null end,error_code=case when p_result='sent' then null else p_result end,
   send_after=case when p_result='retry' then now()+make_interval(mins=>least(60,(2^least(attempt_count,5))::integer)) else send_after end,lock_token=null,locked_at=null where id=p_id;
 return true;
end; $$;
revoke all on function public.claim_academy_push_deliveries(integer,uuid,text),public.prepare_academy_push_delivery(uuid,uuid),public.finish_academy_push_delivery(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.claim_academy_push_deliveries(integer,uuid,text),public.prepare_academy_push_delivery(uuid,uuid),public.finish_academy_push_delivery(uuid,uuid,text,text) to service_role;

-- Only an authenticated owner of a real notification can resolve its authoritative
-- target. Payloads received from the OS are untrusted, including after account swaps.
create function public.resolve_academy_push_notification(p_notification_id uuid)
returns table(target_type text,target_id uuid,comment_id uuid) language sql stable security definer set search_path='' as $$
 select q.target_type,q.target_id,q.comment_id from private.academy_push_deliveries q
 join public.notifications n on n.id=q.notification_id and n.recipient_id=auth.uid() and n.recipient_id=q.user_id and n.target_type=q.target_type and n.target_id=q.target_id
 join public.academy_members m on m.id=q.member_id and m.user_id=auth.uid() and m.academy_community_id=q.community_id and m.status='active'
 join auth.users u on u.id=m.user_id and u.email_confirmed_at is not null and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
 where q.notification_id=p_notification_id and private.academy_notification_access(m.id,q.community_id,q.target_type,q.target_id,q.template_key)
 and not exists(select 1 from public.academy_member_blocks b where b.academy_community_id=q.community_id and ((b.blocker_member_id=m.id and b.blocked_member_id=q.actor_member_id) or (b.blocked_member_id=m.id and b.blocker_member_id=q.actor_member_id)))
 and (q.comment_id is null or exists(select 1 from public.community_comments c where c.id=q.comment_id and c.post_id=q.target_id and c.academy_community_id=q.community_id and c.body<>'[Removed by Academy moderator]'
  and not exists(select 1 from public.academy_member_blocks b where b.academy_community_id=q.community_id and ((b.blocker_member_id=m.id and b.blocked_member_id=c.academy_author_id) or (b.blocked_member_id=m.id and b.blocker_member_id=c.academy_author_id)))))
 and (q.template_key<>'lesson_published' or exists(select 1 from public.course_lessons l join public.course_modules cm on cm.id=l.module_id where l.id::text=q.context->>'lessonId' and cm.course_id=q.target_id and l.status='published'
  and cm.source_archived_at is null and (cm.sync_owner='local' or cm.source_visibility='published') and (coalesce(cm.drip_after_days,0)=0 or exists(select 1 from public.course_enrollments ce where ce.course_id=cm.course_id and ce.academy_member_id=m.id and ce.enrolled_at+make_interval(days=>cm.drip_after_days)<=now())))) limit 1;
$$;
revoke all on function public.resolve_academy_push_notification(uuid) from public,anon;
grant execute on function public.resolve_academy_push_notification(uuid) to authenticated;

-- Preserve the existing producer verbatim except the independent push hook.
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

  -- Independent native delivery: trusted producer context, never email preferences.
  perform private.queue_academy_push(notification_id,p_community_id,recipient.id,p_template_key,p_email_preference,p_actor_member_id,p_payload);

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


-- Add only protected push configuration names; preserve every existing name.
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
      'STRIPE_SERVICE_CHECKOUT_ENABLED','STRIPE_SERVICE_RECURRING_ENABLED','STRIPE_SERVICE_WEBHOOK_SECRET',
      'ACADEMY_PUSH_ENABLED','ACADEMY_PUSH_DISPATCH_SECRET','ACADEMY_PUSH_ENVIRONMENT',
      'APNS_KEY_ID','APNS_TEAM_ID','APNS_PRIVATE_KEY','APNS_TOPIC',
      'FCM_PROJECT_ID','FCM_CLIENT_EMAIL','FCM_PRIVATE_KEY',
      'ACADEMY_POST_SCHEDULER_ENABLED','ACADEMY_POST_SCHEDULER_SECRET'
    ]::text[])), '{}'::jsonb);
end;
$$;
revoke all on function private.get_server_runtime_config(text[]) from public,anon,authenticated;
grant execute on function private.get_server_runtime_config(text[]) to service_role;
