# Community automation rollout

This checkout contains scheduled publication and native phone notification support.
On October 23, 2026 (America/Bogota), the reviewed backend and web app were
deployed. The twelve approved announcements are active for Monday, Wednesday
and Friday at 09:00 America/Phoenix, October 26 through November 20. One protected
server cron dispatches the publisher every minute. Its first observed HTTP 200
runs examined all twelve future schedules without publishing early or failing.

Two bounded tests verified publication, recipient isolation and email fanout;
concurrent dispatches published the first test only once. The accessible Gmail
test arrived in the intended inbox, and its actual HTML button opened the exact
post in Chrome. Both test posts were then archived, with notification, email and
occurrence audits retained. Temporary follows were removed. Existing email
dispatch and Community sync v5 are unchanged.

Phone push remains disabled at both database gates, with zero devices/deliveries
and no push cron. No native build, sync, upload, store change, Git commit or Git
push occurred. Current receipts and the final integration patch are in
`output/community-automation-20261023/` in the primary workspace, with a stable
local copy under this checkout's `output/community-automation-rollout-live/`.

## Agreed publishing rules

- Monday Academy focus, Wednesday discussion question, Friday wins at 09:00
  `America/Phoenix`, plus one-time announcements when needed.
- Use existing Academy material and general discussion prompts. Prices, offers
  and business claims require Steve's supplied wording. Do not fabricate results.
- The initial calendar contains twelve separate one-time schedules, October 26
  through November 20, 2026. These twelve were explicitly activated after live
  acceptance; newly created drafts still need their own activation.
- Weekly schedules repeat their exact saved text. Different content needs
  separate drafts. The approved twelve posts use the existing Announcements channel for all
  eligible Community members, including the observed GHL roster, while honoring
  preferences, access and current provider eligibility. Ordinary posts retain
  the followed-author audience. No GHL CRM-wide broadcast is authorized. The
  user separately approved one Gmail test contact and its narrow contact-link
  repair; that exception does not authorize bulk contact creation.
- Reports, suspensions, accounts, invitations and member replies remain human
  decisions. The literal text screen is not semantic or image/video moderation.

The reviewable calendar and current production findings are saved in the primary
workspace under `output/community-automation-20261023/`. Each draft has a stable
`clientRequestId` so a lost create response cannot silently duplicate it.

## Deployment and activation are separate

1. Reconcile this focused patch with the latest web checkout. Preserve the live
   community sync v5/deleted-author migration and all unrelated uncommitted work.
   The other chat's unpublished Community video/player work is excluded. Its
   separate course `playsInline` change and any later approved course work must
   be reviewed before preparing future native binaries.
2. Obtain explicit approval for the reviewed backend and web deployment. Apply
   only the new reviewed migrations, never replay the full historical directory.
3. Deploy the dedicated scheduler and push workers with their protected dispatch
   configuration. Both database and worker switches default off. Installing code
   does not authorize or activate a schedule.
   The scheduler reads only `ACADEMY_POST_SCHEDULER_ENABLED` and
   `ACADEMY_POST_SCHEDULER_SECRET` from the Edge environment, falling back for
   missing values through the existing service-role-only runtime/Vault RPC.
   Explicit environment values take precedence, including `false`. Missing or
   inaccessible configuration fails closed. Cron must use the same protected
   secret from Vault; never reuse the email/push dispatcher credential or change
   unrelated payment, Community or email settings.
4. Follow the scheduler/push operations templates and native push setup guide.
   Confirm protected APNs/FCM credentials, environment, native capability/signing
   and Android configuration. Do not paste credentials into chat or public envs.
5. Perform one explicitly authorized controlled publication and recipient test.
   Confirm exactly one post, correct audience, email recipient/deep link/opt-out,
   and physical iPhone/Android permission, receipt, tap and sign-out behavior.
6. Enable the verified service and activate the exact reviewed drafts under the
   agreed policy. Confirm next Phoenix run times and pause/cancel behavior.
   Future content beyond the starter calendar requires a new prepared calendar.

Phone push requires new native builds, protected signing configuration and
separate store upload/review authorization. Existing store submissions are not
changed by this source work. A web deployment alone cannot add push to current
installed binaries.

Review the privacy policy and both stores' disclosures against the final device
registry, persistent installation identifier, APNs/FCM tokens and SDK behavior
before a future native release. The registry links devices to accounts for app
notifications; it is not an advertising/tracking feature. That purpose does not
by itself exempt collection from disclosure. Review the final implementation
against [Apple's privacy definitions](https://developer.apple.com/app-store/app-privacy-details/)
and [Google Play's Data safety guidance](https://support.google.com/googleplay/android-developer/answer/10787469).
No store answers were changed in this preparation task.

## Delivery behavior

Push has its own explicit opt-in and category preferences, independent of email.
Likes and followed-member post pushes default off. Generic lock-screen text
avoids disclosing discussion content. Quiet hours are 22:00–08:00 in each
registered phone's timezone; stale queued alerts expire instead of becoming a
backlog. Permission is requested only after the member chooses to enable it.

Publication, queue creation, provider acceptance and actual device/inbox receipt
are different results. Uncertain provider outcomes require review, not blind
automatic resend. Content access, blocks, moderation, account identity and device
generation must still be valid at delivery and when a notification is opened.

## Operations

The hourly **Dirty Turf community operations** heartbeat is active in the app.
It observes and alerts this chat; it sends no member messages and changes no
moderation or publishing state. It depends on the local Codex/Mac runtime. The
future app-owned publisher uses the separately configured Supabase schedule.

`supabase/operations/inspect-community-operations.sql` is a verified read-only
aggregate query. It prints no recipients, message bodies, tokens, cron commands
or provider response bodies. Cron SQL success is separate from worker success.

At the initial live check the existing email worker was active every five
minutes, recent responses were HTTP 200 with no queued work, 71 deliveries were
provider accepted, two were failed and five were cancelled. Actual inbox receipt
was not verified. One failed moderation alert lacked a verified recipient
mapping; one weekly digest was provider rejected. One old post report remained
open. No failed message was retried and no report was resolved by this work.

## Local validation

Use the targeted scheduler/push test commands recorded in the adjacent completion
receipt, then TypeScript, schema/secret checks, the application suite and web
build. SQL harnesses run against isolated PGlite with the combined migrations;
they do not contact a hosted database or notification provider. PGlite serializes
statements, so passing replay tests do not prove independent PostgreSQL session
lock contention. Physical provider/device acceptance remains a rollout gate.
