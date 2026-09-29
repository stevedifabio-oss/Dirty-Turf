# Release status — September 29, 2026

> Later activation update: see [activation-status-2026-09-29.md](activation-status-2026-09-29.md). Course sync, whole-Academy membership checkout and measuring-tool checkout are now active; earlier disabled-state observations below are historical.

## Web — live

- [PR 21](https://github.com/stevedifabio-oss/Dirty-Turf/pull/21) merged through the GitHub connector as Steve. Main release commit: `4d14343cfe4e007412b508aa4c417f3b8f7fe9a1`.
- GitHub CI passed; the automatic Netlify build deployed to https://app.dirtyturf.com. No manual Netlify deployment was used.
- Live root HTML SHA-256 matches the release build: `a55a0e0680af4ddf34b2b756042ed6ef821c21f986390bc97ceb569f5b92b431`.
- All 10 public release smoke checks passed, including legal/support pages, native callback, PWA files, SPA fallback, HTTPS and security headers. Authenticated Dashboard, Academy (109 published lessons) and Community loaded; no captured browser errors.

## Google Play — build 7 submitted; internal testing available

- **1.0 (7), Academy and member experience**, is available to internal testers, released September 29 at 3:13 PM local.
- The same build is submitted for production review, with a full rollout to the selected United States distribution. Publishing overview lists it under **Changes in review**. Managed publishing is off, so approved changes publish automatically.
- The earlier build 5 rejection concerned reviewer login. Reviewer instructions were corrected and saved at **372/500 characters**, preserving the supplied credentials. Submission does not prove Google has accepted that correction; approval remains pending.
- An older open-testing resume change remains unsubmitted.
- Package: `com.dirtyturf.academy`. Corrected signed AAB SHA-256: `7c54beffe0be10a7d36843bce1a8782fe96f060692ede23924d2ae6344212b4a`.
- Google accepted the existing registered upload certificate, SHA-1 `5F:0D:7A:96:E5:FF:CA:22:CA:4F:41:6D:46:96:BC:91:A1:4B:69:12`. The first locally signed candidate used a superseded key and was replaced; no key reset was needed. See `release-runbook.md`.
- Signature verified; all 49 embedded web assets match the release build. Steve's earlier successful Android login is separate evidence; installation and login on build 7 have not been observed.

## Apple — build 12 submitted; TestFlight testing

- Signed **iOS 1.0 (12)** uploaded and processed successfully. App Store status: **Waiting for Review**, submitted September 29 at 3:11 PM local.
- [Current submission](https://appstoreconnect.apple.com/apps/6813588770/distribution/reviewsubmissions/details/b80c8ce7-5c4b-4b3c-b7d9-74b110e7d272). The old build 10 submission was replaced. Automatic release after approval is selected.
- TestFlight build 12 is **Testing**, assigned to **Internal Testers** and **iPhone Testers**. Existing external tester notification was enabled.
- Reviewer credentials were preserved. The existing physical-iPhone walkthrough was accurately identified as build 10; it is not build 12 device evidence.
- IPA SHA-256: `dc256474510a6ec0a839d52bea3aa5da243865fcfa8d5939d9f52fed2e28325a`. Strict code-signature verification passed; all 49 embedded web assets match the release build.
- Public App Store approval and build 12 physical-device acceptance remain pending.

## Backend — deployed; feature activation pending

The Supabase connector applied five migrations and deployed seven Edge Functions. Existing access was preserved: 63 members and 111 access grants, with an identical complete grant-row hash before and after. See `backend-release-pending.md` for versions and endpoint evidence.

- Stripe checkout and pricing gates remain off. Webhook signing/runtime configuration, course mapping, payout bank setup and payment/access/cancellation verification remain pending.
- Branded community email templates and dispatcher are deployed; customer delivery remains off pending credentials, cutover and delivery QA. No member campaign was sent.
- Apps refresh course data on return. Automatic GHL source synchronization remains off pending source/baseline validation, configuration and scheduling. Do not describe it as a running automatic mirror.

## Verification and remaining acceptance

- Full local check passed: **291 tests across 48 files**, security scan, schema checks, store metadata, TypeScript, production build and PWA checks.
- Both native artifacts contain the same release web assets. Availability to testers is not proof of installation or successful device testing.
- Remaining release gates: Apple/Google approval, newest-build device checks, and separate activation/verification of payments, source synchronization and member email delivery.
- The installed GitHub and Supabase connectors resolved the CLI account mismatch. No additional GitHub merge or Supabase function-deployment permission is needed for this release.
