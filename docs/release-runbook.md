# Dirty Turf Academy release runbook

The web app, iOS app, and Android app share one React application and one
Supabase backend. A release is complete only when all three clients pass the
same authenticated member path. A simulator build or an unauthenticated
preview is evidence for compilation and layout, not production acceptance.

## Release order

1. Lock the final HTTPS origin and publish the Resend DNS records.
2. Verify custom SMTP and both web and native Magic Link redirects.
3. Create the permanent owner and normal test member.
4. Run the source access audit, import dry run, one commit, and an idempotent
   repeat. Provision all current members without sending email.
5. Prove Stripe in test mode, including webhook replay and cancellation grant
   precedence.
6. Publish the PR preview and run the complete smoke, responsive, and
   authenticated golden paths.
7. Merge to `main`, wait for the exact production deploy, and repeat the smoke
   and authenticated paths.
8. Build signed TestFlight and Play Internal releases. Run physical iPhone and
   Android measurement tests.
9. Pilot 3-5 members, capture the final GHL delta, then notify the remaining
   members in batches of 25 or fewer.

## Automated preflight

```bash
npm ci
npm run academy:access-audit
npm run check
npm run native:sync
npm run release:smoke -- https://DEPLOY_URL --expect-security-headers
```

`npm run check` includes a credential-pattern scan, migration/RLS contract
checks, TypeScript, unit tests, the production build, public legal-page checks,
and the PWA offline manifest check.

## Golden path

- Unknown email receives the neutral response but cannot create an account.
- Provisioned member receives one Magic Link and reaches the assigned course.
- Expired and reused links fail without creating another account.
- Academy, lesson progress, community, comments, events, and RSVPs persist.
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
| Git commit SHA | `5d8c1e30cd5f89c111ab4266dcef04f792cd03f8` |
| GitHub PR and successful run | `stevedifabio-oss/Dirty-Turf#2` / CI run 15 passed |
| Netlify deploy ID and URL | Preview status passed at `https://deploy-preview-2--bright-brigadeiros-df8b48.netlify.app`; deploy ID pending Netlify UI |
| Supabase migrations | 12 applied / 51 public RLS-protected tables |
| Supabase Edge Function versions | Six deployed; record immutable versions at production release |
| Source archive SHA-256 | `0e1f53311b4635a7ed2969ff5bf6e2b038781eeb3126a958e3aaea82633f1aee` |
| Local automated gate | 14 test files / 54 tests, typecheck, build, PWA, schema, and secret scan passed |
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
