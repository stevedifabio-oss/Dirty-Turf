# Measurement App Recovery Audit

## Authoritative source

The latest source supplied by the client is the TurfClean v11 static PWA bundle:

- `app.js`
- `index.html`
- `manifest.webmanifest`
- `readme.md`
- `service-worker.js`
- `styles.css`

This bundle is the reference for measurement behavior. Older Netlify Drop projects are not part of the implementation source of truth.

## Account findings

- The GitHub `Dirty-Turf` repository was empty when inspected. It did not contain the TurfClean files or any backend history.
- The Netlify account contained multiple private Netlify Drop projects. Drop deployments are uploaded snapshots, not Git-backed source history.
- The latest inspected deploy contained eight static files and no Netlify Functions.
- The connected Supabase project was new: no application tables, migrations, users, storage buckets, or Edge Functions had been deployed.

## Backend and credential findings

The TurfClean v11 source has no backend and no recoverable production credentials.

- Jobs and drafts are stored in browser `localStorage` under `turfclean.jobs` and `turfclean.draft`.
- Photos use temporary browser object URLs and are not uploaded or preserved after the browser session.
- Address search uses the public OpenStreetMap Nominatim endpoint.
- Current and historical imagery use public Esri endpoints.
- NAIP imagery uses the public USGS National Map ArcGIS ImageServer.
- The current source contains no Supabase, Firebase, Netlify Function, or custom API calls.
- The source history says an earlier v5 accepted a Google Maps key in browser storage. Google controls were removed in v9, so the latest source cannot recover a Google Cloud project or API key.

Do not copy secret values into this repository. Browser configuration belongs in `.env.local`; service-role, HighLevel, and Stripe secrets belong only in protected provider secret stores.

## Recovered behavior

The useful behavior was ported into the branded React app rather than embedding the old PWA:

- Address and device-location centering
- Tap-to-place property boundary points
- Multiple separate turf areas with a combined square-foot total
- Spherical polygon area calculation
- Current Esri imagery
- Esri Wayback release selection
- Latest and dated USGS/USDA NAIP imagery
- Street-map fallback
- Live quote and infill recalculation

## Defects not carried forward

The static v11 snapshot includes several incomplete references:

- `saveDraft()` is called but not defined; the implemented function is `persistDraft()`.
- `leafletWaybackTemplate()` is called but not defined; a separate `wbUrl()` helper exists.
- Compare overlays read `area.latlngs`, while saved map areas use `area.points`.
- The selected imagery record is not included in `jobData()`, so it is not actually preserved with saved jobs.
- Camera photos are displayed from temporary object URLs but are not persisted.

The React implementation uses typed helpers and tests instead of carrying those paths forward.

## Cloud activation path

1. Connect this repository to the client-owned GitHub repository.
2. Apply both committed Supabase migrations to the client project.
3. Deploy the committed Supabase Edge Functions.
4. Add the Supabase project URL and public browser key to the frontend environment.
5. Add server-only HighLevel and optional Stripe values to Supabase secrets.
6. Connect Netlify to GitHub and deploy from the production branch instead of Netlify Drop.
7. Verify authentication, row-level security, photo uploads, job sync, and real HighLevel delivery with client-owned test records.
