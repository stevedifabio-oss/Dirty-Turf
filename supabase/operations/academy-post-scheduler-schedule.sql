-- REVIEW-ONLY TEMPLATE. Run only after separate deployment/activation approval,
-- agreed content rules and successful local + controlled recipient acceptance.
-- This file deliberately does not enable either publishing switch or install Cron.
-- 1. Set private.academy_post_scheduler_settings.enabled=true explicitly.
-- 2. Configure ACADEMY_POST_SCHEDULER_ENABLED=true and a dedicated long random
--    ACADEMY_POST_SCHEDULER_SECRET through the protected Edge environment OR the
--    existing service-role-only runtime/Vault allowlist. Environment values win,
--    including explicit false; missing values fall back to Vault and fail closed.
--    Never put these values in client code. Preserve every existing secret.
-- 3. Cron must use the same protected ACADEMY_POST_SCHEDULER_SECRET from Vault
--    (or an explicitly verified matching academy_post_scheduler_secret alias).
-- 4. Review/install ONE named every-minute job calling the worker, with the
--    x-post-scheduler-secret header from Vault and {"limit":25} body.
-- 5. Observe scheduled occurrence/post IDs and independent delivery receipts.
-- Pause by disabling either switch. Do not replay failed/expired occurrences.
-- Publication is independent of the existing email dispatch activation gate.
-- A cron/net request is dispatch evidence, not proof of post/email/push delivery.
select jsonb_build_object('templateOnly',true,'jobInstalled',false,
  'jobName','academy-post-scheduler','proposedCadence','* * * * *',
  'functionPath','/functions/v1/academy-post-scheduler');
