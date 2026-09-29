# Stripe setup — September 29, 2026

Verified using the Stripe plugin against Dirty Turf account `acct_1UGVbZRfnCxS2laI` in **live mode**. No sandbox was exposed by the connection. No charges or customer subscription changes were made.

## Created and read back

All five app products are **inactive**. The app's checkout switch and billing plans remain disabled. Existing LeadConnector products and prices were preserved.

| Offer | USD price | Live Price ID |
| --- | --- | --- |
| Community + certification | $39.99/month | `price_1UL6ZaRfnCxS2laIQv4DFpeK` |
| Full turf cleaning course | $149.95 once | `price_1UL6ZnRfnCxS2laI6GoVMpYe` |
| Tile and grout course | $149.95 once | `price_1UL6ZoRfnCxS2laIvHq9zPy3` |
| Pavers and travertine course | $149.95 once | `price_1UL6ZpRfnCxS2laIDgwt6e6N` |
| Measuring tool | $29.95/month | `price_1UL6ZpRfnCxS2laIoklVoP83` |

SEO and CRM remain unavailable and have no app sale products. Existing members' free access is represented by app entitlements, not new Stripe subscriptions.

Portal configuration `bpc_1UL6a1RfnCxS2laIDBqD3Sxt` supports invoice history, payment method updates and cancellation at period end. Plan changes and a public portal login page are disabled. Stripe made this the default because no portal configuration existed. The app explicitly selects its configuration through a server environment variable.

## Account findings

- `charges_enabled` and `payouts_enabled` were true, but `external_account` appeared in both `currently_due` and `past_due`. The owner must resolve the bank account requirement in Stripe before release.
- Stripe Tax settings were `pending` with no registrations or default tax category. Tax collection has not been enabled; applicable registrations and product categories require review before activation.
- Account branding was initially empty. The real Dirty Turf logo, app icon and brand colors (`#003113` and `#047631`) were uploaded/saved through the signed-in Chrome dashboard and verified through the API. Local hosted Checkout also specifies the logo and app colors. Stripe does not support Poppins/Outfit in Checkout; Montserrat is the supported fallback. Stripe receipt layout/font remain provider-controlled; the app's community emails retain Poppins/Outfit with email-client fallbacks.
- Account-owned default payment settings have cards, Apple Pay and Google Pay enabled. Google Pay was enabled on September 29 through the dashboard and read back through the API. LeadConnector-owned configurations were preserved.
- No webhook endpoints were listed. The app endpoint is now deployed but must be configured with its own signing secret before sales start. Creating a catalog does not install the runtime API key or webhook secret.

## Remaining release work

1. Payment/access verification remains outstanding. A separate sandbox is preferred for renewal failure and replay coverage. The owner prefers live setup; a controlled live purchase/refund/cancellation is an alternative for the basic purchase path only after explicit authorization for the charge. No charge has been authorized or performed.
2. Resolve the certification/full-course content split and all course IDs. Review the grandfathered roster. Keep existing imported grants.
3. Resolve the account bank requirement and tax settings. Replace the previously shared runtime key before live activation.
4. The reviewed backend is deployed. Apply inactive app plans with the correct live IDs; register the eight webhook events in `stripe-setup.md`, securely save the signing secret, and verify delivery.
5. Activate mapped products/plans and checkout only after the release checks pass. PR 21 is merged and the latest web app is live; sales activation remains held. Native apps retain server-managed access without Stripe checkout prompts.

The protected local Stripe environment contains the live portal configuration ID; credentials are not included in this document. These are setup results, not proof of a completed payment or public mobile release.

## Verification for this setup change

- Read back all five Stripe product/price pairs and the portal configuration.
- Read back saved logo, icon and both account colors; inspected the Stripe receipt preview.
- 43 targeted handler/catalog tests passed; both changed Edge Functions passed Deno type checks.
- SQL harness passed 83 assertions across 30 migrations.
- Secret scan and diff whitespace checks passed. Generated the inactive live catalog SQL locally; it has not been applied.
- Chrome confirmed the bank task explicitly states no bank account is on file; the task is left open for the owner.

Follow-up: added the verified public privacy-policy URL to the live billing portal. Payout bank account is still required. The backend has since been deployed through the Supabase connector. No webhook was registered, and no sales were enabled.
