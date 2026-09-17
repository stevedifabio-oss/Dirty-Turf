create type public.academy_role as enum ('owner', 'admin', 'moderator', 'member');
create type public.import_status as enum ('planned', 'capturing', 'validated', 'imported', 'failed');

create table public.academy_communities (
  id uuid primary key default gen_random_uuid(),
  owner_organization_id uuid references public.organizations(id) on delete set null,
  name text not null,
  slug text not null unique,
  external_provider text not null default 'highlevel',
  external_group_id text,
  portal_url text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index academy_communities_external_idx
  on public.academy_communities(external_provider, external_group_id)
  where external_group_id is not null;

create table public.academy_members (
  id uuid primary key default gen_random_uuid(),
  academy_community_id uuid not null references public.academy_communities(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  role public.academy_role not null default 'member',
  status public.membership_status not null default 'active',
  display_name text not null default '',
  avatar_url text,
  company_name text not null default '',
  location text not null default '',
  points integer not null default 0 check (points >= 0),
  level integer not null default 1 check (level >= 1),
  joined_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academy_community_id, id)
);

create unique index academy_members_user_idx
  on public.academy_members(academy_community_id, user_id)
  where user_id is not null;
create index academy_members_directory_idx
  on public.academy_members(academy_community_id, status, display_name);

create table public.academy_member_links (
  academy_community_id uuid not null,
  academy_member_id uuid primary key,
  external_provider text not null default 'highlevel',
  external_contact_id text,
  external_member_id text,
  imported_at timestamptz,
  updated_at timestamptz not null default now(),
  check (external_contact_id is not null or external_member_id is not null),
  foreign key (academy_community_id, academy_member_id)
    references public.academy_members(academy_community_id, id) on delete cascade
);

create unique index academy_member_links_contact_idx
  on public.academy_member_links(academy_community_id, external_provider, external_contact_id)
  where external_contact_id is not null;
create unique index academy_member_links_member_idx
  on public.academy_member_links(academy_community_id, external_provider, external_member_id)
  where external_member_id is not null;

create table public.academy_member_follows (
  academy_community_id uuid not null references public.academy_communities(id) on delete cascade,
  follower_member_id uuid not null,
  followed_member_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (academy_community_id, follower_member_id, followed_member_id),
  check (follower_member_id <> followed_member_id),
  foreign key (academy_community_id, follower_member_id)
    references public.academy_members(academy_community_id, id) on delete cascade,
  foreign key (academy_community_id, followed_member_id)
    references public.academy_members(academy_community_id, id) on delete cascade
);

create table public.source_import_batches (
  id uuid primary key default gen_random_uuid(),
  academy_community_id uuid not null references public.academy_communities(id) on delete cascade,
  provider text not null default 'highlevel',
  status public.import_status not null default 'planned',
  archive_path text,
  manifest jsonb not null default '{}'::jsonb,
  record_counts jsonb not null default '{}'::jsonb,
  requested_by uuid references public.profiles(id) on delete set null,
  source_exported_at timestamptz,
  validated_at timestamptz,
  imported_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academy_community_id, id)
);

create table public.source_import_records (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  academy_community_id uuid not null references public.academy_communities(id) on delete cascade,
  record_type text not null check (record_type in (
    'community', 'channel', 'member', 'post', 'comment', 'reaction',
    'course', 'module', 'lesson', 'progress', 'event', 'rsvp', 'offer', 'asset'
  )),
  external_id text not null,
  parent_external_id text,
  source_url text,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  content_hash text not null check (char_length(content_hash) = 64),
  payload jsonb not null,
  imported_table text,
  imported_id uuid,
  captured_at timestamptz not null default now(),
  unique (batch_id, record_type, external_id),
  foreign key (academy_community_id, batch_id)
    references public.source_import_batches(academy_community_id, id) on delete cascade
);

create index source_import_records_lookup_idx
  on public.source_import_records(academy_community_id, record_type, external_id);
create index source_import_records_hash_idx
  on public.source_import_records(academy_community_id, content_hash);

alter table public.community_categories
  add column academy_community_id uuid references public.academy_communities(id) on delete cascade,
  add column external_id text,
  add column source_import_batch_id uuid references public.source_import_batches(id) on delete set null;

