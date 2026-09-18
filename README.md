# Dirty Turf Academy

Responsive operator academy, community, turf measurement, and infill tools for turf cleaning companies, delivered as a desktop web app, mobile web/PWA, and native iOS and Android apps.

## Current state

The same React workspace adapts to wide desktop screens, touch-first mobile browsers, and the Capacitor iOS/Android shells. It is fully usable in device-preview mode with browser persistence. The repository also contains the backend contract needed to switch to authenticated company workspaces:

- Supabase Auth and organization onboarding
- Multi-tenant Postgres schema with row-level security
- Private `job-photos` storage bucket
- Property, visit, measurement, estimate, course-progress, and community records
- Community categories, posts, replies, likes, bookmarks, follows, moderation reports, pins, and realtime subscriptions
- Course/module/lesson publishing, completion, level locks, resources, and HighLevel external IDs
- Live events, RSVPs, reminders, member profiles, leaderboard points, notifications, applications, roles, plans, subscriptions, and referrals
- Native iOS and Android shells with branded app icons and launch screens
- Desktop navigation and multi-column workspaces with mobile bottom navigation and full-width touch sheets
- Live point-to-point camera measurement implemented with ARKit and ARCore
- Keyless Leaflet property tracing with Esri current imagery, Esri Wayback releases, USGS NAIP captures, and OpenStreetMap address search
- Infill calculations from measured area and a selected lb/sq-ft rate, including rounded-up 40-lb and 50-lb bag counts
- HighLevel webhook ingestion with Ed25519 signature verification and deduplication
- Native Academy, community, and events backed by a provenance-preserving HighLevel migration
- Migration ledger and shared Academy tenancy kept separate from each operator company's field data
- Netlify build, SPA routing, cache, and browser-permission headers
- Installable PWA manifest and production-only offline app shell
- Public privacy, support, and account-deletion pages plus an authenticated,
  RLS-isolated deletion-request workflow

## Local development

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Client account boundary

This project is for a client. Do not reuse personal Supabase, Google Cloud,
HighLevel, Netlify, GitHub, billing, browser-session, or CLI credentials.
Create client-owned accounts and projects with client-controlled recovery,
billing, and administrator access before connecting production services.

Keep setup credentials out of shell history. Enter production secrets only in
the destination provider's protected environment-variable or secrets UI, and
rotate any credential that is accidentally exposed locally.

The app stays in device-preview mode when Supabase variables are absent or the user is signed out.

Run the complete local check:

```bash
npm run check
```

This also validates store character limits, bundle/package identity, native
camera and location declarations, legal URLs, and the App Store icon against
`store/metadata.json`.

Build, copy, and verify the same web entry document in both native projects:

```bash
npm run native:verify
```

Opening and compiling the native projects requires full Xcode on macOS and
Android Studio with JDK 21 plus the Android SDK:

```bash
npm run native:ios
npm run native:android
```

## Backend setup

Install the Supabase CLI, create a project, then link and deploy:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
supabase functions deploy health --no-verify-jwt
supabase functions deploy ghl-webhook --no-verify-jwt
supabase functions deploy ghl-status
supabase functions deploy academy-import
supabase functions deploy academy-invite-members
supabase functions deploy academy-notifications --no-verify-jwt
supabase functions deploy map-geocode
supabase functions deploy create-checkout
supabase functions deploy create-billing-portal
supabase functions deploy stripe-webhook --no-verify-jwt
```

Set server-only secrets in Supabase. Never put these in `VITE_` variables:

```bash
supabase secrets set \
  GHL_PRIVATE_INTEGRATION_TOKEN=... \
  GHL_LOCATION_ID=... \
  APP_URL=https://app.dirtyturf.com \
  APP_ALLOWED_ORIGINS=https://app.dirtyturf.com,https://bright-brigadeiros-df8b48.netlify.app \
  AUTH_REDIRECT_URLS=https://bright-brigadeiros-df8b48.netlify.app,com.dirtyturf.academy://auth/callback \
  STRIPE_SECRET_KEY=... \
  STRIPE_WEBHOOK_SECRET=... \
  MAILGUN_API_KEY=... \
  MAILGUN_DOMAIN=... \
  MAILGUN_FROM_EMAIL=... \
  MAILGUN_FROM_NAME='Dirty Turf Academy' \
  MAILGUN_REGION=us \
  NOTIFICATION_DISPATCH_SECRET=... \
  NOTIFICATION_SIGNING_SECRET=...
