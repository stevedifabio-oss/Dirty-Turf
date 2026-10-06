# Dirty Turf production priorities

Updated October 5, 2026. Retained at the owner's request.

## Current state

- **Web:** the latest UI release (PR33) is published. The authenticated production app loads the matching current frontend. This sync/audit release preserves those frontend assets. GitHub merges trigger the web build; use that release path.
- **Android:** build10 (1.0), Community catch-up, is approved on Google Play with production rollout at100%. Steve previously confirmed login works. Acceptance of the newest build on his physical phone remains a separate check.
- **Apple:** signed-in App Store Connect shows version1.0/build15 Waiting for Review, with automatic release after approval. The production reviewer account passes password sign-in, ordinary course/Community access, measuring-tool access and the no-management-privileges check. App Store approval/public availability remains pending.
- **Courses:** the allowlisted current Turf Cleaning Academy is enabled on its five-minute schedule. A fresh production SELECT found the latest six runs successful and unchanged. Scope remains1 course,36 source modules,128 lessons,109 published lessons; source changes reach all clients through the shared database and foreground/resume refresh. Course authoring and Community synchronization are separate.
- **Stripe:** live charges and payouts are enabled; the bank requirement is cleared. The $39.99/month membership includes Community and the whole current Academy; the $29.95/month measuring tool remains optional. Existing members retain their free current Academy/Community access. No completed paid purchase or cancellation/refund flow has been verified. A new read-only fulfillment audit checks the exact purchase, processed webhook, member grants and authenticated access without charging or modifying customers.
- **Emails:** the branded notification worker is deployed. The September29 internal inbox, logo/green palette, typography, corrected sender, Community CTA and unsubscribe checks passed. No member migration announcement has been sent.
- **Community:** a guarded one-way browser bridge is built. The accepted baseline before this repair was sequence15:67 source posts,74 source comments, six held records and no duplicate writes. The reader now supports GoHighLevel's changed permalink/channel/pin UI while preserving exact source IDs, attachment ownership and complete-thread guards. Each run requires a fresh lease, full source capture, independent repeat and guarded application; private receipts record the latest accepted result and actual scheduler state. This bridge requires this Mac, Codex and Steve's signed-in Chrome; it is not a cloud or instant mirror.
- **Member migration:** the rollout plan and read-only reconciliation tool are prepared. A fresh private app export contains64 member rows,62 GHL links,61 invites,62 Auth identities,111 access grants and zero billing subscriptions. These totals include historical/reviewer/author records and are not the eligible source-member count. A fresh complete exact GHL roster and approved existing-free-member cohort are still needed before rollout readiness can be assessed.

## Remaining work

| Priority | Work | Exact acceptance gate |
|---|---|---|
|1|Community catch-up and overlap|Fresh complete Home feed and every post/comment/reply, independently repeated; exact source identities/channels/media; guarded apply and duplicate replay; stable scheduler proof. Resolve or explicitly accept unsupported media/identity holds before changeover. Missing source records require review and never become automatic deletes.|
|2|Apple review and installed devices|Apple15 approval/public availability; verify current builds on the owner's iPhone and Steve's Android, including retained login, courses, downloads, Community and measuring tools. Android10 production approval is confirmed. Shared backend content updates do not need replacement mobile binaries.|
|3|Stripe purchase/access lifecycle|The owner completes an authorized new-member paid checkout. Verify exact webhook, member account, Community/course or tool grants and ordinary buyer access using the private fulfillment audit. Then verify scheduled cancellation, actual access ending and relevant refund behavior while preserving imported/manual access. Provider setup and local tests are not completed-payment proof.|
|4|Member migration|Refresh the exact source group roster, reconcile accounts/roles/access and source billing, freeze the approved free cohort, resolve exceptions and complete a small web/iPhone/Android pilot. Authorize the announcement/waves and choose the posting changeover date afterward. See the member migration plan and readiness audit.|
|5|Media/download acceptance|All109 published lessons have content; the signed-image mirror is deployed. The September29 worker copied six missing images and then repeated without copies. Four vendor resource URLs returned403 to automated checks and need ordinary device verification. Preserve unsupported Community videos and existing attachments until supported source media is available.|
|6|Upcoming events|Use only actual source/supplied upcoming dates and meeting details. September29 GHL Upcoming showed no events; its calendar included the past September27 Turf Clean call. Refresh before publishing any event notice.|
|7|Additional paid courses/tools|Tile/grout and pavers/travertine courses are absent. Keep those offers unavailable. SEO/CRM remain future products. The whole current Turf Academy is included in membership; do not sell a duplicate upgrade.|

## Ownership rules

One-way GHL to app only. Member progress, app discussions, moderation, reactions,
account access and existing billing stay protected. Unsupported/conflicting source
content is held. Imported history must not replay member notifications. App activity
is not copied back to GHL. A received webhook is not proof of a working mirror.

## Stripe text for Steve — draft only

Hey Steve, Stripe is connected and the bank requirement is cleared. The $39.99/month Academy membership and $29.95/month measuring tool checkout are available. Existing members keep their free Academy/community access. We still need one new-member purchase to verify access and cancellation end to end. Please coordinate that checkout with us so we can check the complete flow.

## Evidence and operating instructions

- [Community bridge and holds](community-sync.md), [browser sync runbook](community-browser-sync-runbook.md)
- [Course sync and scoped source rules](course-sync.md)
- [Payment/access verification](billing-fulfillment-verification.md)
- [Member migration plan](member-migration-plan.md), [private readiness audit](member-migration-readiness.md)
- [Earlier email activation proof](activation-status-2026-09-29.md), [media/member cleanup proof](course-member-cleanup-2026-09-29.md)

Fresh live checks and member/source captures are saved privately under
`output/private/`. No credentials, member identities or source bodies belong in
committed evidence. Store upload, approval, public availability, backend access
and installed-device acceptance are recorded separately.

October5 infrastructure checks:703 tests across66 files and all secret/schema/
store/type/build/PWA gates passed. All49 web files match byte for byte in the
uploaded Android10 AAB and Apple15 IPA/archive. The stale local Android debug APK
was rebuilt and now matches as well. No new store upload was required for these
operator scripts and shared-database content updates.
