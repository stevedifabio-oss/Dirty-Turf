# Dirty Turf production priorities

> Later activation update: see [activation-status-2026-09-29.md](activation-status-2026-09-29.md). Course sync, whole-Academy membership checkout and measuring-tool checkout are now active; earlier disabled-state observations below are historical.

Updated September 29, 2026. User explicitly asked to retain and complete this list.

## Current release snapshot (September 29)

See `release-status-2026-09-29.md` for verified evidence. PR 21 is merged and the latest web app is live through the automatic GitHub/Netlify build. Android build 7 is available to internal testers and submitted for public production review. Apple build 12 is Testing in both TestFlight groups and Waiting for Review for the public App Store. Both stores are set to release automatically after approval. Five database migrations and seven Edge Functions are deployed through the Supabase connector; payments, automatic GHL source sync and member email delivery remain disabled pending their activation checks.

## Confirmed
- Steve reports Android login now works on his phone.
- Latest UI, pricing infrastructure, course refresh and email infrastructure shipped through PR 21; 291 tests passed. Public live smoke checks passed.
- Continue releases through GitHub; do not request manual Netlify deployments.

## Work queue
| Priority | Work | Status / next acceptance gate |
|---|---|---|
|1|Automatic GHL course/community updates|Active investigation and implementation. Existing import is a snapshot; Sept 24 documented course-read APIs now work with existing token. Exact-course reader implemented and live-verified: 1 course, 36 source categories, 128 lessons. All 128 existing lesson IDs present. Conflict-aware sync infrastructure is deployed, but baseline validation, configuration and scheduler activation remain pending. GHL draft post trigger scoped to 7 Figure Turf Cleaning saved inactive; visible post variables are title/content/group/channel only, with no ID or attachment field. Need actual payload verification for stable identities, replies and media before enablement.|
|2|Latest Apple/Android releases|Android 7 available internally and submitted for production review; Apple 12 Testing in TestFlight and Waiting for Review. Matching web assets verified in both binaries. Installed-device acceptance of these newest builds remains pending.|
|3|Stripe payment integration|Live account connected and five inactive products/prices, portal, branding and Google Pay configured. Checkout stays disabled pending course mapping, bank account, runtime secrets, webhook registration and payment/access verification; backend functions are deployed. Never create duplicate subscriptions for existing members.|
|4|Member access reconciliation|Live Sept 26 read-only check: 62 active memberships; 1 active manually-added member has pending invite, no auth account and 1 active enrollment. Separate cancelled historical record has no enrollment. This is not an unlinked imported GHL member. Identify intended pending invite before provision.|
|5|Upcoming events|Live calendar has 5 past events. Need real next date/time/timezone/meeting details before publishing.|
|6|All course media/downloads|Check every published lesson and imported asset, not just samples. Preserve existing private media during source updates.|

## Sync design
GHL owns imported course content. App member progress, native discussions, moderation and app-owned fields remain protected. One-way GHL -> app is the initial design; two-way mirroring is not enabled. Imported posts/comments keep stable source IDs and parents. Poll course data on a server schedule; use documented community workflow triggers for new activity where payloads are sufficient. Hold edit/delete/media coverage gaps and conflicts for review; do not guess missing records are deletions.

Acceptance: create/edit/reorder/move lesson, replace attachment, new post/comment/reply, duplicate/out-of-order webhook, local edit conflict, disabled access and failed-run retry; show last successful sync and actionable errors. No automatic production application is enabled yet.

## Stripe text for Steve — draft only
Hey Steve, the Stripe products, prices, billing portal and branding are set up. Stripe still needs your payout bank account: open Settings → Business → Account status → Provide an external account → Start. Please complete that directly in Stripe. We’re keeping existing members’ billing intact and will finish payment/access verification before turning on sales.

## References
- https://marketplace.gohighlevel.com/docs/Changelog/ (September 24 course read APIs)
- https://marketplace.gohighlevel.com/docs/ghl/courses/list-courses/
- https://ideas.gohighlevel.com/changelog/new-communities-triggers-in-workflows-automate-more-faster

## Implemented sync foundation (September 26)
- `npm run academy:capture-courses -- --env-file <protected-env> --manifest <existing-private-import.json> --output output/private/<new-name>.json` reads only allowlisted courses from official endpoints and saves owner-only snapshots. It never applies changes.
- Reader validates pagination, duplicates and missing imported lessons, follows no redirects and has bounded rate-limit retries. Quiz internals, media binaries, enrollments/progress and community are explicitly outside this capture.
- Import batching now retains original course/module/lesson ordering. Read-only production audit found 21 modules sharing 6 positions and 7 modules with duplicate lesson positions; compare against source before a focused repair. Fix is in source, not yet deployed as an Edge Function.
- Workflow draft: https://app.gohighlevel.com/v2/location/eqVZcs8fro8qiGD2sgoG/automation/workflow/57bf209d-11ca-475a-ad8e-5aff6b22ce4e . Name: Dirty Turf app sync — DRAFT, NOT ACTIVE. Post-created trigger only, exact Academy group filter, no outbound action or publication.
