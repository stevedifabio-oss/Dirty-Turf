-- Native authoring has no external source ID. NULLS NOT DISTINCT incorrectly
-- allowed only one native course per organization and one native lesson per
-- module. Keep the original constraint names and complete column keys so
-- imported non-null identities and ON CONFLICT column inference stay intact.
-- These statements replace only indexes/constraints; no content, access,
-- learning progress, source ownership, or RLS policy is changed.
alter table public.courses
  drop constraint courses_organization_id_external_id_key,
  add constraint courses_organization_id_external_id_key
    unique nulls distinct (organization_id, external_id);

alter table public.course_lessons
  drop constraint course_lessons_module_id_external_id_key,
  add constraint course_lessons_module_id_external_id_key
    unique nulls distinct (module_id, external_id);
