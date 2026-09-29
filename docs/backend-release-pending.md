# Backend release: deployed; activation pending

> Later activation update: see [activation-status-2026-09-29.md](activation-status-2026-09-29.md). Course sync, whole-Academy membership checkout and measuring-tool checkout are now active; earlier disabled-state observations below are historical.

Verified September 29, 2026. Production project: `ipbtldajgsoxixqmajec`.

## Applied database migrations

The installed Supabase connector applied and subsequently listed these migrations. Its live timestamps differ from the source filenames; match by migration name before any future replay.

| Migration name | Live version |
| --- | --- |
| `reserve_public_checkout` | `20260929200345` |
| `academy_course_sync` | `20260929200353` |
| `community_email_parity` | `20260929200355` |
| `academy_course_visibility` | `20260929200358` |
| `academy_pricing_gates` | `20260929200400` |

Before and after: 63 Academy members, 111 access grants; the complete access-grant row hash matched exactly. Steve retains community/course access; a regular member retains community access and 109 published lessons. The manager sees all 128 lessons. Five old pending emails were cancelled by the cutover migration without sending them.

## Deployed Edge Functions

All seven deployed successfully through the installed Supabase connector, using the current repository source and relative dependencies.

| Function | Live version | Gateway JWT verification |
| --- | --- | --- |
| `public-billing-plans` | 1 | Off; read-only disabled catalog |
| `create-checkout` | 5 | Off; handler checks web origin and checkout eligibility |
| `create-billing-portal` | 5 | On |
| `stripe-webhook` | 5 | Off; handler verifies Stripe signature |
| `map-geocode` | 4 | On |
| `academy-notifications` | 4 | Off; handler checks dispatcher secret / unsubscribe token |
| `academy-course-sync` | 1 | Off; handler checks scheduler secret |

Unrelated SearchIQ functions/migrations were preserved. No further function deployment is needed for this source revision.

## Preserve the inactive rollout

- `STRIPE_CHECKOUT_ENABLED=false`: live catalog responds `enabled:false`; checkout returns HTTP 503, "Enrollment is not open yet".
- `academy_communities.pricing_gates_enabled=false`: verified; no active billing plans. Preserve all existing member grants.
- `ACADEMY_EMAIL_DELIVERY_ENABLED=false`: live dispatcher responds `enabled:false,sent:0`; `private.academy_email_cutover.enabled=false` verified.
- `GHL_COURSE_SYNC_ENABLED=false`: preserve until source/baseline validation is complete. No enabled database sync configs exist; unauthenticated invocation returns HTTP 401. The environment flag value itself was not read.
- Billing portal and geocoder reject missing authentication with HTTP 401. Webhook returns HTTP 503, "Webhook is not configured"; payment fulfillment is not ready.

## Remaining configuration names

Values belong in the matching production or isolated sandbox environment's Edge Function secrets. Do not copy live credentials into a sandbox or place secrets in this document.

| Purpose | Names |
| --- | --- |
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_MODE`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PORTAL_CONFIGURATION_ID`, `STRIPE_CHECKOUT_ENABLED` |
| Web origin | `APP_URL`, `APP_ALLOWED_ORIGINS` |
| Email | `ACADEMY_EMAIL_DELIVERY_ENABLED`, `NOTIFICATION_DISPATCH_SECRET`, `NOTIFICATION_SIGNING_SECRET`, `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_FROM_EMAIL`, `MAILGUN_FROM_NAME`, `MAILGUN_REGION` |
| Course sync | `GHL_COURSE_SYNC_ENABLED`, `GHL_COURSE_SYNC_SECRET`, `GHL_PRIVATE_INTEGRATION_TOKEN`, `GHL_LOCATION_ID` |

Supabase supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`; preserve them. The previously shared live Stripe key needs replacement before activation. Sandbox payment/access/cancellation tests, exact course mappings, webhook configuration, and email delivery QA remain pending.

## Access evidence

The local CLI's read-only `whoami` identified **tothemaxbase@gmail.com**, username `tothemax-media`, user ID `703f8961-f6f9-4ec4-85a6-b4653cf4d65d`. Both CLI secrets update and CLI function deployment returned HTTP 403 / "Your account does not have the necessary privileges to access this endpoint." No CLI retry with alternate credentials was attempted.

The user then explicitly directed use of the installed Supabase connector. That connector successfully deployed all seven functions. Its available tools do not include a secrets setter. Remaining secrets must be configured through an authorized Dashboard session or a supported secrets-management connection. The CLI account above only needs its access corrected if CLI-based management is desired; the connector is already proven for database and function releases. [Supabase access control](https://supabase.com/docs/guides/platform/access-control)
