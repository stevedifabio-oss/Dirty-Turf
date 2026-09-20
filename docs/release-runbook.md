# Dirty Turf Academy release runbook

The web app, iOS app, and Android app share one React application and one
Supabase backend. A release is complete only when all three clients pass the
same authenticated member path. A simulator build or an unauthenticated
preview is evidence for compilation and layout, not production acceptance.

## Release order

1. `app.dirtyturf.com` ownership, Cloudflare-to-Netlify routing, TLS, and the
   production merge are complete.
2. Supabase Auth custom SMTP is configured with the existing Mailgun sender.
   Confirm Mailgun DKIM, then add the Mailgun API values plus two generated
   notification secrets to Edge Function secrets. `APP_URL` already points to
   `https://app.dirtyturf.com`.
3. Verify real delivery and both web and native Magic Link redirects. Deploy the
   notification function, send to one internal recipient, verify direct links
   and unsubscribe, then enable its five-minute Cron schedule.
4. The permanent owner, organization, Academy community, and all 60 login
   accounts are created. The owner and an existing pilot member still need a
   real Mailgun-delivered Magic Link before release.
5. The source access audit and all 29 generated batches passed dry run,
   commit, and an idempotent repeat. All current members were provisioned
   without sending email, and all 49 enrollments are login-ready.
6. Prove Stripe in test mode, including webhook replay and cancellation grant
   precedence.
7. Deploy `map-geocode`, verify member-only address search, attribution,
   per-user cache, and the one-request-per-second upstream guard.
8. PRs #2 and #3 passed GitHub CI and Netlify preview builds before merge.
9. The exact production deploy passes the unauthenticated custom-domain smoke.
   Repeat the authenticated golden path with the pilot member.
10. Google Play listing assets, Play App Signing, the protected client upload
   key, and Internal testing release `1 (1.0)` are complete. Finish the remaining
   declarations and reusable reviewer account, then run the full path on
   Steve's Android phone.
11. Signed iOS `1.0 (3)` was uploaded successfully to App Store Connect on
   September 20, 2026 and is processing. Complete Apple's account declarations,
   reviewer credentials, and screenshots, then repeat the physical iPhone
   measurement test against that exact TestFlight candidate. Camera measurement
   was user-confirmed on the connected iPhone before upload; record its model,
   OS version, and Build 3 acceptance result.
12. Pilot 3-5 members, capture the final GHL delta, then notify the remaining
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
- Android email opens the HTTPS handoff, its Open App action launches the Play
  build, and the PKCE exchange finishes without returning to Welcome.
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
- Address search is member-only, keeps its attribution visible, reuses the
  per-member cache, and returns a friendly busy state under concurrent load.
- A saved calculation reopens on a second authorized device.
- A saved calculation photo remains private, opens from job history, and is
  available only through a short-lived signed URL.
- Web billing opens Stripe-hosted Checkout and Customer Portal.
- Native iOS/Android expose no purchase or external checkout control.
- Privacy, support, and account-deletion pages work while signed out.
- An authenticated deletion request is visible only to its requesting user.

## Release evidence record

Fill every row during the production release. Never put passwords, Magic Links,
member emails, private tokens, or reviewer credentials in this repository.

| Evidence | Value |
| --- | --- |
| Git commit SHA | Build 3 application code `12713c9a4283d398ffcb4443b16dd85c792eb3f4` |
| GitHub PR and successful run | `stevedifabio-oss/Dirty-Turf#12`; CI run `35524757883` passed; owner merge remains pending |
| Netlify deploy ID and URL | Production deploy `6aad92da88497700081bd70a` at `https://app.dirtyturf.com`; unauthenticated production smoke passed |
| Supabase migrations | Applied through `20260920131500_protect_owner_and_seed_certificate`; live checks passed for atomic membership, Steve's organization-owner guard, direct-write restrictions, moderation/asset/template RPCs, and one active certificate template on September 20, 2026 |
| Supabase Edge Function versions | Ten active: `academy-import` v5; `map-geocode` v2; health/invite/checkout/portal/Stripe webhook v3; GHL status/webhook and Academy notifications v1 |
| Source archive SHA-256 | Build 3 application code archive `9fed0d628926f7c5df8c113e8ab33ad574de085e2ab45106393fec2b471a59c1` |
| Local automated gate | 91 tests, typecheck, production build, PWA, 23-migration schema contract, store metadata, secret scan, and zero-vulnerability npm audit pass |
| Responsive UI/UX audit | 320 x 640, 360 x 800, 800 x 360, 768 x 1024, and 1440 x 900 pass with no horizontal overflow; mobile thread comments focus above navigation; the landscape calculator body scrolls above its fixed save action |
| Play listing assets | 512 x 512 icon, 1024 x 500 feature graphic, and five 1080 x 1920 phone screenshots prepared under `output/store-assets/` |
| Native candidate proof | Build 3 archive is signed by Apple Distribution team `Z36XF6NX6G`; its embedded web entry matches the production web and iOS source at SHA-256 `b56ebaff5c201bfee5f3a924f9664b1648abf9e1291ada31568a8ad79d6ee5d1`. Exported Build 3 IPA SHA-256 is `c2d6f9abe34b262b7b2e237c9a7f5201454251f3af39d47a895cb160b1619ba6`. Existing Android APK/AAB artifacts predate this iOS-only candidate and were not treated as Build 3 evidence. |
| Smoke-test account owner | Client vault only |
| iPhone model / OS / AR error | Physical iPhone camera measurement user-confirmed September 20, 2026; exact model, OS, error range, and build-2 repeat still pending |
| Android model / OS / AR error | Pending physical test |
| TestFlight build | App record `6813588770`; signed `1.0 (3)` uploaded successfully September 20, 2026 and Apple reported the package is processing. Build 2 is superseded. Apple Distribution identity and App Store profile are valid through September 18, 2027. Processing completion, screenshots, reviewer credentials, declarations, and final physical-device acceptance remain. |
| Play Internal build | App record `4973615558687213779`; track Active; release `1 (1.0)` uploaded and released September 18, 2026; checked tester list contains four accounts; join URL `https://play.google.com/apps/internaltest/4701757813213362221`. Pending physical Galaxy acceptance, reusable reviewer account, and final declaration review. |
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
