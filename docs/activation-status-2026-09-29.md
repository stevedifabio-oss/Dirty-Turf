# Integration activation — September 29, 2026

## Automatic course updates: live

GoHighLevel course sync is active every five minutes. The initial production run at 20:29 UTC applied 1 course, 36 modules and 128 lessons. The actual scheduled run at 20:30 UTC completed HTTP 200 with unchanged content. Existing member access, progress and lesson UUIDs were preserved. Web, iPhone and Android read the same database; no new mobile binary is required for these server changes.

This is course-content synchronization. Community post/comment mirroring remains separate; do not claim full community mirroring.

## Stripe: membership and measuring tool activated

- Live checkout configuration is stored in encrypted Supabase Vault with a service-role-only, exact-name allowlisted RPC. Anonymous and signed-in member roles cannot read it. Environment values take priority.
- Live webhook `we_1UL7ZHRfnCxS2laIgxj3aGuU` targets the production `stripe-webhook` function, uses API version `2026-08-26.dahlia`, and subscribes to the eight documented billing events.
- Checkout, catalog, portal and webhook functions deployed with the Vault fallback. The webhook rejects invalid signatures with HTTP 400.
- Community + the entire current Turf Cleaning Academy is active at **USD $39.99/month**, as explicitly selected by the owner. Measuring Tool product and plan are active at **USD $29.95/month**. Live public catalog confirms the correct amount/price. Community pricing gates are enabled, preserving existing Academy/community grants; ordinary members need the measuring-tool entitlement, while managers/reviewers retain their explicit bypass.
- A restricted-key live Checkout session was created without customer/payment information, and its branded hosted payment page loaded with card, Apple Pay and Google Pay options. No payment or subscription was completed; this proves session creation and hosted Checkout availability, not paid fulfillment.
- Purchase, duplicate-event, cancellation and refund behavior are covered by handler/SQL checks. A real paid transaction has not been executed.

## Approved membership scope

The owner explicitly selected the whole current Academy for the $39.99/month membership. Its live plan maps to the existing published course. A live request through the actual app create-checkout endpoint returned HTTP 200 with a Stripe hosted Checkout URL for a reserved, non-deliverable QA address. No payment was made, no access granted, and no email was sent by this probe. The duplicate $149.95 turf course offer remains inactive. Tile/grout and pavers/travertine courses are absent, so their offers remain unavailable. Existing members retain their free access.

## Email delivery: active through the existing connection

Mailgun is already configured for Supabase Auth SMTP and as GoHighLevel's default sending provider for mail.dirtyturf.com. The notification worker now reuses the existing GoHighLevel connection, whose message-send scope was verified. No Mailgun login or SMTP change was needed.

The dispatcher is enabled with a five-minute schedule; DB cutover is September 29 at 20:39:07 UTC. Five historical emails remain cancelled; zero pending/sent at activation. Future app notifications use the existing branded templates and signed body unsubscribe links. GHL contact ID, location, recipient email and do-not-disturb settings are verified before sending. 60 members have existing mappings; three unmapped accounts are flagged for operator review rather than guessed or silently discarded. This route does not support the Mailgun adapter's custom one-click unsubscribe headers.

First scheduled dispatcher run at 20:40 UTC returned HTTP 200, zero claimed/sent/retrying/review-required, with no timeout. No test/bulk campaign was sent. Configuration, existing-contact verification and dispatcher behavior were checked; actual inbox receipt remains unverified.

## Verification

Full check: 307 tests in 50 files, TypeScript, schema, secret scan, store metadata, build and PWA checks passed. Course-specific PostgreSQL suites passed 29 sync and 33 visibility assertions. Pricing SQL suite passed 83 assertions. Native frontend assets are unchanged from Android 7 and Apple 12; public store review remains separate.
