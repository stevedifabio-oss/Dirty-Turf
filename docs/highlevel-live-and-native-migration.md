# HighLevel to Native Academy Migration

## Decision

Dirty Turf will own Academy authentication, courses, lesson progress, community discussions, members, events, and private media in Supabase. HighLevel remains online only during capture, reconciliation, and rollback. The app's Academy, Community, and Events tabs now render the native experience.

This is a controlled migration, not a screen scrape directly into production. Every source record is written to an import ledger with its HighLevel ID, parent ID, timestamps, source URL, payload hash, and resulting native ID.

## Production Migration Status

The initial native Academy migration completed on September 18, 2026. The ignored source archive validates at SHA-256 `e919ba8701b532ca3c8e4b63fa6612a87f621bd27c7ce33e9c6e8397c9d4a4f7`. All 29 dependency-ordered batches passed dry run, commit, and an idempotent repeat.

- 60 unique member emails were silently provisioned in Supabase Auth; no customer email was sent.
- All 49 imported enrollments are linked to login-ready accounts.
- One additional GHL member row is retained as a historical post author. It has no email or enrollment and is intentionally not provisioned.
- The production Academy contains 1 course, 21 modules, 128 lessons (109 published and 19 draft), 142 asset records, 62 posts, 59 comments, and 5 events. The import validator reports zero empty published lessons.
- The private `academy-assets` bucket contains 117 deduplicated course objects plus 31 imported post objects. The live post records reference only the 7 real post images and preserve 4 external resources; 162 captured profile/avatar artifacts were removed from post media.
- The owner account, owner organization, Academy community, source ledgers, storage policies, and server-side import/provisioning functions are live.

HighLevel must remain available through the member pilot and final delta capture. Mailgun activation, `app.dirtyturf.com`, a real-member Magic Link pilot, and client approval are still cutover gates.

## What HighLevel Officially Exposes

- The public Memberships API documents a course **import** endpoint but no supported course catalog export/read endpoint: <https://marketplace.gohighlevel.com/docs/2023-02-21/ghl/courses/import-courses/>
- The public Contacts API can supply CRM contacts, but all location contacts are not the same as members of the paid Academy group: <https://marketplace.gohighlevel.com/docs/ghl/contacts/contacts/>
- HighLevel's community product includes discussions, learning, events, leaderboards, members, roles, access controls, and paid/private courses. These must be inventoried because there is no single supported public export that contains all of them: <https://help.gohighlevel.com/support/solutions/articles/155000000280>

Use three capture lanes:

1. **API:** contact records and supported CRM metadata.
2. **Admin CSV:** the exact `7 Figure Turf Cleaning` member cohort, filtered by group/access rather than the full CRM.
3. **Authenticated capture:** course/module/lesson bodies, media and downloads, posts, comments, reactions, progress, events, roles, access rules, and leaderboard state.

Do not call undocumented HighLevel endpoints from the production app. Use the client-owned admin session for a one-time archive, then import the archive through the server-side migration function.

## Capture Package

Store every export in client-owned encrypted storage outside Git.

### Members

- HighLevel contact ID and community member ID
- Full name, email, avatar, company, location, role, status, join date, level, and points
- Group access, offer/course entitlements, trial/cancelled/suspended state
- Last-seen date when available

Passwords are not portable. Before launch, active members are silently provisioned as passwordless Supabase users at the same verified source email. They enter through the app's secure magic-link flow; the public form never creates a new user.

### Courses

- Course ID, title, description, cover, instructor, status, order, tags, and access rule
- Module ID, title, order, and drip schedule
- Lesson ID, title, type, body, source URL, video, transcript, duration, order, and status
- Every PDF, image, worksheet, download, and attachment
- Enrollment, completion, progress, certificate, and access exceptions per member when available

Move owned assets to the private `academy-assets` bucket. Keep third-party hosted video as a source link only when the client has confirmed the hosting account and license will remain active.

### Community

- Group settings, branding, privacy/payment state, rules, and membership questions
- Channels/categories, order, permissions, and visibility
- Posts/comments with IDs, authors, timestamps, edits, pins, reactions, mentions, attachments, and parent relationships
- Events with host, timezone, recurrence, meeting link, visibility, RSVP data, recordings, and attachments
- Roles, points, levels, leaderboard state, bans, and suspensions

## Import Workflow

