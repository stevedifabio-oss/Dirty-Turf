-- Close release-blocking authorization and data-integrity gaps found in review.

create table public.academy_course_access_denials (
  academy_community_id uuid not null references public.academy_communities(id) on delete cascade,
  academy_member_id uuid not null references public.academy_members(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  denied_by uuid references public.profiles(id) on delete set null,
  reason text,
  created_at timestamptz not null default now(),
  primary key (academy_member_id, course_id)
);

alter table public.academy_course_access_denials enable row level security;
grant select on public.academy_course_access_denials to authenticated;
grant all on public.academy_course_access_denials to service_role;
create policy "academy_course_denials_self_or_admin_select"
  on public.academy_course_access_denials for select to authenticated
  using (
    (select private.is_academy_identity(academy_member_id))
    or (select private.can_manage_academy(academy_community_id))
  );

-- Keep role and status changes behind an invariant-preserving API. Academy
-- admins may manage members and other admins, but only an owner may create or
-- mutate an owner, and no request may remove the final active owner/manager.
create or replace function public.admin_update_academy_member(
  p_member_id uuid,
  p_role public.academy_role default null,
  p_status public.membership_status default null,
  p_level integer default null,
  p_points integer default null,
  p_display_name text default null,
  p_company_name text default null,
  p_location text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.academy_members%rowtype;
  next_role public.academy_role;
  next_status public.membership_status;
begin
  select * into target from public.academy_members where id = p_member_id for update;
  if target.id is null or not (select private.can_manage_academy(target.academy_community_id)) then
    raise exception 'Academy administrator access required' using errcode = '42501';
  end if;
  if (target.role = 'owner' or p_role = 'owner')
     and not (select private.is_academy_owner(target.academy_community_id)) then
    raise exception 'Only an Academy owner can change an owner account' using errcode = '42501';
  end if;

  next_role := coalesce(p_role, target.role);
  next_status := coalesce(p_status, target.status);

  if target.role = 'owner' and target.status = 'active'
     and (next_role <> 'owner' or next_status <> 'active')
     and not exists (
       select 1 from public.academy_members member
       where member.academy_community_id = target.academy_community_id
         and member.id <> target.id and member.role = 'owner' and member.status = 'active'
     ) then
    raise exception 'The final active Academy owner cannot be demoted or suspended' using errcode = '23514';
  end if;

  if target.role in ('owner', 'admin') and target.status = 'active'
     and (next_role not in ('owner', 'admin') or next_status <> 'active')
     and not exists (
       select 1 from public.academy_members member
       where member.academy_community_id = target.academy_community_id
         and member.id <> target.id and member.role in ('owner', 'admin') and member.status = 'active'
     ) then
    raise exception 'The final active Academy manager cannot be demoted or suspended' using errcode = '23514';
  end if;

  update public.academy_members set
    role = next_role,
    status = next_status,
    level = case when p_level is null then level else greatest(1, p_level) end,
    points = case when p_points is null then points else greatest(0, p_points) end,
    display_name = case when p_display_name is null then display_name else trim(p_display_name) end,
    company_name = case when p_company_name is null then company_name else trim(p_company_name) end,
    location = case when p_location is null then location else trim(p_location) end
  where id = target.id;
end;
$$;

revoke insert, update, delete on public.academy_members from authenticated;
revoke all on function public.admin_update_academy_member(uuid, public.academy_role, public.membership_status, integer, integer, text, text, text) from public, anon;
grant execute on function public.admin_update_academy_member(uuid, public.academy_role, public.membership_status, integer, integer, text, text, text) to authenticated;

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
      and not exists (
        select 1 from public.academy_course_access_denials denial
        where denial.academy_member_id = m.id and denial.course_id = c.id
      )
      and (
        (
          (select private.has_active_academy_grant(m.id, null))
          and (
            c.access_type = 'open'
            or (c.access_type = 'level' and m.level >= coalesce(c.required_level, 1))
          )
        )
        or (select private.has_active_academy_grant(m.id, c.id))
      )
  );
$$;

create or replace function public.admin_set_member_course_access(
  p_member_id uuid,
  p_course_id uuid,
  p_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_row public.academy_members%rowtype;
  course_row public.courses%rowtype;
  grant_source_key text := 'manual:' || p_course_id::text;
begin
  select * into member_row from public.academy_members where id = p_member_id;
  select * into course_row from public.courses where id = p_course_id;
  if member_row.id is null or course_row.id is null
     or member_row.academy_community_id is distinct from course_row.academy_community_id then
    raise exception 'Member and course must belong to the same Academy';
  end if;
  if not (select private.can_manage_academy(member_row.academy_community_id)) then
    raise exception 'Academy administrator access required' using errcode = '42501';
  end if;

  if p_enabled then
    delete from public.academy_course_access_denials
    where academy_member_id = member_row.id and course_id = course_row.id;
    insert into public.course_enrollments (
      academy_community_id, academy_member_id, course_id, status, enrolled_at
    ) values (
      member_row.academy_community_id, member_row.id, course_row.id, 'active', now()
    ) on conflict (academy_member_id, course_id) do update
      set status = 'active', access_expires_at = null, updated_at = now();
    insert into public.academy_access_grants (
      academy_community_id, academy_member_id, course_id, source_type, source_key, status
    ) values (
      member_row.academy_community_id, member_row.id, course_row.id,
      'manual', grant_source_key, 'active'
    ) on conflict (academy_member_id, course_id, source_type, source_key)
      where course_id is not null do update
      set status = 'active', ends_at = null, updated_at = now();
  else
    insert into public.academy_course_access_denials (
      academy_community_id, academy_member_id, course_id, denied_by, reason
    ) values (
      member_row.academy_community_id, member_row.id, course_row.id,
      (select auth.uid()), 'Revoked by Academy administrator'
    ) on conflict (academy_member_id, course_id) do update
      set denied_by = excluded.denied_by, reason = excluded.reason, created_at = now();
    update public.course_enrollments set status = 'cancelled', updated_at = now()
      where academy_member_id = member_row.id and course_id = course_row.id;
    update public.academy_access_grants set status = 'revoked', updated_at = now()
      where academy_member_id = member_row.id and course_id = course_row.id
        and source_type = 'manual' and source_key = grant_source_key;
  end if;
end;
$$;

create or replace function private.validate_academy_post_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  category_allows_members boolean;
  manager boolean;
begin
  if new.academy_community_id is null then return new; end if;
  if (select auth.role()) = 'service_role' then return new; end if;
  manager := (select private.can_manage_academy(new.academy_community_id));
  if manager then return new; end if;
  if new.academy_author_id is null or not (select private.is_academy_identity(new.academy_author_id)) then
    raise exception 'Active Academy access required' using errcode = '42501';
  end if;
  select member_can_post into category_allows_members
  from public.community_categories
  where id = new.category_id and academy_community_id = new.academy_community_id;
  if not coalesce(category_allows_members, false) then
    raise exception 'Only Academy administrators can post in this category' using errcode = '42501';
  end if;
  if new.status <> 'published' or new.is_pinned then
    raise exception 'Only Academy administrators can moderate posts' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (
    new.status is distinct from old.status or new.is_pinned is distinct from old.is_pinned
    or new.category_id is distinct from old.category_id
    or new.academy_community_id is distinct from old.academy_community_id
    or new.academy_author_id is distinct from old.academy_author_id
  ) then
    raise exception 'Only Academy administrators can change moderation fields' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_academy_post_write on public.community_posts;
create trigger validate_academy_post_write
  before insert or update on public.community_posts
  for each row execute function private.validate_academy_post_write();

revoke insert, update, delete on public.community_posts from authenticated;
revoke insert, update, delete on public.community_comments from authenticated;

create or replace function public.admin_moderate_community_post(
  p_post_id uuid,
  p_status public.content_status default null,
  p_is_pinned boolean default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  community_id uuid;
begin
  select academy_community_id into community_id from public.community_posts where id = p_post_id;
  if community_id is null or not (select private.can_manage_academy(community_id)) then
    raise exception 'Academy administrator access required' using errcode = '42501';
  end if;
  update public.community_posts set
    status = coalesce(p_status, status),
    is_pinned = coalesce(p_is_pinned, is_pinned)
  where id = p_post_id;
end;
$$;

create or replace function public.admin_remove_community_comment(p_comment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  community_id uuid;
begin
  select academy_community_id into community_id from public.community_comments where id = p_comment_id;
  if community_id is null or not (select private.can_manage_academy(community_id)) then
    raise exception 'Academy administrator access required' using errcode = '42501';
  end if;
  update public.community_comments
  set body = '[Removed by Academy moderator]', is_answer = false
  where id = p_comment_id;
end;
$$;

create or replace function public.admin_attach_academy_lesson_asset(
  p_academy_community_id uuid,
  p_course_id uuid,
  p_lesson_id uuid,
  p_title text,
  p_asset_type text,
  p_storage_bucket text,
  p_storage_path text,
  p_mime_type text,
  p_byte_size bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  asset_id uuid;
  asset_reference text := 'academy-asset:' || p_storage_path;
begin
  if not (select private.can_manage_academy(p_academy_community_id)) then
    raise exception 'Academy administrator access required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.course_lessons lesson
    join public.course_modules module on module.id = lesson.module_id
    join public.courses course on course.id = module.course_id
    where lesson.id = p_lesson_id and course.id = p_course_id
      and course.academy_community_id = p_academy_community_id
  ) then
    raise exception 'Lesson does not belong to this Academy course';
  end if;
  insert into public.academy_assets (
    academy_community_id, course_id, lesson_id, title, asset_type,
    storage_bucket, storage_path, original_url, mime_type, byte_size, source_provider
  ) values (
    p_academy_community_id, p_course_id, p_lesson_id, trim(p_title), p_asset_type,
    p_storage_bucket, p_storage_path, asset_reference, nullif(p_mime_type, ''), p_byte_size, 'native'
  ) returning id into asset_id;
  if p_asset_type = 'video' then
    update public.course_lessons set video_url = asset_reference where id = p_lesson_id;
  else
    update public.course_lessons
    set resources = coalesce(resources, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'title', trim(p_title), 'url', asset_reference, 'type', p_asset_type
    ))
    where id = p_lesson_id;
  end if;
  return asset_id;
end;
$$;

with ranked as (
  select id, row_number() over (
    partition by academy_community_id order by updated_at desc, created_at desc, id desc
  ) as position
  from public.academy_certificate_templates where active
)
update public.academy_certificate_templates template
set active = false
from ranked where template.id = ranked.id and ranked.position > 1;

create unique index if not exists academy_certificate_templates_one_active_idx
  on public.academy_certificate_templates(academy_community_id) where active;

create or replace function public.admin_save_certificate_template(
  p_template_id uuid,
  p_academy_community_id uuid,
  p_name text,
  p_title text,
  p_description text,
  p_signatory_name text,
  p_signatory_title text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_id uuid;
begin
  if not (select private.can_manage_academy(p_academy_community_id)) then
    raise exception 'Academy administrator access required' using errcode = '42501';
  end if;
  update public.academy_certificate_templates set active = false
  where academy_community_id = p_academy_community_id
    and (p_template_id is null or id <> p_template_id) and active;
  if p_template_id is null then
    insert into public.academy_certificate_templates (
      academy_community_id, name, title, description, signatory_name, signatory_title, active, created_by
    ) values (
      p_academy_community_id, trim(p_name), trim(p_title), trim(p_description),
      trim(p_signatory_name), trim(p_signatory_title), true, (select auth.uid())
    ) returning id into saved_id;
  else
    update public.academy_certificate_templates set
      name = trim(p_name), title = trim(p_title), description = trim(p_description),
      signatory_name = trim(p_signatory_name), signatory_title = trim(p_signatory_title), active = true
    where id = p_template_id and academy_community_id = p_academy_community_id
    returning id into saved_id;
    if saved_id is null then raise exception 'Certificate template not found'; end if;
  end if;
  return saved_id;
end;
$$;

create or replace function private.validate_academy_certificate_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.academy_members where id = new.academy_member_id and academy_community_id = new.academy_community_id)
     or not exists (select 1 from public.courses where id = new.course_id and academy_community_id = new.academy_community_id)
     or (new.template_id is not null and not exists (
       select 1 from public.academy_certificate_templates where id = new.template_id and academy_community_id = new.academy_community_id
     )) then
    raise exception 'Certificate references must belong to the same Academy';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_academy_certificate_tenant on public.academy_certificates;
create trigger validate_academy_certificate_tenant
  before insert or update on public.academy_certificates
  for each row execute function private.validate_academy_certificate_tenant();

revoke insert, update, delete on public.academy_certificates from authenticated;

create or replace function private.issue_academy_certificate(
  target_member_id uuid,
  target_course_id uuid,
  force_issue boolean default false,
  source_label text default 'automatic'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_row public.academy_members%rowtype;
  course_row public.courses%rowtype;
  template_row public.academy_certificate_templates%rowtype;
  total_lessons integer := 0;
  completed_lessons integer := 0;
  imported_complete boolean := false;
  certificate_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_member_id::text || ':' || target_course_id::text, 0));
  select * into member_row from public.academy_members where id = target_member_id;
  select * into course_row from public.courses where id = target_course_id;
  if member_row.id is null or course_row.id is null
     or member_row.academy_community_id is distinct from course_row.academy_community_id then
    raise exception 'Member and course must belong to the same Academy';
  end if;
  if not force_issue then
    select count(*) into total_lessons from public.course_lessons lesson
    join public.course_modules module on module.id = lesson.module_id
    where module.course_id = target_course_id and lesson.status = 'published';
    select count(*) into completed_lessons from public.course_lessons lesson
    join public.course_modules module on module.id = lesson.module_id
    join public.academy_member_lesson_progress progress
      on progress.lesson_id = lesson.id and progress.academy_member_id = target_member_id
    where module.course_id = target_course_id and lesson.status = 'published'
      and (progress.completed_at is not null or progress.progress_percent = 100);
    select exists (
      select 1 from public.course_enrollments enrollment
      where enrollment.academy_member_id = target_member_id and enrollment.course_id = target_course_id
        and (enrollment.status = 'completed' or enrollment.source_progress_percent >= 100)
    ) into imported_complete;
    if total_lessons = 0 or (completed_lessons < total_lessons and not imported_complete) then return null; end if;
  end if;
  select id into certificate_id from public.academy_certificates
  where academy_member_id = target_member_id and course_id = target_course_id and status = 'active' limit 1;
  if certificate_id is not null then return certificate_id; end if;
  select * into template_row from public.academy_certificate_templates
  where academy_community_id = member_row.academy_community_id and active
  order by updated_at desc, created_at desc limit 1;
  insert into public.academy_certificates (
    academy_community_id, academy_member_id, course_id, template_id,
    recipient_name, course_title, metadata
  ) values (
    member_row.academy_community_id, member_row.id, course_row.id, template_row.id,
    coalesce(nullif(trim(member_row.display_name), ''), 'Academy Member'), course_row.title,
    jsonb_build_object(
      'source', source_label,
      'certificateTitle', coalesce(template_row.title, 'Certificate of Completion'),
      'certificateDescription', coalesce(template_row.description, 'has successfully completed the course'),
      'signatoryName', coalesce(template_row.signatory_name, 'Steve DiFabio'),
      'signatoryTitle', coalesce(template_row.signatory_title, 'Dirty Turf Academy')
    )
  ) returning id into certificate_id;
  return certificate_id;
end;
$$;

revoke all on function public.admin_moderate_community_post(uuid, public.content_status, boolean) from public, anon;
revoke all on function public.admin_remove_community_comment(uuid) from public, anon;
revoke all on function public.admin_attach_academy_lesson_asset(uuid, uuid, uuid, text, text, text, text, text, bigint) from public, anon;
revoke all on function public.admin_save_certificate_template(uuid, uuid, text, text, text, text, text) from public, anon;
grant execute on function public.admin_moderate_community_post(uuid, public.content_status, boolean) to authenticated;
grant execute on function public.admin_remove_community_comment(uuid) to authenticated;
grant execute on function public.admin_attach_academy_lesson_asset(uuid, uuid, uuid, text, text, text, text, text, bigint) to authenticated;
grant execute on function public.admin_save_certificate_template(uuid, uuid, text, text, text, text, text) to authenticated;
