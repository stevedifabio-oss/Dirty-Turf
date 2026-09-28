-- RELEASE TEMPLATE ONLY. Do not execute until the held release is authorized.
-- Requires pg_cron + pg_net and previously configured Vault secrets.
-- Do not put real secrets in this file or commit them in migrations.
-- First run the worker manually and inspect academy_course_sync_runs.
select cron.schedule(
  'academy-course-sync',
  '*/5 * * * *',
  $schedule$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='project_url') || '/functions/v1/academy-course-sync',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-course-sync-secret',(select decrypted_secret from vault.decrypted_secrets where name='academy_course_sync_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $schedule$
);
