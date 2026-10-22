# Stripe and backend release — 22 October 2026

Released under the user's explicit request to finish Stripe setup and backend changes for the Apple/Google build session. This receipt describes the hosted backend; it does not claim a published frontend or mobile release.

## Live configuration

- Supabase project: `ipbtldajgsoxixqmajec`. All nine reviewed October 22 migrations applied; hosted history now has 55 entries. Exact source hashes and hosted version/name aliases are in `output/qa/backend-release-20261022/release-migration-manifest.json` and `live-migration-history.json`. Do not replay the whole migration directory or reset production.
- Six functions deployed from the final combined source: `academy-invite-members` v5, `academy-notifications` v10, `create-community-photo-post` v1, `create-service-checkout` v2, `create-service-billing-portal` v2, `service-stripe-webhook` v3. Deployment receipts and artifact hashes are in `live-functions.json`.
- New private photo bucket and row-access policies are live. Moderation tombstones, literal text screening, photo retry recovery, lesson-mutation visibility and notification delivery guards match the combined source.
- New measuring plan `8112a26d-9bf8-5a44-ab3c-e31b39199b79`, Price `price_1UTQBhRfnCxS2laItGqF57n1`: **USD $10/month for new purchases**, measuring feature only. The public production catalog verifies $10 measuring and $39.99 Academy membership.
- Old $29.95 plan is inactive for new sales. Its original Stripe Price remains active and its immutable entitlement/renewal mapping remains present. No customer subscription was repriced or migrated.
- Dedicated live service webhook `we_1UTQDqRfnCxS2laIsdCrUIH6`: four Checkout, three subscription and two invoice events. Its signing secret is stored privately in Vault. The Academy endpoint and its signing secret were preserved.
- Both `STRIPE_SERVICE_CHECKOUT_ENABLED` and `STRIPE_SERVICE_RECURRING_ENABLED` are true. Service prices come from an administrator's immutable quote, with server-side allowed amounts/cadences. Services do not grant/revoke Academy access. Empty/unmapped course upsells remain unavailable.
- Existing portal configuration remains active with cancellation at period end and plan switching disabled. Native purchase/portal controls remain suppressed; no mobile payment-policy exemption is claimed.

## Verification

- 1,378 tests across 108 files; 568 isolated SQL assertions across the combined nine-migration set; TypeScript, schema, secret, metadata and six-entrypoint Deno checks passed.
- Configured production frontend build and PWA checks passed locally. The build contains the public Supabase configuration; server credentials are not bundled.
- Live Stripe Checkout accepted and read back exact $10/month measuring, $1,495 website and $97/month care line items and Dirty Turf branding. All unpaid validation sessions were expired; no customer, subscription or payment was created. The two temporary inline validation products were archived after exact ownership checks.
- Hosted endpoints reject unsigned/invalid-signature webhook requests, unauthorized callers and untrusted checkout origins. Signed ignored validation-event replay returned 200 without fulfillment. A separate real Stripe expiry event for an unpaid validation session had zero pending webhooks; corresponding hosted ingress returned 200. This proves delivery/signature wiring, not successful paid fulfillment.
- Live RLS is enabled for all five new public tables. Anonymous/authenticated callers cannot read runtime secrets or invoke the service-role-only checkout reservation. Private photo storage is limited to the approved image types and 4 MiB per image.
- All eleven protected live tables retained their pre-release row counts and exact values in preexisting columns, including 65 members, 63 links, 111 access grants, two progress records, courses, lessons, posts and comments. Receipt: `protected-state-comparison.json`.
- A private 89-table / 10,498-row preimage was restored locally. All nine migrations plus both measuring scripts rehearsed successfully. See [recovery proof](backend-recovery-proof-20261022.md).

## Exact native handoff

Final source remains uncommitted in `/Users/wififunded/.codex/worktrees/admin-web-live-20261021`, branch `codex/member-growth-upsells`, base `31e5b4e92e5e33ddd4e791955a2a726ea86b20f3`. The native integration checkout is `/Users/wififunded/.codex/worktrees/apple-release-integration`.

The native session's reviewed 20-file moderation/photo delta is integrated here. Copy/apply only the additional two-file invoice handler/test delta if it has not already been integrated: `output/qa/backend-release-20261022/stripe-invoice-native-delta.patch`, SHA-256 `52a928aaab7ecb38ea77188d752d527b52aec35902d49c5ec7e17988fd2506dc`. Its before/after hashes are in the adjacent JSON. The final source/build/backend manifest is `final-release-receipt.json`.

The backend configuration gate is complete for preparing the next native candidates. Preserve dirty work and verify exact configured assets, unused version numbers, signatures and physical-device behavior. No new store upload, reviewer reply, review submission or public release occurred here. Native payment eligibility and Apple business-model/reviewer evidence remain the release session's responsibility.

## Practical limits

Actual successful paid Checkout, asynchronous paid fulfillment, renewal/failure and cancellation delivery have not been exercised against real money. No real charge is implied by the no-charge contract and delivery checks. Payout/bank status could not be read with the restricted credential. Tax collection remains off; Steve's tax settings need separate confirmation.

The new web interface is still local and requires publication through the established GitHub build path. The new invite contract needs that paired frontend; the old bulk-invite mutation fails safely until updated. No members were invited or granted access by this release.

Before a broad member migration, finish private Storage-byte/off-device backup and managed-service recovery, approve a fresh exact roster, verify actual inbox delivery and run the physical-device pilot. The October 6 GHL history is partial and stale; no permanent real-time GHL Community mirror is available.
