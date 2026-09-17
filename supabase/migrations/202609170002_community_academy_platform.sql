create type public.content_status as enum ('draft', 'published', 'archived');
create type public.event_kind as enum ('live', 'workshop', 'office_hours');
create type public.notification_kind as enum ('reply', 'mention', 'reaction', 'event', 'course', 'admin');
create type public.report_status as enum ('open', 'reviewing', 'resolved', 'dismissed');
create type public.membership_status as enum ('pending', 'active', 'suspended', 'cancelled');

alter table public.profiles
  add column if not exists bio text not null default '',
  add column if not exists company_name text not null default '',
  add column if not exists location text not null default '',
  add column if not exists points integer not null default 0 check (points >= 0),
  add column if not exists level integer not null default 1 check (level >= 1),
  add column if not exists last_seen_at timestamptz;

alter table public.community_posts
  add column if not exists category_id uuid,
  add column if not exists is_pinned boolean not null default false,
  add column if not exists status public.content_status not null default 'published',
  add column if not exists media jsonb not null default '[]'::jsonb;

alter table public.community_comments
  add column if not exists parent_id uuid references public.community_comments(id) on delete cascade,
  add column if not exists is_answer boolean not null default false;

create table public.community_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 40),
  color text not null default '#047631',
  sort_order integer not null default 0,
  member_can_post boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

alter table public.community_posts
  add constraint community_posts_category_fk foreign key (category_id) references public.community_categories(id) on delete set null;

