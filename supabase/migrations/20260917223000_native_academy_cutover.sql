-- Native Academy cutover: entitlements, private assets, member invitations,
-- member-facing views, and write RPCs for the in-app experience.

alter table public.courses
  add column if not exists instructor_name text not null default 'Dirty Turf Academy';

alter table public.course_modules
  add column if not exists group_title text;

alter table public.academy_events
  add column if not exists host_name text not null default 'Dirty Turf Academy';

alter table public.source_import_records
  drop constraint if exists source_import_records_record_type_check;
alter table public.source_import_records
  add constraint source_import_records_record_type_check check (record_type in (
    'community', 'channel', 'member', 'post', 'comment', 'reaction',
    'course', 'module', 'lesson', 'progress', 'enrollment', 'certificate',
    'event', 'rsvp', 'offer', 'asset', 'invite', 'leaderboard'
  ));

create table public.course_enrollments (
  id uuid primary key default gen_random_uuid(),
  academy_community_id uuid not null references public.academy_communities(id) on delete cascade,
  academy_member_id uuid not null references public.academy_members(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  status text not null default 'active' check (status in ('pending', 'active', 'completed', 'cancelled', 'expired')),
  source_provider text,
  external_id text,
  enrolled_at timestamptz,
  completed_at timestamptz,
  access_expires_at timestamptz,
  source_updated_at timestamptz,
  source_import_batch_id uuid references public.source_import_batches(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academy_member_id, course_id)
);

create table public.academy_assets (
  id uuid primary key default gen_random_uuid(),
  academy_community_id uuid not null references public.academy_communities(id) on delete cascade,
  course_id uuid references public.courses(id) on delete cascade,
  lesson_id uuid references public.course_lessons(id) on delete cascade,
  title text not null,
  asset_type text not null check (asset_type in ('video', 'audio', 'image', 'pdf', 'document', 'archive', 'link', 'other')),
  storage_bucket text,
  storage_path text,
  original_url text,
  mime_type text,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  content_hash text check (content_hash is null or char_length(content_hash) = 64),
  source_provider text,
  external_id text,
  metadata jsonb not null default '{}'::jsonb,
  source_import_batch_id uuid references public.source_import_batches(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (storage_path is not null or original_url is not null)
);

create table public.academy_member_invites (
  id uuid primary key default gen_random_uuid(),
  academy_community_id uuid not null references public.academy_communities(id) on delete cascade,
  academy_member_id uuid not null references public.academy_members(id) on delete cascade,
  email text not null check (position('@' in email) > 1),
  status text not null default 'pending' check (status in ('pending', 'sent', 'accepted', 'failed', 'cancelled')),
  invited_user_id uuid,
  source_provider text not null default 'highlevel',
  external_contact_id text,
  invite_sent_at timestamptz,
  accepted_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academy_member_id)
);

create table public.academy_post_reactions (
  post_id uuid not null references public.community_posts(id) on delete cascade,
  academy_member_id uuid not null references public.academy_members(id) on delete cascade,
  reaction text not null default 'like' check (reaction in ('like')),
  source_provider text,
  external_id text,
  created_at timestamptz not null default now(),
  primary key (post_id, academy_member_id, reaction)
);

create table public.academy_comment_reactions (
  comment_id uuid not null references public.community_comments(id) on delete cascade,
  academy_member_id uuid not null references public.academy_members(id) on delete cascade,
  reaction text not null default 'like' check (reaction in ('like')),
  source_provider text,
  external_id text,
  created_at timestamptz not null default now(),
  primary key (comment_id, academy_member_id, reaction)
);

create table public.academy_post_bookmarks (
  post_id uuid not null references public.community_posts(id) on delete cascade,
  academy_member_id uuid not null references public.academy_members(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, academy_member_id)
);

create unique index academy_member_invites_email_idx
  on public.academy_member_invites(academy_community_id, lower(email));
create unique index course_enrollments_external_idx
  on public.course_enrollments(academy_community_id, source_provider, external_id)
  where external_id is not null;
create unique index academy_assets_external_idx
  on public.academy_assets(academy_community_id, source_provider, external_id)
  where external_id is not null;
create unique index academy_post_reactions_external_idx
  on public.academy_post_reactions(source_provider, external_id)
  where external_id is not null;
create unique index academy_comment_reactions_external_idx
  on public.academy_comment_reactions(source_provider, external_id)
  where external_id is not null;
create index course_enrollments_member_idx
  on public.course_enrollments(academy_member_id, status);
create index academy_assets_lesson_idx
  on public.academy_assets(lesson_id, asset_type);

create trigger course_enrollments_updated_at before update on public.course_enrollments
  for each row execute function public.set_updated_at();
create trigger academy_assets_updated_at before update on public.academy_assets
  for each row execute function public.set_updated_at();
create trigger academy_member_invites_updated_at before update on public.academy_member_invites
  for each row execute function public.set_updated_at();

create or replace function private.can_access_course(target_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.courses c
    where c.id = target_course_id
      and (select private.can_manage_academy(c.academy_community_id))
  ) or exists (
    select 1
    from public.courses c
    join public.academy_members m
      on m.academy_community_id = c.academy_community_id
     and m.user_id = (select auth.uid())
     and m.status = 'active'
    where c.id = target_course_id
      and c.status = 'published'
      and (
        c.access_type = 'open'
        or (c.access_type = 'level' and m.level >= coalesce(c.required_level, 1))
        or exists (
          select 1 from public.course_enrollments e
          where e.course_id = c.id
            and e.academy_member_id = m.id
            and e.status in ('active', 'completed')
            and (e.access_expires_at is null or e.access_expires_at > now())
        )
      )
  );
$$;

revoke all on function private.can_access_course(uuid) from public;
grant execute on function private.can_access_course(uuid) to authenticated;

alter table public.course_enrollments enable row level security;
alter table public.academy_assets enable row level security;
alter table public.academy_member_invites enable row level security;
alter table public.academy_post_reactions enable row level security;
alter table public.academy_comment_reactions enable row level security;
alter table public.academy_post_bookmarks enable row level security;

grant select, insert, update, delete on public.course_enrollments to authenticated;
grant select, insert, update, delete on public.academy_assets to authenticated;
grant select, insert, update, delete on public.academy_member_invites to authenticated;
grant select, insert, delete on public.academy_post_reactions to authenticated;
grant select, insert, delete on public.academy_comment_reactions to authenticated;
grant select, insert, delete on public.academy_post_bookmarks to authenticated;

create policy "course_enrollments_member_select" on public.course_enrollments
  for select to authenticated
  using (
    (select private.is_academy_identity(academy_member_id))
    or (select private.can_manage_academy(academy_community_id))
  );
create policy "course_enrollments_admin_insert" on public.course_enrollments
  for insert to authenticated
  with check ((select private.can_manage_academy(academy_community_id)));
create policy "course_enrollments_admin_update" on public.course_enrollments
  for update to authenticated
  using ((select private.can_manage_academy(academy_community_id)))
  with check ((select private.can_manage_academy(academy_community_id)));
create policy "course_enrollments_admin_delete" on public.course_enrollments
  for delete to authenticated
  using ((select private.can_manage_academy(academy_community_id)));

create policy "academy_assets_member_select" on public.academy_assets
  for select to authenticated
  using (
    (course_id is not null and (select private.can_access_course(course_id)))
    or (course_id is null and (select private.is_academy_member(academy_community_id)))
    or (select private.can_manage_academy(academy_community_id))
  );
create policy "academy_assets_admin_insert" on public.academy_assets
  for insert to authenticated
  with check ((select private.can_manage_academy(academy_community_id)));
create policy "academy_assets_admin_update" on public.academy_assets
  for update to authenticated
  using ((select private.can_manage_academy(academy_community_id)))
  with check ((select private.can_manage_academy(academy_community_id)));
create policy "academy_assets_admin_delete" on public.academy_assets
  for delete to authenticated
  using ((select private.can_manage_academy(academy_community_id)));

create policy "academy_invites_admin_select" on public.academy_member_invites
  for select to authenticated
  using ((select private.can_manage_academy(academy_community_id)));
create policy "academy_invites_admin_insert" on public.academy_member_invites
  for insert to authenticated
  with check ((select private.can_manage_academy(academy_community_id)));
create policy "academy_invites_admin_update" on public.academy_member_invites
  for update to authenticated
  using ((select private.can_manage_academy(academy_community_id)))
  with check ((select private.can_manage_academy(academy_community_id)));
create policy "academy_invites_admin_delete" on public.academy_member_invites
  for delete to authenticated
  using ((select private.can_manage_academy(academy_community_id)));

create policy "academy_post_reactions_member_select" on public.academy_post_reactions
  for select to authenticated
  using (exists (
    select 1 from public.community_posts p
    where p.id = post_id and (select private.is_academy_member(p.academy_community_id))
  ));
create policy "academy_post_reactions_self_insert" on public.academy_post_reactions
  for insert to authenticated
  with check (
    (select private.is_academy_identity(academy_member_id))
    and exists (
      select 1 from public.community_posts p
      join public.academy_members m on m.id = academy_member_id
      where p.id = post_id and p.academy_community_id = m.academy_community_id
    )
  );
create policy "academy_post_reactions_self_delete" on public.academy_post_reactions
  for delete to authenticated
  using ((select private.is_academy_identity(academy_member_id)));

create policy "academy_comment_reactions_member_select" on public.academy_comment_reactions
  for select to authenticated
  using (exists (
    select 1 from public.community_comments c
    where c.id = comment_id and (select private.is_academy_member(c.academy_community_id))
  ));
create policy "academy_comment_reactions_self_insert" on public.academy_comment_reactions
  for insert to authenticated
  with check (
    (select private.is_academy_identity(academy_member_id))
    and exists (
      select 1 from public.community_comments c
      join public.academy_members m on m.id = academy_member_id
      where c.id = comment_id and c.academy_community_id = m.academy_community_id
    )
  );
create policy "academy_comment_reactions_self_delete" on public.academy_comment_reactions
  for delete to authenticated
  using ((select private.is_academy_identity(academy_member_id)));

create policy "academy_post_bookmarks_self_select" on public.academy_post_bookmarks
  for select to authenticated
  using ((select private.is_academy_identity(academy_member_id)));
create policy "academy_post_bookmarks_self_insert" on public.academy_post_bookmarks
  for insert to authenticated
  with check (
    (select private.is_academy_identity(academy_member_id))
    and exists (
      select 1 from public.community_posts p
      join public.academy_members m on m.id = academy_member_id
      where p.id = post_id and p.academy_community_id = m.academy_community_id
    )
  );
create policy "academy_post_bookmarks_self_delete" on public.academy_post_bookmarks
  for delete to authenticated
  using ((select private.is_academy_identity(academy_member_id)));

drop policy if exists "courses_academy_member_read" on public.courses;
create policy "courses_academy_member_read" on public.courses
  for select to authenticated
  using (academy_community_id is not null and (select private.can_access_course(id)));

drop policy if exists "modules_academy_member_read" on public.course_modules;
create policy "modules_academy_member_read" on public.course_modules
  for select to authenticated
  using ((select private.can_access_course(course_id)));

drop policy if exists "lessons_academy_member_read" on public.course_lessons;
create policy "lessons_academy_member_read" on public.course_lessons
  for select to authenticated
  using (exists (
    select 1 from public.course_modules m
    where m.id = module_id and (select private.can_access_course(m.course_id))
  ));

-- The earlier migrations expose a narrower community_feed shape. PostgreSQL
-- cannot use CREATE OR REPLACE VIEW when columns are inserted or reordered, so
-- rebuild it explicitly and restore the authenticated Data API grant below.
drop view if exists public.community_feed;
create view public.community_feed with (security_invoker = true) as
select
  p.id,
  p.academy_community_id,
  p.title,
  p.body,
  coalesce(nullif(pr.full_name, ''), nullif(am.display_name, ''), 'Member') as author_name,
  count(distinct c.id)::integer as reply_count,
  p.created_at,
  coalesce(cat.name, 'General') as category_name,
  p.is_pinned,
  p.media,
  (
    (select count(*) from public.community_post_reactions r where r.post_id = p.id)
    + (select count(*) from public.academy_post_reactions ar where ar.post_id = p.id)
  )::integer as like_count
from public.community_posts p
left join public.profiles pr on pr.id = p.author_id
left join public.academy_members am on am.id = p.academy_author_id
left join public.community_categories cat on cat.id = p.category_id
left join public.community_comments c on c.post_id = p.id
where p.status = 'published'
group by p.id, pr.full_name, am.display_name, cat.name;

create or replace view public.academy_comment_feed with (security_invoker = true) as
select
  c.id,
  c.academy_community_id,
  c.post_id,
  c.parent_id,
  coalesce(nullif(pr.full_name, ''), nullif(am.display_name, ''), 'Member') as author_name,
  c.body,
  c.is_answer,
  c.created_at,
  (
    (select count(*) from public.community_comment_reactions r where r.comment_id = c.id)
    + (select count(*) from public.academy_comment_reactions ar where ar.comment_id = c.id)
  )::integer as like_count
from public.community_comments c
left join public.profiles pr on pr.id = c.author_id
left join public.academy_members am on am.id = c.academy_author_id
group by c.id, pr.full_name, am.display_name;

create or replace view public.academy_event_feed with (security_invoker = true) as
select
  e.id,
  e.academy_community_id,
  e.title,
  e.description,
  e.kind,
  e.starts_at,
  e.ends_at,
  e.host_name,
  e.meeting_url,
  count(distinct r.academy_member_id)::integer as attendee_count,
  exists (
    select 1
    from public.academy_member_event_rsvps mine
    join public.academy_members member on member.id = mine.academy_member_id
    where mine.event_id = e.id and member.user_id = (select auth.uid())
  ) as is_attending
from public.academy_events e
left join public.academy_member_event_rsvps r on r.event_id = e.id
where e.status = 'published'
group by e.id;

grant select on public.community_feed, public.academy_comment_feed,
  public.academy_event_feed to authenticated;

create or replace function public.create_community_post(
  p_title text,
  p_body text,
  p_category_name text
)
returns uuid
language plpgsql
security invoker
set search_path = public
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
  return new_post_id;
end;
$$;

create or replace function public.notify_post_author_on_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  post_author uuid;
  post_title text;
begin
  select coalesce(p.author_id, am.user_id), p.title
  into post_author, post_title
  from public.community_posts p
  left join public.academy_members am on am.id = p.academy_author_id
  where p.id = new.post_id;

  if post_author is not null and post_author is distinct from new.author_id then
    insert into public.notifications (
      organization_id, recipient_id, actor_id, kind, title, detail, target_type, target_id
    ) values (
      new.organization_id, post_author, new.author_id, 'reply',
      'New reply to your discussion', post_title, 'post', new.post_id
    );
  end if;
  return new;
end;
$$;

create or replace function public.create_academy_comment(p_post_id uuid, p_body text)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  target_member public.academy_members%rowtype;
  target_post public.community_posts%rowtype;
  new_comment_id uuid;
begin
  if char_length(trim(coalesce(p_body, ''))) not between 1 and 5000 then
    raise exception 'Comment body must be between 1 and 5000 characters';
  end if;

  select * into target_post from public.community_posts where id = p_post_id;
  if target_post.id is null or target_post.academy_community_id is null then raise exception 'Academy post not found'; end if;
  select * into target_member
  from public.academy_members
  where user_id = (select auth.uid())
    and academy_community_id = target_post.academy_community_id
    and status = 'active'
  limit 1;
  if target_member.id is null then raise exception 'No active Academy membership found'; end if;

  insert into public.community_comments (
    organization_id, post_id, author_id, academy_community_id, academy_author_id, body
  ) values (
    target_post.organization_id, target_post.id, (select auth.uid()),
    target_post.academy_community_id, target_member.id, trim(p_body)
  ) returning id into new_comment_id;
  return new_comment_id;
end;
$$;

create or replace function public.set_academy_lesson_completion(p_lesson_id uuid, p_completed boolean)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  target_member_id uuid;
begin
  select m.id into target_member_id
  from public.academy_members m
  join public.course_lessons l on l.id = p_lesson_id
  join public.course_modules cm on cm.id = l.module_id
  join public.courses c on c.id = cm.course_id
  where m.user_id = (select auth.uid())
    and m.academy_community_id = c.academy_community_id
    and m.status = 'active'
    and (select private.can_access_course(c.id))
  limit 1;
  if target_member_id is null then raise exception 'Lesson is not available'; end if;

  insert into public.academy_member_lesson_progress (
    academy_member_id, lesson_id, progress_percent, completed_at
  ) values (
    target_member_id, p_lesson_id, case when p_completed then 100 else 0 end,
    case when p_completed then now() else null end
  )
  on conflict (academy_member_id, lesson_id) do update
  set progress_percent = excluded.progress_percent,
      completed_at = excluded.completed_at,
      updated_at = now();
end;
$$;

create or replace function public.toggle_academy_event_rsvp(p_event_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  target_member_id uuid;
begin
  select m.id into target_member_id
  from public.academy_members m
  join public.academy_events e on e.id = p_event_id
    and e.academy_community_id = m.academy_community_id
  where m.user_id = (select auth.uid()) and m.status = 'active'
  limit 1;
  if target_member_id is null then raise exception 'Event is not available'; end if;

  if exists (
    select 1 from public.academy_member_event_rsvps
    where event_id = p_event_id and academy_member_id = target_member_id
  ) then
    delete from public.academy_member_event_rsvps
    where event_id = p_event_id and academy_member_id = target_member_id;
    return false;
  end if;
  insert into public.academy_member_event_rsvps (event_id, academy_member_id)
  values (p_event_id, target_member_id);
  return true;
end;
$$;

create or replace function public.toggle_academy_post_reaction(p_post_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  target_member_id uuid;
begin
  select m.id into target_member_id
  from public.academy_members m
  join public.community_posts p on p.id = p_post_id
    and p.academy_community_id = m.academy_community_id
  where m.user_id = (select auth.uid()) and m.status = 'active'
  limit 1;
  if target_member_id is null then raise exception 'Post is not available'; end if;

  if exists (
    select 1 from public.academy_post_reactions
    where post_id = p_post_id and academy_member_id = target_member_id
  ) then
    delete from public.academy_post_reactions
    where post_id = p_post_id and academy_member_id = target_member_id;
    return false;
  end if;
  insert into public.academy_post_reactions (post_id, academy_member_id)
  values (p_post_id, target_member_id);
  return true;
end;
$$;

create or replace function public.toggle_academy_post_bookmark(p_post_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  target_member_id uuid;
begin
  select m.id into target_member_id
  from public.academy_members m
  join public.community_posts p on p.id = p_post_id
    and p.academy_community_id = m.academy_community_id
  where m.user_id = (select auth.uid()) and m.status = 'active'
  limit 1;
  if target_member_id is null then raise exception 'Post is not available'; end if;

  if exists (
    select 1 from public.academy_post_bookmarks
    where post_id = p_post_id and academy_member_id = target_member_id
  ) then
    delete from public.academy_post_bookmarks
    where post_id = p_post_id and academy_member_id = target_member_id;
    return false;
  end if;
  insert into public.academy_post_bookmarks (post_id, academy_member_id)
  values (p_post_id, target_member_id);
  return true;
end;
$$;

revoke all on function public.create_community_post(text, text, text) from public, anon;
revoke all on function public.create_academy_comment(uuid, text) from public, anon;
revoke all on function public.set_academy_lesson_completion(uuid, boolean) from public, anon;
revoke all on function public.toggle_academy_event_rsvp(uuid) from public, anon;
revoke all on function public.toggle_academy_post_reaction(uuid) from public, anon;
revoke all on function public.toggle_academy_post_bookmark(uuid) from public, anon;
revoke all on function public.notify_post_author_on_comment() from public, anon, authenticated;
grant execute on function public.create_community_post(text, text, text) to authenticated;
grant execute on function public.create_academy_comment(uuid, text) to authenticated;
grant execute on function public.set_academy_lesson_completion(uuid, boolean) to authenticated;
grant execute on function public.toggle_academy_event_rsvp(uuid) to authenticated;
grant execute on function public.toggle_academy_post_reaction(uuid) to authenticated;
grant execute on function public.toggle_academy_post_bookmark(uuid) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('academy-assets', 'academy-assets', false, 1073741824)
on conflict (id) do update
set public = false, file_size_limit = excluded.file_size_limit;

create policy "academy_storage_member_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'academy-assets'
    and exists (
      select 1 from public.academy_members m
      where m.user_id = (select auth.uid())
        and m.status = 'active'
        and m.academy_community_id::text = (storage.foldername(name))[1]
        and (
          (storage.foldername(name))[2] = 'shared'
          or exists (
            select 1 from public.courses c
            where c.id::text = (storage.foldername(name))[2]
              and (select private.can_access_course(c.id))
          )
        )
    )
  );
create policy "academy_storage_admin_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'academy-assets'
    and exists (
      select 1 from public.academy_communities c
      where c.id::text = (storage.foldername(name))[1]
        and (select private.can_manage_academy(c.id))
    )
  );
create policy "academy_storage_admin_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'academy-assets'
    and exists (
      select 1 from public.academy_communities c
      where c.id::text = (storage.foldername(name))[1]
        and (select private.can_manage_academy(c.id))
    )
  )
  with check (
    bucket_id = 'academy-assets'
    and exists (
      select 1 from public.academy_communities c
      where c.id::text = (storage.foldername(name))[1]
        and (select private.can_manage_academy(c.id))
    )
  );
create policy "academy_storage_admin_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'academy-assets'
    and exists (
      select 1 from public.academy_communities c
      where c.id::text = (storage.foldername(name))[1]
        and (select private.can_manage_academy(c.id))
    )
  );

revoke all on public.academy_member_invites from anon;
revoke all on public.course_enrollments from anon;
revoke all on public.academy_assets from anon;
revoke all on public.academy_post_reactions from anon;
revoke all on public.academy_comment_reactions from anon;
revoke all on public.academy_post_bookmarks from anon;
