-- Preserve aggregate HighLevel course analytics without inventing lesson-level
-- completion records. Native lesson progress can then advance beyond this floor.

alter table public.course_enrollments
  add column if not exists source_progress_percent integer
    check (source_progress_percent is null or source_progress_percent between 0 and 100),
  add column if not exists source_login_count integer
    check (source_login_count is null or source_login_count >= 0),
  add column if not exists source_last_login_at timestamptz;

comment on column public.course_enrollments.source_progress_percent is
  'Aggregate course completion percentage from the source platform; not a substitute for lesson completion rows.';
comment on column public.course_enrollments.source_login_count is
  'Login count reported by the source course analytics export.';
comment on column public.course_enrollments.source_last_login_at is
  'Last course login reported by the source course analytics export.';
