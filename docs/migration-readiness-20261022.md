# Dirty Turf migration readiness — 22 October 2026

Audit window: **16:00–17:30 UTC / 11:00–12:30 Bogotá**. Implementation and verification are complete; this report is the release/migration handoff.

**Later backend release:** the user subsequently authorized Stripe/backend activation. Nine migrations and six functions are now live; $10 new measuring purchases and service sales are enabled. See [the current backend receipt](backend-release-20261022.md). The audit-close platform table below is a historical snapshot. Frontend publication, native builds and broad member migration remain separate.

## Decision

Prepare a small controlled pilot, then move new discussions to Dirty Turf on one agreed date. Keep GoHighLevel available through the transition. **Do not start a full member migration yet.** Fresh roster approval, recoverable backups, real inbox delivery and physical-device acceptance still need proof.

GoHighLevel confirmed that its public APIs cannot retrieve complete native Community posts, replies, attachments, edits or history. Social Planner only returns content managed through Social Planner. There is no supported cloud-based real-time mirror for the existing native Community. A browser catch-up is temporary and cannot replace a migration plan.

## Changes prepared locally during this audit

| Area | What changed | Verification / limit |
| --- | --- | --- |
| Member setup | Select exact members; separate account preparation from first sign-in email; review names and addresses before action; signed preview expires and is invalidated by changed selection/status; duplicate clicks are locked | Actual endpoint boundary and UI regressions; synthetic desktop and narrow mobile walkthrough. No accounts or emails created |
| Access decisions | Readiness audit counts effective Community/open-course access rather than requiring redundant course grants; restricted and app-only records remain separate | Read-only live aggregate and targeted fixtures; no new access grants |
| Enrollment default | New visitors start with Academy membership even if the catalog lists a measuring add-on first; explicit upgrade links and existing-member ownership are preserved | Reproduced on the live public page and failed-before/passed-after component regression; no checkout created |
| Course protection | Hidden/draft/archived lessons cannot accept progress/quiz mutations; edited native content is protected from source overwrite; unsupported attachments fail with useful errors | Isolated PostgreSQL reproductions and course/media tests; no hosted migration applied |
| Course authoring | Upload limits match the hosted Free plan, preserve failed drafts and explain when a video link is needed; source-hidden modules are clearly held; empty courses do not promise a certificate | Shared UI/backend limits and actual storage policy tests |
| Admin number editing | Price, duration, level and quiz fields no longer reinsert a zero after Backspace; native constraints and numeric saved values remain intact | Failed-before/passed-after actual component regressions and browser Price/Minutes replay; no course saved |
| Community safety | Parent visibility and block rules apply to comments; removed comments detach their media while preserving replies; rapid block clicks cannot toggle twice; ambiguous mentions are held | SQL and interaction regressions |
| Native photo posts | Private photo composer, previews/removal, bounded verified image uploads, atomic publication and stable retry IDs; access and block rules protect photo signing | Local UI, handler and actual PostgreSQL policy tests. Function and bucket are not deployed |
| Account transitions | Community draft writes bind to the verified author instead of picking up another account during an async operation | Deferred-account-switch regressions against actual backend helpers |
| Email safety | Access checked again before provider submission; blocked/deleted/withdrawn content and ineligible recipients suppressed; digest refreshed per recipient; course cancellation notices require a real subscription relationship | Worker-boundary and isolated SQL tests; no real notification sent |
| Email navigation | Event/course/post/comment links retain a safe destination through web magic-link login; stale comment targets are removed when changing threads | Actual auth call and URL parser tests; native universal post links are not claimed |
| Offline updates | A partial new asset download cannot replace a complete offline shell; HTML fallbacks cannot overwrite JavaScript; cache failures do not discard a good response | Executed service-worker failure scenarios |
| Search scope | Online and offline labels explain coverage; restricted/blocked content stays behind the caller's access rules | Courses and loaded content are searchable, with additional older-post lookup online. Older comments are loaded-thread search, not a complete server-wide comment index |
| Branding/accessibility | Poppins/Outfit and Dirty Turf identity checked in member controls and email previews; review receives keyboard focus; loading returns focus to the next useful field | Browser and interaction checks; additional legal-reader keyboard checks recorded in the audit evidence |
| Native preparation | Next source versions reserved as Android 12 / iOS 17; reviewed camera lifecycle mitigation carried into this checkout; Apple public copy no longer refers to Android | Source parity, store checks and existing Android JVM tests. No new native artifact built or uploaded |

