# Android update preparation — November 1, 2026

Candidate: Dirty Turf Academy 1.0.1 (13), package `com.dirtyturf.academy`.

Google Play was inspected on November 1: production is 1.0 (12), and the all-bundles inventory shows 12 as the highest uploaded version code. Code 13 is unused at this checkpoint; recheck before upload.

## Included

- The published yard image, Turf Scanner wording and zero calculation defaults from web PR #43.
- Expandable desktop navigation from web PR #44.
- Android AR flags, yellow measuring lines and the live line drawn while walking, previously tested by Steve in the separate preview app.
- Saved-session foreground refresh and its regression tests.

Membership pricing/cutover, free-access/master-member controls, new course backend changes, push activation and iPhone builds are excluded. The existing production backend and access rules are preserved.

## Release gate

The original Google Play upload signing key is unavailable locally. Searches of the project, Downloads and the protected Dirty Turf folder found no `.jks` or `.keystore` file. No signing environment variables are set. Google Play's App signing page confirms an existing upload key. No reset was requested or replacement key generated.

Ask the developer who published the app:

> Please provide Dirty Turf Academy's existing Android **upload keystore** (`.jks` or `.keystore`), its key alias, keystore password and key password through a secure channel. It must match the upload certificate in Google Play Console for package `com.dirtyturf.academy`. We are preparing version 1.0.1, code 13.

Google Play signing page: https://play.google.com/console/u/0/developers/6488874704983265343/app/4973615558687213779/keymanagement

Do not put signing material in Git, OneDrive, build logs or chat. Keep it in the existing protected local credential location.

## Verification and remaining work

The 34 session/auth/workspace tests passed. Configured native sync and web/native bundle parity checks passed, including the App and Push Notifications plugin registrations. The candidate uses the existing public production Supabase client configuration and matching Firebase Android app configuration; no server key is bundled.

Build logs and candidate receipts are ignored under `output/release/android-20261101/`. Compilation, unit tests and lint results must be read from the final build receipt before claiming success.

After the original upload key is available: verify its certificate against Play, build signed AAB/APK from this exact source, rerun packaging checks, test the final signed candidate on a connected phone, upload to internal testing, and complete the authorized production submission after acceptance. No phone is connected at this checkpoint. No Play upload or review submission has occurred.
