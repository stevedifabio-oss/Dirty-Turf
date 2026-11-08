# Membership setup, Android internal release and iPhone compile — November 8, 2026

Steve authorized completing the remaining setup. This receipt records the disabled backend in the existing Supabase project `ipbtldajgsoxixqmajec`, draft store catalogs and the refreshed Android internal-test release. Purchases, trials and customer push delivery remain off. There is no website publication, public production rollout or iPhone resubmission.

## Owner follow-up and next native batch

Steve confirmed the Tile & Grout Cleaning one-time price as $195.00. The shared add-on card displays that price while remaining Coming soon; no course content, checkout mapping or provider product was activated. The update is queued for the next native candidate with a newly verified unused code (15 or higher), not the locked Android code-14 artifact below. No rebuild or upload accompanies this change.

Steve reports Android build 14 is installed and opens. Installation/launch is user-confirmed; feature, purchase and physical-device acceptance beyond launch remain outstanding. The later provider checkpoint below records the fresh Apple agreement read-back and dedicated Google project creation.

## Exact Android candidate and source

The refreshed Android `1.0.1`/code `14` was accepted by Google Play and is ACTIVE on the existing internal-testing track `4701757813213362221`, release 13, named `1.0.1 (14) - Membership setup and Academy icon`. [Tester opt-in](https://play.google.com/apps/internaltest/4701757813213362221) is separate from public production availability. Physical-device acceptance and real purchases are not established.

The exact runtime source is remote commit `43a915c6c1bf8405575605b278bfdf26d8f27a2f`, byte-equivalent tree `b218e71be0f04636f8f992691ef828543f408780` with local commit `838a35e443d49140c3cc7253cf1365566f050d55`. [Full Linux CI run 149 passed](https://github.com/stevedifabio-oss/Dirty-Turf/actions/runs/42517233576). Subsequent documentation-only commits do not change this runtime/artifact identity.

Artifact: `output/release/android-memberships-20261108/DirtyTurf-1.0.1-14-memberships-upload-signed.aab`; SHA256 `e70b54c63061705dc8c90910df31a8ff21b4e70b4b3dae9509ed4b36ae11061d`; 59,928,615 bytes. Its protected build receipt confirms signing, 69 bundled assets matched, 24 launcher image pixel checks, 24 native release tests and zero native lint errors. This refreshed artifact includes the Academy icon, add-on presentation, final Scanner gate and notification interface. The older November 4 artifact with provisional code 14 was superseded and must not be uploaded. Code 14 is now used and locked; subsequent binaries need a newly verified unused higher code.

Local release evidence remains ignored: `output/qa/android-build14-internal-active-20261108.png` and the artifact directory's `build-receipt.json`/source manifest. No artifact or signing material is committed.

## Unsigned iPhone compilation

The focused PR/manual workflow `.github/workflows/ios-unsigned.yml` uses the standard `xcode-27` runner with read-only repository permissions, Node 22, locked dependencies and fresh native verification/sync. [Run 2 passed](https://github.com/stevedifabio-oss/Dirty-Turf/actions/runs/42519493657) on Xcode 27.1 (`27A9275`), compiling the actual StoreKit membership and measurement Swift plugins for generic iPhone ARM64. The Release build succeeded and its test-only web payload/native registry matched the synced source. No production environment, Apple credentials, provisioning, signing or store upload is used by this workflow.

The first run identified `Int64` as incompatible with Capacitor's `JSValue` protocol. Remote commit `dff96033dc250485c709e30488e6c0e829bcad35` / local `1cf0bbf173422d6799f2f67a9e2b1a63d8613540` changes only the iOS numeric price projection to supported `Int`. [Full Linux CI 152 passed](https://github.com/stevedifabio-oss/Dirty-Turf/actions/runs/42519493700), with 23 focused native-client/lifecycle tests also passing. This iOS-only repair is later than the frozen Android-14 source and does not change or replace that binary.

Ignored evidence: `output/qa/ios-unsigned-compile-20261108.json`, with runner/toolchain, source, first-run diagnosis and successful compile/payload checks. The workflow's preview payload does not verify production sign-in, real purchases, push delivery, signing or physical-device behavior; it is not an installable/App Store candidate and does not resolve Apple's rejected-login report by itself.

## Hosted components

Source migration `20261104014537_independent_store_memberships.sql` was applied once as hosted `20261108194112_independent_store_memberships`. The deployed SQL SHA256 is `b6c3470e5709d58af86f42375ebbb6cf58c5b25f81e85f517b54dca557846064`. Reconcile this alias before future database work; never replay the migrations directory. Six pre-existing hosted-only SearchIQ/TurfAdvisor migrations were untouched.

| Function | Hosted status | Version | Platform JWT check |
| --- | --- | --- | --- |
| verify-store-membership | ACTIVE | 3 | On; confirmed Auth account also checked in handler |
| google-store-membership-notifications | ACTIVE | 3 | Off; handler verifies Google OIDC identity/audience |
| apple-store-membership-notifications | ACTIVE | 3 | Off; handler verifies Apple signed payloads |

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

The Google payments profile is verified. All three approved product IDs now have subscription records and `monthly` base plans in DRAFT, with United States-only availability and saved prices of Community $19.99/month, Scanner $24.95/month and Academy $24.95/month. The exact Scanner price was read back after a direct U.S. price edit and Save changes; do not substitute $24.99. No base plan was activated and no purchase occurred. Google license testing was saved with only the existing one-person owner test list selected, the broader five-person list unselected and `RESPOND_NORMALLY`; no test purchase was attempted. Local evidence: `output/qa/google-scanner-price-exact-20261108.png` and `output/qa/google-license-tester-configured-20261108.png`.

In the authenticated Dirty Turf LLC Apple account, three separate subscription groups/products are configured: Community group 22559099/product 6832336762; Turf Scanner group 22559042/product 6832337801; Academy group 22559079/product 6832338391. All three have English (U.S.) product display names/descriptions, English group localizations with the default app name preserved, United States-only availability and saved one-month prices of $19.99/$24.95/$24.95 respectively. They remain Prepare for Submission, not in review or live. Local group evidence: `output/qa/apple-subscription-groups-20261108.png`.

Apple's Paid Apps Agreement still showed New and an unchecked acceptance box in fresh provider read-back, despite Steve's report of accepting it. The account-holder completion/confirmation request is pending; no agreement was accepted by the agent. The existing iPhone 1.0/build 17 is Rejected; Apple's November 5 review cited Guideline 2.1(a), with a login button that did not respond. No resubmission occurred. Local agreement evidence: `output/qa/apple-paid-agreement-still-new-followup.png`.

The owner authorized a dedicated project, and Dirty Turf Billing (`dirty-turf-billing`) was created under the current account with no organization or attached Cloud Billing account. The existing Firebase/FCM project and other Portal Tests/Social Posts projects were untouched. Publisher API terms/enablement, app-limited service-account access and key creation remain pending the current approval. No Google billing credential or authenticated RTDN was configured by project creation. Local API preparation evidence: `output/qa/google-publisher-enable-prepared-20261108.png`. Pub/Sub's free throughput tier still requires an active Cloud Billing account and does not guarantee zero storage/network/overage cost.

Apple's IAP key named Dirty Turf Membership Verify was created, downloaded into protected local storage and parsed as an EC key. The authenticated Supabase dashboard saved `APPLE_IAP_PRIVATE_KEY`, `APPLE_IAP_KEY_ID` and `APPLE_IAP_ISSUER_ID`; digest comparisons matched all three protected/local values. A protected read-only history request returned sandbox HTTP 200 with zero items/no further pages and production HTTP 401. The production failure's cause is unproven. Local evidence: `output/qa/apple-iap-key-prepared-20261108.png`, `output/qa/apple-iap-secrets-saved-20261108.png`, `output/qa/apple-iap-auth-verification-20261108/read-only-receipt.json` and `output/qa/apple-backend-configured-20261108.json`. Sandbox history authentication is not purchase, renewal or entitlement acceptance. Existing FCM/APNs custom configuration names were visible in the dashboard; they were not replaced and are not asserted absent.

Both renewal-notification URLs persisted after a full App Store Connect reload as `https://ipbtldajgsoxixqmajec.supabase.co/functions/v1/apple-store-membership-notifications`; bundle `com.dirtyturf.academy` was confirmed and Save was disabled. The observed UI displayed URL fields without a V1/V2 selector. Sandbox TEST had returned HTTP 404/error 4040007 (`SERVER_NOTIFICATION_URL_NOT_FOUND`), without a test token or callback. Persisted UI settings are confirmed, but the API failure's cause remains unproven; neither signed delivery nor its version is claimed tested and no immediate retry was performed. The deployed TEST path cannot apply an entitlement; 45 Apple verifier tests passed and hosted postflight kept all gates false, zero entitlements/trials/deliveries and 402 notifications. Local evidence: `output/qa/apple-renewal-urls-saved-20261108.png` and `output/qa/apple-store-test-notification-20261108/status-only-receipt.json`.

Google billing credentials, authenticated RTDN/Pub/Sub, Apple notification/provider acceptance and real purchase/renewal/refund/restore tests remain incomplete. Android device acceptance beyond the owner's installation/launch report is outstanding. iPhone compilation is verified above; an authorized signed production-configured candidate and iPhone acceptance are still required. No provider credential values or private identifiers are included in this receipt.

Keep all backend flags and mappings off until provider configuration and exact native candidates pass acceptance. Recheck access immediately before and after any cutover. Store records and internal-test availability do not establish publicly purchasable memberships. Upload, internal testing, review submission and public availability must remain separate.

## Notification schema follow-up

The two reviewed notification migrations were also deployed with delivery still held: source `20261108193714_academy_activity_notifications` maps to hosted `20261108194929_academy_activity_notifications`; source `20261108193947_academy_app_release_notifications` maps to hosted `20261108194950_academy_app_release_notifications`. Record these aliases rather than replaying source timestamps. Existing notification rows remained 402 with unchanged digest `f2052f2944a463c7b521a81289173da8`; push delivery rows remained zero, and the normalized membership-rights digest above was unchanged. The `academy-push-notifications` worker is ACTIVE version 11 with the reviewed three-file closure and expanded target-type allowlist. Push `enabled` and `client_ready` remain false. No release announcement, queue backfill or dispatch was invoked; provider/device acceptance and any delivery activation remain outstanding.
