# Dirty Turf Academy release runbook

The web app, iOS app, and Android app share one React application and one
Supabase backend. A release is complete only when all three clients pass the
same authenticated member path. A simulator build or an unauthenticated
preview is evidence for compilation and layout, not production acceptance.

## Release order

1. Point `app.dirtyturf.com` at Netlify, finish ownership verification, and
   wait for a valid TLS certificate.
2. Configure the existing verified Mailgun domain as Supabase custom SMTP and
   add the Mailgun API values plus two generated notification secrets to Edge
   Function secrets.
3. Verify custom SMTP and both web and native Magic Link redirects. Deploy the
   notification function, send to one internal recipient, verify direct links
   and unsubscribe, then enable its five-minute Cron schedule.
4. Create the permanent owner and normal test member.
5. Run the source access audit, import dry run, one commit, and an idempotent
   repeat. Provision all current members without sending email.
6. Prove Stripe in test mode, including webhook replay and cancellation grant
   precedence.
7. Publish the PR preview and run the complete smoke, responsive, and
   authenticated golden paths.
8. Merge to `main`, wait for the exact production deploy, and repeat the smoke
   and authenticated paths.
9. Build signed TestFlight and Play Internal releases. Run physical iPhone and
   Android measurement tests.
10. Pilot 3-5 members, capture the final GHL delta, then notify the remaining
   members in batches of 25 or fewer.

## Automated preflight

```bash
npm ci
npm run academy:access-audit
npm run check
npm run native:sync
npm run release:smoke -- https://DEPLOY_URL --expected-origin https://app.dirtyturf.com --expect-security-headers
```

The same checks can be run as one gate. Before DNS cutover, use the deploy
preview form; after DNS and TLS are ready, include `--check-domain`:

```bash
npm run release:preflight -- --deploy https://DEPLOY_URL
npm run release:preflight -- --check-domain
```

`npm run release:domain` reports the Netlify ownership TXT, CNAME, HTTPS/TLS,
and HTTP-to-HTTPS status separately, so an incomplete DNS handoff is visible
without being confused with an application failure.

`npm run check` includes a credential-pattern scan, migration/RLS contract
checks, TypeScript, unit tests, the production build, public legal-page checks,
and the PWA offline manifest check.

## Golden path

- Unknown email receives the neutral response but cannot create an account.
- Provisioned member receives one Magic Link and reaches the assigned course.
- Expired and reused links fail without creating another account.
- Academy, lesson progress, community, comments, events, and RSVPs persist.
- The notification bell receives comments, replies, mentions, likes, new
  posts, announcements, courses, events, and reminders in realtime.
- One internal recipient receives every email template with the correct
  sender, subject, responsive layout, direct link, unsubscribe link, and no
  duplicate after a dispatcher retry.
- Turning off one email category suppresses only that category; the master
  switch suppresses all community mail while in-app alerts remain visible.
- Manual length x width, map polygons, and native live points produce the same
  infill formula and rounded-up 40-lb/50-lb bags.
- A saved calculation reopens on a second authorized device.
- Web billing opens Stripe-hosted Checkout and Customer Portal.
- Native iOS/Android expose no purchase or external checkout control.
- Privacy, support, and account-deletion pages work while signed out.
- An authenticated deletion request is visible only to its requesting user.

## Release evidence record

Fill every row during the production release. Never put passwords, Magic Links,
member emails, private tokens, or reviewer credentials in this repository.

| Evidence | Value |
| --- | --- |
| Git commit SHA | Record the immutable merge SHA at release |
| GitHub PR and successful run | `stevedifabio-oss/Dirty-Turf#2`; require the latest head to pass immediately before merge |
| Netlify deploy ID and URL | Preview is ready at `https://deploy-preview-2--bright-brigadeiros-df8b48.netlify.app`; record the production deploy after merge |
| Supabase migrations | 15 applied / 53 public RLS-protected tables; recheck at production release |
| Supabase Edge Function versions | Nine deployed; record immutable versions at production release |
| Source archive SHA-256 | `0e1f53311b4635a7ed2969ff5bf6e2b038781eeb3126a958e3aaea82633f1aee` |
| Local automated gate | Record current test count, typecheck, build, PWA, schema, and secret scan result |
| Native candidate proof | Android debug/release AAB and iOS Release simulator launch passed; embedded app-shell hashes match |
| Smoke-test account owner | Client vault only |
| iPhone model / OS / AR error | Pending physical test |
| Android model / OS / AR error | Pending physical test |
| TestFlight build | Pending signed build |
| Play Internal build | Pending signed build |
| Rollback owner | Pending client assignment |
| Final sign-off owner / timestamp | Pending client approval |

## Rollback

1. Stop member notifications and web sales. Do not delete imported accounts.
2. Re-publish the last known-good Netlify production deploy.
3. Keep the Supabase schema forward-compatible; do not use a destructive
   database rollback. Disable the affected feature or Edge Function instead.
4. Restore access from the durable import grant. Stripe cancellation must not
   remove a separate GHL-import grant.
5. Keep GHL read-only and available as the source archive until the pilot and
   store builds are accepted.
6. If imported data is incorrect, restore from the pre-cutover database backup
   and re-run the verified manifest with provider IDs. Never hand-edit source
   IDs in production.
7. Record the incident, deploy IDs, database migration state, member impact,
   and the exact recovery proof before resuming notifications.

## First 24 hours

Monitor Supabase Auth delivery, Edge Function failures, Postgres errors,
Stripe webhook retries, Netlify errors, native crashes, and support messages.
Pause the next notification batch on any unexplained login, entitlement, or
content mismatch.

## Notification dispatcher schedule

Create a long random dispatch secret and set it both as the Edge Function
secret `NOTIFICATION_DISPATCH_SECRET` and in Supabase Vault. Store the project
URL in Vault too. Then schedule one request every five minutes from the SQL
editor. Replace only the two placeholder values; never commit them.

```sql
select vault.create_secret('https://YOUR_PROJECT.supabase.co', 'project_url');
select vault.create_secret('YOUR_LONG_RANDOM_DISPATCH_SECRET', 'academy_notification_dispatch_secret');

select cron.schedule(
  'academy-notification-dispatch',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
      || '/functions/v1/academy-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-notification-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'academy_notification_dispatch_secret')
    ),
    body := '{"limit":25}'::jsonb
  );
  $$
);
```

Keep this Cron job removed or inactive until Mailgun domain verification and
the single-recipient acceptance test pass. The outbox can safely accumulate
while delivery is paused.