alter table public.community_posts
  alter column author_id drop not null,
  add column academy_community_id uuid references public.academy_communities(id) on delete cascade,
  add column academy_author_id uuid references public.academy_members(id) on delete set null,
  add column external_id text,
  add column source_provider text,
  add column source_url text,
  add column source_created_at timestamptz,
  add column source_updated_at timestamptz,
  add column source_import_batch_id uuid references public.source_import_batches(id) on delete set null,
  add constraint community_posts_author_check check (author_id is not null or academy_author_id is not null);

alter table public.community_comments
  alter column author_id drop not null,
  add column academy_community_id uuid references public.academy_communities(id) on delete cascade,
  add column academy_author_id uuid references public.academy_members(id) on delete set null,
  add column external_id text,
  add column source_provider text,
  add column source_url text,
  add column source_created_at timestamptz,
  add column source_updated_at timestamptz,
  add column source_import_batch_id uuid references public.source_import_batches(id) on delete set null,
  add constraint community_comments_author_check check (author_id is not null or academy_author_id is not null);

alter table public.courses
  add column academy_community_id uuid references public.academy_communities(id) on delete cascade,
  add column source_provider text,
  add column source_url text,
  add column source_updated_at timestamptz,
  add column source_import_batch_id uuid references public.source_import_batches(id) on delete set null;

alter table public.course_modules
  add column external_id text,
  add column source_updated_at timestamptz,
  add column source_import_batch_id uuid references public.source_import_batches(id) on delete set null;

alter table public.course_lessons
  add column source_url text,
  add column source_updated_at timestamptz,
  add column source_import_batch_id uuid references public.source_import_batches(id) on delete set null;

alter table public.academy_events
  add column academy_community_id uuid references public.academy_communities(id) on delete cascade,
  add column external_id text,
  add column source_provider text,
  add column source_url text,
  add column source_updated_at timestamptz,
  add column source_import_batch_id uuid references public.source_import_batches(id) on delete set null;

create unique index community_categories_external_idx
  on public.community_categories(academy_community_id, external_id)
  where academy_community_id is not null and external_id is not null;
create unique index community_posts_external_idx
  on public.community_posts(academy_community_id, source_provider, external_id)
  where academy_community_id is not null and external_id is not null;
create unique index community_comments_external_idx
  on public.community_comments(academy_community_id, source_provider, external_id)
  where academy_community_id is not null and external_id is not null;
create unique index courses_academy_external_idx
  on public.courses(academy_community_id, external_id)
  where academy_community_id is not null and external_id is not null;
create unique index modules_external_idx
  on public.course_modules(course_id, external_id)
  where external_id is not null;
create unique index academy_events_external_idx
  on public.academy_events(academy_community_id, external_id)
  where academy_community_id is not null and external_id is not null;

create table public.academy_member_lesson_progress (
  academy_member_id uuid not null references public.academy_members(id) on delete cascade,
  lesson_id uuid not null references public.course_lessons(id) on delete cascade,
  progress_percent integer not null default 0 check (progress_percent between 0 and 100),
  position_seconds integer not null default 0 check (position_seconds >= 0),
  completed_at timestamptz,
  source_updated_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (academy_member_id, lesson_id)
);

create table public.academy_member_event_rsvps (
  event_id uuid not null references public.academy_events(id) on delete cascade,
  academy_member_id uuid not null references public.academy_members(id) on delete cascade,
  status text not null default 'going' check (status in ('going', 'interested')),
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (event_id, academy_member_id)
);

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create or replace function private.is_academy_member(target_community_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.academy_members m
    where m.academy_community_id = target_community_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
  );
$$;

create or replace function private.can_manage_academy(target_community_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.academy_members m
    where m.academy_community_id = target_community_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.role in ('owner', 'admin')
  ) or exists (
    select 1
    from public.academy_communities c
    join public.organization_members om on om.organization_id = c.owner_organization_id
    where c.id = target_community_id
      and om.user_id = (select auth.uid())
      and om.role in ('owner', 'admin')
  );
$$;

create or replace function private.is_academy_identity(target_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.academy_members m
    where m.id = target_member_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
  );
$$;

create or replace function private.can_access_academy_lesson_progress(target_member_id uuid, target_lesson_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.academy_members m
    join public.course_lessons l on l.id = target_lesson_id
    join public.course_modules cm on cm.id = l.module_id
    join public.courses c on c.id = cm.course_id
    where m.id = target_member_id
      and m.status = 'active'
      and c.academy_community_id = m.academy_community_id
      and (
        m.user_id = (select auth.uid())
        or (select private.can_manage_academy(m.academy_community_id))
      )
  );
