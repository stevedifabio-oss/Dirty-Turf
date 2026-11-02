-- Arrange existing identities only. RLS remains in force and the existing local
-- ownership triggers prevent GHL from overwriting locally changed positions.
create or replace function public.save_academy_course_order(p_course_id uuid, p_original jsonb, p_next jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  course public.courses%rowtype;
  payload jsonb; module jsonb; lesson jsonb;
  module_map jsonb; lesson_map jsonb;
  original_modules jsonb; original_lessons jsonb;
  next_modules jsonb; next_lessons jsonb;
  current_modules jsonb; current_lessons jsonb;
  module_id uuid; lesson_id uuid; position integer; previous_position integer;
  lesson_position integer; previous_lesson_position integer;
  hidden_module public.course_modules%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'Administrator access required' using errcode='42501'; end if;
  select * into course from public.courses where id=p_course_id for update;
  if not found or not (
    coalesce((select private.can_manage_academy(course.academy_community_id)), false)
    or coalesce((select public.is_organization_admin(course.organization_id)), false)
  ) then raise exception 'Administrator access required' using errcode='42501'; end if;

  if p_original is null or p_next is null
    or jsonb_typeof(p_original) <> 'array' or jsonb_typeof(p_next) <> 'array'
    or jsonb_array_length(p_original) > 10000 or jsonb_array_length(p_next) > 10000
  then raise exception 'Invalid course order' using errcode='22023'; end if;

  -- Lock parents before children. Parent FK locks also serialize new children
  -- with this transaction; a stale draft must never silently omit existing rows.
  perform id from public.course_modules where course_id=p_course_id order by id for update;
  perform l.id from public.course_lessons l join public.course_modules m on m.id=l.module_id
    where m.course_id=p_course_id order by l.id for update of l;

  foreach payload in array array[p_original,p_next] loop
    module_map := '{}'::jsonb; lesson_map := '{}'::jsonb; previous_position := null;
    for module in select value from jsonb_array_elements(payload) loop
      if jsonb_typeof(module) <> 'object' or jsonb_typeof(module->'id') is distinct from 'string'
        or jsonb_typeof(module->'sortOrder') is distinct from 'number'
        or jsonb_typeof(module->'lessons') is distinct from 'array'
      then raise exception 'Invalid module order' using errcode='22023'; end if;
      module_id := (module->>'id')::uuid; position := (module->>'sortOrder')::integer;
      if module_map ? module_id::text or position < 0 or (previous_position is not null and position < previous_position)
      then raise exception 'Duplicate or unordered module' using errcode='22023'; end if;
      module_map := module_map || jsonb_build_object(module_id::text,position);
      previous_position := position; previous_lesson_position := null;
      for lesson in select value from jsonb_array_elements(module->'lessons') loop
        if jsonb_typeof(lesson) <> 'object' or jsonb_typeof(lesson->'id') is distinct from 'string'
          or jsonb_typeof(lesson->'sortOrder') is distinct from 'number'
        then raise exception 'Invalid lesson order' using errcode='22023'; end if;
        lesson_id := (lesson->>'id')::uuid; lesson_position := (lesson->>'sortOrder')::integer;
        if lesson_map ? lesson_id::text or lesson_position < 0
          or (previous_lesson_position is not null and lesson_position < previous_lesson_position)
        then raise exception 'Duplicate or unordered lesson' using errcode='22023'; end if;
        lesson_map := lesson_map || jsonb_build_object(lesson_id::text,jsonb_build_object('moduleId',module_id,'sortOrder',lesson_position));
        previous_lesson_position := lesson_position;
      end loop;
    end loop;
    if original_modules is null then original_modules := module_map; original_lessons := lesson_map;
    else next_modules := module_map; next_lessons := lesson_map; end if;
  end loop;

  select coalesce(jsonb_object_agg(id::text,sort_order),'{}'::jsonb) into current_modules
    from public.course_modules where course_id=p_course_id;
  select coalesce(jsonb_object_agg(l.id::text,jsonb_build_object('moduleId',l.module_id,'sortOrder',l.sort_order)),'{}'::jsonb)
    into current_lessons from public.course_lessons l join public.course_modules m on m.id=l.module_id where m.course_id=p_course_id;
  if original_modules <> current_modules or original_lessons <> current_lessons
  then raise exception 'Course changed while arranging; reload and try again' using errcode='40001'; end if;
  if (select array_agg(key order by key) from jsonb_object_keys(next_modules) key)
      is distinct from (select array_agg(key order by key) from jsonb_object_keys(current_modules) key)
    or (select array_agg(key order by key) from jsonb_object_keys(next_lessons) key)
      is distinct from (select array_agg(key order by key) from jsonb_object_keys(current_lessons) key)
  then raise exception 'Arrangement must preserve all course modules and lessons' using errcode='22023'; end if;

  -- Editing a hidden HighLevel module would switch its owner to local, which
  -- would make it visible. Leave its position and every child unchanged instead.
  for hidden_module in select * from public.course_modules where course_id=p_course_id
    and (source_archived_at is not null or (sync_owner='highlevel' and source_visibility='draft')) loop
    if next_modules->hidden_module.id::text <> current_modules->hidden_module.id::text
      or exists(select 1 from jsonb_each(current_lessons) old_l full join jsonb_each(next_lessons) new_l on old_l.key=new_l.key
        where (old_l.value->>'moduleId'=hidden_module.id::text or new_l.value->>'moduleId'=hidden_module.id::text)
          and old_l.value is distinct from new_l.value)
    then raise exception 'Source-hidden or archived modules cannot be rearranged' using errcode='22023'; end if;
  end loop;

  update public.course_modules m set sort_order=(n.value::text)::integer
    from jsonb_each(next_modules) n where m.id=n.key::uuid and m.course_id=p_course_id and m.sort_order is distinct from (n.value::text)::integer;
  update public.course_lessons l set module_id=(n.value->>'moduleId')::uuid, sort_order=(n.value->>'sortOrder')::integer
    from jsonb_each(next_lessons) n where l.id=n.key::uuid
      and (l.module_id,l.sort_order) is distinct from ((n.value->>'moduleId')::uuid,(n.value->>'sortOrder')::integer);
end;
$$;
revoke all on function public.save_academy_course_order(uuid,jsonb,jsonb) from public,anon;
grant execute on function public.save_academy_course_order(uuid,jsonb,jsonb) to authenticated;
