create extension if not exists pgcrypto;

create type public.organization_role as enum ('owner', 'admin', 'operator', 'member');
create type public.measurement_method as enum ('camera', 'map', 'manual');
create type public.cleaning_plan as enum ('quick', 'premium', 'annihilator');
create type public.estimate_status as enum ('draft', 'ready_to_quote', 'sent', 'accepted', 'declined', 'archived');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.organization_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  address text,
  latitude double precision,
  longitude double precision,
  ghl_contact_id text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.visits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  visited_at timestamptz not null default now(),
  notes text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.measurements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  visit_id uuid references public.visits(id) on delete set null,
  method public.measurement_method not null,
  square_feet numeric(12,2) not null check (square_feet >= 0),
  length_feet numeric(10,2),
  width_feet numeric(10,2),
  polygon jsonb,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.estimates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  measurement_id uuid references public.measurements(id) on delete set null,
  plan public.cleaning_plan not null default 'premium',
  bag_count integer not null default 0 check (bag_count >= 0),
  service_subtotal numeric(12,2) not null default 0,
  materials_total numeric(12,2) not null default 0,
  plan_total numeric(12,2) not null default 0,
  total numeric(12,2) not null check (total >= 0),
  status public.estimate_status not null default 'draft',
  ghl_opportunity_id text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  visit_id uuid references public.visits(id) on delete set null,
  storage_path text not null unique,
  kind text not null default 'site' check (kind in ('before', 'after', 'site', 'issue')),
  captured_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.course_progress (
  user_id uuid not null references public.profiles(id) on delete cascade,
  external_course_id text not null,
  external_lesson_id text not null default '',
  progress_percent integer not null default 0 check (progress_percent between 0 and 100),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, external_course_id, external_lesson_id)
);

create table public.community_posts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 2 and 120),
  body text not null check (char_length(body) between 2 and 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.community_comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  post_id uuid not null references public.community_posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 3000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.integration_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  external_event_id text not null,
  event_type text not null,
  payload jsonb not null,
  processed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  unique (provider, external_event_id)
);

create index properties_organization_idx on public.properties(organization_id);
create index visits_property_idx on public.visits(property_id, visited_at desc);
create index measurements_property_idx on public.measurements(property_id, created_at desc);
create index estimates_organization_idx on public.estimates(organization_id, created_at desc);
create index photos_property_idx on public.photos(property_id, captured_at desc);
create index posts_organization_idx on public.community_posts(organization_id, created_at desc);
create index comments_post_idx on public.community_comments(post_id, created_at);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger organizations_updated_at before update on public.organizations for each row execute function public.set_updated_at();
create trigger properties_updated_at before update on public.properties for each row execute function public.set_updated_at();
create trigger estimates_updated_at before update on public.estimates for each row execute function public.set_updated_at();
create trigger posts_updated_at before update on public.community_posts for each row execute function public.set_updated_at();
create trigger comments_updated_at before update on public.community_comments for each row execute function public.set_updated_at();

create or replace function public.is_organization_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = target_organization_id and user_id = (select auth.uid())
  );
$$;

