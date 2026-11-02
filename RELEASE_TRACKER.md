# Dirty Turf Academy release tracker

Maintained with each release. Canonical: https://github.com/stevedifabio-oss/Dirty-Turf.

## Current Android 1.0.1 candidate — November 1, 2026

Steve requested all updates and supplied the original Android upload keystore/password locally. Prepared in a separate checkout from published main f1f1d7e, restoring the previously phone-tested Android live measuring line and native session-refresh changes. The candidate includes the latest shared web/app changes; code 13 is still unused in the refreshed Play inventory. Original certificate matches the historical Google Play upload key. The pending replacement reset remains scheduled for November 3 at 3:59 PM Arizona time; current upload acceptance is not inferred. Configured native sync/asset parity, TypeScript, 60 targeted tests, secrets and store metadata checks passed. Signed artifacts, native test/lint, internal Play upload and exact delivered-device acceptance remain in progress; see docs/android-update-20261101.md and release PR receipts. This preparation does not claim a public Android update or any iPhone upload.

## Turf Scanner property inspections — November 1, 2026

Prepared locally on canonical main `1a3e7cd` in the isolated `codex/turf-property-inspections` branch. Optional condition (Poor/Fair/Good/Excellent), visible seams, debris, infill level and notes save with each measurement. Camera capture and multi-file uploads accept up to six JPEG/PNG/WebP/HEIC photos of at most 20 MB each. Recent Properties now opens the saved measurement, inspection and photo gallery. Photos that fail to attach can be retried without creating a duplicate calculation. Repeated save clicks are guarded; draft inspections/photos clear on sign-out, account switching or revoked access. Cloud writes capture the initiating account token for the entire measurement/photo operation. Disconnected previews keep photo blobs in local IndexedDB; configured signed-out apps never fall back to device saves.

Steve authorized publishing the complete website update. Source migration `20261102031133_property_inspections.sql` was applied to the existing Supabase project as hosted `20261102033833_property_inspections`; do not replay it. It adds workspace-protected `property_inspections` and the atomic SECURITY INVOKER `create_infill_inspection` RPC. The old calculation RPC and older installed apps remain compatible. Hosted acceptance passed an authenticated owner save/read, cross-workspace denial, invalid-input rejection and the legacy RPC, all inside a rolled-back transaction. Existing property/measurement/estimate counts remained 26/26/26 and no test inspection was retained. Hosted security advisor results were unchanged, with no new inspection findings. Canonical PR #54, complete Linux CI and Netlify production receipts are recorded in the PR. This web release does not update installed native frontends.

Verification: 50 focused frontend/backend/workspace tests; TypeScript, schema, secret, store metadata, production build and PWA checks passed. The isolated SQL harness applied all 61 source migrations and passed 45 assertions covering atomic rollback, validation, caller authorization, cross-workspace isolation and old-RPC compatibility. Local CLI advisors could not connect because no local Postgres server is running; no hosted fallback was used. Browser acceptance saved a 450 sq ft sample with inspection notes and two photos, then confirmed local history/photos survived refresh. Development-only review URL: `http://127.0.0.1:5175/?scanner-preview=1`; this route requires DEV mode and no configured Supabase client. Physical Android/iPhone capture and hosted round-trip acceptance remain release checks. Include the shared frontend in the next requested native release.

## Grow Your Business service pages — November 1, 2026

Steve authorized publishing the completed marketing-page batch. Prepared on canonical main `7e74e08`: his Grow Your Business introduction; dedicated Website, SEO/AEO, Website Care, GoHighLevel and Facebook/Instagram Ads pages; six unique website-design examples with accessible enlarged previews; and his four service overview graphics with illustrative-data captions. Existing app fonts, colors and navigation are retained. Website Care is advertised as starting at $97/month. Steve explicitly retained current GoHighLevel setup ($1,495–$2,495) and separate software ($197/month) prices; AI/management options request a quote. Facebook/Instagram management remains $495–$895/month, with ad spend separate.

Service pages have query-addressable routes, native dropdowns, FAQs and request CTAs. GoHighLevel and advertising selections prepare a bounded summary for the existing per-member service request while preserving freeform notes, duplicate prevention, offline restrictions and explicit submission. CRM, conversations, charts, advertising concepts and budget planning are local demonstrations, not active integrations or customer performance. No GHL/Meta campaign, live messaging, customer import, payment catalog, subscription, hosted migration, function or native-store release is activated by this frontend batch. Preview output/qa files remain ignored and are not a production route.

Published through PR #53: main `1a3e7cd297c5bb31164789cbb6bc9aa72aaf429b`, complete Linux CI run `41378857545`, Netlify production deploy `6ae7f84d7bccaf96a15bab91` (Published). Live authenticated pages and images were verified. Local verification includes TypeScript, focused growth/request and budget tests, production build and browser checks of routes, dropdowns, image previews, reporting switches, estimator assumptions and selection summaries. The installed phone app frontend remains queued for a subsequent store release.

## GHL course-workflow review and isolated editor preparation — November 1, 2026

Published core editor through PR #51, main `634f5036d7ba7bcad63114c0297f36b8eee2cc3f`, Netlify `6ae7e944406d7d09c4a18db8` (Published). Source ordering migration `20261101180626_academy_course_order` is hosted as `20261102013602_academy_course_order`; do not replay it. Canonical Linux CI 41373315687 passed. The live owner opened the real Academy's Arrange modules & lessons control. Backend acceptance passed an owner no-op save and ordinary-member denial; module/lesson/progress row digests were unchanged.