The existing local upsell work is preserved: membership review, optional measuring plan, paid course scaffolding, business-service requests/quotes and guarded Stripe Checkout/portal/webhook handling. Existing subscriptions are not repriced by this audit.

## Live state at audit close — historical snapshot

| Surface | Confirmed state | Still required |
| --- | --- | --- |
| Web | `https://app.dirtyturf.com`, deployed revision `31e5b4e92e5e33ddd4e791955a2a726ea86b20f3`; ten public smoke checks passed | Release these local changes separately, then run the authenticated pilot on the deployed version |
| Google Play | Production build **10** at 100% rollout; internal testing build **11** serving | Physical Android stability/login/course/community test, then build/review the next intended artifact. Crash/ANR data was unavailable, not confirmed zero |
| Apple | TestFlight build **16** is Testing for existing tester groups; public submission build **15** is Rejected | Physical walkthrough showing consent/report/block; business-model response; corrected metadata; approved resubmission. TestFlight does not establish public approval |
| Supabase | Free plan; no hosted project backups included | Owner-controlled database plus Storage backup and isolated restore proof before a broad migration |
| Stripe | Live public catalog exposes membership $39.99/month and legacy measuring $29.95/month; matching live prices active; original billing webhook enabled; customer portal active | New $10 measuring price only for new purchases; service webhook/config; controlled checkout/fulfillment/cancellation evidence. Payout readiness could not be verified with the restricted key |
| Email | Existing worker uses GHL; 69 provider-accepted deliveries, five historical cancellations, one old exhausted provider-400 failure; no queued/processing deliveries at audit | Actual inbox receipt, preferences/unsubscribe check and direct Mailgun API configuration for members without GHL contact mappings |

Community notifications already have a direct Mailgun adapter in source. Supabase Auth's existing Mailgun SMTP setup does **not** prove that the separate notification worker has direct Mailgun credentials. Retain GHL's required email/course/media dependencies until replacement is verified.

The [Apple review preparation draft](apple-migration-review-draft-20261022.md) lists verified business facts and the physical walkthrough needed. No reader-app/payment exemption or public approval is assumed.

## Member and content inventory

- **65 app members:** 62 active and three restricted. There are 63 imported links: 60 active, two pending and one cancelled. No duplicate source/contact/invite emails or shared-Auth identity groups were found in the aggregate checks.
- **61 active durable Community grants** give included access to the open published Academy. The 49 explicit course grants do not imply that the other 12 lack access.
- **61 account/invite rows:** 56 provisioned, five historically accepted. Those historical counts do not establish onboarding in this migration campaign.
- One active app-only member without the imported invitation/grant path remains for explicit review. Do not infer eligibility or grant access from a CRM contact.
- The latest source directory inventory is about 44 hours old and is not a complete, email-verified, owner-approved roster. A fresh exact roster is still required.
- **One published course, one draft; 37 modules; 109 published visible lessons and 19 draft lessons.** Three draft quizzes are not published.
- 143 registered Academy assets had corresponding Storage objects. 99 published lessons contain images. No stored expiring links were found. There are no published main video/HTML-video/iframe lessons in the current database; owner content reconciliation and actual playback remain necessary before claiming complete video migration.
- The current hosted global upload cap is **50 MB**, despite a larger bucket-specific limit. Larger videos need a supported video link/host or a separately approved storage plan change.
- **Community history is stale and partial:** 68 imported posts and 73 imported comments are present alongside two app-native posts and one native comment. The last accepted browser capture was **6 October at 18:04 UTC**, with five held records (four posts and one comment, `unobserved_media`) and `fullSync: false`. It cannot establish what has happened in GHL since then. A fresh complete observation and agreed handling of the media exceptions are required before changeover; preserve all native app activity.

## Release and migration order