```

Copy the project URL, publishable key, and public Stripe Payment Link into
`.env.local`, restart Vite, and use `requestMagicLink()` from
`src/lib/backend.ts` for the first owner login. The auth trigger creates the
profile, organization, and owner membership after the migrations are applied.

```bash
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLIC_PUBLISHABLE_KEY
VITE_STRIPE_ACADEMY_PAYMENT_LINK=https://buy.stripe.com/YOUR_PAYMENT_LINK
```

The permanent web origin is `https://app.dirtyturf.com`. In **Supabase >
Authentication > URL Configuration**, allow that origin, the Netlify pilot
origin, localhost, and `com.dirtyturf.academy://auth/callback`. The custom
domain now resolves through Cloudflare to Netlify with valid TLS. The Supabase
Auth Site URL and Edge Function `APP_URL` are both set to
`https://app.dirtyturf.com`, and Auth custom SMTP is configured with the
client-owned Mailgun sender. Web links return to the production origin; iOS and
Android links return directly to the installed app through the registered
custom URL scheme. The app handles PKCE redirects from cold start and while it
is already open.

Community email uses the same verified Mailgun domain through the
`academy-notifications` Edge Function. It is separate from Supabase Auth SMTP:
the Mailgun API values and notification signing/dispatch secrets must be added
to Edge Function secrets before community email can be dispatched.
Auth SMTP sends Magic Links, while the Edge Function sends welcome, comment,
reply, mention, like, post, announcement, course, event, reminder, and weekly
digest messages. Delivery is backed by a retry-safe database outbox. The
function rejects requests without `NOTIFICATION_DISPATCH_SECRET`, signs every
unsubscribe link with `NOTIFICATION_SIGNING_SECRET`, and does not claim queued
mail when Mailgun configuration is incomplete.

After secrets are set, schedule the dispatcher with Supabase Cron and Vault as
documented in `docs/release-runbook.md`. Keep the schedule disabled until a
single test recipient has passed sender, deep-link, preference, and unsubscribe
verification. Historical HighLevel imports do not create notification mail.

`academy-import` and `academy-invite-members` accept browser and native
requests only from `APP_URL`, `APP_ALLOWED_ORIGINS`, or the fixed Capacitor
origins. Invitation redirects must exactly match `APP_URL`,
`AUTH_REDIRECT_URLS`, or the Dirty Turf native callback. Invite responses never
return member email addresses.

## Web payments and Academy entitlements

Payments use a client-owned Stripe account and Stripe-hosted pages. The app
never receives card data. The signed-out website can open a validated
`buy.stripe.com` Payment Link for new members, and authenticated web members can
open Checkout and the Billing Portal. The iOS and Android builds hide every
purchase button and external purchase link at runtime; they are consumption-only
clients that let members sign in to content acquired on the web.

The Academy billing migration separates identity from access. Imported
HighLevel members receive durable import grants. Stripe subscriptions and
one-time purchases receive separate grants, so a failed or cancelled Stripe
subscription cannot remove a legacy member's imported access. The signed
Stripe webhook silently provisions a confirmed Supabase account for a new
buyer, links or creates the Academy member, applies the matching plan, and
leaves the member ready to request a Magic Link.

Before enabling sales:

1. Create the client-owned Stripe product and recurring or one-time Price.
2. Insert an inactive academy_billing_plans row with that Price ID, attach
   course rows in academy_billing_plan_courses, then activate the plan.
3. Register the Supabase stripe-webhook function for checkout completion and
   subscription created, updated, and deleted events.
4. Configure the Stripe Customer Portal and make a web Payment Link for public
   acquisition. Set its after-payment redirect to
   `https://app.dirtyturf.com/?checkout=success`, then expose that public URL as
   `VITE_STRIPE_ACADEMY_PAYMENT_LINK` in the Netlify web build. Its Price ID is
   the trusted plan mapping; no amount is accepted from the browser.
5. Complete one Stripe test-mode purchase, request the buyer's Magic Link, and
   verify course access, cancellation, webhook replay, and Billing Portal
   return before live mode.

## Map measurement

Map tracing works without a Google Cloud account. Operators can search an address, center on their location, tap multiple turf boundaries, and calculate a combined square-foot total. The imagery selector includes current Esri tiles, Esri Wayback releases, USGS/USDA NAIP captures, and an OpenStreetMap street view.

