# Dirty Turf production priorities

Updated September 29, 2026. Retained at the owner's request.

## Current state

- Automatic GHL course updates run every five minutes: 1 course,36 modules,128 lessons. Eleven production runs observed: one applied,ten unchanged. All109 published lessons have content.
- Stripe membership ($39.99/month,whole current Academy) and measuring tool ($29.95/month) checkout are active. Existing members retain their free Academy/community access. No paid transaction has been executed.
- Branded community email delivery is enabled through the existing GHL/Mailgun connection. No new Mailgun login is required. No test or bulk email has been sent; inbox receipt remains unverified.
- Community sync storage/receiver are deployed; native GHL post/comment triggers now capture privately. Actual content application awaits a real payload adapter. See [community-sync.md](community-sync.md).
- Apple build12 is Testing in TestFlight; Android build7 is available to internal testers. Public releases were submitted for review and configured for automatic release on approval. Store approval and newest-build physical-device acceptance remain separate gates.
- GitHub merge triggers the web deployment. Never request a separate manual Netlify deployment.

## Remaining work

| Priority | Work | Exact acceptance gate |
|---|---|---|
|1|Community post/comment synchronization|Capture real native post/comment/reply events, map stable IDs and media, then verify app appearance and duplicate suppression. Backend tests and private transport pass; source payload mapping is pending. Edit/delete support is not established.|
|2|Store releases and installed devices|Check approval of Apple12/Android7; verify current builds on the owner's iPhone and Steve's Android. Backend content updates already use their shared database.|
|3|Stripe fulfillment|Owner must complete the payout bank requirement. Controlled paid purchase/access/cancellation and refund verification remain pending; no charge is authorized. Preserve existing subscriptions and imported grants.|
|4|Email delivery acceptance|One authorized internal notification, inbox rendering, unsubscribe and app destination verification. Three unmapped accounts require deliberate GHL contact mapping before delivery.|
|5|Media/download audit|All published lessons have content; complete authenticated playback/download verification is still needed. Preserve private mirrored assets during sync.|
|6|Upcoming events|Five imported events are past. Publish only after real upcoming date,time,timezone and meeting details are supplied.|
|7|Additional paid courses/tools|Tile/grout and pavers/travertine courses are absent. Keep their offers unavailable. SEO/CRM remain future products. Whole current Turf Academy is included in membership, so do not sell a duplicate course upgrade.|

## Ownership rules

One-way GHL to app only. Member progress, app discussions, moderation, account access and existing billing stay protected. Unsupported or conflicting source content is held for review. Receiving a webhook is not proof of a working mirror.

## Stripe text for Steve — draft only

Hey Steve, the $39.99/month Academy membership and $29.95/month measuring tool checkout are connected. Existing members keep their free Academy/community access. Stripe still needs your payout bank account: open Settings → Business → Account status → Provide an external account → Start, and complete that directly in Stripe. We still need to verify one paid purchase and cancellation end to end.

## Evidence

[Activation details](activation-status-2026-09-29.md), [store release evidence](release-status-2026-09-29.md), [community implementation and remaining gates](community-sync.md).