1. **Recovery first:** complete [backup and restore proof](member-migration-recovery.md). Today's hashes/counts and old history archive are not backups.
2. **Reconcile members:** obtain the fresh complete exact Community roster; approve the existing free cohort and exceptions; preserve app-only accounts, restrictions, progress and separately purchased tools. Use [the readiness audit](member-migration-readiness.md).
3. **Review the local release:** review all changed files and migrations against current production. Apply only the reviewed new migrations, in timestamp order, after backup; deploy matching functions and then the frontend through the existing GitHub build path. Avoid historical whole-file replay or database reset. Keep provider sales flags off until the intended checkout lifecycle passes.
4. **Verify email and billing:** confirm the direct transport configuration and one authorized internal inbox delivery. Confirm the new optional measuring mapping does not alter old subscriptions. Test service payments and membership fulfillment with controlled provider evidence before enabling sales; reconcile any uncertain operation before retrying.
5. **Prepare 3–5 exact pilot members:** use the deployed new preview contract, then separately approve account setup and first sign-in emails. Maximum 25 recipients per email batch. Review status and delivery before another batch. See [targeted actions](member-migration-targeted-actions.md).
6. **Run the actual-device checklist:** web, physical iPhone and physical Android; fresh and retained login, offline/resume, all included content, new posts/replies/photos, block/report, progress and support. Test the exact artifact intended for members.
7. **Agree the changeover:** Steve chooses when all new discussions move to Dirty Turf and approves the history/archive exceptions. Before that time, run the final guarded, coverage-proven source capture and reconcile its receipt; the October 6 database state is not current. Announce, invite in reviewed waves and keep GHL available during recovery. No automatic two-way copying is promised.

The [launch pack](member-migration-launch-pack.md) already contains the pilot matrix, announcement, reminders, pinned GHL notice and delay/support drafts. All remain unsent drafts.

## Simple text for Steve

> Steve, we're preparing the move to Dirty Turf. Existing eligible members keep their free Community and current Academy access. GHL confirmed it cannot mirror the existing community into the app in real time, so we need one agreed switch date. Please confirm the current member list, choose 3–5 testers across iPhone, Android and web, and identify the course videos/history we must preserve. We'll check their login, content and posts before inviting everyone in small batches. Keep using GHL until we confirm the switch, and keep it available through the transition. Google is public with a newer internal test build; Apple is in TestFlight. Final device tests and backup recovery come before the full move.

## Evidence and final check

Evidence is stored under `output/qa/migration-20261022/`; private aggregate, state-hash and source receipts remain under `output/private/` and must not be committed. Component reports cover members, courses/media, Community/photos, emails and native readiness. Browser fixtures used synthetic names/content and did not mutate production. The live public membership page/catalog were read without entering an email or starting checkout. Its allowed production origin returned HTTP 200; the temporary localhost preview origin is intentionally not CORS-allowed, so its catalog error does not establish a production outage.

### Final verification

- **1,317 tests passed across 107 files.** The full run includes the upsell work and all audit fixes. A photo fixture timing/cleanup issue found in the integrated run was fixed by awaiting real validation and always unmounting; its original assertions were retained and the full suite passed again.
- **418 behavioral SQL assertions passed across eight isolated PostgreSQL suites**, using all 50 repository migrations. No SQL test touched the hosted project.
- TypeScript, 50-migration / 76-table schema contracts, 515-file secret scan, store metadata and `git diff --check` passed.
- The final web build used the existing verified **public** production project configuration and passed the PWA check: 36 assets across 32 manifest entries. Server secrets were not read for the build.
- All six changed/new Edge Function entry points passed Deno checking.
- Browser evidence covers desktop and narrow mobile member review, course authoring/number entry, Terms keyboard navigation, email branding and photo/offline states. Physical-device and actual-provider acceptance remain separate gates.
- Comparison fingerprints for members, member links, access grants, feature grants, lesson progress and billing subscriptions were unchanged between the pre-release and post-audit read-only checks. These receipts cannot restore data and are not a backup.
- `final-source-build-proof.json` identifies the uncommitted source and exact local build. `verification-summary.json` collects the final gates; individual logs and screenshots remain beside it.

Local fixes have not been committed, pushed, deployed, sent to members or uploaded to the stores.

### Browser housekeeping

Completed IAB audit tabs were closed and the viewport restored; the original user tab and ongoing offers preview were preserved. One disposable synthetic Chrome course-preview tab (`123507725`, localhost port 5203) has a native unsaved-change confirmation that could not be dismissed or closed while macOS was locked. After unlocking, choose **Cancel** on that synthetic warning, then close that exact preview tab. No real member, course draft or user-owned tab was changed. Apple/Supabase read-only status tabs remain available for the release follow-up.