Address search runs through the authenticated `map-geocode` Edge Function. It identifies the application to Nominatim, enforces one upstream request per second across the app, caches results per member for 30 days, and returns only normalized addresses and coordinates. The native shells append the Dirty Turf application identity to their WebView user agent, and map attribution remains visible. Google Geocoding is intentionally not used: Google currently prohibits displaying its geocoding results with this non-Google Esri/NAIP map stack.

## Live camera measurement

Steve's point-to-point camera workflow needs real world-space raycasts, not a photograph. The browser displays the workflow and accepts a manual fallback, while accurate measurement runs inside the client-owned iOS and Android builds:

- iOS: `DirtyTurfMeasurePlugin.swift` uses ARKit raycasts, visible points, boundary lines, undo, cancel, and finish controls
- Android: `LiveMeasureActivity.kt` uses ARCore hit tests with plane, depth, and feature-point support plus the same controls
- Shared result: closed 3D boundary, square feet, perimeter, point list, and capture timestamp

The browser preview deliberately does not estimate distance from ordinary camera pixels. Visit photos remain a separate property-history action.

The current native source compiles as an Android debug APK, a signed release
AAB, and an iOS Release simulator app. Android release `1 (1.0)` is Active on
the Play Internal testing track. It still must be calibrated on real supported
iPhone and Android devices; compilation and a web preview cannot prove ARKit or
ARCore accuracy.

## Infill calculator

The calculator is deliberately limited to the field decision the operator
needs. It has no property-name requirement, cleaning-plan selector, material
price, bag-coverage input, or minimum charge.

```text
area = length x width (or camera/map measured area)
total pounds = ceil(area x selected lb/sq ft)
40-lb bags = ceil(total pounds / 40)
50-lb bags = ceil(total pounds / 50)
customer price = unrounded area x service rate per sq ft
```

The available infill rates are 0.25, 0.50, 0.75, 1.00, 1.50, 2.00,
2.50, and 3.00 lb/sq ft. The `create_infill_calculation` RPC repeats the
calculation server-side so saved records do not trust client-computed totals.

## HighLevel

Use a scoped private integration for the first internal release. Keep the token server-side. Configure the HighLevel webhook URL as:

```text
https://YOUR_PROJECT.supabase.co/functions/v1/ghl-webhook
```

The webhook function verifies the current `X-GHL-Signature` Ed25519 signature, deduplicates by `webhookId`, and stores the original payload in `integration_events`. Do not mark the integration complete until a real contact, workflow entry, and notification are verified in the intended HighLevel location.

Validate the server credentials without printing the token:

```bash
npm run ghl:verify
```

`ghl-status` is an authenticated, owner/admin-only Edge Function that verifies the configured location and reports available pipeline, workflow, and product metadata. Current HighLevel API documentation exposes course import but no supported course catalog export/read endpoint, so the one-time content archive is captured through the client-owned admin session and imported through the server-side migration function.

The current private capture has been reconciled to the client HighLevel location and composes into a valid dry-run manifest containing 60 current members with email, 49 enrollments, 128 lessons (109 published and 19 draft), 142 asset rows, 62 posts, 59 comments, and 5 events. Every published lesson has importable content. One former commenter is retained as a non-login historical author. Aggregate course completion is preserved on enrollments; no lesson completions, reaction identities, or RSVP identities are fabricated when HighLevel exposes only totals.

Private exports remain under ignored `output/private/`. Build and verify the package without printing credentials or member data:

```bash
npm run academy:reconcile
npm run academy:compose
npm run academy:validate -- output/private/dirty-turf-academy-import.json
npm run academy:access-audit
```

The access audit currently proves that all 60 current members have unique,
valid login emails and that all 49 source course enrollments map to those
members. Every committed import also upserts source-aware community and course
grants, so a first import after the billing migration and any later delta import
produce the same durable access state. After the production import, an Academy owner runs
`academy-invite-members` with
`action: "preview"`, then `action: "provision"` until
`summary.allEligibleReady` is true. Provisioning creates confirmed,
passwordless Supabase users and links their imported Academy identities without
sending email. The public magic-link form always sets `shouldCreateUser: false`,
so an unknown email cannot create an account.

Only after client SMTP, redirect URLs, and a representative login have been
verified should the owner run `action: "notify"`. Notification sends a magic
link to an already-provisioned account in batches of at most 25; it is not the
account-creation step. On first authenticated load, the app also claims any
matching active imported membership by the verified auth email.

HighLevel remains available during reconciliation and rollback. Native cutover happens only after a client-owned Supabase organization ID is added, the server dry run and count comparison pass, member invitations are previewed, and representative accounts are tested. See `docs/highlevel-live-and-native-migration.md` for the controlled sequence.

