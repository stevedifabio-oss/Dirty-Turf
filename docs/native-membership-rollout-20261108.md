# Membership setup and Android internal release — November 8, 2026

Steve authorized completing the remaining setup. This receipt records the disabled backend in the existing Supabase project `ipbtldajgsoxixqmajec`, draft store catalogs and the refreshed Android internal-test release. Purchases, trials and customer push delivery remain off. There is no website publication, public production rollout or iPhone resubmission.

## Exact Android candidate and source

The refreshed Android `1.0.1`/code `14` was accepted by Google Play and is ACTIVE on the existing internal-testing track `4701757813213362221`, release 13, named `1.0.1 (14) - Membership setup and Academy icon`. [Tester opt-in](https://play.google.com/apps/internaltest/4701757813213362221) is separate from public production availability. Physical-device acceptance and real purchases are not established.

The exact runtime source is remote commit `43a915c6c1bf8405575605b278bfdf26d8f27a2f`, byte-equivalent tree `b218e71be0f04636f8f992691ef828543f408780` with local commit `838a35e443d49140c3cc7253cf1365566f050d55`. [Full Linux CI run 149 passed](https://github.com/stevedifabio-oss/Dirty-Turf/actions/runs/42517233576). Subsequent documentation-only commits do not change this runtime/artifact identity.

Artifact: `output/release/android-memberships-20261108/DirtyTurf-1.0.1-14-memberships-upload-signed.aab`; SHA256 `e70b54c63061705dc8c90910df31a8ff21b4e70b4b3dae9509ed4b36ae11061d`; 59,928,615 bytes. Its protected build receipt confirms signing, 69 bundled assets matched, 24 launcher image pixel checks, 24 native release tests and zero native lint errors. This refreshed artifact includes the Academy icon, add-on presentation, final Scanner gate and notification interface. The older November 4 artifact with provisional code 14 was superseded and must not be uploaded. Code 14 is now used and locked; subsequent binaries need a newly verified unused higher code.

Local release evidence remains ignored: `output/qa/android-build14-internal-active-20261108.png` and the artifact directory's `build-receipt.json`/source manifest. No artifact or signing material is committed.

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
- A verified-member hosted acceptance transaction passed and was rolled back: store status returned `enabled=false`, `trialEligible=false` and `products=[]`; the trial RPC rejected the request as not open; direct member invocation of verified fulfillment was denied with SQLSTATE 42501. After rollback, entitlements, trial claims and push deliveries remained zero and all three activation flags remained false. No outgoing send was invoked.
- Before/after effective access matched: 65 linked accounts; 64 app; 64 Community; 63 courses; six Scanner; four managers; zero identity mismatches. The normalized digest remained `6abaa7b956dd06f2252c77b522cabdbc`.
- The final isolated SQL harness passed 193 assertions across all 64 release migrations. It covers independent combinations, source-scoped cancellation/refund, account binding, held purchase/trial denial, repeated trial denial, sandbox restrictions and the manual Scanner boundary.

Manual and infill calculations retain their legacy availability while separate access is off. The future cutover will require Scanner entitlement for every measurement method. Saved property records remain readable under existing workspace rules. That intentional future calculation restriction is separate from the unchanged entitlement digest.

## Remaining activation gates

The Google payments profile is verified. All three approved product IDs now have subscription records and `monthly` base plans in DRAFT, with United States-only availability and saved prices of Community $19.99/month, Scanner $24.95/month and Academy $24.95/month. The exact Scanner price was read back after a direct U.S. price edit and Save changes; do not substitute $24.99. No base plan was activated and no purchase occurred. Local price evidence: `output/qa/google-scanner-price-exact-20261108.png`.

In the authenticated Dirty Turf LLC Apple account, three separate subscription groups/products are configured: Community group 22559099/product 6832336762; Turf Scanner group 22559042/product 6832337801; Academy group 22559079/product 6832338391. All three have English (U.S.) product display names/descriptions, English group localizations with the default app name preserved, United States-only availability and saved one-month prices of $19.99/$24.95/$24.95 respectively. They remain Prepare for Submission, not in review or live. Local group evidence: `output/qa/apple-subscription-groups-20261108.png`.

Apple's Paid Apps Agreement remains unsigned; its terms were left open for the account holder, and no agreement was accepted by the agent. The existing iPhone 1.0/build 17 is Rejected; Apple's November 5 review cited Guideline 2.1(a), with a login button that did not respond. No resubmission occurred.

The available Google Cloud login lacks IAM access to `dirty-turf-academy`. Other available Portal Tests/Social Posts projects were left untouched. Dedicated billing credentials, Google RTDN/Pub/Sub and Apple provider configuration remain incomplete. Real purchase/renewal/refund/restore acceptance and actual Android device acceptance are outstanding; iPhone compilation/signing and acceptance require Mac/Xcode and an iPhone. No provider credential values are included in this receipt.

Keep all backend flags and mappings off until provider configuration and exact native candidates pass acceptance. Recheck access immediately before and after any cutover. Store records and internal-test availability do not establish publicly purchasable memberships. Upload, internal testing, review submission and public availability must remain separate.

## Notification schema follow-up

The two reviewed notification migrations were also deployed with delivery still held: source `20261108193714_academy_activity_notifications` maps to hosted `20261108194929_academy_activity_notifications`; source `20261108193947_academy_app_release_notifications` maps to hosted `20261108194950_academy_app_release_notifications`. Record these aliases rather than replaying source timestamps. Existing notification rows remained 402 with unchanged digest `f2052f2944a463c7b521a81289173da8`; push delivery rows remained zero, and the normalized membership-rights digest above was unchanged. The `academy-push-notifications` worker is ACTIVE version 9 with the reviewed three-file closure and expanded target-type allowlist. Push `enabled` and `client_ready` remain false. No release announcement, queue backfill or dispatch was invoked; provider/device acceptance and any delivery activation remain outstanding.
