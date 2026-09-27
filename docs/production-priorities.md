# Dirty Turf production priorities

Updated September 26, 2026. User explicitly asked to retain and complete this list.

## Confirmed
- Steve reports Android login now works on his phone.
- UI/UX fixes shipped on web via PR 18 and automatic GitHub build; 137 tests passed.
- Continue releases through GitHub; do not request manual Netlify deployments.

## Work queue
| Priority | Work | Status / next acceptance gate |
|---|---|---|
|1|Automatic GHL course/community updates|Active investigation and implementation. Existing import is a snapshot; Sept 24 documented course-read APIs now work with existing token. Exact-course reader implemented and live-verified: 1 course, 36 source categories, 128 lessons. All 128 existing lesson IDs present. Conflict-safe application and scheduler pending. GHL draft post trigger scoped to 7 Figure Turf Cleaning saved inactive; visible post variables are title/content/group/channel only, with no ID or attachment field. Need actual payload verification for stable identities, replies and media before enablement.|
|2|Apple/Android update containing PR 18 UI fixes|Pending new store binaries and installed-device acceptance. Android login separately confirmed by Steve. Apple11 upload previously completed, TestFlight availability needs verification.|
|3|Stripe payment integration|Waiting on Steve account access/activation and confirmed offer pricing/current billing arrangement. Then test purchase, access, failed renewal, cancellation, refund and duplicate webhooks. Never create duplicate subscriptions for existing members.|
|4|Member access reconciliation|Live Sept 26 read-only check: 62 active memberships; 1 active manually-added member has pending invite, no auth account and 1 active enrollment. Separate cancelled historical record has no enrollment. This is not an unlinked imported GHL member. Identify intended pending invite before provision.|
|5|Upcoming events|Live calendar has 5 past events. Need real next date/time/timezone/meeting details before publishing.|
|6|All course media/downloads|Check every published lesson and imported asset, not just samples. Preserve existing private media during source updates.|

## Sync design
GHL owns imported course content. App member progress, native discussions, moderation and app-owned fields remain protected. One-way GHL -> app is the initial design; two-way mirroring is not enabled. Imported posts/comments keep stable source IDs and parents. Poll course data on a server schedule; use documented community workflow triggers for new activity where payloads are sufficient. Hold edit/delete/media coverage gaps and conflicts for review; do not guess missing records are deletions.

Acceptance: create/edit/reorder/move lesson, replace attachment, new post/comment/reply, duplicate/out-of-order webhook, local edit conflict, disabled access and failed-run retry; show last successful sync and actionable errors. No automatic production application is enabled yet.

## Stripe text for Steve — draft only
Hey Steve, glad the login worked! To finish payments, please sign in to Dirty Turf’s Stripe account and complete any business or payout verification Stripe asks for. Let me know when it’s ready, and confirm the Academy price and whether it’s monthly, yearly, or a one-time payment. Also let me know how current members are paying so we can keep their billing intact and avoid charging anyone twice. We’ll handle the app connection and testing.

## References
- https://marketplace.gohighlevel.com/docs/Changelog/ (September 24 course read APIs)
- https://marketplace.gohighlevel.com/docs/ghl/courses/list-courses/
- https://ideas.gohighlevel.com/changelog/new-communities-triggers-in-workflows-automate-more-faster

## Implemented sync foundation (September 26)
- `npm run academy:capture-courses -- --env-file <protected-env> --manifest <existing-private-import.json> --output output/private/<new-name>.json` reads only allowlisted courses from official endpoints and saves owner-only snapshots. It never applies changes.
- Reader validates pagination, duplicates and missing imported lessons, follows no redirects and has bounded rate-limit retries. Quiz internals, media binaries, enrollments/progress and community are explicitly outside this capture.
- Import batching now retains original course/module/lesson ordering. Read-only production audit found 21 modules sharing 6 positions and 7 modules with duplicate lesson positions; compare against source before a focused repair. Fix is in source, not yet deployed as an Edge Function.
- Workflow draft: https://app.gohighlevel.com/v2/location/eqVZcs8fro8qiGD2sgoG/automation/workflow/57bf209d-11ca-475a-ad8e-5aff6b22ce4e . Name: Dirty Turf app sync — DRAFT, NOT ACTIVE. Post-created trigger only, exact Academy group filter, no outbound action or publication.