$$;

create or replace function private.can_access_academy_event_rsvp(target_member_id uuid, target_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.academy_members m
    join public.academy_events e on e.id = target_event_id
    where m.id = target_member_id
      and m.status = 'active'
      and e.academy_community_id = m.academy_community_id
      and (
        m.user_id = (select auth.uid())
        or (select private.can_manage_academy(m.academy_community_id))
      )
  );
$$;

create or replace function private.shares_academy_with(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.academy_members mine
    join public.academy_members theirs
      on theirs.academy_community_id = mine.academy_community_id
    where mine.user_id = (select auth.uid())
      and mine.status = 'active'
      and theirs.user_id = target_user_id
      and theirs.status = 'active'
  );
$$;

revoke all on function private.is_academy_member(uuid) from public;
revoke all on function private.can_manage_academy(uuid) from public;
revoke all on function private.is_academy_identity(uuid) from public;
revoke all on function private.can_access_academy_lesson_progress(uuid, uuid) from public;
revoke all on function private.can_access_academy_event_rsvp(uuid, uuid) from public;
revoke all on function private.shares_academy_with(uuid) from public;
grant execute on function private.is_academy_member(uuid) to authenticated;
grant execute on function private.can_manage_academy(uuid) to authenticated;
grant execute on function private.is_academy_identity(uuid) to authenticated;
grant execute on function private.can_access_academy_lesson_progress(uuid, uuid) to authenticated;
grant execute on function private.can_access_academy_event_rsvp(uuid, uuid) to authenticated;
grant execute on function private.shares_academy_with(uuid) to authenticated;

create trigger academy_communities_updated_at before update on public.academy_communities for each row execute function public.set_updated_at();
create trigger academy_members_updated_at before update on public.academy_members for each row execute function public.set_updated_at();
create trigger academy_member_links_updated_at before update on public.academy_member_links for each row execute function public.set_updated_at();
create trigger source_import_batches_updated_at before update on public.source_import_batches for each row execute function public.set_updated_at();
create trigger academy_progress_updated_at before update on public.academy_member_lesson_progress for each row execute function public.set_updated_at();

alter table public.academy_communities enable row level security;
alter table public.academy_members enable row level security;
alter table public.academy_member_links enable row level security;
alter table public.academy_member_follows enable row level security;
alter table public.source_import_batches enable row level security;
alter table public.source_import_records enable row level security;
alter table public.academy_member_lesson_progress enable row level security;
alter table public.academy_member_event_rsvps enable row level security;

grant select, insert, update, delete on public.academy_communities to authenticated;
grant select, insert, update, delete on public.academy_members to authenticated;
grant select, insert, update, delete on public.academy_member_links to authenticated;
grant select, insert, update, delete on public.academy_member_follows to authenticated;
grant select, insert, update, delete on public.source_import_batches to authenticated;
grant select, insert, update, delete on public.source_import_records to authenticated;
grant select, insert, update, delete on public.academy_member_lesson_progress to authenticated;
grant select, insert, update, delete on public.academy_member_event_rsvps to authenticated;

create policy "academy_communities_member_select" on public.academy_communities
  for select to authenticated
  using ((select private.is_academy_member(id)) or (select private.can_manage_academy(id)));
create policy "academy_communities_owner_insert" on public.academy_communities
  for insert to authenticated
  with check (owner_organization_id is not null and public.is_organization_admin(owner_organization_id));
create policy "academy_communities_admin_update" on public.academy_communities
  for update to authenticated
  using ((select private.can_manage_academy(id)))
  with check ((select private.can_manage_academy(id)));
create policy "academy_communities_admin_delete" on public.academy_communities
  for delete to authenticated
  using ((select private.can_manage_academy(id)));

create policy "academy_members_directory_select" on public.academy_members
  for select to authenticated
  using ((select private.is_academy_member(academy_community_id)) or (select private.can_manage_academy(academy_community_id)));
create policy "academy_members_admin_insert" on public.academy_members
  for insert to authenticated
  with check ((select private.can_manage_academy(academy_community_id)));
create policy "academy_members_admin_update" on public.academy_members
  for update to authenticated
  using ((select private.can_manage_academy(academy_community_id)))
  with check ((select private.can_manage_academy(academy_community_id)));
