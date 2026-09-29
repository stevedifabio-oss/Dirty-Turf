# Dirty Turf production priorities

Updated September 29, 2026. Retained at the owner's request.

## Current state

- Automatic GHL course updates run every five minutes: 1 course,36 modules,128 lessons. Eleven production runs observed: one applied,ten unchanged. All109 published lessons have content.
- Stripe membership ($39.99/month,whole current Academy) and measuring tool ($29.95/month) checkout are active. Existing members retain their free Academy/community access. No paid transaction has been executed.
- Branded community email delivery is enabled through the existing GHL/Mailgun connection. Two authorized internal emails reached Steve's Gmail inbox. Logo, green palette, readable fallback typography and the corrected Dirty Turf Academy sender were verified. Direct CTA navigation opened Community with the existing signed-in session. The live same-domain unsubscribe confirmation and POST both passed, the database preference changed to false, and Steve's original true preference was restored. Notification function v9 is active. PR25 deployed as main@6b8d4f0.
- Community sync storage/receiver are deployed; native GHL post/comment triggers now capture privately. Fixed historical avatar/profile artifacts blocking enrollment: all 62 imported posts and 59 imported comments are enrolled, with content/access/attachments unchanged and no emails generated. Actual content application still awaits a supported source payload with stable IDs. See [community-sync.md](community-sync.md).
- Apple build12 is Testing in TestFlight; Android build7 is available to internal testers. Public releases were submitted for review and configured for automatic release on approval. Store approval and newest-build physical-device acceptance remain separate gates.
- GitHub merge triggers the web deployment. Never request a separate manual Netlify deployment.

## Remaining work

| Priority | Work | Exact acceptance gate |
|---|---|---|
|1|Community post/comment synchronization|Real test post/comment/reply created. Native payloads omit stable content IDs, source timestamps and reply parents; the workflow picker also omits them. Obtain a supported GHL source interface before automatic application. Backend tests and authenticated transport pass; edit/delete/media support remains unestablished.|
|2|Store releases and installed devices|Check approval of Apple12/Android7; verify current builds on the owner's iPhone and Steve's Android. Backend content updates already use their shared database.|
|3|Stripe fulfillment|Bank requirement cleared September29: Stripe reports charges_enabled=true, payouts_enabled=true, one connected bank and no current/past-due/pending requirements. Controlled paid purchase/access/cancellation and refund verification remain pending; the owner completes any real paid checkout. Preserve existing subscriptions and imported grants.|
|4|Email delivery acceptance|Passed: inbox receipt, logo/colors, corrected sender, direct CTA, live unsubscribe GET/POST and original preference restoration. Derek Baca and Ralph lack linked login/contact identities; the dedicated App Review account intentionally has no GHL contact. Do not guess or create contact mappings.|
|5|Media/download audit|All109 published lessons have content. Authenticated first-lesson image loaded from signed private storage (1672x941). All142 inventoried assets are images; no published video/audio URLs were found, so video playback cannot be claimed. Empty source container modules currently show 0/0 headings in the course outline.|
|6|Upcoming events|GHL's Upcoming view showed no events on September29. Its calendar includes the past September27 Turf Clean call. Publish only real supplied/source upcoming dates and meeting details.|
|7|Additional paid courses/tools|Tile/grout and pavers/travertine courses are absent. Keep their offers unavailable. SEO/CRM remain future products. Whole current Turf Academy is included in membership, so do not sell a duplicate course upgrade.|

## Ownership rules

One-way GHL to app only. Member progress, app discussions, moderation, account access and existing billing stay protected. Unsupported or conflicting source content is held for review. Receiving a webhook is not proof of a working mirror.

## Stripe text for Steve — draft only

Hey Steve, Stripe is connected and the bank requirement is cleared. The $39.99/month Academy membership and $29.95/month measuring tool checkout are available. Existing members keep their free Academy/community access. We still need one new-member purchase to verify access and cancellation end to end. Please coordinate that checkout with us so we can check the complete flow.

## Evidence

[Activation details](activation-status-2026-09-29.md), [store release evidence](release-status-2026-09-29.md), [community implementation and remaining gates](community-sync.md).

September29 final checks: 380 tests passed; secret/schema/store/type/build/PWA gates passed. Web, iOS source, Android source, debug APK and release AAB retain identical embedded frontend hashes. This release changes server email delivery and the web unsubscribe endpoint, so no replacement native binary is required. Apple12 remains Waiting for Review; Google7 remains in production review with automatic publishing. The previously paired physical iPhone is currently unavailable; no new installed-device test is claimed. Course sync runs at21:40,21:45 and21:50 UTC completed unchanged without errors.