Live-outline follow-up: an archived imported module shares sort position 3 with a visible module. Arrangement now reuses positions only as-is and never normalizes unrelated archived rows because of that tie. A tie inside the moved range leaves the draft unchanged with an explanation. Two regression cases cover these behaviors; no further migration is needed.

Steve subsequently authorized uploading this prepared course editor. The release adds Arrange modules & lessons to the real Admin Studio course page, rich-text lesson editing, content-block reordering, transcript editing, optional quiz passing requirements and Save & publish. Only source migration 20261101180626_academy_course_order.sql is required for cloud order saves; hosted aliases and acceptance receipts are recorded in the publishing PR. Publishing does not rearrange existing courses, edit GHL, enable notifications or activate new billing. The development-only sample is excluded from the production bundle. Mobile frontend changes remain queued for a subsequent store build. This release does not claim full GHL parity.

Steve requested matching his actual GHL course behavior, then specifically directed inspection of the open GHL screen. Reviewed the authenticated Turf Cleaning Academy outline, an existing published lesson, an existing draft Quick Quiz, and an existing practice-assignment lesson without saving or changing content. Observed module/sub-module/lesson nesting, grips and edit/clone/preview/delete row actions, Add Content menu (module, sub-module, lesson, quiz, assignment, badge, import), lesson media upload/library/link/embed, formatted descriptions, thumbnails, downloads, Preview and separate Save / Save & Publish. Lesson status menu offers Draft, Published and Locked. Quiz supports answer checkboxes, an answer explanation, optional passing grade, thumbnail and completion message. The practice-assignment item inspected is a lesson with instructions/evaluation criteria; formal submission/grading behavior was not established. GHL media limits shown were 5 GB video and 2 GB audio; no upload was attempted.

Prepared the previously local core editor changes in the isolated C:/Users/steve/DirtyTurfCourseEditorRelease worktree on canonical main f69f541, preserving the published master-only member/free-access controls. Development preview: http://127.0.0.1:5174/?editor-preview=1. Forty-two focused editor/order/rich-text tests and TypeScript passed; isolated course-order SQL passed 23 assertions. No hosted migration, course write, GHL write, announcement, billing change or publication occurred. This is not full GHL parity: nested module authoring, Locked semantics, thumbnails, full quiz question types and larger/audio upload support need explicit implementation and verification. Screenshot reference remains in ignored output/qa/ghl-course-outline-reference.png. Full GHL parity and real cloud editing acceptance remain outstanding.

## Owner-only per-member complimentary access — November 1, 2026

Follow-up: Steve requested no date field for owner grants. New grants from the owner panel are permanent until removed; previously time-limited grants retain their stored limits. Rejected course grants now explain the existing restriction and point to the course-access controls; the authoritative grant choices remain visible after a rejected save. No member grants or billing are changed by this interface update.

Turf Scanner trial policy clarified: seven days of access, then access stops unless the member explicitly subscribes; no automatic paid conversion or charge. This is separate from permanent owner grants. The new self-service trial and paid catalog remain unactivated and require a server-enforced, once-per-account trial flow before release.

Published through PR #48 (main `726adb59b66f2dcea65e1cf72f33faa4c7be9f11`, Netlify `6ae7de28a8a01fd081b0e2d9`): Admin → Members shows free-access checkboxes inside each member record, with an optional expiration for new grants. Only the verified steve@dirtyturf.com master identity may manage members, invitations, course restrictions and complimentary grants; other managers retain their unrelated administration tools. Server authorization and invitation handling enforce the same rule as the interface. A layout follow-up separates the expiration field from the checkbox grid and adds normal panel spacing.

The owner-controls migration and separate owner_per_member_free_access migration add independent Community, Turf Scanner and course grants. Revoking a complimentary grant preserves other purchased/imported access and does not change billing. Complimentary Community access never implies course access; existing membership grants keep their current semantics. This release does not activate new Stripe prices, new checkout, separate-membership cutover, notifications or imports. Newly advertised add-on courses without content remain unavailable. Installed mobile frontends require a subsequent store build; server authorization changes apply immediately to older clients.

The local example remains a disconnected development screen; live grants are managed from each member's Admin record. Verification and hosted migration/function/publication receipts are recorded in the publishing PR. Never replay the migrations directory: apply only the two reviewed owner migrations, accounting for the existing hosted aliases listed below and the profile migration alias 20261101233702.

Hosted aliases: source `20261101205918_master_member_controls` → `20261102004904_master_member_controls`; source `20261102004247_owner_per_member_free_access` → `20261102004908_owner_per_member_free_access`. Invitation function is ACTIVE version 13 with JWT verification retained. Existing member/access/feature rows and digests were unchanged; verified-owner allow and ordinary-member denial passed read-only checks. Full canonical Linux CI passed. Future separate-membership work must reconcile its pending duplicate owner RPC definitions against this release.

## Simple Sign in / Join entry — November 1, 2026

Steve requested one sign-in and one join option. Removed the email-link alternative and the duplicate Join Academy purchase link from the signed-out page. The page now has email/password Sign in, Forgot password, and one Join button opening account creation. Recovery, signup profiles, Terms and existing access rules are preserved. Web publication follows canonical GitHub → Netlify; installed native frontends require the next store build.

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