create policy "academy_members_admin_delete" on public.academy_members
  for delete to authenticated
  using ((select private.can_manage_academy(academy_community_id)));

create policy "academy_member_links_admin_select" on public.academy_member_links
  for select to authenticated
  using ((select private.can_manage_academy(academy_community_id)));
create policy "academy_member_links_admin_insert" on public.academy_member_links
  for insert to authenticated
  with check ((select private.can_manage_academy(academy_community_id)));
create policy "academy_member_links_admin_update" on public.academy_member_links
  for update to authenticated
  using ((select private.can_manage_academy(academy_community_id)))
  with check ((select private.can_manage_academy(academy_community_id)));
create policy "academy_member_links_admin_delete" on public.academy_member_links
  for delete to authenticated
  using ((select private.can_manage_academy(academy_community_id)));

create policy "academy_import_batches_admin_select" on public.source_import_batches
  for select to authenticated
  using ((select private.can_manage_academy(academy_community_id)));
create policy "academy_import_batches_admin_insert" on public.source_import_batches
  for insert to authenticated
  with check ((select private.can_manage_academy(academy_community_id)));
create policy "academy_import_batches_admin_update" on public.source_import_batches
  for update to authenticated
  using ((select private.can_manage_academy(academy_community_id)))
  with check ((select private.can_manage_academy(academy_community_id)));
create policy "academy_import_batches_admin_delete" on public.source_import_batches
  for delete to authenticated
  using ((select private.can_manage_academy(academy_community_id)));

create policy "academy_import_records_admin_select" on public.source_import_records
  for select to authenticated
  using ((select private.can_manage_academy(academy_community_id)));
create policy "academy_import_records_admin_insert" on public.source_import_records
  for insert to authenticated
  with check ((select private.can_manage_academy(academy_community_id)));
create policy "academy_import_records_admin_update" on public.source_import_records
  for update to authenticated
  using ((select private.can_manage_academy(academy_community_id)))
  with check ((select private.can_manage_academy(academy_community_id)));
create policy "academy_import_records_admin_delete" on public.source_import_records
  for delete to authenticated
  using ((select private.can_manage_academy(academy_community_id)));

create policy "profiles_select_shared_academy" on public.profiles
  for select to authenticated
  using ((select private.shares_academy_with(id)));

create policy "categories_academy_member_read" on public.community_categories
  for select to authenticated
  using (academy_community_id is not null and (select private.is_academy_member(academy_community_id)));
create policy "categories_academy_admin_insert" on public.community_categories
  for insert to authenticated
  with check (academy_community_id is not null and (select private.can_manage_academy(academy_community_id)));
create policy "categories_academy_admin_update" on public.community_categories
  for update to authenticated
  using (academy_community_id is not null and (select private.can_manage_academy(academy_community_id)))
  with check (academy_community_id is not null and (select private.can_manage_academy(academy_community_id)));
create policy "categories_academy_admin_delete" on public.community_categories
  for delete to authenticated
  using (academy_community_id is not null and (select private.can_manage_academy(academy_community_id)));

create policy "posts_academy_member_select" on public.community_posts
  for select to authenticated
  using (academy_community_id is not null and (select private.is_academy_member(academy_community_id)));
create policy "posts_academy_member_insert" on public.community_posts
  for insert to authenticated
  with check (
    academy_community_id is not null
    and ((select private.is_academy_member(academy_community_id)) or (select private.can_manage_academy(academy_community_id)))
    and (author_id = (select auth.uid()) or (select private.is_academy_identity(academy_author_id)))
  );
create policy "posts_academy_author_update" on public.community_posts
  for update to authenticated
  using (
    academy_community_id is not null
    and (author_id = (select auth.uid()) or (select private.is_academy_identity(academy_author_id)) or (select private.can_manage_academy(academy_community_id)))
  )
  with check (
    academy_community_id is not null
    and ((select private.is_academy_member(academy_community_id)) or (select private.can_manage_academy(academy_community_id)))
    and (author_id = (select auth.uid()) or (select private.is_academy_identity(academy_author_id)) or (select private.can_manage_academy(academy_community_id)))
  );
create policy "posts_academy_author_delete" on public.community_posts
  for delete to authenticated
  using (
    academy_community_id is not null
    and (author_id = (select auth.uid()) or (select private.is_academy_identity(academy_author_id)) or (select private.can_manage_academy(academy_community_id)))
  );

