-- A known lesson UUID must not bypass its published/source-visibility window
-- through a SECURITY DEFINER progress or quiz mutation. Keep member/course
-- authorization, server-computed quiz scores, imported progress and certificate
-- eligibility unchanged. No records, email queues or enrollment grants change.

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
  join public.course_modules visible_module on visible_module.id = lesson.module_id
  where lesson.id = p_lesson_id and lesson.lesson_type = 'quiz'
    and lesson.status = 'published'
    and visible_module.source_archived_at is null
    and (visible_module.sync_owner = 'local' or visible_module.source_visibility = 'published');
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
  from public.course_lessons lesson
  join public.course_modules visible_module on visible_module.id = lesson.module_id
  where lesson.id = p_lesson_id and lesson.status = 'published'
    and visible_module.source_archived_at is null
    and (visible_module.sync_owner = 'local' or visible_module.source_visibility = 'published');
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
