-- Retries verified events waiting for a source author, category, post or reply parent.
-- Raw workflow captures stay private until a verified payload adapter is installed.
select cron.schedule(
  'academy-community-retry', '*/5 * * * *',
  $job$select public.retry_academy_community_events(id,50)
       from public.academy_community_sync_configs where enabled$job$
);