create policy "comments_academy_member_select" on public.community_comments
  for select to authenticated
  using (academy_community_id is not null and (select private.is_academy_member(academy_community_id)));
create policy "comments_academy_member_insert" on public.community_comments
  for insert to authenticated
  with check (
    academy_community_id is not null
    and (select private.is_academy_member(academy_community_id))
    and (author_id = (select auth.uid()) or (select private.is_academy_identity(academy_author_id)))
  );
create policy "comments_academy_author_update" on public.community_comments
  for update to authenticated
  using (
    academy_community_id is not null
    and (author_id = (select auth.uid()) or (select private.is_academy_identity(academy_author_id)) or (select private.can_manage_academy(academy_community_id)))
  )
  with check (
    academy_community_id is not null
    and ((select private.is_academy_member(academy_community_id)) or (select private.can_manage_academy(academy_community_id)))
    and (author_id = (select auth.uid()) or (select private.is_academy_identity(academy_author_id)) or (select private.can_manage_academy(academy_community_id)))
  );
create policy "comments_academy_author_delete" on public.community_comments
  for delete to authenticated
  using (
    academy_community_id is not null
    and (author_id = (select auth.uid()) or (select private.is_academy_identity(academy_author_id)) or (select private.can_manage_academy(academy_community_id)))
  );

create policy "courses_academy_member_read" on public.courses
  for select to authenticated
  using (academy_community_id is not null and (select private.is_academy_member(academy_community_id)));
create policy "courses_academy_admin_insert" on public.courses
  for insert to authenticated
  with check (academy_community_id is not null and (select private.can_manage_academy(academy_community_id)));
create policy "courses_academy_admin_update" on public.courses
  for update to authenticated
  using (academy_community_id is not null and (select private.can_manage_academy(academy_community_id)))
  with check (academy_community_id is not null and (select private.can_manage_academy(academy_community_id)));
create policy "courses_academy_admin_delete" on public.courses
  for delete to authenticated
  using (academy_community_id is not null and (select private.can_manage_academy(academy_community_id)));
create policy "modules_academy_member_read" on public.course_modules
  for select to authenticated
  using (exists (
    select 1 from public.courses c
    where c.id = course_id and c.academy_community_id is not null
      and (select private.is_academy_member(c.academy_community_id))
  ));
create policy "modules_academy_admin_insert" on public.course_modules
  for insert to authenticated
  with check (exists (
    select 1 from public.courses c
    where c.id = course_id and c.academy_community_id is not null
      and (select private.can_manage_academy(c.academy_community_id))
  ));
create policy "modules_academy_admin_update" on public.course_modules
  for update to authenticated
  using (exists (
    select 1 from public.courses c
    where c.id = course_id and c.academy_community_id is not null
      and (select private.can_manage_academy(c.academy_community_id))
  ))
  with check (exists (
    select 1 from public.courses c
    where c.id = course_id and c.academy_community_id is not null
      and (select private.can_manage_academy(c.academy_community_id))
  ));
create policy "modules_academy_admin_delete" on public.course_modules
  for delete to authenticated
  using (exists (
    select 1 from public.courses c
    where c.id = course_id and c.academy_community_id is not null
      and (select private.can_manage_academy(c.academy_community_id))
  ));
create policy "lessons_academy_member_read" on public.course_lessons
  for select to authenticated
  using (exists (
    select 1 from public.course_modules m
    join public.courses c on c.id = m.course_id
    where m.id = module_id and c.academy_community_id is not null
      and (select private.is_academy_member(c.academy_community_id))
  ));
create policy "lessons_academy_admin_insert" on public.course_lessons
  for insert to authenticated
  with check (exists (
    select 1 from public.course_modules m
    join public.courses c on c.id = m.course_id
    where m.id = module_id and c.academy_community_id is not null
      and (select private.can_manage_academy(c.academy_community_id))
  ));
create policy "lessons_academy_admin_update" on public.course_lessons
  for update to authenticated
  using (exists (
    select 1 from public.course_modules m
    join public.courses c on c.id = m.course_id
    where m.id = module_id and c.academy_community_id is not null
      and (select private.can_manage_academy(c.academy_community_id))
  ))
  with check (exists (
    select 1 from public.course_modules m
    join public.courses c on c.id = m.course_id
    where m.id = module_id and c.academy_community_id is not null
      and (select private.can_manage_academy(c.academy_community_id))
  ));