create table public.community_post_reactions (
  post_id uuid not null references public.community_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction text not null default 'like' check (reaction in ('like')),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table public.community_comment_reactions (
  comment_id uuid not null references public.community_comments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction text not null default 'like' check (reaction in ('like')),
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

create table public.community_bookmarks (
  post_id uuid not null references public.community_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table public.member_follows (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followed_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (organization_id, follower_id, followed_id),
  check (follower_id <> followed_id)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  kind public.notification_kind not null,
  title text not null,
  detail text not null default '',
  target_type text,
  target_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  replies boolean not null default true,
  mentions boolean not null default true,
  event_reminders boolean not null default true,
  weekly_digest boolean not null default true,
  new_posts boolean not null default false,
  push_enabled boolean not null default false,
  email_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  external_id text,
  title text not null,
  description text not null default '',
  category text not null default 'Core',
  instructor_id uuid references public.profiles(id) on delete set null,
  cover_url text,
  status public.content_status not null default 'draft',
  access_type text not null default 'open' check (access_type in ('open', 'level', 'purchase')),
  required_level integer,
  price_cents integer check (price_cents is null or price_cents >= 0),
  sort_order integer not null default 0,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (organization_id, external_id)
);

create table public.course_modules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null,
  sort_order integer not null default 0,
  drip_after_days integer check (drip_after_days is null or drip_after_days >= 0),
  created_at timestamptz not null default now()
);

create table public.course_lessons (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.course_modules(id) on delete cascade,
  external_id text,
  title text not null,
  lesson_type text not null default 'video' check (lesson_type in ('video', 'guide', 'quiz')),
  body jsonb not null default '{}'::jsonb,
  video_url text,
  transcript text,
  resources jsonb not null default '[]'::jsonb,
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  sort_order integer not null default 0,
  status public.content_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (module_id, external_id)
);

create table public.lesson_progress (
  user_id uuid not null references public.profiles(id) on delete cascade,
  lesson_id uuid not null references public.course_lessons(id) on delete cascade,
  completed_at timestamptz,
  position_seconds integer not null default 0 check (position_seconds >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, lesson_id)
);

create table public.academy_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  description text not null default '',
  kind public.event_kind not null default 'live',
  host_id uuid references public.profiles(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  meeting_url text,
  recurrence_rule text,
  required_level integer,
  status public.content_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table public.event_rsvps (
  event_id uuid not null references public.academy_events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'going' check (status in ('going', 'interested')),
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create table public.membership_questions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  prompt text not null,
  required boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.membership_applications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  full_name text not null,
  answers jsonb not null default '{}'::jsonb,
  status public.membership_status not null default 'pending',
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.content_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  content_type text not null check (content_type in ('post', 'comment', 'member')),
  content_id uuid not null,
  reason text not null,
  status public.report_status not null default 'open',
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.membership_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  stripe_price_id text,
  amount_cents integer not null check (amount_cents >= 0),
  interval text not null check (interval in ('month', 'year', 'one_time')),
  active boolean not null default true,
  benefits jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table public.member_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan_id uuid references public.membership_plans(id) on delete set null,
  provider_customer_id text,
  provider_subscription_id text unique,
  status public.membership_status not null default 'pending',
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  referrer_id uuid not null references public.profiles(id) on delete cascade,
  code text not null unique,
  referred_email text,
  converted_user_id uuid references public.profiles(id) on delete set null,
  converted_at timestamptz,
  created_at timestamptz not null default now()
);

create index community_categories_org_idx on public.community_categories(organization_id, sort_order);
create index notifications_recipient_idx on public.notifications(recipient_id, created_at desc);
create index courses_org_idx on public.courses(organization_id, status, sort_order);
create index modules_course_idx on public.course_modules(course_id, sort_order);
create index lessons_module_idx on public.course_lessons(module_id, sort_order);
create index events_org_idx on public.academy_events(organization_id, starts_at);
create index applications_org_idx on public.membership_applications(organization_id, status);
create index reports_org_idx on public.content_reports(organization_id, status);

create trigger courses_updated_at before update on public.courses for each row execute function public.set_updated_at();
create trigger lessons_updated_at before update on public.course_lessons for each row execute function public.set_updated_at();
create trigger events_updated_at before update on public.academy_events for each row execute function public.set_updated_at();
create trigger subscriptions_updated_at before update on public.member_subscriptions for each row execute function public.set_updated_at();
create trigger notification_preferences_updated_at before update on public.notification_preferences for each row execute function public.set_updated_at();

alter table public.community_categories enable row level security;
alter table public.community_post_reactions enable row level security;
alter table public.community_comment_reactions enable row level security;
alter table public.community_bookmarks enable row level security;
alter table public.member_follows enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.courses enable row level security;
alter table public.course_modules enable row level security;
alter table public.course_lessons enable row level security;
alter table public.lesson_progress enable row level security;
alter table public.academy_events enable row level security;
alter table public.event_rsvps enable row level security;
alter table public.membership_questions enable row level security;
alter table public.membership_applications enable row level security;
alter table public.content_reports enable row level security;
alter table public.membership_plans enable row level security;
alter table public.member_subscriptions enable row level security;
alter table public.referrals enable row level security;

create policy "categories_member_read" on public.community_categories for select to authenticated using (public.is_organization_member(organization_id));
create policy "categories_admin_manage" on public.community_categories for all to authenticated using (public.is_organization_admin(organization_id)) with check (public.is_organization_admin(organization_id));
create policy "post_reactions_member_manage" on public.community_post_reactions for all to authenticated using (user_id = (select auth.uid()) and exists (select 1 from public.community_posts p where p.id = post_id and public.is_organization_member(p.organization_id))) with check (user_id = (select auth.uid()) and exists (select 1 from public.community_posts p where p.id = post_id and public.is_organization_member(p.organization_id)));
create policy "comment_reactions_member_manage" on public.community_comment_reactions for all to authenticated using (user_id = (select auth.uid()) and exists (select 1 from public.community_comments c where c.id = comment_id and public.is_organization_member(c.organization_id))) with check (user_id = (select auth.uid()) and exists (select 1 from public.community_comments c where c.id = comment_id and public.is_organization_member(c.organization_id)));
create policy "bookmarks_self_manage" on public.community_bookmarks for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "follows_org_read" on public.member_follows for select to authenticated using (public.is_organization_member(organization_id));
create policy "follows_self_manage" on public.member_follows for all to authenticated using (follower_id = (select auth.uid()) and public.is_organization_member(organization_id)) with check (follower_id = (select auth.uid()) and public.is_organization_member(organization_id));
create policy "notifications_self" on public.notifications for select to authenticated using (recipient_id = (select auth.uid()));
create policy "notifications_self_update" on public.notifications for update to authenticated using (recipient_id = (select auth.uid())) with check (recipient_id = (select auth.uid()));
create policy "notification_preferences_self" on public.notification_preferences for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "courses_member_read" on public.courses for select to authenticated using (public.is_organization_member(organization_id));
create policy "courses_admin_manage" on public.courses for all to authenticated using (public.is_organization_admin(organization_id)) with check (public.is_organization_admin(organization_id));
create policy "modules_member_read" on public.course_modules for select to authenticated using (exists (select 1 from public.courses c where c.id = course_id and public.is_organization_member(c.organization_id)));
create policy "modules_admin_manage" on public.course_modules for all to authenticated using (exists (select 1 from public.courses c where c.id = course_id and public.is_organization_admin(c.organization_id))) with check (exists (select 1 from public.courses c where c.id = course_id and public.is_organization_admin(c.organization_id)));
create policy "lessons_member_read" on public.course_lessons for select to authenticated using (exists (select 1 from public.course_modules m join public.courses c on c.id = m.course_id where m.id = module_id and public.is_organization_member(c.organization_id)));
create policy "lessons_admin_manage" on public.course_lessons for all to authenticated using (exists (select 1 from public.course_modules m join public.courses c on c.id = m.course_id where m.id = module_id and public.is_organization_admin(c.organization_id))) with check (exists (select 1 from public.course_modules m join public.courses c on c.id = m.course_id where m.id = module_id and public.is_organization_admin(c.organization_id)));
create policy "lesson_progress_self" on public.lesson_progress for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "events_member_read" on public.academy_events for select to authenticated using (public.is_organization_member(organization_id));
create policy "events_admin_manage" on public.academy_events for all to authenticated using (public.is_organization_admin(organization_id)) with check (public.is_organization_admin(organization_id));
create policy "rsvps_member_manage" on public.event_rsvps for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and exists (select 1 from public.academy_events e where e.id = event_id and public.is_organization_member(e.organization_id)));
create policy "questions_member_read" on public.membership_questions for select to authenticated using (public.is_organization_member(organization_id));
create policy "questions_admin_manage" on public.membership_questions for all to authenticated using (public.is_organization_admin(organization_id)) with check (public.is_organization_admin(organization_id));
create policy "applications_admin_manage" on public.membership_applications for all to authenticated using (public.is_organization_admin(organization_id)) with check (public.is_organization_admin(organization_id));
create policy "reports_member_insert" on public.content_reports for insert to authenticated with check (reporter_id = (select auth.uid()) and public.is_organization_member(organization_id));
create policy "reports_admin_manage" on public.content_reports for all to authenticated using (public.is_organization_admin(organization_id)) with check (public.is_organization_admin(organization_id));
create policy "plans_member_read" on public.membership_plans for select to authenticated using (public.is_organization_member(organization_id));
create policy "plans_admin_manage" on public.membership_plans for all to authenticated using (public.is_organization_admin(organization_id)) with check (public.is_organization_admin(organization_id));
create policy "subscriptions_self_read" on public.member_subscriptions for select to authenticated using (user_id = (select auth.uid()) or public.is_organization_admin(organization_id));
create policy "referrals_self_read" on public.referrals for select to authenticated using (referrer_id = (select auth.uid()) or public.is_organization_admin(organization_id));
create policy "referrals_self_insert" on public.referrals for insert to authenticated with check (referrer_id = (select auth.uid()) and public.is_organization_member(organization_id));

create or replace view public.community_feed with (security_invoker = true) as
select
  p.id,
  p.title,
  p.body,
  coalesce(nullif(pr.full_name, ''), 'Member') as author_name,
  count(distinct c.id)::integer as reply_count,
  p.created_at,
  coalesce(cat.name, 'General') as category_name,
  p.is_pinned,
  p.media,
  count(distinct r.user_id)::integer as like_count
from public.community_posts p
join public.profiles pr on pr.id = p.author_id
left join public.community_categories cat on cat.id = p.category_id
left join public.community_comments c on c.post_id = p.id
left join public.community_post_reactions r on r.post_id = p.id
where p.status = 'published'
group by p.id, pr.full_name, cat.name;

create or replace function public.toggle_post_reaction(target_post_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  if exists (select 1 from public.community_post_reactions where post_id = target_post_id and user_id = (select auth.uid())) then
    delete from public.community_post_reactions where post_id = target_post_id and user_id = (select auth.uid());
    return false;
  end if;
  insert into public.community_post_reactions (post_id, user_id) values (target_post_id, (select auth.uid()));
  return true;
end;
$$;

create or replace function public.toggle_post_bookmark(target_post_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  if exists (select 1 from public.community_bookmarks where post_id = target_post_id and user_id = (select auth.uid())) then
    delete from public.community_bookmarks where post_id = target_post_id and user_id = (select auth.uid());
    return false;
  end if;
  insert into public.community_bookmarks (post_id, user_id) values (target_post_id, (select auth.uid()));
  return true;
end;
$$;

create or replace function public.toggle_event_rsvp(target_event_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  if exists (select 1 from public.event_rsvps where event_id = target_event_id and user_id = (select auth.uid())) then
    delete from public.event_rsvps where event_id = target_event_id and user_id = (select auth.uid());
    return false;
  end if;
  insert into public.event_rsvps (event_id, user_id) values (target_event_id, (select auth.uid()));
  return true;
end;
$$;

create or replace function public.set_lesson_completion(target_lesson_id uuid, is_complete boolean)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  insert into public.lesson_progress (user_id, lesson_id, completed_at)
  values ((select auth.uid()), target_lesson_id, case when is_complete then now() else null end)
  on conflict (user_id, lesson_id) do update
  set completed_at = excluded.completed_at, updated_at = now();
end;
$$;

create or replace function public.notify_post_author_on_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  post_author uuid;
  post_title text;
begin
  select author_id, title into post_author, post_title from public.community_posts where id = new.post_id;
  if post_author is distinct from new.author_id then
    insert into public.notifications (organization_id, recipient_id, actor_id, kind, title, detail, target_type, target_id)
    values (new.organization_id, post_author, new.author_id, 'reply', 'New reply to your discussion', post_title, 'post', new.post_id);
  end if;
  return new;
end;
$$;

create trigger community_comment_notification after insert on public.community_comments for each row execute function public.notify_post_author_on_comment();

grant execute on function public.toggle_post_reaction(uuid) to authenticated;
grant execute on function public.toggle_post_bookmark(uuid) to authenticated;
grant execute on function public.toggle_event_rsvp(uuid) to authenticated;
grant execute on function public.set_lesson_completion(uuid, boolean) to authenticated;

alter publication supabase_realtime add table public.community_post_reactions;
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.event_rsvps;
