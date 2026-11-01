# Dirty Turf Academy release tracker

Maintained with each release. Canonical: https://github.com/stevedifabio-oss/Dirty-Turf.

## Email/password sign-in and required signup profiles — November 1, 2026

Prepared for canonical GitHub → Netlify publication. Sign-in defaults to email/password, with Forgot password, Create an account and the existing optional email link. Signup creates only an Auth login; email verification precedes required name, private phone, city/region/country, profile photo, short introduction and turf-cleaning experience (Just started / Under 2 years / Over 2 years). Password recovery uses the existing PKCE/native callback path and an authenticated new-password form. Existing accounts retain access; paid entitlements and roles are unchanged.

Migration 20261101230938_member_signup_profiles.sql adds private own-account profile storage, upload ownership controls and later member-provisioning profile copying. It must be applied before the frontend release. No pending membership prices, payment activation, admin controls, course editing/imports or notification delivery are included. Native apps require a subsequent tested store build; the frozen Android 1.0.1/13 candidate is unchanged.

Release verification and hosted migration state are recorded with the publishing PR. Local verification: 44 focused account/profile/workspace tests and 19 isolated PostgreSQL assertions over 57 migrations passed, plus type, schema, store metadata, secrets, build and PWA checks. Full Windows suite has existing POSIX permission/symlink/video-helper failures and one concurrent import timeout; the focused workspace rerun passes. Publication requires green canonical Linux CI. Dashboard read-back confirmed email signups and confirmation enabled, approved website/native redirects, custom SMTP enabled, and confirmation/reset templates using ConfirmationURL. No Auth configuration was changed. Disconnected development previews use ?auth-preview=1 and ?profile-preview=1 without Supabase configuration. Live account-email and photo acceptance require a signed-in test member; automated tests use isolated fixtures.

## Handoff batch — 29 October 2026

The handoff branch `codex/steve-maintenance-handoff-20261029` was reconciled from canonical `67d819c7f8af6fc2a53bb08c8c91a364710a7996` (PR #40), then merged through [PR #41](https://github.com/stevedifabio-oss/Dirty-Turf/pull/41) as `ea9ff41e5e1c7490dcb879bc7c172ba0e56155dc`. Steve should open current canonical **`main`** for maintenance.

| Surface | Verified position | Next gate |
| --- | --- | --- |
| Source handoff | Merged into canonical `main` through PR #41; original worktrees preserved | No handoff merge or account linking remains required |
| Website | Verified Git CD production deploy `6ae37b54a3bfe13c8b6ffbe8`, source `ea9ff41e`, published Oct 29 | Future web changes use the same GitHub → Netlify workflow |
| Apple current submission | Last recorded candidate iOS 1.0/build17; last authenticated review observation was Waiting for Review | Refresh App Store Connect before any new release action; no new approval/publication inferred |
| Google current production | Last verified Oct28: Android 1.0/code12, available at 100% rollout in existing one-country scope | Keep availability separate from a future candidate's status |
| Queued iPhone batch | Local preparation only; see native evidence | Store inventory, signing/capabilities, physical acceptance, outstanding exact-candidate authorization, Apple review |
| Queued Android batch | Local preparation only; see native evidence | Store inventory, upload-key verification, physical acceptance, outstanding exact-candidate authorization, Google review |

### Changes collected together

- Preserve Oct22 shared course builder, service/native payment restrictions, moderation, photo, auth/offline, and native integration already merged in PR #39/#40.
- Recover the deployed scheduler interface/worker and Community sync v5 prerequisite source that had remained uncommitted.
- Recover shared lesson inline playback and Community video tap/play, retry/fallback, background pause, keyboard focus, and single-player behavior; local video preparation utility does not upload anything.
- Carry guarded native push preparation while keeping its activation/provider/schedule gates held. Source inclusion is not proof of working push delivery.
- Add Steve's maintenance instructions, setup, reconciliation inventory and evidence.

The web release used the established GitHub → Netlify workflow, including its existing web function. No Supabase migration/function deployment, schedule activation, capture/import, customer change, reviewer reply, store upload, or store submission occurred in this handoff. Existing server scheduling remains governed by its prior authorization.

### Release notes for the next combined mobile batch

Draft: “Improved lesson and Community video playback, including inline viewing, clearer retry controls, and pause behavior when leaving the app. Includes shared Academy and administrator improvements.”

Do not announce push delivery as available. Before submission, tailor these notes to the exact tested candidate and preserve native purchase restrictions. The prepared version/build numbers in native evidence are provisional until current store inventories are checked.

### Verification and publication

The initial fork head was merged through Steve's existing signed-in owner browser session. No accounts were linked and no repository permissions were expanded. The full source is now in Steve's canonical repository.

- Runtime release commit: [`ea9ff41e5e1c7490dcb879bc7c172ba0e56155dc`](https://github.com/stevedifabio-oss/Dirty-Turf/commit/ea9ff41e5e1c7490dcb879bc7c172ba0e56155dc).
- [Canonical main CI run `40916880038`](https://github.com/stevedifabio-oss/Dirty-Turf/actions/runs/40916880038): passed.
- [Netlify production deploy `6ae37b54a3bfe13c8b6ffbe8`](https://app.netlify.com/projects/bright-brigadeiros-df8b48/deploys/6ae37b54a3bfe13c8b6ffbe8): ready, exact runtime commit, published October 29 at 11:59 a.m. America/Bogota (16:59 UTC).
- [Live site](https://app.dirtyturf.com): all 10 read-only smoke checks passed at 12:01 p.m. America/Bogota, covering public pages, SPA fallback, HTTPS redirect and security headers. This does not establish authenticated member or physical-device acceptance.
- A separate fresh canonical clone installed locked dependencies on Node 22 and started Vite successfully. Use the quickstart's canonical `main` instructions.

These receipts identify the tested runtime release. Later documentation-only commits can receive separate CI and Netlify deploy IDs without adding changes to the mobile batch.

See [verification record](docs/handoff-verification-20261029.md), [native evidence](docs/native-handoff-evidence-20261029.md), and [source reconciliation](docs/handoff-source-reconciliation-20261029.md). Record future releases and separate store outcomes here. Never turn an uploaded or internally tested build into a claim of public availability.

### Backend history caution

Do not replay all local migrations against production. Existing hosted aliases include scheduler `20261024031838` and native push/runtime `20261024032138`, while local files use `20261024022504` and `20261024022522`. Reconcile the migration ledger before any separately authorized database release. Preserve Community sync v5 and existing access/email guards.

## Historical evidence

Oct22 final candidates were iOS17/Android12. Earlier build15 rejection, build16 testing, and Android10/11 preparation notes are superseded checkpoints. Older backend/runbook documents retain their original dates and do not establish today's publication, billing, recovery, or device-test state.

## Turf Scanner web publication candidate — November 1, 2026

Dashboard image, product wording and zero calculation defaults only. New membership billing, backend, course/notification and native work remain held.


## Desktop navigation publication candidate — November 1, 2026

Desktop menu opens expanded with labels and a keyboard-accessible collapse/reopen button. Verified in local desktop and phone previews. This release excludes pending membership, master-admin backend, course and native changes.