The custom-domain activation sequence and current DNS handoff are documented
in `docs/production-domain-cutover.md`.

## Key files

- `supabase/migrations/202609170001_initial_schema.sql`: schema, RLS, views, RPCs, and storage policies
- `supabase/migrations/202609170002_community_academy_platform.sql`: member community, Academy, events, notifications, moderation, access, and billing-ready schema
- `supabase/migrations/20260917203000_infill_calculator.sql`: infill fields, server-side calculation RPC, and updated job-card projection
- `supabase/migrations/20260918010000_preserve_imported_course_progress.sql`: non-fabricated aggregate course-progress preservation
- `supabase/migrations/20260918023000_lock_public_schema_creation.sql`: prevents API users from shadowing trusted database objects
- `supabase/migrations/20260918080238_academy_billing_entitlements.sql`: imported and Stripe access grants, billing records, RLS, and transactional webhook application
- `supabase/migrations/20260918150000_account_deletion_requests.sql`: RLS-isolated member deletion requests
- `supabase/migrations/20260918154500_academy_notification_delivery.sql`: notification triggers, member preferences, signed-email outbox, replies, mentions, and scheduled reminder queue
- `supabase/migrations/20260918161500_optimize_notification_paths.sql`: notification outbox and mention lookup indexes for launch traffic
- `supabase/functions/ghl-webhook/index.ts`: signed HighLevel webhook receiver
- `supabase/functions/ghl-status/index.ts`: private integration and resource status check
- `supabase/functions/_shared/ghl.ts`: server-only HighLevel API client
- `supabase/functions/create-checkout/index.ts`: authenticated Stripe Checkout session creation for client-owned plans
- `supabase/functions/create-billing-portal/index.ts`: authenticated web-only Stripe customer portal sessions
- `supabase/functions/stripe-webhook/index.ts`: Stripe-SDK signature verification, retry-safe event storage, silent buyer provisioning, and entitlement updates
- `supabase/functions/academy-notifications/index.ts`: authenticated Mailgun dispatcher, retries, branded templates, direct links, and signed unsubscribe handling
- `supabase/functions/map-geocode/index.ts`: authenticated address search with per-member caching, attribution, identification, and upstream rate protection
- `src/lib/backend.ts`: cloud/device data adapter, auth, and photo upload
- `src/lib/authRedirect.ts`: validated iOS/Android PKCE callback handling
- `src/components/MapMeasurement.tsx`: interactive property tracing and imagery-source controls
- `src/components/Academy.tsx`, `Community.tsx`, and `Events.tsx`: native member experience
- `supabase/migrations/20260917165624_separate_academy_tenancy_and_import_ledger.sql`: shared Academy membership, import provenance, and future native cutover model
- `scripts/reconcile-ghl-community.mjs`: credential-safe contact reconciliation with aggregate-only terminal output
- `scripts/compose-academy-import.mjs`: deterministic private course/community manifest composition
- `docs/highlevel-live-and-native-migration.md`: live integration and complete future extraction plan
- `src/lib/mapMeasurement.ts`: spherical area math and public imagery adapters
- `src/lib/liveMeasurement.ts`: native AR measurement bridge
- `src/lib/quote.ts`: deterministic infill and service-price calculator
- `ios/App/CapApp-SPM/Sources/CapApp-SPM/DirtyTurfMeasurePlugin.swift`: iOS ARKit measurement view
- `android/app/src/main/java/com/dirtyturf/academy/LiveMeasureActivity.kt`: Android ARCore measurement view
- `index.html`: branded offline-safe startup shell used by web, iOS, and Android
- `output/pdf/dirty-turf-functional-app-checklist.pdf`: account, backend, device, QA, and store-release checklist
- `docs/store-submission.md`: prepared store copy, privacy answers, reviewer notes, and record values
- `docs/release-runbook.md`: release order, golden path, evidence record, monitoring, and rollback
- `.env.example`: public and private configuration contract

## Member experience

The local preview is intentionally complete enough to review without server credentials. When no Supabase URL/key is configured, Academy, Community, Events, and field tools use labeled device-preview data. Once Supabase is configured, production never falls back to seed content: signed-out users see Magic Link login and authenticated users without an active grant see an access-status screen.

Device persistence is not production synchronization. Keep HighLevel available as the rollback source until the private archive is dry-run, imported, visually reconciled, and approved under the cutover gates in `docs/highlevel-live-and-native-migration.md`.
