# Independent membership activation

The disabled backend was deployed on November 8, 2026. Source migration `20261104014537_independent_store_memberships.sql` is hosted as `20261108194112_independent_store_memberships`; do not replay it. All three membership functions are ACTIVE version 1, with six inactive provider/product mappings. Separate access, purchases and Scanner trials remain off. Existing effective access is unchanged. See [the rollout receipt](native-membership-rollout-20261108.md).

Google Play confirmed the merchant profile and Steve completed payout verification. Provider product/configuration work and real purchase acceptance remain outstanding; the Google Cloud account currently available does not have access to the required project. Apple's three separate subscription groups/products are created as drafts, with final metadata/availability and provider verification still pending. The previously signed Android code 14 predates the latest Scanner access, add-on and icon changes. No new native membership release or website activation is claimed. Existing Stripe billing remains unchanged.

## Catalog

| Product ID (both stores) | Independent access | US monthly target |
| --- | --- | --- |
| dirty_turf_community_monthly | Community | $19.99 |
| dirty_turf_scanner_monthly | Turf Scanner | $24.95 |
| dirty_turf_academy_monthly | Published Academy course a0238fea-1bfd-46de-978d-f476492edec8 | $24.95 |

Google uses a monthly auto-renewing base plan named `monthly`, without an introductory offer. Apple requires three separate subscription groups; confirm supported price points before changing Steve's target. Both clients display provider-localized prices. Scanner's separate server trial runs once per Auth account for seven days, requires no card and cannot automatically become a paid subscription. One-time courses require published content and separately reviewed non-consumable mappings before sale.

## Server preparation and rollout

1. Hosted preparation is complete under migration alias `20261108194112`; no replay is needed. Never replay the migration directory against the hosted database. Capture effective resource access again immediately before and after the future separate-access cutover, including legacy cancellation/expiry, restricted courses and owner free grants. A migration replay in isolated PGlite is test-only.
2. The six reviewed provider/product mappings for community fac17da0-bdb9-48c0-9c67-591d087e9912 are seeded inactive. Keep `separate_access_enabled`, `store_purchases_enabled` and `scanner_trial_enabled` false until their acceptance requirements pass. The private sandbox account allowlist is empty; no store entitlement or trial claim was created by deployment.
3. `verify-store-membership` is ACTIVE v1 with platform JWT verification retained; it also checks the confirmed Auth user, provider account binding and current provider state. Both notification functions are ACTIVE v1 with platform JWT checks off because their handlers verify Google OIDC or Apple signed payloads. A successful client purchase alone never grants access. Apply durable verified state before Google acknowledgement or Apple finish. Store lineage is immutable; stale events cannot overwrite newer verification or transfer a purchase to another login.
4. Configure dedicated protected server secrets, never browser VITE variables: `GOOGLE_PLAY_IAP_SERVICE_ACCOUNT_JSON`, `GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL`, `APPLE_IAP_PRIVATE_KEY`, `APPLE_IAP_KEY_ID`, `APPLE_IAP_ISSUER_ID`. These are separate from FCM/APNs push credentials. Grant only required provider billing/API access. Keep credentials and artifacts outside Git.
5. Google RTDN uses authenticated Pub/Sub push to `https://ipbtldajgsoxixqmajec.supabase.co/functions/v1/google-store-membership-notifications`, with that exact audience and the configured service-account email. Google signatures/issuer/audience/email are checked. Pending purchases that finish with the app closed resolve only through the authoritative Publisher API account hash and a service-only confirmed-account lookup. Google API state is reverified before applying or acknowledging.
6. Configure App Store Server Notifications V2 at `https://ipbtldajgsoxixqmajec.supabase.co/functions/v1/apple-store-membership-notifications`. Signature verification uses pinned Apple roots and current App Store Server API status. Sandbox and production remain separate. See native-store-billing-ios.md for groups and Mac/iPhone acceptance.
7. Exercise real provider sandbox purchases, cancellation, each product alone, each pair, all three, pending completion with the app closed, restore after interruption/reinstall, renewal, refund, account switching and duplicate/out-of-order events. Verify other memberships, existing access and owner grants survive cancellation of one product. Confirm Scanner trial expiry cannot be restarted and never creates a charge.
8. Prepare an unused native build number, native:sync/native:verify, signed artifacts and physical-device evidence. Android code13 has already been used by the previous internal-test release and lacks this implementation. iOS requires Mac/Xcode. Enable reviewed production mappings/flags only after provider configuration, server acceptance and the actual native release path are ready. Report upload, testing, review and public availability separately.

## Local verification

Node22 and locked dependencies. `npm run check` covers normal shared checks; Windows has existing POSIX permission/symlink/video helper failures, so require canonical Linux CI as well. The November 8 isolated SQL harness passed 193 assertions across 62 migrations, including all Scanner measurement methods and legacy compatibility. Run it with `node scripts/test-independent-memberships-sql.mjs` and a supplied PGLITE_MODULE if not installed locally. Pure provider/lifecycle tests mock authoritative services; they do not prove real payments.

With Deno2, check all three new function entrypoints using `deno check --no-config --node-modules-dir=none`. Android bridge tests use JDK21 and the existing SDK. Swift/StoreKit compilation is not possible on this Windows machine. The disconnected `?store-preview=1` sample is DEV-only and excluded from production builds; it shows independent choices without changing cloud data or charging anyone.
