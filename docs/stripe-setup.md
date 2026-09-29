# Stripe setup for Dirty Turf Academy

The September 28 owner pricing is captured in [Academy pricing](academy-pricing.md) and `academy-pricing.draft.json`. Keep that catalog inactive until the included certification content, paid upgrades, tool entitlements and Stripe mappings are verified.

## Prepared live resources — checkout remains closed

The Stripe plugin prepared five dedicated, inactive app products and their prices in Dirty Turf's live account on September 29. Their IDs are recorded in `academy-pricing.draft.json`. They cover the $39.99/month membership, three $149.95 one-time courses, and the $29.95/month measuring tool. Existing GHL products and subscriptions are unchanged. SEO and the future CRM are not offered for sale.

The dedicated live customer portal configuration is `bpc_1UL6a1RfnCxS2laIDBqD3Sxt`. It allows invoice history, payment-method updates, and cancellation at the end of the billing period. Product switching and shared portal login links are disabled.

## Remaining owner input

1. Finish any business or payout verification Stripe requests in Dirty Turf's account.
2. Connect a **separate Stripe sandbox** through the Stripe plugin so payment tests can run without real charges. Sandbox products, prices, portal configuration, keys and webhook secrets must be created separately; the live IDs above do not work there.
3. Confirm which imported Turf Cleaning Academy lessons belong to the included certification versus the $149.95 full course. Reconcile the existing-member roster and existing billing agreements before activation.

We will configure the matching sandbox catalog, webhook and server settings, then test payment, access and cancellation. Server keys belong in the selected Supabase environment's secrets; do not send them in chat. This hosted Checkout integration does not need a publishable Stripe key in the website or mobile app.

## Pages prepared

- `/membership`: public membership options and email entry, then Stripe-hosted Checkout. Prices come from validated server configuration; enrollment stays closed until activated.
- `/checkout/return`: request a sign-in link after returning from Checkout. This page never grants access or assumes payment succeeded from its URL.
- `/billing`: signed-in billing management through Stripe's customer portal. Existing members without connected Stripe billing are directed to support, not another purchase.

All three routes and purchase links are excluded from the native iPhone/Android interface. Signed-in checkout uses the account's existing email. Same-tab checkout retries reuse a request ID; the database reservation prevents simultaneous independent sessions for the same email/community.

## Implementation and activation checklist

### Separate testing from live billing

- Use a Stripe sandbox with a local or staging Supabase database. Sandbox transactions must never change real members' production access.
- Set `STRIPE_CHECKOUT_ENABLED=false` until the matching mode, endpoint, product mapping, and tests are verified. Set `STRIPE_MODE=test` for sandbox or `live` for production; the API key and Stripe Price must match that mode.
- Stripe sandbox and live resources are separate. Live activation needs the live API key, live Price IDs, live portal configuration ID, and the live destination's signing secret together. [Stripe test and live environments](https://docs.stripe.com/keys)
- Leave existing GHL billing in place until each existing subscription is identified and a cutover is approved. Importing course/community data does not migrate billing agreements.

### Server credentials

`STRIPE_SECRET_KEY` accepts a server API key; a restricted key is preferred. It is not a public browser key. Set these restricted-key permissions, then verify them in sandbox request logs before live activation:

| Resource | Permission |
| --- | --- |
| Checkout Sessions | Write |
| Billing Portal Sessions | Write |
| Customers | Read |
| Prices | Read |
| Subscriptions | Read |
| Charges | Read |
| Payment Intents | Read |
| Invoices | Read |

Keep other permissions at None unless the sandbox request log identifies an additional required permission. The server reads refund results; it does not issue refunds or payouts. Dashboard permission labels can vary by Stripe account.

`STRIPE_WEBHOOK_SECRET` is the `whsec_` value belonging to the exact event destination. It is different from the API key and from any Stripe CLI listener secret. Both values belong only in Supabase Edge Function secrets, with no `VITE_` prefix. [API and webhook secrets](https://docs.stripe.com/keys)

For local setup, copy `docs/stripe.env.example` to the repository root as `.env.stripe.local`, fill it locally, and use it only for the matching server environment. `.env.stripe.local` is ignored by Git; the example must keep placeholders.

### Webhook destination

After deploying the matching backend to the test environment:

1. Open **Stripe Workbench → Webhooks → Create an event destination**.
2. Choose **Your account**, the snapshot event format, and API version **2026-08-26.dahlia** (the default of the pinned Stripe SDK 22.6.2).
3. Select the event list below, choose **Webhook endpoint**, and enter:

   ```text
   https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/stripe-webhook
   ```

4. Save, reveal the destination's signing secret, and save it as `STRIPE_WEBHOOK_SECRET` in that same Supabase environment.

Use the project selected for testing; do not point sandbox events at the production database. Stripe signs each delivery, and the function verifies that signature. [Official destination setup](https://docs.stripe.com/webhooks)

Select these events:

```text
checkout.session.completed
checkout.session.async_payment_succeeded
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.paid
invoice.payment_failed
charge.refunded
```

If the Stripe SDK is upgraded, re-check the destination version against the handler before activation.

Full refunds of one-time purchases revoke the related Stripe access. Refunding an invoice payment does not cancel the underlying subscription or its future renewal; subscription cancellation is a separate billing action. Manual/imported grants remain independent.

### Customer billing portal

Set `STRIPE_PORTAL_CONFIGURATION_ID` in Supabase Edge Function secrets to the dedicated portal configuration for the same Stripe account and mode. For the held live setup, use `bpc_1UL6a1RfnCxS2laIDBqD3Sxt`; create a separate configuration for the sandbox. The backend requires a valid `bpc_` ID and passes it explicitly to Stripe, so it never silently falls back to the account's default/GHL portal settings.

Enable payment-method updates, invoice viewing, and cancellation at the end of the billing period. Keep product switching and shared portal login links disabled. The app creates the portal session for the signed-in member. [Stripe portal setup](https://docs.stripe.com/customer-management/activate-no-code-customer-portal)

### Acceptance checks before live activation

- A new web purchase receives access only after verified payment.
- A cancelled Checkout does not grant access or create a second charge.
- Reaching or refreshing the return page never grants access; subsequent sign-in checks actual membership after the webhook.
- Duplicate/retried deliveries do not duplicate access or subscriptions.
- Renewal, failed payment, cancellation, and full refund produce the intended access state.
- Existing imported/manual access remains available when a separate Stripe grant ends.
- Members can use paid access on web, iPhone, and Android; native checkout links remain disabled.
- Stripe portal actions and the app's displayed plan agree.

After these checks pass, activate the mapped billing plan and set `STRIPE_CHECKOUT_ENABLED=true` in that environment. Keep each app plan's amount, currency, billing interval, and Stripe Price ID consistent. The supported intervals are monthly, yearly, and one-time. Turning checkout off later prevents new purchases while retaining billing-portal access for existing customers.

Website releases follow the existing **GitHub → automatic build** path. Supabase functions, database migrations, and server secrets need their own backend release; a website push alone does not activate them.
