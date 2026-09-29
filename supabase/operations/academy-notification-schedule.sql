-- Run after Mailgun configuration, recipient delivery verification and DB cutover.
-- Requires pg_cron + pg_net. Secrets stay in Vault, never in the cron command.
-- Re-running updates the same named job instead of adding a duplicate.
begin;
do $check$
begin
  if not exists (select 1 from pg_extension where extname='pg_cron')
     or not exists (select 1 from pg_extension where extname='pg_net') then
    raise exception 'Enable pg_cron and pg_net before scheduling notifications';
  end if;
  if not exists (select 1 from private.academy_email_cutover where id and enabled and enabled_at <= now()) then
    raise exception 'Notification cutover is not active';
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name='project_url' and decrypted_secret ~ '^https://[a-z0-9]+\.supabase\.co$')
     or not exists (select 1 from vault.decrypted_secrets where name='academy_notification_dispatch_secret' and length(decrypted_secret) >= 32) then
    raise exception 'Notification Vault configuration is missing or invalid';
  end if;
end;
$check$;
select cron.schedule(
  'academy-notification-dispatch',
  '*/5 * * * *',
  $schedule$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='project_url') || '/functions/v1/academy-notifications',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-notification-secret',(select decrypted_secret from vault.decrypted_secrets where name='academy_notification_dispatch_secret')
    ),
    body := '{"limit":25}'::jsonb,
    timeout_milliseconds := 120000
  ) where exists (select 1 from private.academy_email_cutover where id and enabled);
  $schedule$
);
commit;

-- To pause immediately: select cron.unschedule('academy-notification-dispatch');
