# Dirty Turf Academy

Mobile-first operator academy, community, property measurement, and quoting tools for turf cleaning companies.

## Current state

The interface is fully usable in device-preview mode with browser persistence. The repository also contains the backend contract needed to switch to authenticated company workspaces:

- Supabase Auth and organization onboarding
- Multi-tenant Postgres schema with row-level security
- Private `job-photos` storage bucket
- Property, visit, measurement, estimate, course-progress, and community records
- Community categories, posts, replies, likes, bookmarks, follows, moderation reports, pins, and realtime subscriptions
- Course/module/lesson publishing, completion, level locks, resources, and HighLevel external IDs
- Live events, RSVPs, reminders, member profiles, leaderboard points, notifications, applications, roles, plans, subscriptions, and referrals
- Native live-measure bridge contract for ARKit and ARCore
- Keyless Leaflet property tracing with Esri current imagery, Esri Wayback releases, USGS NAIP captures, and OpenStreetMap address search
- HighLevel webhook ingestion with Ed25519 signature verification and deduplication
- Embedded live HighLevel Academy/community with a direct-open fallback
- Migration ledger and shared Academy tenancy kept separate from each operator company's field data
- Netlify build, SPA routing, cache, and browser-permission headers

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

## Backend setup

Install the Supabase CLI, create a project, then link and deploy:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
supabase functions deploy health --no-verify-jwt
supabase functions deploy ghl-webhook --no-verify-jwt
supabase functions deploy ghl-status
supabase functions deploy create-checkout
supabase functions deploy stripe-webhook --no-verify-jwt
```

Set server-only secrets in Supabase. Never put these in `VITE_` variables:

```bash
supabase secrets set \
  GHL_PRIVATE_INTEGRATION_TOKEN=... \
  GHL_LOCATION_ID=... \
  APP_URL=https://YOUR_APP_DOMAIN \
  STRIPE_SECRET_KEY=... \
  STRIPE_WEBHOOK_SECRET=...
```

Copy the project URL and publishable key into `.env.local`, restart Vite, and use `requestMagicLink()` from `src/lib/backend.ts` for the first owner login. The auth trigger creates the profile, organization, and owner membership after the migrations are applied.

## Map measurement

Map tracing works without a Google Cloud account. Operators can search an address, center on their location, tap multiple turf boundaries, and calculate a combined square-foot total. The imagery selector includes current Esri tiles, Esri Wayback releases, USGS/USDA NAIP captures, and an OpenStreetMap street view.

The browser uses public imagery and geocoding endpoints. Before production scale, confirm each provider's attribution and usage requirements and move address search behind a client-owned geocoder or server proxy if required by the selected provider.

## Live camera measurement

Steve's point-to-point camera workflow needs real world-space raycasts, not a photograph. `src/lib/liveMeasurement.ts` defines the bridge used by the web interface, but accurate measurement must run inside client-owned iOS and Android builds:

- iOS: ARKit raycasts and anchors in a native Swift/RealityKit view
- Android: ARCore hit tests with plane and DepthPoint support when available
- Shared result: closed 3D boundary, square feet, perimeter, point list, and capture timestamp

The browser preview deliberately does not estimate distance from ordinary camera pixels. Visit photos remain a separate property-history action.

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

`ghl-status` is an authenticated, owner/admin-only Edge Function that verifies the configured location and reports available pipeline, workflow, and product metadata. Current HighLevel API documentation exposes course import through `courses.write`, but no read/export endpoint for an existing course catalog. Existing Academy lessons therefore need a client-approved export/content handoff or links back to the managed HighLevel course experience; do not claim that the private integration token can automatically pull those lessons.

The member app launches the existing branded portal at `https://academy.dirtyturf.com` using verified post-login destinations. HighLevel does not render reliably in a cross-origin iframe, so the production integration uses explicit deep links instead of a blank embedded frame:

- Courses: `courses/library-v2`
- Community: `communities`
- Events: `communities` (then the group's Events tab)

When a trusted launch supplies `sessionKey`, the app keeps it in memory only, removes it from the browser address bar, and passes it only to the academy origin. Without a session key, the same links open the normal Dirty Turf Academy login before continuing to the requested destination. Never log, persist, or include a session key in analytics.

HighLevel remains the live source for courses and community at launch. The native tables are the future migration target, not a parallel production feed. See `docs/highlevel-live-and-native-migration.md` for the capability matrix, complete capture inventory, provenance contract, and cutover gates.

## Key files

- `supabase/migrations/202609170001_initial_schema.sql`: schema, RLS, views, RPCs, and storage policies
- `supabase/migrations/202609170002_community_academy_platform.sql`: member community, Academy, events, notifications, moderation, access, and billing-ready schema
- `supabase/functions/ghl-webhook/index.ts`: signed HighLevel webhook receiver
- `supabase/functions/ghl-status/index.ts`: private integration and resource status check
- `supabase/functions/_shared/ghl.ts`: server-only HighLevel API client
- `supabase/functions/create-checkout/index.ts`: authenticated Stripe Checkout session creation for client-owned plans
- `supabase/functions/stripe-webhook/index.ts`: signed, idempotent membership subscription updates
- `src/lib/backend.ts`: cloud/device data adapter, auth, and photo upload
- `src/components/MapMeasurement.tsx`: interactive property tracing and imagery-source controls
- `src/components/GhlPortal.tsx`: branded live HighLevel launch surface for courses, community, and events
- `supabase/migrations/20260917165624_separate_academy_tenancy_and_import_ledger.sql`: shared Academy membership, import provenance, and future native cutover model
- `docs/highlevel-live-and-native-migration.md`: live integration and complete future extraction plan
- `src/lib/mapMeasurement.ts`: spherical area math and public imagery adapters
- `src/lib/liveMeasurement.ts`: native AR measurement bridge contract
- `src/lib/quote.ts`: deterministic quote calculator
- `.env.example`: public and private configuration contract

## Member experience

The local preview is intentionally complete enough to review without server credentials. Academy, Community, and Events launch the live HighLevel portal. Field tools and labeled device-demo history remain available until the Supabase schema is applied and a member signs in.

Device persistence is not production synchronization. After the client-owned Supabase project is migrated, promote field actions to the supplied tables and RPCs. Keep HighLevel live for Academy/community while building and validating the client-owned migration archive described in `docs/highlevel-live-and-native-migration.md`.
