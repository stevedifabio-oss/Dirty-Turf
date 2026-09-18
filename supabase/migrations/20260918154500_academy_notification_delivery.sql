-- Community notification parity: durable in-app alerts, Mailgun delivery
-- outbox, member preferences, replies, mentions, and scheduled reminders.

alter table public.notification_preferences
  add column if not exists reactions boolean not null default true,
  add column if not exists course_updates boolean not null default true,
  add column if not exists admin_announcements boolean not null default true;

alter table public.notification_preferences
  alter column new_posts set default true;

alter table public.notifications
  add column if not exists dedupe_key text;

create unique index if not exists notifications_dedupe_idx
  on public.notifications (dedupe_key)
  where dedupe_key is not null;

create type public.academy_email_delivery_status as enum (
  'pending', 'processing', 'sent', 'failed', 'cancelled'
);

create table public.academy_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid references public.notifications(id) on delete set null,
  academy_community_id uuid not null references public.academy_communities(id) on delete cascade,
  recipient_member_id uuid not null references public.academy_members(id) on delete cascade,
  recipient_id uuid references public.profiles(id) on delete set null,
  recipient_email text not null check (position('@' in recipient_email) > 1),
  recipient_name text not null default '',
  kind public.notification_kind not null,
  template_key text not null check (template_key in (
    'welcome', 'new_post', 'announcement', 'comment', 'reply', 'mention',
    'post_reaction', 'comment_reaction', 'new_event', 'event_reminder',
    'new_course', 'course_unlocked', 'weekly_digest'
  )),
  title text not null,
  detail text not null default '',
  target_type text,
  target_id uuid,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  status public.academy_email_delivery_status not null default 'pending',
  send_after timestamptz not null default now(),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 10),
  lock_token uuid,
  locked_at timestamptz,
  provider_message_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index academy_email_deliveries_pending_idx
  on public.academy_email_deliveries (status, send_after, created_at)
  where status in ('pending', 'processing');
create index academy_email_deliveries_recipient_idx
  on public.academy_email_deliveries (recipient_member_id, created_at desc);

create table public.academy_content_mentions (
  id uuid primary key default gen_random_uuid(),
  academy_community_id uuid not null references public.academy_communities(id) on delete cascade,
  actor_member_id uuid not null references public.academy_members(id) on delete cascade,
  mentioned_member_id uuid not null references public.academy_members(id) on delete cascade,
  post_id uuid references public.community_posts(id) on delete cascade,
  comment_id uuid references public.community_comments(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (actor_member_id <> mentioned_member_id),
  check ((post_id is not null)::integer + (comment_id is not null)::integer = 1)
);

create unique index academy_content_mentions_post_idx
  on public.academy_content_mentions (post_id, mentioned_member_id)
  where post_id is not null;
create unique index academy_content_mentions_comment_idx
  on public.academy_content_mentions (comment_id, mentioned_member_id)
  where comment_id is not null;

create trigger academy_email_deliveries_updated_at
  before update on public.academy_email_deliveries
  for each row execute function public.set_updated_at();

alter table public.academy_email_deliveries enable row level security;
alter table public.academy_content_mentions enable row level security;

revoke all on public.academy_email_deliveries from public, anon, authenticated;
revoke all on public.academy_content_mentions from public, anon, authenticated;
grant select, insert, update, delete on public.notification_preferences to authenticated;

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
    'new_course', 'course_unlocked', 'weekly_digest'
  ) then
    raise exception 'Unsupported notification template';
  end if;

  select * into recipient
  from public.academy_members
  where id = p_recipient_member_id
    and academy_community_id = p_community_id
    and status = 'active';
  if recipient.id is null or recipient.id is not distinct from p_actor_member_id then
    return null;
  end if;

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

  if not email_allowed then return notification_id; end if;

  select coalesce(
    (
      select lower(trim(invite.email))
      from public.academy_member_invites invite
      where invite.academy_member_id = recipient.id and invite.status <> 'cancelled'
      limit 1
    ),
    (
      select lower(trim(customer.email))
      from public.academy_billing_customers customer
      where customer.academy_member_id = recipient.id
      limit 1
    ),
    (
      select lower(trim(auth_user.email))
      from auth.users auth_user
      where auth_user.id = recipient.user_id
      limit 1
    )
  ) into recipient_email;

  if recipient_email is null or position('@' in recipient_email) <= 1 then
    return notification_id;
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
      'actorName', coalesce(actor_name, 'Dirty Turf Academy'),
      'communityName', coalesce(community_name, '7 Figure Turf Cleaning')
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

