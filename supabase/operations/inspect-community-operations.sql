-- Read-only operational summary. Contains no recipients, message bodies,
-- credentials, device tokens, cron commands or provider response bodies.
-- A cron SQL success is separate from an Edge Function or provider success.
with recent_http as (
  select created,status_code,timed_out,
    case when pg_input_is_valid(content,'jsonb') then content::jsonb end as body
  from net._http_response where created>now()-interval '20 minutes'
), dispatch_responses as (
  select created,status_code,timed_out,body->'claimed' as claimed,
    body->'sent' as provider_accepted,body->'reviewRequired' as review_required,
    body->'retrying' as retrying,body->'enabled' as enabled
  from recent_http
  where body ? 'claimed' or body ? 'reviewRequired' or body ? 'enabled'
  order by created desc limit 12
)
select jsonb_build_object(
  'checkedAt',now(),
  'jobs',(select coalesce(jsonb_agg(jsonb_build_object(
    'name',jobname,'active',active,'schedule',schedule)),'[]'::jsonb)
    from cron.job where jobname in (
      'academy-notification-dispatch','academy-post-scheduler','academy-push-dispatch')),
  'dispatchResponses',(select coalesce(jsonb_agg(x),'[]'::jsonb) from dispatch_responses x),
  'emailOutbox',(select coalesce(jsonb_agg(x),'[]'::jsonb) from (
    select status,count(*) as count,min(created_at) as oldest,
      max(sent_at) as latest_provider_acceptance
    from public.academy_email_deliveries group by status) x),
  'unresolvedReports',(select coalesce(jsonb_agg(x),'[]'::jsonb) from (
    select status,content_type,count(*) as count,min(created_at) as oldest
    from public.content_reports where status in ('open','reviewing')
    group by status,content_type) x),
  'scheduledPublishingInstalled',to_regclass('public.academy_post_schedules') is not null,
  'phonePushInstalled',to_regclass('private.academy_push_deliveries') is not null
);