create or replace function public.is_organization_admin(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = target_organization_id
      and user_id = (select auth.uid())
      and role in ('owner', 'admin')
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_organization_id uuid;
  organization_name text;
  organization_slug text;
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));

  organization_name := coalesce(nullif(new.raw_user_meta_data ->> 'company_name', ''), 'My turf company');
  organization_slug := lower(regexp_replace(organization_name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || left(new.id::text, 8);

  insert into public.organizations (name, slug, created_by)
  values (organization_name, organization_slug, new.id)
  returning id into new_organization_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (new_organization_id, new.id, 'owner');
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.properties enable row level security;
alter table public.visits enable row level security;
alter table public.measurements enable row level security;
alter table public.estimates enable row level security;
alter table public.photos enable row level security;
alter table public.course_progress enable row level security;
alter table public.community_posts enable row level security;
alter table public.community_comments enable row level security;
alter table public.integration_events enable row level security;

create policy "profiles_select_organization" on public.profiles for select to authenticated
using (id = (select auth.uid()) or exists (
  select 1 from public.organization_members mine
  join public.organization_members theirs on theirs.organization_id = mine.organization_id
  where mine.user_id = (select auth.uid()) and theirs.user_id = profiles.id
));
create policy "profiles_update_self" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "organizations_select_member" on public.organizations for select to authenticated using (public.is_organization_member(id));
create policy "organizations_update_admin" on public.organizations for update to authenticated using (public.is_organization_admin(id)) with check (public.is_organization_admin(id));
create policy "members_select_member" on public.organization_members for select to authenticated using (public.is_organization_member(organization_id));
create policy "members_manage_admin" on public.organization_members for all to authenticated using (public.is_organization_admin(organization_id)) with check (public.is_organization_admin(organization_id));

create policy "properties_member_access" on public.properties for all to authenticated using (public.is_organization_member(organization_id)) with check (public.is_organization_member(organization_id));
create policy "visits_member_access" on public.visits for all to authenticated using (public.is_organization_member(organization_id)) with check (public.is_organization_member(organization_id));
create policy "measurements_member_access" on public.measurements for all to authenticated using (public.is_organization_member(organization_id)) with check (public.is_organization_member(organization_id));
create policy "estimates_member_access" on public.estimates for all to authenticated using (public.is_organization_member(organization_id)) with check (public.is_organization_member(organization_id));
create policy "photos_member_access" on public.photos for all to authenticated using (public.is_organization_member(organization_id)) with check (public.is_organization_member(organization_id));
create policy "course_progress_self" on public.course_progress for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "posts_member_select" on public.community_posts for select to authenticated using (public.is_organization_member(organization_id));
create policy "posts_member_insert" on public.community_posts for insert to authenticated with check (author_id = (select auth.uid()) and public.is_organization_member(organization_id));
create policy "posts_author_update" on public.community_posts for update to authenticated using (author_id = (select auth.uid()) or public.is_organization_admin(organization_id)) with check (public.is_organization_member(organization_id));
create policy "posts_author_delete" on public.community_posts for delete to authenticated using (author_id = (select auth.uid()) or public.is_organization_admin(organization_id));
create policy "comments_member_select" on public.community_comments for select to authenticated using (public.is_organization_member(organization_id));
create policy "comments_member_insert" on public.community_comments for insert to authenticated with check (author_id = (select auth.uid()) and public.is_organization_member(organization_id));
create policy "comments_author_manage" on public.community_comments for update to authenticated using (author_id = (select auth.uid()) or public.is_organization_admin(organization_id)) with check (public.is_organization_member(organization_id));
create policy "comments_author_delete" on public.community_comments for delete to authenticated using (author_id = (select auth.uid()) or public.is_organization_admin(organization_id));

create or replace view public.job_cards with (security_invoker = true) as
select
  e.id,
  p.name as property_name,
  coalesce(m.square_feet, 0) as square_feet,
  e.bag_count,
  e.total,
  e.status::text,
  coalesce(m.method, 'manual'::public.measurement_method)::text as measurement_method,
  e.created_at,
  (select count(*) from public.photos ph where ph.property_id = p.id)::integer as photo_count
from public.estimates e
join public.properties p on p.id = e.property_id
left join public.measurements m on m.id = e.measurement_id;

create or replace view public.community_feed with (security_invoker = true) as
select
  p.id,
  p.title,
  p.body,
  coalesce(nullif(pr.full_name, ''), 'Member') as author_name,
  count(c.id)::integer as reply_count,
  p.created_at
from public.community_posts p
join public.profiles pr on pr.id = p.author_id
left join public.community_comments c on c.post_id = p.id
group by p.id, pr.full_name;

create or replace function public.create_property_estimate(
  p_property_name text,
  p_square_feet numeric,
  p_bag_count integer,
  p_total numeric,
  p_measurement_method public.measurement_method,
  p_plan public.cleaning_plan default 'premium'
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  target_organization_id uuid;
  new_property_id uuid;
  new_measurement_id uuid;
  new_estimate_id uuid;
begin
  select organization_id into target_organization_id
  from public.organization_members
  where user_id = (select auth.uid())
  order by created_at
  limit 1;

  if target_organization_id is null then raise exception 'No organization membership found'; end if;

  insert into public.properties (organization_id, name, created_by)
  values (target_organization_id, trim(p_property_name), (select auth.uid()))
  returning id into new_property_id;

  insert into public.measurements (organization_id, property_id, method, square_feet, created_by)
  values (target_organization_id, new_property_id, p_measurement_method, greatest(p_square_feet, 0), (select auth.uid()))
  returning id into new_measurement_id;

  insert into public.estimates (organization_id, property_id, measurement_id, plan, bag_count, total, status, created_by)
  values (target_organization_id, new_property_id, new_measurement_id, p_plan, greatest(p_bag_count, 0), greatest(p_total, 0), 'ready_to_quote', (select auth.uid()))
  returning id into new_estimate_id;

  return new_estimate_id;
end;
$$;

create or replace function public.create_community_post(p_title text, p_body text)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  target_organization_id uuid;
  new_post_id uuid;
begin
  select organization_id into target_organization_id
  from public.organization_members
  where user_id = (select auth.uid())
  order by created_at
  limit 1;

  if target_organization_id is null then raise exception 'No organization membership found'; end if;

  insert into public.community_posts (organization_id, author_id, title, body)
  values (target_organization_id, (select auth.uid()), trim(p_title), trim(p_body))
  returning id into new_post_id;
  return new_post_id;
end;
$$;

grant select on public.job_cards, public.community_feed to authenticated;
grant execute on function public.create_property_estimate(text, numeric, integer, numeric, public.measurement_method, public.cleaning_plan) to authenticated;
grant execute on function public.create_community_post(text, text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('job-photos', 'job-photos', false, 20971520, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "job_photos_select_member" on storage.objects for select to authenticated
using (bucket_id = 'job-photos' and public.is_organization_member(((storage.foldername(name))[1])::uuid));
create policy "job_photos_insert_member" on storage.objects for insert to authenticated
with check (bucket_id = 'job-photos' and public.is_organization_member(((storage.foldername(name))[1])::uuid));
create policy "job_photos_update_member" on storage.objects for update to authenticated
using (bucket_id = 'job-photos' and public.is_organization_member(((storage.foldername(name))[1])::uuid));
create policy "job_photos_delete_member" on storage.objects for delete to authenticated
using (bucket_id = 'job-photos' and public.is_organization_member(((storage.foldername(name))[1])::uuid));

alter publication supabase_realtime add table public.community_posts;
alter publication supabase_realtime add table public.community_comments;
