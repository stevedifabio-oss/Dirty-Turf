# Community email parity — local build, held for Stripe

Nothing in this change has been pushed, deployed, scheduled remotely, or emailed to a member. The preview catalog contains **38 synthetic emails**. Regenerate it with `node scripts/preview-academy-emails.mjs`, then open `output/email-preview/index.html`.

## Evidence and coverage

The supplied September 27 event-launch email includes a personalized greeting, community, event name, date, meeting location and Register button. The local launch template preserves those fields and adds an explicit local time range/timezone. Dirty Turf branding, web/app links, notification settings and per-category unsubscribe appear in every email. Existing signed-in sessions are reused when a link opens; emails do not contain bearer login tokens.

Read-only review of the user's prior GHL emails also confirmed mentions, comments, replies, post/comment likes, posts from followed people, welcome, new/unlocked courses, membership administration, group/course payment notices and cancellations. Reference catalog: [HighLevel community email settings](https://help.gohighlevel.com/support/solutions/articles/155000000280), [notification preferences](https://help.gohighlevel.com/support/solutions/articles/155000001719), and [community events](https://help.gohighlevel.com/support/solutions/articles/155000004111).

| Email family | Local implementation | Trigger / remaining connection |
|---|---|---|
| Event launched / open registration | Wired | Published app event → eligible community members; Register opens the exact event. |
| Event reminder | Wired | 24-hour and 1-hour windows, registered/interested members only; date/time/timezone and safe meeting URL. |
| Event registration confirmation | Wired | RSVP insertion or change; only the attendee receives it. |
| Event changed / cancelled | Wired | Updates notify attendees; archive/unpublish/delete cancels stale reminders and sends cancellation. These extend observed launch/reminder parity. |
| New post from followed member | Wired | Follow relationship required; no all-member new-post broadcast. |
| Announcement | Wired | Announcement-category post → eligible community members. |
| Comment on own post / reply on own comment | Wired | Existing comment triggers; excerpt and conversation link; self/duplicate-author suppression. |
| Mention in post / comment | Wired | Existing selected-member mention producer; actor, excerpt and discussion link. A mention replaces the same action's generic pending email. |
| Post / comment like | Wired | Existing reaction triggers, reaction preference and self suppression. |
| Welcome / course unlock | Wired | Non-import access grant; independently respects membership/course access. Unclaimed import identities are not emailed by this worker. |
| New course / new published lesson | Wired | Course publish and future lesson publish; baseline source sync is silent; ordinary edits/republish do not re-email the same lesson. Course access and module visibility/drip limits apply. |
| Course certificate | Wired | Newly issued active certificate → recipient; course link. |
| Membership approved / declined / removed | Wired | Authenticated community administrator status change; corresponding member notice and admin removal notice. |
| Community role / ownership change | Wired | Authenticated administrator role change. Ownership uses the existing role update capability. |
| Reported content | Wired | New report → community owners/admins/moderators only. Email omits sensitive report text. |
| Weekly summary | Wired | Monday 9am in each recipient's saved timezone; count of recent non-imported posts. This is an app summary, not a claim to duplicate every GHL newsletter setting. |
| Join request, user/admin | Template + protected producer API | Membership application acceptance is not connected to an Academy identity/community in the existing product. No invented registration/approval flow. |
| Added to private channel | Template + protected producer API | Current app does not model private-channel memberships. |
| @everyone in post / comment | Template + protected producer API | Current composer supplies specific member mentions only; mass-mention UI/authorization is not enabled. |
| Group/course purchase, member/admin | Template + protected producer API | Awaiting verified Stripe payment events and setup. An `active` database status is not proof of a payment. Stripe supplies payment receipts. |
| Group/course cancellation, member/admin | Template + protected producer API | Awaiting Stripe integration and cancellation-state tests. Cancellation notices must carry the correct remaining-access explanation. |

The protected producer is `queue_academy_lifecycle_email(...)`, executable only by `service_role`. It accepts a catalogued template, recipient, community and stable source event ID. Replaying an event does not duplicate email. Admin-only templates reject ordinary recipients. This API is not a client-facing “send email” endpoint.

## Delivery safeguards