create or replace function private.record_academy_mentions(
  p_community_id uuid,
  p_actor_member_id uuid,
  p_post_id uuid,
  p_comment_id uuid,
  p_member_ids uuid[]
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.academy_content_mentions (
    academy_community_id, actor_member_id, mentioned_member_id, post_id, comment_id
  )
  select p_community_id, p_actor_member_id, member.id, p_post_id, p_comment_id
  from unnest(coalesce(p_member_ids, '{}'::uuid[])) requested(id)
  join public.academy_members member on member.id = requested.id
    and member.academy_community_id = p_community_id
    and member.status = 'active'
  where member.id <> p_actor_member_id
  on conflict do nothing;
$$;

revoke all on function private.record_academy_mentions(uuid, uuid, uuid, uuid, uuid[])
  from public, anon, authenticated;

drop function if exists public.create_community_post(text, text, text);
create function public.create_community_post(
  p_title text,
  p_body text,
  p_category_name text,
  p_mentioned_member_ids uuid[] default '{}'::uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_member public.academy_members%rowtype;
  target_organization_id uuid;
  target_category_id uuid;
  new_post_id uuid;
begin
  if char_length(trim(coalesce(p_title, ''))) not between 1 and 120 then
    raise exception 'Post title must be between 1 and 120 characters';
  end if;
  if char_length(trim(coalesce(p_body, ''))) not between 1 and 5000 then
    raise exception 'Post body must be between 1 and 5000 characters';
  end if;
  if char_length(trim(coalesce(p_category_name, ''))) > 80 then
    raise exception 'Post category is too long';
  end if;

  select * into target_member
  from public.academy_members
  where user_id = (select auth.uid()) and status = 'active'
  order by created_at
  limit 1;
  if target_member.id is null then raise exception 'No active Academy membership found'; end if;

  select owner_organization_id into target_organization_id
  from public.academy_communities where id = target_member.academy_community_id;
  if target_organization_id is null then raise exception 'Academy owner organization is not configured'; end if;

  select id into target_category_id
  from public.community_categories
  where academy_community_id = target_member.academy_community_id
    and lower(name) = lower(coalesce(nullif(trim(p_category_name), ''), 'General'))
  order by sort_order
  limit 1;

  insert into public.community_posts (
    organization_id, author_id, academy_community_id, academy_author_id,
    category_id, title, body, status
  ) values (
    target_organization_id, (select auth.uid()), target_member.academy_community_id,
    target_member.id, target_category_id, trim(p_title), trim(p_body), 'published'
  ) returning id into new_post_id;

  perform private.record_academy_mentions(
    target_member.academy_community_id, target_member.id, new_post_id, null,
    p_mentioned_member_ids
  );
  return new_post_id;
end;
$$;

drop function if exists public.create_academy_comment(uuid, text);
create function public.create_academy_comment(
  p_post_id uuid,
  p_body text,
  p_parent_id uuid default null,
  p_mentioned_member_ids uuid[] default '{}'::uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_member public.academy_members%rowtype;
  target_post public.community_posts%rowtype;
  new_comment_id uuid;
begin
  if char_length(trim(coalesce(p_body, ''))) not between 1 and 3000 then
    raise exception 'Comment body must be between 1 and 3000 characters';
  end if;

  select * into target_post from public.community_posts where id = p_post_id;
  if target_post.id is null or target_post.academy_community_id is null then raise exception 'Academy post not found'; end if;
  if p_parent_id is not null and not exists (
    select 1 from public.community_comments
    where id = p_parent_id and post_id = p_post_id
  ) then
    raise exception 'Reply target is not part of this discussion';
  end if;

  select * into target_member
  from public.academy_members
  where user_id = (select auth.uid())
    and academy_community_id = target_post.academy_community_id
    and status = 'active'
  limit 1;
  if target_member.id is null then raise exception 'No active Academy membership found'; end if;

  insert into public.community_comments (
    organization_id, post_id, author_id, academy_community_id,
    academy_author_id, parent_id, body
  ) values (
    target_post.organization_id, target_post.id, (select auth.uid()),
    target_post.academy_community_id, target_member.id, p_parent_id, trim(p_body)
  ) returning id into new_comment_id;

  perform private.record_academy_mentions(
    target_member.academy_community_id, target_member.id, null, new_comment_id,
    p_mentioned_member_ids
  );
  return new_comment_id;
end;
$$;

create or replace function public.toggle_academy_comment_reaction(p_comment_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  target_member_id uuid;
begin
  select member.id into target_member_id
  from public.academy_members member
  join public.community_comments comment on comment.id = p_comment_id
    and comment.academy_community_id = member.academy_community_id
  where member.user_id = (select auth.uid()) and member.status = 'active'
  limit 1;
  if target_member_id is null then raise exception 'Comment is not available'; end if;

  if exists (
    select 1 from public.academy_comment_reactions
    where comment_id = p_comment_id and academy_member_id = target_member_id
  ) then
    delete from public.academy_comment_reactions
    where comment_id = p_comment_id and academy_member_id = target_member_id;
    return false;
  end if;
  insert into public.academy_comment_reactions (comment_id, academy_member_id)
  values (p_comment_id, target_member_id);
  return true;
end;
$$;

revoke all on function public.create_community_post(text, text, text, uuid[]) from public, anon;
revoke all on function public.create_academy_comment(uuid, text, uuid, uuid[]) from public, anon;
revoke all on function public.toggle_academy_comment_reaction(uuid) from public, anon;
grant execute on function public.create_community_post(text, text, text, uuid[]) to authenticated;
grant execute on function public.create_academy_comment(uuid, text, uuid, uuid[]) to authenticated;
grant execute on function public.toggle_academy_comment_reaction(uuid) to authenticated;

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
      'replies', now(), jsonb_build_object('commentId', new.id), true
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
        'replies', now(), jsonb_build_object('commentId', new.id), true
      );
    end if;
  end if;
  return new;
end;
$$;

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

create trigger academy_post_notification
  after insert on public.community_posts
  for each row execute function private.notify_academy_post_created();

create or replace function private.notify_academy_post_reaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  post_row public.community_posts%rowtype;
  actor_name text;
begin
  select * into post_row from public.community_posts where id = new.post_id;
  if post_row.academy_community_id is null or post_row.academy_author_id is null then return new; end if;
  select coalesce(nullif(display_name, ''), 'A community member') into actor_name
  from public.academy_members where id = new.academy_member_id;
  perform private.queue_academy_notification(
    post_row.academy_community_id, post_row.organization_id, post_row.academy_author_id,
    new.academy_member_id, 'reaction', 'post_reaction',
    actor_name || ' liked your post', post_row.title,
    'post', post_row.id,
    'post-reaction:' || post_row.id || ':' || new.academy_member_id,
    'reactions', now(), '{}'::jsonb, true
  );
  return new;
end;
$$;

create trigger academy_post_reaction_notification
  after insert on public.academy_post_reactions
  for each row execute function private.notify_academy_post_reaction();

create or replace function private.notify_academy_comment_reaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  comment_row public.community_comments%rowtype;
  post_title text;
  actor_name text;
begin
  select * into comment_row from public.community_comments where id = new.comment_id;
  if comment_row.academy_community_id is null or comment_row.academy_author_id is null then return new; end if;
  select title into post_title from public.community_posts where id = comment_row.post_id;
  select coalesce(nullif(display_name, ''), 'A community member') into actor_name
  from public.academy_members where id = new.academy_member_id;
  perform private.queue_academy_notification(
    comment_row.academy_community_id, comment_row.organization_id, comment_row.academy_author_id,
    new.academy_member_id, 'reaction', 'comment_reaction',
    actor_name || ' liked your comment', coalesce(post_title, 'Community discussion'),
    'post', comment_row.post_id,
    'comment-reaction:' || comment_row.id || ':' || new.academy_member_id,
    'reactions', now(), jsonb_build_object('commentId', comment_row.id), true
  );
  return new;
end;
$$;

create trigger academy_comment_reaction_notification
  after insert on public.academy_comment_reactions
  for each row execute function private.notify_academy_comment_reaction();

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
begin
  if new.post_id is not null then
    select id, title, organization_id into target_post_id, target_title, target_organization_id
    from public.community_posts where id = new.post_id;
  else
    select post.id, post.title, post.organization_id
    into target_post_id, target_title, target_organization_id
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
    'mentions', now(), jsonb_build_object('commentId', new.comment_id), true
  );
  return new;
end;
$$;

create trigger academy_mention_notification
  after insert on public.academy_content_mentions
  for each row execute function private.notify_academy_mention();

create or replace function private.notify_academy_event_published()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient record;
begin
  if new.academy_community_id is null or new.source_import_batch_id is not null or new.status <> 'published' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'published' then return new; end if;
  for recipient in
    select id from public.academy_members
    where academy_community_id = new.academy_community_id and status = 'active'
  loop
    perform private.queue_academy_notification(
      new.academy_community_id, new.organization_id, recipient.id, null,
      'event', 'new_event', 'New Academy event', new.title,
      'event', new.id, 'event:' || new.id || ':published:' || recipient.id,
      'event_reminders', now(), jsonb_build_object(
        'startsAt', new.starts_at, 'endsAt', new.ends_at,
        'description', left(new.description, 280)
      ), true
    );
  end loop;
  return new;
end;
$$;

create trigger academy_event_published_notification
  after insert or update of status on public.academy_events
  for each row execute function private.notify_academy_event_published();

create or replace function private.notify_academy_course_published()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient record;
begin
  if new.academy_community_id is null or new.source_import_batch_id is not null or new.status <> 'published' then
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

create trigger academy_course_published_notification
  after insert or update of status on public.courses
  for each row execute function private.notify_academy_course_published();

create or replace function private.notify_academy_access_granted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  community public.academy_communities%rowtype;
  course_title text;
begin
  if new.status <> 'active' or new.source_type = 'import' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'active' then return new; end if;

  select * into community
  from public.academy_communities
  where id = new.academy_community_id;
  if community.id is null or community.owner_organization_id is null then return new; end if;

  if new.course_id is null then
    perform private.queue_academy_notification(
      community.id, community.owner_organization_id, new.academy_member_id, null,
      'admin', 'welcome', 'Welcome to ' || community.name,
      'Your Academy account and community are ready.',
      'community', community.id,
      'welcome:' || community.id || ':' || new.academy_member_id || ':v1',
      'admin_announcements', now(), '{}'::jsonb, true
    );
  else
    select title into course_title from public.courses where id = new.course_id;
    perform private.queue_academy_notification(
      community.id, community.owner_organization_id, new.academy_member_id, null,
      'course', 'course_unlocked', 'Course unlocked', coalesce(course_title, 'Academy course'),
      'course', new.course_id,
      'course-unlocked:' || new.course_id || ':' || new.academy_member_id,
      'course_updates', now(), '{}'::jsonb, true
    );
  end if;
  return new;
end;
$$;

create trigger academy_access_grant_notification
  after insert or update of status on public.academy_access_grants
  for each row execute function private.notify_academy_access_granted();

create or replace function public.queue_academy_welcome_emails(p_community_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  community public.academy_communities%rowtype;
  recipient record;
  queued integer := 0;
begin
  if not (select private.can_manage_academy(p_community_id)) then
    raise exception 'Academy administrator access required' using errcode = '42501';
  end if;
  select * into community from public.academy_communities where id = p_community_id;
  if community.id is null or community.owner_organization_id is null then
    raise exception 'Academy community is not configured';
  end if;

  for recipient in
    select id from public.academy_members
    where academy_community_id = p_community_id and status = 'active'
  loop
    perform private.queue_academy_notification(
      p_community_id, community.owner_organization_id, recipient.id, null,
      'admin', 'welcome', 'Welcome to ' || community.name,
      'Your Academy account and community are ready.',
      'community', community.id,
      'welcome:' || p_community_id || ':' || recipient.id || ':v1',
      'admin_announcements', now(), '{}'::jsonb, true
    );
    if found then queued := queued + 1; end if;
  end loop;
  return queued;
end;
$$;

revoke all on function public.queue_academy_welcome_emails(uuid) from public, anon;
grant execute on function public.queue_academy_welcome_emails(uuid) to authenticated;

create or replace function public.queue_academy_scheduled_notifications(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  reminder record;
  digest record;
  reminder_count integer := 0;
  digest_count integer := 0;
  week_key text := to_char(date_trunc('week', p_now), 'YYYY-MM-DD');
begin
  for reminder in
    select event.id event_id, event.academy_community_id, event.organization_id,
      event.title, event.starts_at, rsvp.academy_member_id
    from public.academy_events event
    join public.academy_member_event_rsvps rsvp on rsvp.event_id = event.id
    where event.status = 'published'
      and event.starts_at > p_now + interval '23 hours'
      and event.starts_at <= p_now + interval '25 hours'
      and rsvp.status in ('going', 'interested')
  loop
    perform private.queue_academy_notification(
      reminder.academy_community_id, reminder.organization_id,
      reminder.academy_member_id, null, 'event', 'event_reminder',
      reminder.title || ' starts tomorrow', 'You are registered for this Academy event.',
      'event', reminder.event_id,
      'event:' || reminder.event_id || ':24h:' || reminder.academy_member_id,
      'event_reminders', p_now, jsonb_build_object('startsAt', reminder.starts_at), true
    );
    reminder_count := reminder_count + 1;
  end loop;

  if extract(isodow from p_now) = 1 then
    for digest in
      select community.id community_id, community.owner_organization_id organization_id,
        member.id member_id,
        (select count(*) from public.community_posts post
         where post.academy_community_id = community.id
           and post.status = 'published' and post.created_at >= p_now - interval '7 days') post_count
      from public.academy_communities community
      join public.academy_members member on member.academy_community_id = community.id
        and member.status = 'active'
      where community.owner_organization_id is not null
    loop
      if digest.post_count > 0 then
        perform private.queue_academy_notification(
          digest.community_id, digest.organization_id, digest.member_id, null,
          'admin', 'weekly_digest', 'Your week in the Dirty Turf community',
          digest.post_count || ' new discussion' || case when digest.post_count = 1 then '' else 's' end || ' this week.',
          'community', digest.community_id,
          'digest:' || digest.community_id || ':' || digest.member_id || ':' || week_key,
          'weekly_digest', p_now, jsonb_build_object('postCount', digest.post_count), false
        );
        digest_count := digest_count + 1;
      end if;
    end loop;
  end if;

  return jsonb_build_object('eventReminders', reminder_count, 'weeklyDigests', digest_count);
end;
$$;

revoke all on function public.queue_academy_scheduled_notifications(timestamptz)
  from public, anon, authenticated;
grant execute on function public.queue_academy_scheduled_notifications(timestamptz)
  to service_role;

create or replace function public.claim_academy_email_deliveries(
  p_limit integer,
  p_lock_token uuid
)
returns setof public.academy_email_deliveries
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.academy_email_deliveries
  set status = 'pending', lock_token = null, locked_at = null,
      last_error = coalesce(last_error, 'Recovered stale delivery lock')
  where status = 'processing' and locked_at < now() - interval '15 minutes';

  return query
  update public.academy_email_deliveries delivery
  set status = 'processing', lock_token = p_lock_token, locked_at = now(),
      attempt_count = delivery.attempt_count + 1
  where delivery.id in (
    select candidate.id
    from public.academy_email_deliveries candidate
    where candidate.status = 'pending'
      and candidate.send_after <= now()
      and candidate.attempt_count < candidate.max_attempts
    order by candidate.send_after, candidate.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 25), 100))
  )
  returning delivery.*;
end;
$$;

create or replace function public.complete_academy_email_delivery(
  p_delivery_id uuid,
  p_lock_token uuid,
  p_provider_message_id text
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with completed as (
    update public.academy_email_deliveries
    set status = 'sent', sent_at = now(), provider_message_id = p_provider_message_id,
        last_error = null, lock_token = null, locked_at = null
    where id = p_delivery_id and status = 'processing' and lock_token = p_lock_token
    returning 1
  )
  select exists (select 1 from completed);
$$;

create or replace function public.fail_academy_email_delivery(
  p_delivery_id uuid,
  p_lock_token uuid,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed boolean;
begin
  with failed as (
    update public.academy_email_deliveries
    set status = case when attempt_count >= max_attempts then 'failed'::public.academy_email_delivery_status else 'pending'::public.academy_email_delivery_status end,
        send_after = case when attempt_count >= max_attempts then send_after else now() + make_interval(mins => least(60, (2 ^ least(attempt_count, 5))::integer)) end,
        last_error = left(coalesce(p_error, 'Unknown delivery error'), 1000),
        lock_token = null, locked_at = null
    where id = p_delivery_id and status = 'processing' and lock_token = p_lock_token
    returning 1
  ) select exists (select 1 from failed) into changed;
  return changed;
end;
$$;

revoke all on function public.claim_academy_email_deliveries(integer, uuid) from public, anon, authenticated;
revoke all on function public.complete_academy_email_delivery(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.fail_academy_email_delivery(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_academy_email_deliveries(integer, uuid) to service_role;
grant execute on function public.complete_academy_email_delivery(uuid, uuid, text) to service_role;
grant execute on function public.fail_academy_email_delivery(uuid, uuid, text) to service_role;

revoke all on function public.notify_post_author_on_comment() from public, anon, authenticated;
revoke all on function private.notify_academy_post_created() from public, anon, authenticated;
revoke all on function private.notify_academy_post_reaction() from public, anon, authenticated;
revoke all on function private.notify_academy_comment_reaction() from public, anon, authenticated;
revoke all on function private.notify_academy_mention() from public, anon, authenticated;
revoke all on function private.notify_academy_event_published() from public, anon, authenticated;
revoke all on function private.notify_academy_course_published() from public, anon, authenticated;
revoke all on function private.notify_academy_access_granted() from public, anon, authenticated;