create policy "lessons_academy_admin_delete" on public.course_lessons
  for delete to authenticated
  using (exists (
    select 1 from public.course_modules m
    join public.courses c on c.id = m.course_id
    where m.id = module_id and c.academy_community_id is not null
      and (select private.can_manage_academy(c.academy_community_id))
  ));

create policy "events_academy_member_read" on public.academy_events
  for select to authenticated
  using (academy_community_id is not null and (select private.is_academy_member(academy_community_id)));
create policy "events_academy_admin_insert" on public.academy_events
  for insert to authenticated
  with check (academy_community_id is not null and (select private.can_manage_academy(academy_community_id)));
create policy "events_academy_admin_update" on public.academy_events
  for update to authenticated
  using (academy_community_id is not null and (select private.can_manage_academy(academy_community_id)))
  with check (academy_community_id is not null and (select private.can_manage_academy(academy_community_id)));
create policy "events_academy_admin_delete" on public.academy_events
  for delete to authenticated
  using (academy_community_id is not null and (select private.can_manage_academy(academy_community_id)));

create policy "academy_follows_member_select" on public.academy_member_follows
  for select to authenticated
  using ((select private.is_academy_member(academy_community_id)));
create policy "academy_follows_self_insert" on public.academy_member_follows
  for insert to authenticated
  with check ((select private.is_academy_identity(follower_member_id)) and (select private.is_academy_member(academy_community_id)));
create policy "academy_follows_self_delete" on public.academy_member_follows
  for delete to authenticated
  using ((select private.is_academy_identity(follower_member_id)));

create policy "academy_progress_member_or_admin_select" on public.academy_member_lesson_progress
  for select to authenticated
  using ((select private.can_access_academy_lesson_progress(academy_member_id, lesson_id)));
create policy "academy_progress_member_or_admin_insert" on public.academy_member_lesson_progress
  for insert to authenticated
  with check ((select private.can_access_academy_lesson_progress(academy_member_id, lesson_id)));
create policy "academy_progress_member_or_admin_update" on public.academy_member_lesson_progress
  for update to authenticated
  using ((select private.can_access_academy_lesson_progress(academy_member_id, lesson_id)))
  with check ((select private.can_access_academy_lesson_progress(academy_member_id, lesson_id)));
create policy "academy_progress_member_or_admin_delete" on public.academy_member_lesson_progress
  for delete to authenticated
  using ((select private.can_access_academy_lesson_progress(academy_member_id, lesson_id)));

create policy "academy_rsvps_member_or_admin_select" on public.academy_member_event_rsvps
  for select to authenticated
  using ((select private.can_access_academy_event_rsvp(academy_member_id, event_id)));
create policy "academy_rsvps_member_or_admin_insert" on public.academy_member_event_rsvps
  for insert to authenticated
  with check ((select private.can_access_academy_event_rsvp(academy_member_id, event_id)));
create policy "academy_rsvps_member_or_admin_update" on public.academy_member_event_rsvps
  for update to authenticated
  using ((select private.can_access_academy_event_rsvp(academy_member_id, event_id)))
  with check ((select private.can_access_academy_event_rsvp(academy_member_id, event_id)));
create policy "academy_rsvps_member_or_admin_delete" on public.academy_member_event_rsvps
  for delete to authenticated
  using ((select private.can_access_academy_event_rsvp(academy_member_id, event_id)));

create or replace view public.community_feed with (security_invoker = true) as
select
  p.id,
  p.title,
  p.body,
  coalesce(nullif(pr.full_name, ''), nullif(am.display_name, ''), 'Member') as author_name,
  count(distinct c.id)::integer as reply_count,
  p.created_at,
  coalesce(cat.name, 'General') as category_name,
  p.is_pinned,
  p.media,
  count(distinct r.user_id)::integer as like_count
from public.community_posts p
left join public.profiles pr on pr.id = p.author_id
left join public.academy_members am on am.id = p.academy_author_id
left join public.community_categories cat on cat.id = p.category_id
left join public.community_comments c on c.post_id = p.id
left join public.community_post_reactions r on r.post_id = p.id
where p.status = 'published'
group by p.id, pr.full_name, am.display_name, cat.name;
