# Disabled membership backend deployment — November 8, 2026

Steve authorized completing the remaining setup. This receipt records backend preparation in the existing Supabase project `ipbtldajgsoxixqmajec`. It does not claim live purchases, trials, a native upload, a website release or customer push delivery.

## Hosted components

Source migration `20261104014537_independent_store_memberships.sql` was applied once as hosted `20261108194112_independent_store_memberships`. The deployed SQL SHA256 is `b6c3470e5709d58af86f42375ebbb6cf58c5b25f81e85f517b54dca557846064`. Reconcile this alias before future database work; never replay the migrations directory. Six pre-existing hosted-only SearchIQ/TurfAdvisor migrations were untouched.

| Function | Hosted status | Version | Platform JWT check |
| --- | --- | --- | --- |
| verify-store-membership | ACTIVE | 1 | On; confirmed Auth account also checked in handler |
| google-store-membership-notifications | ACTIVE | 1 | Off; handler verifies Google OIDC identity/audience |
| apple-store-membership-notifications | ACTIVE | 1 | Off; handler verifies Apple signed payloads |

The deployment closures contain 9, 7 and 6 local files respectively. Direct remote imports are pinned, including the Edge runtime declaration at 2.116.0. All three Deno checks passed. Ignored deployment manifests/payloads and aggregate audit SQL are retained in `output/qa`.

## Held state and acceptance

- Six provider/product mappings exist: Google and Apple each map Community, Scanner and Academy independently. All six remain inactive.
- `separate_access_enabled`, `store_purchases_enabled` and `scanner_trial_enabled` are false.
- Store entitlement, Scanner trial claim and private sandbox-account tables each contain zero rows.
- Authenticated members cannot select raw store catalog rows or insert entitlements; anonymous users cannot read entitlements.
- Empty unauthenticated POST requests returned 401 for purchase verification, 401 for Google notifications and 400 for Apple notifications. These are negative smoke checks, not valid provider acceptance.
- Before/after effective access matched: 65 linked accounts; 64 app; 64 Community; 63 courses; six Scanner; four managers; zero identity mismatches. The normalized digest remained `6abaa7b956dd06f2252c77b522cabdbc`.
- The isolated SQL harness passed 193 assertions across 62 migrations. It covers independent combinations, source-scoped cancellation/refund, account binding, held purchase/trial denial, repeated trial denial, sandbox restrictions and the manual Scanner boundary.

Manual and infill calculations retain their legacy availability while separate access is off. The future cutover will require Scanner entitlement for every measurement method. Saved property records remain readable under existing workspace rules. That intentional future calculation restriction is separate from the unchanged entitlement digest.

## Remaining activation gates

The Google payments profile is verified, but the Google Cloud account currently available lacks access to the required project. Google Play's current bundle inventory still lists code 13 as highest; code 14 is unused at this checkpoint. Google billing service-account/Pub/Sub configuration and actual Google subscription products remain outstanding.

In the authenticated Dirty Turf LLC Apple account, three separate draft subscription groups/products were created: Community group 22559099/product 6832336762; Turf Scanner group 22559042/product 6832337801; Academy group 22559079/product 6832338391. Community's $19.99/month and Scanner's exact $24.95/month price were saved; Academy's exact $24.95/month price confirmation was submitted, with final read-back and required metadata/availability still in progress at this checkpoint. They remain Prepare for Submission, not approved or live. No agreement was accepted. The existing iPhone 1.0/build 17 is Rejected; Apple's November 5 review cited Guideline 2.1(a), with a login button that did not respond. No resubmission occurred.

Apple billing credentials and real purchase/renewal/refund/restore acceptance remain separate work. No provider credential values are included in this receipt.

Keep all flags and mappings off until the reviewed provider configuration and exact native candidates pass acceptance. Recheck access immediately before and after any cutover. Android build 14 already signed before this batch predates the new icon, add-on presentation and final Scanner gate; it is not evidence that those updates are installed. Apple still requires Mac/Xcode compilation and iPhone acceptance. Upload, internal testing, review submission and public availability must be recorded separately.

## Notification schema follow-up

The two reviewed notification migrations were also deployed with delivery still held: source `20261108193714_academy_activity_notifications` maps to hosted `20261108194929_academy_activity_notifications`; source `20261108193947_academy_app_release_notifications` maps to hosted `20261108194950_academy_app_release_notifications`. Record these aliases rather than replaying source timestamps. Existing notification rows remained 402 with unchanged digest `f2052f2944a463c7b521a81289173da8`; push delivery rows remained zero, and the normalized membership-rights digest above was unchanged. No release announcement, queue backfill or dispatch was invoked. The worker's added target-type allowlist requires its separate reviewed deployment; provider/device acceptance and any delivery activation remain outstanding.
