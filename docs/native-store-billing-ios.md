# iPhone membership billing preparation

The shared application uses `MembershipBilling`, a local Capacitor plugin backed by StoreKit 2. Its Swift source is part of the existing `CapApp-SPM` target and `BridgeViewController` registers the plugin. No new Swift package or signing entitlement is added. This is source preparation, not an App Store product activation, uploaded build, or verified purchase.

## App Store Connect configuration

Create one auto-renewable monthly subscription in **each of three separate subscription groups**. A single group would make these alternatives/upgrades rather than independently purchasable memberships.

| Product ID | Display name | Separate group | Approved US monthly target |
| --- | --- | --- | --- |
| `dirty_turf_community_monthly` | Community | Community membership | $19.99 |
| `dirty_turf_scanner_monthly` | Turf Scanner | Turf Scanner membership | $24.95 |
| `dirty_turf_academy_monthly` | Turf Cleaning Academy | Academy membership | $24.95 |

Confirm the available Apple price points with Steve before activating a price that differs from his targets. The app displays Apple's localized `displayPrice`; it must never substitute a hardcoded website price in the purchase screen. Add the required localizations, subscription descriptions, review information and availability, and reconcile tax/category and Paid Apps agreement status with the account holder. Do not accept agreements, submit bank/tax details or change existing subscriptions by inference.

Do not configure a Scanner introductory offer that automatically converts to a charge. Steve's seven-day Scanner trial is a separate, once-per-account, expiring server entitlement with no automatic paid conversion. All three StoreKit products are regular paid monthly subscriptions. One-time add-on courses need separately mapped published content and non-consumable products before they can be sold; this plugin does not advertise or purchase them.

## Server prerequisites

Use the established bundle identifier `com.dirtyturf.academy` and the actual numeric App Store application ID, verified from App Store Connect. Server-side verification must validate the Apple signature against trusted Apple roots, expected bundle/application, production or explicitly allowed sandbox environment, exact allowed product ID, subscription expiry/revocation, transaction identity and the signed `appAccountToken` against the authenticated Academy user UUID. Never trust client price, expiry, account, environment or purchase-success fields as an entitlement.

App Store Server API credentials belong in protected server configuration only: issuer ID, key ID and the associated private signing key. They are not the existing APNs push credentials. Configure App Store Server Notifications V2 for the verified deployed endpoint and environment only after its signed-payload verification and replay/ordering behavior have passed tests. Server verification and renewal/refund/revocation handling must be operational before live purchases are enabled.

The prepared server adapter uses Apple's official `@apple/app-store-server-library@3.1.0`, online certificate checks and the Apple PKI G2/G3 roots embedded as DER data. SHA-256 pins: G2 `c2b9b042dd57830e7d117dac55ac8ae19407d38e41d88f3215bc3a890444a050`; G3 `63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179`. Roots are never obtained from a request-supplied trust store. The adapter verifies the initial proof, fetches Apple's current subscription status and verifies the latest transaction and renewal JWS before returning normalized state. A signed old device proof or delayed notification cannot independently reactivate a refund. Sandbox and production remain distinct; the fulfillment layer must enforce its sandbox account allowlist before any grant.

Forty-five injected-provider tests and a strict TypeScript check passed for the pure verification logic. They cover account/application/product mismatches, invalid signatures, authoritative refunds/expiry/retry/grace, independent subscription lineage, unavailable providers and signed notifications. Deno 2.9.6 checks passed for the three new membership functions, including the pinned Apple runtime dependency. No live Apple API request or secret inspection was performed for these tests. Downloaded public certificate/SDK inspection evidence is preserved outside the repository at `%LOCALAPPDATA%/DirtyTurf/verification/apple-membership-public-20261103` so third-party package tests are not discovered as repository tests.

## Native bridge contract

- `getProducts()` returns `{ available, products }`. Each product includes `id`, `displayName`, localized `displayPrice`, `priceAmountMicros` and `currencyCode`. Only the three allowlisted auto-renewable subscriptions with a one-month period are exposed. Products absent from App Store Connect remain unavailable.
- `purchase({ productId, accountToken })` requires a nonzero UUID for the signed-in user. It returns `status: purchased | pending | cancelled` and a `purchases` array. A purchased proof contains `provider: apple`, `productId`, decimal-string `transactionId` and `signedTransactionInfo`. The local StoreKit verification must succeed and its account token must match before the native purchase call returns a proof.
- `restorePurchases({ sync?: boolean })` returns current entitlements and unfinished verified transactions. User-triggered Restore defaults to `sync: true` and can show Apple's account prompt. Use `sync: false` for quiet foreground refresh. No proof is persisted in browser storage or logged.
- `billingPurchaseUpdated` emits `{ status: purchased, purchases }` for locally verified transaction updates, including delayed approvals, renewals and revoked/expired updates. The application must still verify each proof on the server and handle account changes before updating access.
- Call `finishTransaction({ transactionId })` only after durable server fulfillment succeeds. Failed server/network operations leave the transaction unfinished so restore/retry can recover it. Completion is idempotent for the most recent 256 finished transaction IDs. After a WebView reload, a repeated finish must still match an exact StoreKit-verified unfinished transaction or current entitlement; unknown/unverified IDs are rejected. The plugin grants no access directly.
- `manageSubscriptions({ productId? })` validates any supplied product ID, then opens Apple's subscription-management sheet in the app's foreground window scene. Apple shows all of this app's separate subscriptions. `{ opened: true }` means the sheet was presented and dismissed; it does not claim that the member cancelled anything. Refresh verified access after dismissal. No external Stripe URL is opened.

## Required acceptance on a Mac and iPhone

1. Build the configured app using a supported Xcode and the existing Apple team; this Windows workspace cannot compile or sign StoreKit/UIKit code.
2. In StoreKit testing/sandbox, exercise each membership alone, every pair and all three. Confirm purchasing a second does not replace the first and that the server grants only the purchased resource.
3. Confirm local prices match Apple's confirmation sheet. Test cancelled purchases and Ask to Buy/pending approval with no premature access.
4. Interrupt the network after Apple payment, restart the app, restore and verify the same transaction fulfills once before being finished. Repeat restore and transaction updates to verify idempotence.
5. Test a different Academy login on the same Apple account. The signed account token must prevent purchase transfer or disclosure of another member's resources.
6. Verify quiet foreground refresh does not prompt for Apple sign-in; explicit Restore works after reinstall/on another device. Exercise refunds, expiry, renewal failure, cancellation and delayed/out-of-order notifications while other memberships and owner grants remain intact.
7. Verify the separate seven-day Scanner trial expires on the server, cannot restart, and never creates an Apple/Stripe subscription automatically.

Official references: [StoreKit transactions](https://developer.apple.com/documentation/storekit/transaction), [account tokens](https://developer.apple.com/documentation/storekit/product/purchaseoption/appaccounttoken(_:)), [current entitlements](https://developer.apple.com/documentation/storekit/transaction/currententitlements), [transaction verification](https://developer.apple.com/documentation/storekit/verificationresult), [finishing transactions](https://developer.apple.com/documentation/storekit/transaction/finish()).