1. Keep the authenticated course and community captures under ignored, client-controlled `output/private/` storage.
2. Run `npm run academy:reconcile`. It resolves only the 60 captured member contact IDs and prints aggregate counts, never credentials or member PII.
3. Run `npm run academy:compose`. It joins the course archive, community archive, contact reconciliation, enrollment roster, posts, comments, and events into `output/private/dirty-turf-academy-import.json`.
4. Run `npm run academy:validate -- output/private/dirty-turf-academy-import.json` and `npm run academy:batches`. The batch composer writes dependency-aware requests under ignored `output/private/academy-import-batches/`; this keeps each request below the hosted Edge Function execution window without dropping parent records.
5. Run `npm run academy:access-audit`. It must report 60 unique login emails, 49 enrollment records, and `allEnrolledCanLogin: true` without printing member PII.
6. Create the client owner in Supabase, obtain the organization UUID, and add it to the private source archive as `ownerOrganizationId`, then compose and validate again.
7. Sign into the app as that Academy owner/admin and call `academy-import` with every generated batch in filename order and `commit: false`.
8. Compare the combined batch counts with the private report and source archive. The current capture expects 60 login-eligible members plus one historical author, 49 enrollments, 128 lessons (109 published and 19 draft), 142 asset rows, 62 posts, 59 comments, and 5 events.
9. Call the same batches in order with `commit: true`, then repeat the complete ordered batch set. Provider IDs make application records idempotent; source-ledger batches remain separate audit records.
10. Call `academy-invite-members` with `action: "preview"`. The historical author must not receive an invite.
11. Call `academy-invite-members` with `action: "provision"` in batches of no more than 50 until `summary.allEnrolledReady` is true. This creates and links accounts without sending email.
12. Configure Supabase custom SMTP with the client-owned, verified Mailgun domain. Disable Mailgun click tracking for authentication mail. Allow `https://app.dirtyturf.com/**`, the Netlify pilot origin, localhost, and `com.dirtyturf.academy://auth/callback` under Authentication URL Configuration. After the custom domain resolves over HTTPS, set the Site URL and `APP_URL` to `https://app.dirtyturf.com`; keep the pilot origin temporarily in `APP_ALLOWED_ORIGINS` and `AUTH_REDIRECT_URLS` until production smoke tests pass.
13. Test a representative provisioned member by requesting a magic link from the app. Unknown email must not create an account, and the verified member must claim the correct Academy identity and course enrollment.
14. Call `academy-invite-members` with `action: "notify"` for a small pilot, verify delivery and deep links, then notify the remaining members in batches of no more than 25.
15. Test owner, admin, active member, course-only entitlement, cancelled member, and unrecognized email before cutover.

Never send the full archive as one production request. The archive is the canonical audit artifact, while the generated batches are the bounded transport format.

The source roster exposes course-level percentages but not trustworthy lesson IDs. These percentages are stored on `course_enrollments` and displayed as a floor until native lesson completion advances beyond them. The migration never marks an arbitrary set of lessons complete. Likewise, aggregate reaction and RSVP counts remain in the import ledger when member identities are unavailable.

## Native Data Model

- `academy_communities`, `academy_members`, `academy_member_links`
- `courses`, `course_modules`, `course_lessons`, `course_enrollments`
- `academy_member_lesson_progress`, `academy_assets`
- `community_categories`, `community_posts`, `community_comments`, reactions, bookmarks, and follows
- `academy_events`, `academy_member_event_rsvps`
- `academy_member_invites`
- `source_import_batches`, `source_import_records`

Company job records remain isolated by organization. Academy records are shared only with active Academy members and are protected by row-level security. Course access checks enforce open, level, and explicit enrollment rules at the course, module, lesson, metadata, and storage layers.

## Cutover Gates

1. Member, course, module, lesson, asset, enrollment, post, comment, and event counts match the final archive.
2. At least three records of every content type are visually compared with HighLevel.
3. Rich text, videos, downloads, timestamps, replies, pins, roles, progress, and access rules match.
4. All 60 current source members show login-ready in the access summary and all 49 course enrollments are linked; notification delivery, login, logout, expired links, and magic links work on iPhone and Android.
5. Active members can access only their assigned content; cancelled and suspended members cannot.
6. A final delta capture is imported after HighLevel enters read-only/frozen mode.
7. The client approves the archive and native production release before HighLevel is retired.

## Security

- Keep the HighLevel private token and Supabase service-role key server-side only.
- Never put either secret in a `VITE_` variable, app bundle, browser storage, log, or Git commit.
- Never commit member CSVs, manifests containing PII, course assets, or community archives.
- Keep invitation redirect targets on the exact server allowlist; do not accept a caller-supplied external URL.
- Rotate the HighLevel token previously shared in chat before production cutover.
- Use client-owned email, billing, recovery, storage, and administrator accounts.
