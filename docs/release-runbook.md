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
4. The permanent owner, organization, Academy community, and all 60 login
   accounts are created. The owner and an existing pilot member still need a
   real Mailgun-delivered Magic Link before release.
5. The source access audit and all 28 generated batches passed dry run,
   commit, and an idempotent repeat. All current members were provisioned
   without sending email, and all 49 enrollments are login-ready.
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
npm run native:verify
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

`npm run native:verify` builds the web app, copies it into both native wrappers,
and proves that the web, Android, and iOS entry documents have the same SHA-256.
After native compilation, `npm run native:verify:artifacts` also checks the
packaged Android APK and AAB. Pass a built `.app` with
`node scripts/check-native-bundles.mjs --ios-app /path/to/App.app` to include
the iOS product in the same proof.

`npm run native:android:signing-status` reports whether all four client-owned
upload-key variables are present. `npm run native:android:release` then builds
the release AAB and signs it only when the complete environment is supplied;
the key and passwords never belong in Git or `.env` files.

`npm run check` includes a credential-pattern scan, migration/RLS contract
checks, store metadata/native permission validation, TypeScript, unit tests,
the production build, public legal-page checks, and the PWA offline manifest
check.

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
| Supabase migrations | 18 applied / 53 public RLS-protected tables; recheck at production release |
| Supabase Edge Function versions | Nine active: `academy-import` v5; health/invite/checkout/portal/Stripe webhook v3; GHL status/webhook and Academy notifications v1 |
| Source archive SHA-256 | `e919ba8701b532ca3c8e4b63fa6612a87f621bd27c7ce33e9c6e8397c9d4a4f7` |
| Local automated gate | 70 tests, typecheck, production build, PWA, schema, store metadata, and secret scan pass |
| Native candidate proof | Android debug APK/release AAB and iOS simulator build pass; all six embedded entry documents match SHA-256 `a66bf220f19bdf5bf3f00be90a6f1695d14c24e2ec8da6419f5695102c10fcc5` |
| Smoke-test account owner | Client vault only |
| iPhone model / OS / AR error | Pending physical test |
| Android model / OS / AR error | Pending physical test |
| TestFlight build | Pending: archive reached signing; Apple reports no registered physical device/profile for `com.dirtyturf.academy` |
| Play Internal build | App record `4973615558687213779` exists and Play App Signing is accepted; pending client-owned upload key and signed AAB |
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
