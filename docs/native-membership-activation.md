# Independent membership activation

Prepared source only. No new membership migration, function, store catalog, secret or activation flag has been deployed. Google Play confirmed the merchant profile. After Steve verified the checking account on November 4, Play Console showed it as Primary and cleared its verification warning. The subscriptions page previously requested a billing-enabled app upload before product creation. The website's planned membership catalog and existing Stripe billing remain unchanged.

## Catalog

| Product ID (both stores) | Independent access | US monthly target |
| --- | --- | --- |
| dirty_turf_community_monthly | Community | $19.99 |
| dirty_turf_scanner_monthly | Turf Scanner | $24.95 |
| dirty_turf_academy_monthly | Published Academy course a0238fea-1bfd-46de-978d-f476492edec8 | $24.95 |

Google uses a monthly auto-renewing base plan named `monthly`, without an introductory offer. Apple requires three separate subscription groups; confirm supported price points before changing Steve's target. Both clients display provider-localized prices. Scanner's separate server trial runs once per Auth account for seven days, requires no card and cannot automatically become a paid subscription. One-time courses require published content and separately reviewed non-consumable mappings before sale.

## Server preparation and rollout

1. Reconcile RELEASE_TRACKER hosted migration aliases and inspect hosted schema before applying only `20261104014537_independent_store_memberships.sql`. Never replay the migration directory against the hosted database. Capture effective resource access before and after the separate-access cutover, including legacy cancellation/expiry, restricted courses and owner free grants. A migration replay in isolated PGlite is test-only.
2. Review the three service-only tables/RPCs and inactive mappings for the real community fac17da0-bdb9-48c0-9c67-591d087e9912. Seed only the six reviewed provider/product mappings. Keep `separate_access_enabled`, `store_purchases_enabled` and `scanner_trial_enabled` false until their acceptance requirements pass. Sandbox accounts use the private explicit allowlist, which is empty by default.
3. Deploy `verify-store-membership` with platform JWT verification retained; it also checks the confirmed Auth user, provider account binding and current provider state. Deploy the two notification functions with their own cryptographic verification. A successful client purchase alone never grants access. Apply durable verified state before Google acknowledgement or Apple finish. Store lineage is immutable; stale events cannot overwrite newer verification or transfer a purchase to another login.
4. Configure dedicated protected server secrets, never browser VITE variables: `GOOGLE_PLAY_IAP_SERVICE_ACCOUNT_JSON`, `GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL`, `APPLE_IAP_PRIVATE_KEY`, `APPLE_IAP_KEY_ID`, `APPLE_IAP_ISSUER_ID`. These are separate from FCM/APNs push credentials. Grant only required provider billing/API access. Keep credentials and artifacts outside Git.
5. Google RTDN uses authenticated Pub/Sub push to `https://ipbtldajgsoxixqmajec.supabase.co/functions/v1/google-store-membership-notifications`, with that exact audience and the configured service-account email. Google signatures/issuer/audience/email are checked. Pending purchases that finish with the app closed resolve only through the authoritative Publisher API account hash and a service-only confirmed-account lookup. Google API state is reverified before applying or acknowledging.
6. Configure App Store Server Notifications V2 at `https://ipbtldajgsoxixqmajec.supabase.co/functions/v1/apple-store-membership-notifications`. Signature verification uses pinned Apple roots and current App Store Server API status. Sandbox and production remain separate. See native-store-billing-ios.md for groups and Mac/iPhone acceptance.
7. Exercise real provider sandbox purchases, cancellation, each product alone, each pair, all three, pending completion with the app closed, restore after interruption/reinstall, renewal, refund, account switching and duplicate/out-of-order events. Verify other memberships, existing access and owner grants survive cancellation of one product. Confirm Scanner trial expiry cannot be restarted and never creates a charge.
8. Prepare an unused native build number, native:sync/native:verify, signed artifacts and physical-device evidence. Android code13 has already been used by the previous internal-test release and lacks this implementation. iOS requires Mac/Xcode. Enable reviewed production mappings/flags only after provider configuration, server acceptance and the actual native release path are ready. Report upload, testing, review and public availability separately.

## Local verification

Node22 and locked dependencies. `npm run check` covers normal shared checks; Windows has existing POSIX permission/symlink/video helper failures, so require canonical Linux CI as well. New SQL harness: `node scripts/test-independent-memberships-sql.mjs` with a supplied PGLITE_MODULE if not installed locally. Pure provider/lifecycle tests mock authoritative services; they do not prove real payments.

With Deno2, check all three new function entrypoints using `deno check --no-config --node-modules-dir=none`. Android bridge tests use JDK21 and the existing SDK. Swift/StoreKit compilation is not possible on this Windows machine. The disconnected `?store-preview=1` sample is DEV-only and excluded from production builds; it shows independent choices without changing cloud data or charging anyone.
