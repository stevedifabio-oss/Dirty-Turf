# Verify Stripe payment and app access

Stripe checkout, live prices and the webhook are configured. **No completed paid purchase has been verified.** Existing unit/SQL checks cover the billing handlers; they are local checks, not proof of a real payment.

`scripts/audit-billing-fulfillment.mjs` reads an exact Checkout session, its current subscription/payment, the mapped plan, processed webhook and that buyer's grants. It repeats the provider read to hold a report if cancellation or refund changes the state during capture. It never creates checkout, charges money, replays a webhook, changes customers, cancels a subscription, issues refunds or sends messages.

## After an authorized purchase

1. Use a **separate Stripe sandbox and separate Supabase environment** for rehearsals. For a live purchase, the account owner must explicitly authorize and complete the charge first.
2. Obtain that app purchase's Checkout session ID from Stripe. Do not use a customer email or an unrelated GHL transaction as payment proof.
3. Supply the matching credentials locally in the ignored, private `.env.billing-audit.local` file. Never paste them into chat or commit the file:

   ```text
   STRIPE_MODE=live
   STRIPE_ACCOUNT_ID=<exact acct_ account ID>
   STRIPE_SECRET_KEY=<restricted server key for that mode/account>
   VITE_SUPABASE_URL=<matching project URL>
   SUPABASE_SERVICE_ROLE_KEY=<matching server key>
   VITE_SUPABASE_PUBLISHABLE_KEY=<matching public key>
   BILLING_BUYER_ACCESS_TOKEN=<existing short-lived session token of the actual buyer>
   ```

   Use `STRIPE_MODE=test` for the sandbox. The audit only needs Stripe **Read** permissions for Account, Checkout Sessions, Prices, Subscriptions and Payment Intents. A denied read produces `unverified`; it does not prove a payment or fulfillment failure. Server keys and buyer tokens stay local. This audit does not sign the buyer in or refresh their token.

4. Run:

   ```sh
   node --env-file=.env.billing-audit.local scripts/audit-billing-fulfillment.mjs --session cs_REPLACE --expect active --receipt output/private/billing-purchase-UNIQUE.json
   ```

5. Check the redacted receipt. `verified` requires positive paid completion, the exact account/mode/price, buyer identity, billing record, source-specific grants, processed Checkout webhook, and the ordinary buyer's authenticated app access. Missing or pending evidence stays `unverified`. A mismatched price, identity or grant becomes `mismatch`. It never treats a zero-dollar trial, an open Checkout, a success-page URL or reviewer/manager bypass as paid fulfillment.

The buyer token is optional for inspecting provider/database state. Without it, authenticated access remains unverified and the overall audit cannot pass. Use the real buyer's existing session; do not substitute the reviewer account. Receipts contain only checks, timestamps and hashed identity/grant fingerprints, and are saved privately with mode `0600`. Choose a fresh filename for every run; existing receipts are never overwritten.

## Verify cancellation or a refund

Save a **verified active receipt first**. After the owner performs an authorized action in Stripe's portal/dashboard, run the same exact session with its new expected state and the purchase receipt:

```sh
node --env-file=.env.billing-audit.local scripts/audit-billing-fulfillment.mjs --session cs_REPLACE --expect cancel_at_period_end --previous output/private/billing-purchase-UNIQUE.json --receipt output/private/billing-cancel-scheduled-UNIQUE.json
```

- `cancel_at_period_end` requires continued paid access through the paid period and the matching cancellation flag. It does not revoke access immediately.
- `cancelled` requires the actual ended subscription and revoked Stripe source grants.
- `refunded` is for a fully refunded **one-time purchase**. Partial refunds do not end access. Refunding a subscription invoice does not cancel the subscription.
- `unpaid` checks that an unpaid session did not confer active Stripe grants or an active billing record.

The previous receipt must belong to the same buyer, purchase and environment. Its imported/manual grant fingerprints must still exist unchanged. Ending a Stripe purchase must preserve separate free/manual access. No preservation baseline means the result remains unverified.

A passing report covers that observed state in the shared backend and an authenticated access RPC. It does **not** prove every lifecycle stage, renewal/failure behavior, physical iPhone/Android behavior, tax handling or a public store release. Confirm ordinary buyer access on each device separately. A local test fixture cannot satisfy these real-payment gates.

## Local regression checks

```sh
npx vitest run scripts/lib/billing-fulfillment-audit.test.mjs scripts/audit-billing-fulfillment.test.mjs supabase/functions/_shared/billing-handlers.test.ts supabase/functions/_shared/billing.test.ts
node --check scripts/audit-billing-fulfillment.mjs
```

The evaluator tests cover wrong mode/account/price, incomplete or zero-dollar checkout, exact member/source binding, missing/errored webhook, tool grants, scheduled cancellation, full one-time refund and preservation of imported grants. They contact no provider and make no financial changes.
