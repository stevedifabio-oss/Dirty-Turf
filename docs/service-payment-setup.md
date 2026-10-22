# Business-service payments

Backend released on 22 October 2026 under the user’s explicit instruction to finish Stripe and backend setup. The reviewed migrations and six matching functions are live, the dedicated nine-event service webhook is enabled, and both one-time and recurring service-sales flags are on. The new web/native frontend still needs its separate publication/build. See [the exact release receipt](backend-release-20261022.md). No card was charged; successful paid fulfillment remains untested.

## Steve's workflow

1. Open **Admin Studio → Offers & services** and choose a member's service request.
2. Enter the agreed amount and offer the quote. Website/GHL/SEO-AEO are $1,495–$2,495 once; Facebook management is $495–$895/month; website care is $97/month; GHL subscription is $197/month. The member sees the exact quote, not an invented fixed price within a range.
3. The member opens **Grow your business**, reviews the quote and chooses **Continue to Stripe**. Their Stripe-hosted Checkout charges that exact server-stored amount. A saved Stripe Price ID is optional advanced configuration; the normal workflow needs only an amount.
4. The app shows **paid only after signed payment confirmation**. The return URL never grants access or proves payment. A paid request moves from New to Contacted; payment does not mark the work delivered or close the job.
5. Monthly buyers can manage/cancel through service billing on the web, including after Academy membership expires. Orders retain initial payment status plus separate ongoing subscription/cancellation status.

Offered terms are immutable. Withdraw an unpaid quote before issuing a correction. A quote with pending or paid Checkout cannot be withdrawn. Retrying identical terms returns the same quote; another browser retry resumes the same pending order and authoritative Stripe session.

Lists are bounded: up to 250 offered quotes plus 250 historical quotes, and up to 250 ongoing monthly service orders plus 250 recent orders. Ongoing billing is loaded separately so old cancellation controls do not disappear behind newer one-time payments. Larger histories need a separately paginated administration view.

## Configuration procedure and remaining acceptance

1. Review/apply `20261022152708_academy_growth_services.sql`, then `20261022153645_academy_service_checkout.sql`. Do not replay unrelated historical migrations.
2. Deploy `create-service-checkout`, `service-stripe-webhook`, and `create-service-billing-portal`. Each validates its own boundary; the webhook uses the raw Stripe signature, while Checkout/portal verify the Auth user server-side.
3. Keep existing `STRIPE_SECRET_KEY`, `STRIPE_MODE`, `STRIPE_PORTAL_CONFIGURATION_ID` in their existing server environment or private Vault runtime configuration. No keys go into client code.
4. Add the **new dedicated** Stripe webhook endpoint `/functions/v1/service-stripe-webhook` in the same deliberate test/live mode. Subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `customer.subscription.created/updated/deleted`, `invoice.paid`, and `invoice.payment_failed`. Store its own signing secret as `STRIPE_SERVICE_WEBHOOK_SECRET`; the Academy endpoint's secret is not interchangeable.
5. Both new sales flags default off: `STRIPE_SERVICE_CHECKOUT_ENABLED=false` and `STRIPE_SERVICE_RECURRING_ENABLED=false`. The new names support server environment overrides and the exact private Vault allowlist. Explicit environment `false` wins over Vault. No setting is created or enabled by the migration.
6. Remaining paid acceptance: verify a Stripe sandbox/test-mode service payment, unpaid/asynchronous payment, duplicate retry and webhook replay. Confirm service orders change while Academy grants/subscriptions remain unchanged. A service Price must never also map to an Academy access plan.
7. Before monthly activation, verify the selected live/test portal configuration has cancellation enabled and subscription-plan switching disabled. Both portal and monthly Checkout check these settings against Stripe. Verify a recurring purchase, cancellation schedule, past-due status and cancellation webhook. Account owners must approve the actual checkout; local mocks are not a live charge test.
8. Both flags were enabled after the user’s approval, local lifecycle/SQL verification, live unpaid Checkout readback/expiry, cancellation-portal verification and signed webhook-ingress checks. These flags are independent from Academy membership checkout. Turning new sales off does not turn authenticated service billing or signed webhooks off.

Native Checkout remains disabled. This work does not alter native store purchase declarations or publish a new iPhone/Android build. Tax is not enabled, discounts/promotional prices are not applied, and advertising spend is not represented as included in management fees. Confirm tax treatment before launch.

## Guarded recovery

- **Known open Stripe session:** selecting Pay resumes that exact verified session, even with a different client retry ID.
- **Known paid session awaiting webhook:** hold the next Checkout; repair/replay the dedicated signed webhook instead of charging again.
- **Known expired Stripe session:** the server verifies expiry, cancels only its pending service order, and asks the member to select Pay again. A new order may then open a new session.
- **Unknown outcome after a create timeout:** the stable order ID is also the Stripe idempotency key (`dirty-turf-service:<order-id>`). Retries within the valid reservation recover the same operation. If the server never saved a session ID and the one-hour reservation is too old to safely create, the app holds payment for administrator review. Do not cancel/reset/recreate it merely because the local timer elapsed. In the exact Stripe account/mode, locate the Checkout by `metadata.service_order_id`, verify owner, quote, one line item, amount and payment status, and reconcile the actual session through the service-only record/confirmation path. If absence cannot be proven, retain the hold and contact Stripe. This is an explicit safe operational hold, not automatic payment recovery.
- **Price, identity, customer, mode or subscription terms disagree:** retain the hold; do not edit an old paid quote/order/plan to force fulfillment.

Subscriptions use authoritative Stripe `customer.subscription.*` state. The paid order is an initial receipt, not a claim that every future invoice is paid; no invoice-history UI or refund automation is included. Failed/cancelled service billing never revokes Academy access.

## Verification commands

```sh
npx vitest run src/lib/serviceCheckout.test.ts supabase/functions/_shared/service-checkout.test.ts supabase/functions/_shared/runtime-config.test.ts
deno check --node-modules-dir=none --no-lock supabase/functions/create-service-checkout/index.ts supabase/functions/service-stripe-webhook/index.ts supabase/functions/create-service-billing-portal/index.ts
PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node scripts/test-service-checkout-sql.mjs
```

These checks use local boundaries and isolated PostgreSQL. Provider setup, hosted configuration and real payment delivery require separate verification before calling the service checkout live.