- Both the Edge Function `ACADEMY_EMAIL_DELIVERY_ENABLED` flag and `private.academy_email_cutover.enabled` default off. In-app alerts continue while email is off. No pre-cutover backlog is created for later replay; the migration retires old pending/processing deliveries.
- Imported historical records and the initial course synchronization produce no email blast. The course worker enables subsequent source publication notifications only after its baseline succeeds. Content edits preserve progress and do not email every learner on each poll.
- Recipient email comes from the currently bound Auth user, never a stale GHL invite or Stripe billing address. Unclaimed imported accounts require the separate invitation process. No marketing email is guessed from display names.
- Access, target visibility, preferences, changed email addresses, blocks, unfollows and RSVP existence are checked again when claiming and immediately before provider submission. Course-only access works without assuming a community grant. Membership-removal/cancellation notices may reach their own inactive account without leaking protected content.
- Member timezone is validated against PostgreSQL's timezone catalog; the frontend saves the browser timezone when preferences are saved. Existing users default to explicitly labeled UTC until their preference is saved. We do not assume every member lives in Phoenix.
- Email links use application targets; launch Register opens the event, cancelled events open the calendar. Meeting links accept HTTPS only. Imported excerpts and template data are HTML escaped. Tracking is disabled so Mailgun does not rewrite app links.
- Preference unsubscribe uses a signed token; GET previews confirmation, POST applies the change. The endpoint stays available even while dispatch is disabled. Queued pending/processing messages for that category are cancelled.
- Claims use locks and idempotency keys. A provider timeout, 5xx, missing acceptance ID, process crash, or database failure after acceptance is held for manual provider-log review rather than automatically resent. Mailgun has no guaranteed message idempotency contract here; exactly-once delivery cannot be promised across provider/network failure.

## Cutover — prepared instructions, not executed

1. Keep the release held until the Stripe details arrive. Complete staging payment/access tests first. Prepare the production backend before pushing the website: this frontend depends on the new course visibility and notification timezone columns.
2. Apply course-sync and email migrations; deploy the named functions. Keep `ACADEMY_EMAIL_DELIVERY_ENABLED=false`. Do not change unrelated functions or schedules.
3. Configure `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_FROM_EMAIL`, `MAILGUN_FROM_NAME`, `MAILGUN_REGION`, `APP_URL`, `NOTIFICATION_DISPATCH_SECRET`, and `NOTIFICATION_SIGNING_SECRET` as server-only secrets. Keep the existing `/unsubscribe` route accessible. The worker uses its custom `x-notification-secret` header; its existing `verify_jwt=false` setting is required for cron/unsubscribe.
4. Verify the disabled backend, apply the guarded course baseline, and then push through GitHub for the automatic web build and prepare the native release. Verify one internal member's consent/preferences, recipient identity, event/course targets and the existing GHL notification configuration. Stop the matching GHL email families before enabling this sender to prevent duplicate notifications. Do not blindly enable both systems.
5. Set the DB cutover time **at activation**, then turn on the Edge Function flag. Old pending mail remains cancelled. Run one controlled internal event and verify delivery + unsubscribe + target opens on web/iPhone/Android before broad cutover.
6. Use the existing scheduler recipe in `docs/release-runbook.md` (Vault secrets and `pg_net`) for the `academy-notification-dispatch` job every five minutes. Inspect existing jobs first and update that job instead of creating a duplicate. Do not enable this job before cutover. The reminder catch-up window is 15 minutes; a longer outage intentionally does not send late reminders.
7. Observe pending/failed/cancelled outbox counts. Review ambiguous provider outcomes individually. Disable the Edge flag to stop dispatch; disable/reset DB cutover before a long pause so old queued content will not replay at the next activation.

## Verification

- `npx vitest run supabase/functions/_shared/notification-email.test.ts`
- `PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js node scripts/test-community-email-sql.mjs`
- `npx --yes deno check supabase/functions/academy-notifications/index.ts`
- `node scripts/preview-academy-emails.mjs`

The SQL harness loads actual repository migrations into isolated PostgreSQL, replacing only Supabase-owned Auth/Storage bootstrap objects and the unavailable pgcrypto extension setup. It does not connect to a hosted database or send email. Browser previews verify rendering; real provider delivery and installed-device notification links remain a controlled cutover check.
