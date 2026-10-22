-- Certificate completion must use the same published lesson window as the
-- member library. Source categories can be draft while their lessons remain
-- published; those hidden lessons must not prevent a visible-course completion.
-- Keep tenant checks, imported completion, administrator overrides and the
-- existing private-only execution boundary unchanged.
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
    where module.course_id = target_course_id and lesson.status = 'published'
      and module.source_archived_at is null
      and (module.sync_owner = 'local' or module.source_visibility = 'published');
    select count(*) into completed_lessons from public.course_lessons lesson
    join public.course_modules module on module.id = lesson.module_id
    join public.academy_member_lesson_progress progress
      on progress.lesson_id = lesson.id and progress.academy_member_id = target_member_id
    where module.course_id = target_course_id and lesson.status = 'published'
      and module.source_archived_at is null
      and (module.sync_owner = 'local' or module.source_visibility = 'published')
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

revoke all on function private.issue_academy_certificate(uuid, uuid, boolean, text)
  from public, anon, authenticated;
