# October 22 offers preparation

Backend follow-up completed 22 October: the new live $10 measuring Price and separate plan are active for new purchases; the old plan is closed to new sales while its original Price/mapping remains intact. Service payment functions, dedicated webhook and sales flags are active. Frontend publication/native builds remain separate. See [the release receipt](backend-release-20261022.md).

## Member offers

- Preserve existing members’ imported/free access and current subscriptions.
- New membership: **$39.99/month**, including Community and the whole current Turf Cleaning Academy.
- New measuring purchases: **$10/month**. Existing $29.95 subscriptions keep their existing price and plan identity. Do not edit their subscriptions or grants.
- Additional courses remain separate paid upgrades. The prior approved price is **$149.95 once per course**; do not sell an empty/unmapped course or guess its content. Map and review each course first.

## Services and shop

- Website setup: **$1,495–$2,495 once**; optional website care **$97/month**.
- GHL setup: **$1,495–$2,495 once**; ongoing GHL subscription **$197/month**.
- Combined SEO/AEO: **$1,495–$2,495 once**.
- Facebook ads management: **$495–$895/month**. Advertising spend has not been specified as included.
- Service ranges are inquiry/quote offers, not invented fixed checkout prices.
- “Products” means the course, app and service offers above; no physical-goods store is requested. Build the Stripe-backed offers/cart inside the web app. An external store URL is not required. Keep service purchases separate from membership/course fulfillment and do not attach app identity tokens to external links.

## Safe measuring price cutover

1. Reconnect Stripe and review the correct live account. Create a **new**, fixed USD 10/month Price; retain the old Price, Product and plan mapping. Save its reviewed Price response as private JSON under `output/private/`.
2. Prepare inactive SQL using the existing reviewed community/plan/price:

   ```sh
   node scripts/prepare-measuring-price-change.mjs \
     --community fac17da0-bdb9-48c0-9c67-591d087e9912 \
     --old-plan f2aca619-3ac5-4701-8204-b0d3eff4c507 \
     --old-price price_1UL6ZpRfnCxS2laIoklVoP83 \
     --stripe-price-json output/private/measuring-price-10-reviewed.json \
     --mode live \
     --output output/private/measuring-price-10-inactive.sql
   ```

3. Review the generated transaction before any application. It creates one new stable plan version, inactive by default, with exactly the measuring feature and no course/community access. It checks that the prior plan is still USD 29.95/month with the expected identity and feature mapping. Exact reruns preserve state; any mismatch holds instead of overwriting.
4. After approval and payment/webhook verification in the appropriate Stripe mode, generate a separate reviewed file with `--activate-new-sales`. That transaction enables the new plan for future checkouts and disables the old plan for new sales. It never migrates existing subscriptions or rewrites their fulfillment mapping.
5. Verify a new checkout’s $10 line item, single feature fulfillment, duplicate-purchase prevention and old-price renewal behavior. Keep digital purchases within the existing approved native-app purchase boundaries; this preparation does not add a native checkout or release a new store build.

The script only reads a local reviewed Price JSON and writes private SQL. It makes no network calls and cannot apply SQL, create Stripe resources, charge a card or publish the app.
