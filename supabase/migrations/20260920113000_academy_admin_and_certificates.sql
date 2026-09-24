-- Launch-critical Academy administration, quiz records, and certificates.
-- All client-facing writes remain protected by Academy manager checks or member identity.

create table public.academy_quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  academy_community_id uuid not null references public.academy_communities(id) on delete cascade,
  academy_member_id uuid not null references public.academy_members(id) on delete cascade,
  lesson_id uuid not null references public.course_lessons(id) on delete cascade,
  score_percent integer not null check (score_percent between 0 and 100),
  passed boolean not null,
  answers jsonb not null default '[]'::jsonb,
  submitted_at timestamptz not null default now()
);

create index academy_quiz_attempts_member_lesson_idx
  on public.academy_quiz_attempts(academy_member_id, lesson_id, submitted_at desc);

create table public.academy_certificate_templates (
  id uuid primary key default gen_random_uuid(),
  academy_community_id uuid not null references public.academy_communities(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  title text not null default 'Certificate of Completion',
  description text not null default 'has successfully completed the course',
  signatory_name text not null default 'Steve DiFabio',
  signatory_title text not null default 'Dirty Turf Academy',
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index academy_certificate_templates_name_idx
  on public.academy_certificate_templates(academy_community_id, lower(name));

create table public.academy_certificates (
  id uuid primary key default gen_random_uuid(),
  academy_community_id uuid not null references public.academy_communities(id) on delete cascade,
  academy_member_id uuid not null references public.academy_members(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  template_id uuid references public.academy_certificate_templates(id) on delete set null,
  recipient_name text not null,
  course_title text not null,
  verification_code uuid not null default gen_random_uuid() unique,
  status text not null default 'active' check (status in ('active', 'revoked')),
  issued_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete set null,
  revoke_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at is null or expires_at > issued_at),
  check (
    (status = 'active' and revoked_at is null)
    or (status = 'revoked' and revoked_at is not null)
  )
);

create table public.academy_member_blocks (
  academy_community_id uuid not null references public.academy_communities(id) on delete cascade,
  blocker_member_id uuid not null references public.academy_members(id) on delete cascade,
  blocked_member_id uuid not null references public.academy_members(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_member_id, blocked_member_id),
  check (blocker_member_id <> blocked_member_id)
);

create unique index academy_certificates_active_member_course_idx
  on public.academy_certificates(academy_member_id, course_id)
  where status = 'active';
create index academy_certificates_community_issued_idx
  on public.academy_certificates(academy_community_id, issued_at desc);

create trigger academy_certificate_templates_updated_at
  before update on public.academy_certificate_templates
  for each row execute function public.set_updated_at();
create trigger academy_certificates_updated_at
  before update on public.academy_certificates
  for each row execute function public.set_updated_at();

alter table public.academy_quiz_attempts enable row level security;
alter table public.academy_certificate_templates enable row level security;
alter table public.academy_certificates enable row level security;
alter table public.academy_member_blocks enable row level security;

grant select, insert on public.academy_quiz_attempts to authenticated;
grant select, insert, update, delete on public.academy_certificate_templates to authenticated;
grant select, insert, update, delete on public.academy_certificates to authenticated;
grant select, insert, delete on public.academy_member_blocks to authenticated;
grant all on public.academy_quiz_attempts, public.academy_certificate_templates,
  public.academy_certificates, public.academy_member_blocks to service_role;

create policy "academy_member_blocks_self_select"
  on public.academy_member_blocks for select to authenticated
  using ((select private.is_academy_identity(blocker_member_id)));
create policy "academy_member_blocks_self_insert"
  on public.academy_member_blocks for insert to authenticated
  with check (
    (select private.is_academy_identity(blocker_member_id))
    and exists (
      select 1 from public.academy_members blocked
      where blocked.id = blocked_member_id
        and blocked.academy_community_id = academy_member_blocks.academy_community_id
    )
  );
create policy "academy_member_blocks_self_delete"
  on public.academy_member_blocks for delete to authenticated
  using ((select private.is_academy_identity(blocker_member_id)));

create policy "content_reports_academy_admin_manage"
  on public.content_reports for all to authenticated
  using (exists (
    select 1 from public.academy_communities community
    where community.owner_organization_id = content_reports.organization_id
      and (select private.can_manage_academy(community.id))
  ))
  with check (exists (
    select 1 from public.academy_communities community
    where community.owner_organization_id = content_reports.organization_id
      and (select private.can_manage_academy(community.id))
  ));

create policy "academy_quiz_attempts_member_or_admin_select"
  on public.academy_quiz_attempts for select to authenticated
  using (
    (select private.is_academy_identity(academy_quiz_attempts.academy_member_id))
    or (select private.can_manage_academy(academy_quiz_attempts.academy_community_id))
  );

revoke insert on public.academy_quiz_attempts from authenticated;

create policy "academy_certificate_templates_member_select"
  on public.academy_certificate_templates for select to authenticated
  using (
    (select private.is_academy_member(academy_community_id))
    or (select private.can_manage_academy(academy_community_id))
  );
create policy "academy_certificate_templates_admin_insert"
  on public.academy_certificate_templates for insert to authenticated
  with check ((select private.can_manage_academy(academy_community_id)));
create policy "academy_certificate_templates_admin_update"
  on public.academy_certificate_templates for update to authenticated
  using ((select private.can_manage_academy(academy_community_id)))
  with check ((select private.can_manage_academy(academy_community_id)));
create policy "academy_certificate_templates_admin_delete"
  on public.academy_certificate_templates for delete to authenticated
  using ((select private.can_manage_academy(academy_community_id)));

create policy "academy_certificates_member_or_admin_select"
  on public.academy_certificates for select to authenticated
  using (
    (select private.is_academy_identity(academy_member_id))
    or (select private.can_manage_academy(academy_community_id))
  );
create policy "academy_certificates_admin_insert"
  on public.academy_certificates for insert to authenticated
  with check ((select private.can_manage_academy(academy_community_id)));
create policy "academy_certificates_admin_update"
  on public.academy_certificates for update to authenticated
  using ((select private.can_manage_academy(academy_community_id)))
  with check ((select private.can_manage_academy(academy_community_id)));
create policy "academy_certificates_admin_delete"
  on public.academy_certificates for delete to authenticated
  using ((select private.can_manage_academy(academy_community_id)));

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
  select * into member_row from public.academy_members where id = target_member_id;
  select * into course_row from public.courses where id = target_course_id;
  if member_row.id is null or course_row.id is null
     or member_row.academy_community_id is distinct from course_row.academy_community_id then
    raise exception 'Member and course must belong to the same Academy';
  end if;

  if not force_issue then
    select count(*) into total_lessons
    from public.course_lessons lesson
    join public.course_modules module on module.id = lesson.module_id
    where module.course_id = target_course_id and lesson.status = 'published';

    select count(*) into completed_lessons
    from public.course_lessons lesson
    join public.course_modules module on module.id = lesson.module_id
    join public.academy_member_lesson_progress progress
      on progress.lesson_id = lesson.id and progress.academy_member_id = target_member_id
    where module.course_id = target_course_id
      and lesson.status = 'published'
      and (progress.completed_at is not null or progress.progress_percent = 100);

    select exists (
      select 1 from public.course_enrollments enrollment
      where enrollment.academy_member_id = target_member_id
        and enrollment.course_id = target_course_id
        and (enrollment.status = 'completed' or enrollment.source_progress_percent >= 100)
    ) into imported_complete;

    if total_lessons = 0 or (completed_lessons < total_lessons and not imported_complete) then
      return null;
    end if;
  end if;

  select * into template_row
  from public.academy_certificate_templates
  where academy_community_id = member_row.academy_community_id and active
  order by created_at
  limit 1;

  select id into certificate_id
  from public.academy_certificates
  where academy_member_id = target_member_id
    and course_id = target_course_id
    and status = 'active'
  limit 1;
  if certificate_id is not null then return certificate_id; end if;

  insert into public.academy_certificates (
    academy_community_id, academy_member_id, course_id, template_id,
    recipient_name, course_title, metadata
  ) values (
    member_row.academy_community_id, member_row.id, course_row.id, template_row.id,
    coalesce(nullif(trim(member_row.display_name), ''), 'Academy Member'),
    course_row.title, jsonb_build_object('source', source_label)
  ) returning id into certificate_id;
  return certificate_id;
end;
$$;

create or replace function public.record_academy_quiz_attempt(
  p_lesson_id uuid,
  p_score_percent integer,
  p_answers jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_row public.academy_members%rowtype;
  lesson_row public.course_lessons%rowtype;
  target_course_id uuid;
  required_score integer := 0;
  requires_passing boolean := false;
  passed boolean := false;
  attempt_id uuid;
  quiz jsonb;
  questions jsonb;
  question jsonb;
  options jsonb;
  correct_text text;
  option_text text;
  question_index integer;
  option_index integer;
  answer_index integer;
  correct_index integer;
  keyed_questions integer := 0;
  correct_answers integer := 0;
  computed_score integer := 0;
begin
  if p_score_percent not between 0 and 100 then raise exception 'Quiz score must be between 0 and 100'; end if;
  if jsonb_typeof(coalesce(p_answers, '[]'::jsonb)) <> 'array' then raise exception 'Quiz answers must be an array'; end if;

  select lesson.* into lesson_row
  from public.course_lessons lesson
  where lesson.id = p_lesson_id and lesson.lesson_type = 'quiz';
  if lesson_row.id is null then raise exception 'Quiz lesson not found'; end if;

  select module.course_id into target_course_id
  from public.course_modules module
  where module.id = lesson_row.module_id;

  select member.* into member_row
  from public.academy_members member
  join public.courses course on course.id = target_course_id
  where member.user_id = (select auth.uid())
    and member.status = 'active'
    and member.academy_community_id = course.academy_community_id
    and (select private.can_access_course(course.id))
  limit 1;
  if member_row.id is null then raise exception 'Quiz is not available'; end if;

  quiz := lesson_row.body->'quiz';
  questions := quiz->'questions';
  if jsonb_typeof(questions) <> 'array' or jsonb_array_length(questions) = 0 then
    raise exception 'Quiz has no valid questions';
  end if;
  if jsonb_array_length(p_answers) <> jsonb_array_length(questions) then
    raise exception 'Answer every quiz question before submitting';
  end if;

  for question_index in 0..jsonb_array_length(questions) - 1 loop
    question := questions->question_index;
    options := question->'options';
    if jsonb_typeof(options) <> 'array' or jsonb_array_length(options) < 2 then continue; end if;
    answer_index := (p_answers->>question_index)::integer;
    if answer_index < 0 or answer_index >= jsonb_array_length(options) then
      raise exception 'Quiz answer is out of range';
    end if;
    correct_index := null;
    if jsonb_typeof(question->'correctOptionIndex') = 'number' then
      correct_index := (question->>'correctOptionIndex')::integer;
    else
      correct_text := lower(regexp_replace(regexp_replace(coalesce(
        case jsonb_typeof(question->'explanation')
          when 'string' then question->>'explanation'
          when 'object' then coalesce(question#>>'{explanation,text}', question#>>'{explanation,html}', '')
          else ''
        end, ''), '<[^>]*>', '', 'g'), '[^a-z0-9]+', '', 'g'));
      if correct_text <> '' then
        for option_index in 0..jsonb_array_length(options) - 1 loop
          option_text := lower(regexp_replace(regexp_replace(coalesce(
            case jsonb_typeof(options->option_index)
              when 'string' then options->>option_index
              when 'object' then coalesce(options#>>array[option_index::text,'text'], options#>>array[option_index::text,'html'], '')
              else ''
            end, ''), '<[^>]*>', '', 'g'), '[^a-z0-9]+', '', 'g'));
          if option_text = correct_text then correct_index := option_index; exit; end if;
        end loop;
      end if;
    end if;
    if correct_index is not null then
      keyed_questions := keyed_questions + 1;
      if answer_index = correct_index then correct_answers := correct_answers + 1; end if;
    end if;
  end loop;

  computed_score := case when keyed_questions > 0 then round(correct_answers::numeric * 100 / keyed_questions)::integer else 0 end;
  if keyed_questions > 0 and p_score_percent <> computed_score then
    raise exception 'Quiz score does not match the submitted answers';
  end if;
  requires_passing := coalesce((quiz->>'requiresPassing')::boolean, false);
  required_score := coalesce((quiz->>'passingPercent')::integer, case when requires_passing then 100 else 0 end);
  passed := not requires_passing or (keyed_questions > 0 and computed_score >= required_score);

  insert into public.academy_quiz_attempts (
    academy_community_id, academy_member_id, lesson_id, score_percent, passed, answers
  ) values (
    member_row.academy_community_id, member_row.id, lesson_row.id,
    computed_score, passed, coalesce(p_answers, '[]'::jsonb)
  ) returning id into attempt_id;

  if passed then
    insert into public.academy_member_lesson_progress (
      academy_member_id, lesson_id, progress_percent, completed_at
    ) values (member_row.id, lesson_row.id, 100, now())
    on conflict (academy_member_id, lesson_id) do update
      set progress_percent = 100, completed_at = coalesce(public.academy_member_lesson_progress.completed_at, now()), updated_at = now();
  end if;

  perform private.issue_academy_certificate(member_row.id, target_course_id, false, 'quiz_completion');
  return jsonb_build_object('attemptId', attempt_id, 'passed', passed, 'requiredScore', required_score);
end;
$$;

-- Members record lesson progress through validated RPCs. Direct client writes are
-- reserved for Academy administrators so required quizzes cannot be bypassed.
drop policy if exists "academy_progress_member_or_admin_insert" on public.academy_member_lesson_progress;
drop policy if exists "academy_progress_member_or_admin_update" on public.academy_member_lesson_progress;
drop policy if exists "academy_progress_member_or_admin_delete" on public.academy_member_lesson_progress;
create policy "academy_progress_admin_insert" on public.academy_member_lesson_progress
  for insert to authenticated with check (exists (
    select 1 from public.course_lessons lesson
    join public.course_modules module on module.id = lesson.module_id
    join public.courses course on course.id = module.course_id
    where lesson.id = academy_member_lesson_progress.lesson_id
      and (select private.can_manage_academy(course.academy_community_id))
  ));
create policy "academy_progress_admin_update" on public.academy_member_lesson_progress
  for update to authenticated using (exists (
    select 1 from public.course_lessons lesson
    join public.course_modules module on module.id = lesson.module_id
    join public.courses course on course.id = module.course_id
    where lesson.id = academy_member_lesson_progress.lesson_id
      and (select private.can_manage_academy(course.academy_community_id))
  )) with check (exists (
    select 1 from public.course_lessons lesson
    join public.course_modules module on module.id = lesson.module_id
    join public.courses course on course.id = module.course_id
    where lesson.id = academy_member_lesson_progress.lesson_id
      and (select private.can_manage_academy(course.academy_community_id))
  ));
create policy "academy_progress_admin_delete" on public.academy_member_lesson_progress
  for delete to authenticated using (exists (
    select 1 from public.course_lessons lesson
    join public.course_modules module on module.id = lesson.module_id
    join public.courses course on course.id = module.course_id
    where lesson.id = academy_member_lesson_progress.lesson_id
      and (select private.can_manage_academy(course.academy_community_id))
  ));

create or replace function public.set_academy_lesson_completion(p_lesson_id uuid, p_completed boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_member_id uuid;
  target_lesson public.course_lessons%rowtype;
  target_course_id uuid;
  requires_passing boolean := false;
begin
  select lesson.* into target_lesson
  from public.course_lessons lesson where lesson.id = p_lesson_id;
  select module.course_id into target_course_id
  from public.course_modules module where module.id = target_lesson.module_id;
  select member.id into target_member_id
  from public.academy_members member
  join public.courses course on course.id = target_course_id
  where member.user_id = (select auth.uid())
    and member.academy_community_id = course.academy_community_id
    and member.status = 'active'
    and (select private.can_access_course(course.id))
  limit 1;
  if target_member_id is null or target_lesson.id is null then raise exception 'Lesson is not available'; end if;

  requires_passing := target_lesson.lesson_type = 'quiz'
    and coalesce((target_lesson.body #>> '{quiz,requiresPassing}')::boolean, false);
  if p_completed and requires_passing and not exists (
    select 1 from public.academy_quiz_attempts attempt
    where attempt.academy_member_id = target_member_id
      and attempt.lesson_id = target_lesson.id and attempt.passed
  ) then
    raise exception 'Pass the quiz before completing this lesson' using errcode = '42501';
  end if;

  insert into public.academy_member_lesson_progress (
    academy_member_id, lesson_id, progress_percent, completed_at
  ) values (
    target_member_id, p_lesson_id, case when p_completed then 100 else 0 end,
    case when p_completed then now() else null end
  ) on conflict (academy_member_id, lesson_id) do update
    set progress_percent = excluded.progress_percent,
        completed_at = excluded.completed_at,
        updated_at = now();
end;
$$;

create or replace function public.issue_my_academy_certificate(p_course_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_id uuid;
begin
  select member.id into member_id
  from public.academy_members member
  join public.courses course on course.academy_community_id = member.academy_community_id
  where member.user_id = (select auth.uid())
    and member.status = 'active'
    and course.id = p_course_id
    and (select private.can_access_course(course.id))
  limit 1;
  if member_id is null then raise exception 'Course is not available'; end if;
  return private.issue_academy_certificate(member_id, p_course_id, false, 'member_completion');
end;
$$;

create or replace function public.admin_issue_academy_certificate(
  p_member_id uuid,
  p_course_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  community_id uuid;
begin
  select academy_community_id into community_id from public.academy_members where id = p_member_id;
  if community_id is null or not (select private.can_manage_academy(community_id)) then
    raise exception 'Academy administrator access required' using errcode = '42501';
  end if;
  return private.issue_academy_certificate(p_member_id, p_course_id, true, 'admin');
end;
$$;

create or replace function public.admin_revoke_academy_certificate(
  p_certificate_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  community_id uuid;
begin
  select academy_community_id into community_id
  from public.academy_certificates where id = p_certificate_id;
  if community_id is null or not (select private.can_manage_academy(community_id)) then
    raise exception 'Academy administrator access required' using errcode = '42501';
  end if;
  update public.academy_certificates
  set status = 'revoked', revoked_at = now(), revoked_by = (select auth.uid()),
      revoke_reason = nullif(trim(coalesce(p_reason, '')), '')
  where id = p_certificate_id and status = 'active';
end;
$$;

create or replace function public.verify_academy_certificate(p_verification_code uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'valid', certificate.status = 'active' and (certificate.expires_at is null or certificate.expires_at > now()),
    'recipientName', certificate.recipient_name,
    'courseTitle', certificate.course_title,
    'issuedAt', certificate.issued_at,
    'status', certificate.status
  )
  from public.academy_certificates certificate
  where certificate.verification_code = p_verification_code;
$$;

create or replace function private.maybe_issue_academy_certificate_from_progress()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  course_id uuid;
begin
  if new.progress_percent < 100 and new.completed_at is null then return new; end if;
  select module.course_id into course_id
  from public.course_lessons lesson
  join public.course_modules module on module.id = lesson.module_id
  where lesson.id = new.lesson_id;
  if course_id is not null then
    perform private.issue_academy_certificate(new.academy_member_id, course_id, false, 'lesson_completion');
  end if;
  return new;
end;
$$;

create trigger academy_progress_certificate_issue
  after insert or update of progress_percent, completed_at
  on public.academy_member_lesson_progress
  for each row execute function private.maybe_issue_academy_certificate_from_progress();

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
    update public.course_enrollments
    set status = 'cancelled', updated_at = now()
    where academy_member_id = member_row.id and course_id = course_row.id;
    update public.academy_access_grants
    set status = 'revoked', updated_at = now()
    where academy_member_id = member_row.id and course_id = course_row.id
      and source_type = 'manual'
      and academy_access_grants.source_key = grant_source_key;
  end if;
end;
$$;

create or replace function public.report_academy_content(
  p_content_type text,
  p_content_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_member public.academy_members%rowtype;
  target_organization_id uuid;
  target_community_id uuid;
  report_id uuid;
begin
  if p_content_type not in ('post', 'comment', 'member') then
    raise exception 'Unsupported report type';
  end if;
  if char_length(trim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'Report reason must be between 3 and 500 characters';
  end if;

  select * into target_member
  from public.academy_members member
  where member.user_id = (select auth.uid()) and member.status = 'active'
  order by member.created_at limit 1;
  if target_member.id is null then raise exception 'Active Academy membership required'; end if;

  target_community_id := case p_content_type
    when 'post' then (select post.academy_community_id from public.community_posts post where post.id = p_content_id)
    when 'comment' then (select comment.academy_community_id from public.community_comments comment where comment.id = p_content_id)
    else (select member.academy_community_id from public.academy_members member where member.id = p_content_id)
  end;
  if target_community_id is distinct from target_member.academy_community_id then
    raise exception 'Reported content is not available';
  end if;

  select community.owner_organization_id into target_organization_id
  from public.academy_communities community where community.id = target_community_id;
  insert into public.content_reports (
    organization_id, reporter_id, content_type, content_id, reason
  ) values (
    target_organization_id, (select auth.uid()), p_content_type, p_content_id, trim(p_reason)
  ) returning id into report_id;
  return report_id;
end;
$$;

create or replace function public.toggle_academy_member_block(p_member_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_member public.academy_members%rowtype;
  blocked_member public.academy_members%rowtype;
begin
  select * into target_member
  from public.academy_members member
  where member.user_id = (select auth.uid()) and member.status = 'active'
  order by member.created_at limit 1;
  select * into blocked_member from public.academy_members where id = p_member_id;
  if target_member.id is null or blocked_member.id is null
     or blocked_member.academy_community_id is distinct from target_member.academy_community_id
     or blocked_member.id = target_member.id then
    raise exception 'Member cannot be blocked';
  end if;

  if exists (
    select 1 from public.academy_member_blocks block
    where block.blocker_member_id = target_member.id
      and block.blocked_member_id = blocked_member.id
  ) then
    delete from public.academy_member_blocks block
    where block.blocker_member_id = target_member.id
      and block.blocked_member_id = blocked_member.id;
    return false;
  end if;

  insert into public.academy_member_blocks (
    academy_community_id, blocker_member_id, blocked_member_id
  ) values (
    target_member.academy_community_id, target_member.id, blocked_member.id
  );
  return true;
end;
$$;

create or replace view public.community_feed with (security_invoker = true) as
select
  post.id,
  post.academy_community_id,
  post.title,
  post.body,
  coalesce(nullif(profile.full_name, ''), nullif(member.display_name, ''), 'Member') as author_name,
  count(distinct comment.id)::integer as reply_count,
  post.created_at,
  coalesce(category.name, 'General') as category_name,
  post.is_pinned,
  post.media,
  (
    (select count(*) from public.community_post_reactions reaction where reaction.post_id = post.id)
    + (select count(*) from public.academy_post_reactions reaction where reaction.post_id = post.id)
  )::integer as like_count,
  post.academy_author_id
from public.community_posts post
left join public.profiles profile on profile.id = post.author_id
left join public.academy_members member on member.id = post.academy_author_id
left join public.community_categories category on category.id = post.category_id
left join public.community_comments comment on comment.post_id = post.id
where post.status = 'published'
  and not exists (
    select 1
    from public.academy_member_blocks block
    join public.academy_members viewer on viewer.id = block.blocker_member_id
    where viewer.user_id = (select auth.uid())
      and block.blocked_member_id = post.academy_author_id
  )
group by post.id, profile.full_name, member.display_name, category.name;

create or replace view public.academy_comment_feed with (security_invoker = true) as
select
  comment.id,
  comment.academy_community_id,
  comment.post_id,
  comment.parent_id,
  coalesce(nullif(profile.full_name, ''), nullif(member.display_name, ''), 'Member') as author_name,
  comment.body,
  comment.is_answer,
  comment.created_at,
  (
    (select count(*) from public.community_comment_reactions reaction where reaction.comment_id = comment.id)
    + (select count(*) from public.academy_comment_reactions reaction where reaction.comment_id = comment.id)
  )::integer as like_count,
  comment.academy_author_id
from public.community_comments comment
left join public.profiles profile on profile.id = comment.author_id
left join public.academy_members member on member.id = comment.academy_author_id
where not exists (
  select 1
  from public.academy_member_blocks block
  join public.academy_members viewer on viewer.id = block.blocker_member_id
  where viewer.user_id = (select auth.uid())
    and block.blocked_member_id = comment.academy_author_id
)
group by comment.id, profile.full_name, member.display_name;

grant select on public.community_feed, public.academy_comment_feed to authenticated;

-- A restricted channel must remain restricted even when clients are modified.
create or replace function public.create_community_post(
  p_title text,
  p_body text,
  p_category_name text,
  p_mentioned_member_ids uuid[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_member public.academy_members%rowtype;
  target_organization_id uuid;
  target_category public.community_categories%rowtype;
  new_post_id uuid;
  mentioned_member_id uuid;
begin
  if char_length(trim(coalesce(p_title, ''))) not between 1 and 120 then raise exception 'Post title must be between 1 and 120 characters'; end if;
  if char_length(trim(coalesce(p_body, ''))) not between 1 and 5000 then raise exception 'Post body must be between 1 and 5000 characters'; end if;
  if char_length(trim(coalesce(p_category_name, ''))) > 80 then raise exception 'Post category is too long'; end if;

  select * into target_member
  from public.academy_members
  where user_id = (select auth.uid()) and status = 'active'
  order by created_at limit 1;
  if target_member.id is null then raise exception 'No active Academy membership found'; end if;

  select owner_organization_id into target_organization_id
  from public.academy_communities where id = target_member.academy_community_id;
  if target_organization_id is null then raise exception 'Academy owner organization is not configured'; end if;

  select * into target_category
  from public.community_categories
  where academy_community_id = target_member.academy_community_id
    and lower(name) = lower(coalesce(nullif(trim(p_category_name), ''), 'General'))
  order by sort_order limit 1;
  if target_category.id is null then raise exception 'Community category not found'; end if;
  if not target_category.member_can_post
     and not (select private.can_manage_academy(target_member.academy_community_id)) then
    raise exception 'Only Academy administrators can post in this category' using errcode = '42501';
  end if;

  insert into public.community_posts (
    organization_id, author_id, academy_community_id, academy_author_id,
    category_id, title, body, status
  ) values (
    target_organization_id, (select auth.uid()), target_member.academy_community_id,
    target_member.id, target_category.id, trim(p_title), trim(p_body), 'published'
  ) returning id into new_post_id;

  foreach mentioned_member_id in array coalesce(p_mentioned_member_ids, '{}'::uuid[]) loop
    if mentioned_member_id <> target_member.id and exists (
      select 1 from public.academy_members member
      where member.id = mentioned_member_id
        and member.academy_community_id = target_member.academy_community_id
        and member.status = 'active'
    ) then
      insert into public.academy_content_mentions (
        academy_community_id, post_id, mentioned_member_id, actor_member_id
      ) values (
        target_member.academy_community_id, new_post_id,
        mentioned_member_id, target_member.id
      ) on conflict do nothing;
    end if;
  end loop;
  return new_post_id;
end;
$$;

revoke all on function private.issue_academy_certificate(uuid, uuid, boolean, text) from public, anon, authenticated;
revoke all on function private.maybe_issue_academy_certificate_from_progress() from public, anon, authenticated;
revoke all on function public.record_academy_quiz_attempt(uuid, integer, jsonb) from public, anon;
revoke all on function public.issue_my_academy_certificate(uuid) from public, anon;
revoke all on function public.admin_issue_academy_certificate(uuid, uuid) from public, anon;
revoke all on function public.admin_revoke_academy_certificate(uuid, text) from public, anon;
revoke all on function public.verify_academy_certificate(uuid) from public;
revoke all on function public.admin_set_member_course_access(uuid, uuid, boolean) from public, anon;
revoke all on function public.report_academy_content(text, uuid, text) from public, anon;
revoke all on function public.toggle_academy_member_block(uuid) from public, anon;
revoke all on function public.create_community_post(text, text, text, uuid[]) from public, anon;
grant execute on function public.record_academy_quiz_attempt(uuid, integer, jsonb) to authenticated;
grant execute on function public.issue_my_academy_certificate(uuid) to authenticated;
grant execute on function public.admin_issue_academy_certificate(uuid, uuid) to authenticated;
grant execute on function public.admin_revoke_academy_certificate(uuid, text) to authenticated;
grant execute on function public.verify_academy_certificate(uuid) to public, anon, authenticated;
grant execute on function public.admin_set_member_course_access(uuid, uuid, boolean) to authenticated;
grant execute on function public.report_academy_content(text, uuid, text) to authenticated;
grant execute on function public.toggle_academy_member_block(uuid) to authenticated;
grant execute on function public.create_community_post(text, text, text, uuid[]) to authenticated;

comment on table public.academy_certificates is
  'Issued and revocable Academy course-completion certificates with public verification codes.';
comment on table public.academy_quiz_attempts is
  'Persisted quiz scores used to enforce passing requirements before lesson completion.';
