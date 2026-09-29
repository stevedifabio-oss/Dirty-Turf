# Academy pricing — September 28 owner requirements

Source: the owner's supplied pricing screenshot. Amounts are recorded as USD; the existing matching Stripe prices are USD. This is a held pricing configuration, not an active catalog. The September 29 app/database implementation below is local and unshipped. Machine-readable values are in `academy-pricing.draft.json`.

| Offering | Price | Includes |
| --- | --- | --- |
| Existing members | Free | Community conversations and Turf Cleaning Academy certification |
| New members | $39.99/month | Community conversations and Turf Cleaning Academy certification |
| Full turf cleaning course | $149.95 once | Separate course upgrade, available to existing and new members |
| Tile and grout cleaning | $149.95 once | Separate course upgrade |
| Pavers and travertine cleaning | $149.95 once | One combined course upgrade |
| Measuring tool | $29.95/month extra | Separate tool subscription |
| SEO tools | $149.95/month extra | Separate tool subscription |
| Turf cleaning CRM | $189.99/month, future | Do not publish or sell until built and approved |

## Access rules and remaining setup

- Establish the reviewed existing-member roster at cutover. Do not make newly created accounts free by treating every active member as grandfathered.
- Preserve prior imported/manual course grants. The new upgrade prices do not authorize revoking courses members already own or cancelling existing payment agreements.
- Base membership grants community and certification content only. It must not accidentally unlock all paid courses or tools.
- The current imported catalog has one combined course, Turf Cleaning Academy (`a0238fea-1bfd-46de-978d-f476492edec8`, GHL `0a9ea28f-eaa0-4b4f-a1eb-4b6bc23df18b`). The owner must identify certification content versus the paid full course before the split can be mapped. Do not map both offers to the same course-wide grant.
- Existing-member upgrade checkout now checks the requested community/course/tool entitlements. Existing free members can buy an unowned upgrade; duplicate and overlapping access is rejected. Course/tool upgrades require a signed-in active member. A customer is reused only when bound to that authenticated member. Pending Stripe purchases are checked before grants arrive.
- Tool grants are now separate from community/course grants. Map/camera entry points use server-returned effective access, the geocoding endpoint checks measuring access before cache/provider calls, and database writes enforce measurement access. Manual dimension entry and historical saved calculations remain available. The SEO entitlement identifier is reserved; there is no implemented SEO product to sell yet.
- Recurring cancellation/revocation affects only that purchase's grants. Course purchases and grandfathered access remain independent. Decide whether paid upgrades require a continuing base membership; the screenshot does not settle that policy.
- Keep native checkout links disabled while the existing web payment integration is completed. Do not infer store approval from this pricing plan.

## Stripe catalog audit and setup

The supplied live key successfully listed all six active prices on September 28. Four are $39.99/month USD; their IDs, product names and nicknames are recorded in the JSON draft. Several product names are `Communities - undefined`, so amount alone is not a reliable plan mapping. The remaining two prices are $300/month with the nickname `Test`; they were left untouched.

That September 28 audit found no matching upgrade prices. On September 29, the Stripe plugin created five separate inactive app products and their live prices: membership, three courses, and the measuring tool. The JSON draft records their verified IDs. Existing LeadConnector products and subscriptions were preserved; SEO/CRM remain unavailable. The app billing portal was also configured. See `stripe-account-setup-status.md`. [Stripe price-list API](https://docs.stripe.com/api/prices/list)

## September 29 local implementation

- `20260929190352_academy_pricing_gates.sql`: feature grants, offer types, scoped eligibility, reservations, billing reconciliation, effective access and measurement enforcement. `pricing_gates_enabled` defaults false so installation does not activate the new tool paywall.
- Web upgrades group membership, course purchases and tool subscriptions; owned access cannot be bought again. Billing lists independent purchases/subscriptions. Prices and entitlements come from validated server plans.
- iOS/Android consume the same entitlement state and show neutral unavailable states, with no Stripe checkout or external purchase prompts. New native binaries must be released before activating gates; existing installed binaries do not acquire this UI from a web push.
- Access refreshes on focus, online, native resume and foreground polling. Account changes clear old data; access-check errors fail closed. Community-only data is hidden/cleared for course/tool-only accounts.
- This is access control for the official app and its server services, not DRM for public map tiles or offline algorithms inside an old or modified app binary.
- Prepare the five inactive supported offers with `node scripts/prepare-pricing-catalog.mjs --community <reviewed-uuid> --output output/private/pricing-catalog.sql`. The script only writes SQL; it does not connect to Stripe or a database. The generated transaction refuses an enabled community or existing same-slug plans, creates no course mappings, and excludes SEO/CRM. Do not activate membership without mapping the included certification, or paid courses before setting their correct access rules.

## Local verification

- The pricing SQL harness runs all 30 repository migrations in isolated PostgreSQL: 82 assertions cover independent grants, cancellations, imported access, source identity, duplicate reservations, immediate next purchase, malformed mappings, permissions, and direct/RPC measurement enforcement.
- Existing course visibility (33 assertions) and community email (43 assertions) pass with the new migration included.
- Browser previews render the actual React offer and locked-tool components using synthetic member data. They verify desktop/mobile layout, not a paid live checkout.
- `npm run check`: 271 tests across 47 files, TypeScript, secret/schema/store checks, production build and PWA checks passed. Deno checked all four changed Edge endpoints.
- Android debug APK and unsigned iOS simulator app built successfully. All 49 web output files match both built artifacts. No device installation or store upload was performed.
- Real Stripe sandbox checkout/webhook/portal tests and physical-device acceptance remain required before activation.

## Release status

All five supported draft offers are inactive with verified live Stripe IDs; course entitlement mappings remain pending. Checkout stays disabled. Stripe catalog, portal and account branding were configured. No app database, member access, subscriptions, email deliveries, app releases or deployments were changed. The live key is private and ignored by Git; it must be replaced before production because it appeared in the conversation. Sandbox purchase/access/cancellation testing still needs separate test credentials and an isolated backend.
