# Native push preparation

## November 8, 2026 preparation and current hosted audit

Recovered the earlier grouped controls (master switch plus Community, Courses and App updates) and the native app-version banner into the current release checkout. The public `app-releases.json` remains empty for both platforms. Checking a future store release is read-only; it does not install an update. Tapping a server-authorized release notice shows the matching fixed store link, with installed-version checks on phones. Account changes invalidate a delayed notice response.

Two additive migrations follow the independent-memberships migration: source `20261108193714_academy_activity_notifications.sql` is hosted as `20261108194929_academy_activity_notifications`; source `20261108193947_academy_app_release_notifications.sql` is hosted as `20261108194950_academy_app_release_notifications`. Do not replay them. They add all-post/new-member preferences, published lesson-edit producers, the app-updates preference and explicit master-owner release announcements. Delivery remains held; no cron, backfill, import or store announcement was activated. Existing notification rows remained 402 with unchanged digest `f2052f2944a463c7b521a81289173da8`, and push delivery rows remained zero. The activity migration retains historical import silence, current access/moderation/drip checks, category consent and the existing email audience. The release producer never creates email deliveries. At the November 8 read-back, the worker's reviewed three-file closure was `academy-push-notifications` ACTIVE v13 with its added target-type allowlist; push `enabled`/`client_ready` remain false, and no dispatcher call or provider/device acceptance is claimed.

After independently verifying a version is publicly available, the verified master owner can call `admin_announce_app_release` with the community UUID, exact `ios`/`android` platform, numeric version/build strings, the fixed real store listing URL, notes, past/current publication timestamp and an expiry within 90 days. Internal-test uploads and review submissions must not be announced. Exact retries return the existing release without adding recipients or deliveries; different details for the same version/build are rejected. Only opted-in registered devices on that platform can queue push, and current account/access, device generation, platform, preference, active release, cutover and expiry are checked again before dispatch. The owner may withdraw a release by setting its private record inactive through the established backend operations path. No announcement is invoked during preparation.

Read-only hosted audit before these notification migrations: production push `enabled=false`, `client_ready=false`; one enabled Android installation, zero delivery rows and no push dispatcher cron. The existing email dispatcher remains active. Earlier single-phone Android test receipt does not establish member-wide delivery or Apple readiness. Apple's APNs capability, provisioning, credential authorization and physical iPhone behavior still require verification. Both provider configurations and the production dispatcher must pass the controlled acceptance below before releasing held delivery switches.

Later November 8 dashboard read-back showed seven existing FCM/APNs custom configuration names alongside the three newly saved Apple IAP billing names. Do not infer missing push credentials from the absence of billing configuration in Vault: the Edge secret store is separate. Existing FCM/APNs values were not replaced by the dedicated billing project or IAP-key setup. Configuration presence does not verify provider authorization, APNs capability/provisioning or physical delivery. The existing push hold and controlled acceptance requirements remain unchanged.

Google's dedicated membership RTDN transport subsequently delivered a Play test notification to its billing endpoint with HTTP 204. That provider-to-server billing test does not send a member notification or verify phone push delivery. The separate Apple billing TEST retry reached its endpoint but returned HTTP 503 with its hosted-runtime cause described below. Neither diagnostic changes FCM/APNs configuration, enables the notification dispatcher or satisfies physical-device push acceptance.

The earlier HTTP 503 was traced to unimplemented X509 methods in Supabase Edge 1.77.9 / compatible Deno 2.1.4. The deployed Node helper retains Apple's official SDK, online certificate checks and pinned roots for notification, transaction and renewal signatures; authoritative App Store API status verification and entitlement fulfillment remain in the Edge/backend path. Historical diagnosis: `output/qa/apple-503-diagnosis-20261108/status-only-diagnosis.json`. The matching protected `APPLE_SIGNATURE_VERIFIER_SECRET` is configured in Netlify production and Supabase, with the saved Supabase value verified by digest. Netlify's current plan protects it across Builds, Functions and Runtime and excludes Post processing; a narrower Functions-only scope would require an upgrade, which was not performed. No IAP private key or Supabase service-role credential is added to Netlify, and the helper cannot write entitlements.

Deployment evidence is retained outside Git in `output/qa/apple-signature-repair-published-20261109.json`, `output/qa/apple-signature-production-published-20261109.png` and `output/qa/apple-signature-production-node22-proof-20261109.png`. Netlify build logs confirm Node 22.23.4; production runtime is configured as nodejs22.x. No debug runtime endpoint was added. Protected-setting screenshots are ignored; no credential values or account details are recorded here.

The approved backend-only [PR 58](https://github.com/stevedifabio-oss/Dirty-Turf/pull/58) is merged as canonical main `2dad84822719deb8709493432d23949d38c04564`, with production Netlify deploy `6af2a0a803cf98252d75a40a` verified against that exact commit. Production uses `NODE_VERSION=22.23.4` and `AWS_LAMBDA_JS_RUNTIME=nodejs22.x`. This publishes the 11-file backend helper subset only; the pending app frontend/native batch and PR 57 are not merged or published. The two reviewed Edge consumers were deployed from PR 57 source commit `1d8972a00890d6f789c2ca540eb8f97075914e21`: `verify-store-membership` ACTIVE v7 retains platform JWT verification, while `apple-store-membership-notifications` ACTIVE v7 retains handler-verified Apple signatures with platform JWT off. This later documentation checkpoint does not change that deployed source. Fresh metadata lists Google notifications v6 and the push worker v14 after the secret save; their source hashes and source-deployment timestamps are unchanged. Google billing source and member-push controls were not changed.

Live helper checks returned HTTP 401 for unauthenticated requests, HTTP 400 for malformed authenticated input and HTTP 200 for the protected real Apple TEST, with `Cache-Control: no-store`. A fresh sandbox TEST was accepted and Apple's `getTestNotificationStatus` returned SUCCESS (attempt `1794285907252`); Supabase logged POST HTTP 204 at `2026-11-10T04:45:07.948Z` (November 9 in Phoenix). This verifies signed sandbox notification processing, not a real payment, renewal, restore, refund or production purchase. [Backend PR CI 156](https://github.com/stevedifabio-oss/Dirty-Turf/actions/runs/42540434387), [main deployment CI](https://github.com/stevedifabio-oss/Dirty-Turf/actions/runs/42757531343), [membership source CI 157](https://github.com/stevedifabio-oss/Dirty-Turf/actions/runs/42756164909) and [unsigned iOS compile 6](https://github.com/stevedifabio-oss/Dirty-Turf/actions/runs/42756164570) all passed. The Edge source stays fixed at `1d8972a00890d6f789c2ca540eb8f97075914e21`; documentation-only commits do not replace it. Postflight kept `separate_access_enabled`, `store_purchases_enabled` and `scanner_trial_enabled` false, with zero active product mappings, entitlements and trial claims. Member-push readiness was unchanged. No mobile upload, PR 57 merge, Google change, release announcement or member push accompanied the repair. Apple's last direct status remains Paid Apps Agreement Processing, bank update Processing (up to 24 hours advised) and W-9 Active.

A fresh read-only production `getNotificationHistory` follow-up still returned HTTP 401 at `2026-11-10T04:48:36.605Z`, with no API error code and cause unproven. Production API authorization remains an explicit gate despite sandbox callback success. No permission was broadened or key replaced in response. Ignored evidence: `output/qa/apple-production-auth-followup-20261109.json`.

Course notification access now matches the intended recipient's independent course grants and grandfathered scopes, rather than the publishing actor's privileges. Community-only access never exposes course titles or queued updates; expired-course cancellation notices retain their narrowly scoped existing exception. Existing course producers and queued-event send/tap checks use the same guard.

Verification: 85 isolated PostgreSQL assertions cover activity and release authorization, duplicate suppression, platform targeting, opt-outs, access revocation, withdrawal, import silence, held gates, Community-only course isolation, grandfathered access, cancellation exceptions and member/Auth relinking. Focused client/provider tests cover grouped preferences, legacy schemas, native release checks, notification taps, fixed store links and account switching. This source preparation does not prove provider/device delivery.

Native phone delivery remains inactive. The reviewed backend schema and worker were installed on October 23, 2026 (America/Bogota), with database `enabled=false`, `client_ready=false`, zero devices/deliveries and no push cron. An unauthenticated worker probe returned `enabled:false,sent:0`. No native sync/build, provider push call, store upload, selected-build change or release-control change occurred. The web scheduler's twelve reviewed announcements are active after controlled in-app/email acceptance, including actual Gmail receipt and an email button opening its exact post. That acceptance does not establish native phone delivery.

## Behavior

- Members explicitly enable phone notifications. Neither app startup nor resume asks for permission. A read-only authenticated readiness RPC must report the matching environment ready before the app asks the OS.
- The account master switch defaults off. Replies, mentions, announcements, events and course updates default on beneath that switch. Likes and followed-member posts default off. These preferences are separate from email.
- A private per-installation device registry stores provider tokens. Clients cannot read tokens or choose another notification recipient. Registration binds the captured Auth identity and token to an authenticated, revision-fenced installation intent. Token rotation, account switching and logout invalidate older queued generations.
- Logout disables only the local installation. Explicit phone-notification opt-out disables the account master preference. OS unregister and remote revocation run independently; offline revocation is retained and retried with the installation's disable-only capability. A stale revision cannot disable a later account's registration.
- Each new, supported in-app notification can queue one delivery per opted-in device generation. There is no historical backfill or broadcast API. Imports retain their existing silence. Mentions supersede the same action's generic pending push.
- Quiet hours are 10pm–8am in the device's validated IANA timezone. The queue postpones alerts until 8am, including across daylight-saving changes. Unsent alerts expire after 24 hours. Registration refreshes the device timezone; tokens inactive for 90 days stop receiving new alerts.
- Claim and final preparation check current Auth restrictions, membership, access grants/denials, target visibility, blocks, follows, comment moderation, lesson visibility/drip and relevant RSVP state. Final preparation runs after provider authentication. Lock-screen copy is always generic; private post titles, excerpts and member names are absent.
- Push taps carry identifiers, never arbitrary URLs. The app retains the notification ID through login/Terms, then resolves it with the authenticated notification owner's current access. A different signed-in account cannot resolve that notification.
- The worker claims one device at a time, at most 25 per request, and admits no new claim after 45 seconds. DB calls have 8-second timeouts and provider calls have 20-second timeouts. A slow provider leaves unattempted devices pending. Definitive rate limits retry with bounded backoff. Network ambiguity, provider 5xx, lost completion and stale processing locks are held for review. Explicit APNs `Unregistered` or FCM `UNREGISTERED` retires that token. Provider acceptance is not device delivery proof.

## Protected setup required before activation

Keep credentials out of chat, source, public build variables and receipts. Use the established protected Edge environment/Vault path. The allowlist adds only these names while preserving all existing Stripe/GHL/email names:

| Name | Purpose |
|---|---|
| `ACADEMY_PUSH_ENABLED` | Worker kill switch, exact `true` only after approval; absent means off |
| `ACADEMY_PUSH_DISPATCH_SECRET` | Separate random dispatch credential, 32–256 URL-safe characters |
| `ACADEMY_PUSH_ENVIRONMENT` | Exact `sandbox` or `production`; must match the DB readiness environment |
| `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY` | Apple signing key ID, team ID and protected PKCS8 `.p8` key |
| `APNS_TOPIC` | Exact `com.dirtyturf.academy` |
| `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY` | Protected Firebase service account authorized to send FCM messages |

Apple APNs capability and provisioning must include the app. The local Xcode source has the official token callbacks and an entitlement using `development` for Debug and `production` for Release. This is not proof the existing signing profiles support push.

Android requires the matching Firebase Android app and `android/app/google-services.json`. That file is ignored and must come from protected native configuration; no fabricated file is supplied. The plugin uses FCM on Android and APNs on iOS. The pinned official plugin is `@capacitor/push-notifications` **8.1.3**, compatible with Capacitor 8. Native generated dependency registration was prepared without running native sync or builds. Run the normal authorized native preparation later to regenerate the runtime plugin registries, then inspect their diff.

The Android manifest disables Firebase Messaging auto-initialization on a fresh installation. The verified plugin's explicit `register()` enables it; `unregister()` disables it and deletes the token. No request is made on startup to bypass member opt-in.

The public, non-secret native build variable `VITE_PUSH_ENVIRONMENT` is required: `sandbox` for a development-entitled iPhone build, `production` for store distribution. It must match server readiness. An ordinary web publication cannot add native push to currently installed binaries.

After reviewing the exact source/migration and provisioning, deploy only the approved named function/migration through the existing backend process. Independently verify provider configuration and protected dispatcher authentication. The DB settings row starts with `enabled=false` and `client_ready=false`; set both only after that verification, with a fresh cutover time and matching environment. Do not reuse an old cutover or enqueue the existing notification history.

No cron is installed here. An approved dispatcher schedule must POST to `academy-push-notifications` with `x-push-dispatch-secret` from Vault. Avoid placing the credential in a cron command, logs or client. Keep the email dispatcher and Community sync v5/sequence-66 baseline intact.

A minutely dispatcher is the intended future cadence. Capacity is bounded per invocation and provider latency; it is not an instant-delivery guarantee. Monitor queue age, provider outcomes and actual receipt before expanding an approved rollout.

## Required acceptance

1. Verify no permission prompt at install/start/resume and no prompt while readiness is off.
2. On actual iPhone and Android builds, explicitly enable once and verify the OS permission, account preference and exact device registration. Confirm installed build, provider environment and signing configuration agree.
3. Send a separately authorized, single-recipient controlled event. Verify foreground/background/terminated receipt, generic lock-screen copy and a tap opening the correct content after Terms/login.
4. Test account A logout → account B sign-in, delayed old registration, expired session and offline logout. No A content or notifications may be opened under B; old token requests/revocations must not replace B's newer registration.
5. Check category opt-outs, followed-post opt-in, duplicate event replay, mention supersession, quiet-hours postponement/expiry, moderator removal, blocks and revoked access before send.
6. Verify token rotation and unregistered-token retirement. Review uncertain provider results rather than resetting them blindly. Provider API acceptance and OS display are separate evidence.

## Local verification commands

`npx vitest run src/lib/nativePush.test.ts supabase/functions/_shared/native-push.test.ts supabase/functions/academy-push-notifications/index.test.ts supabase/functions/_shared/runtime-config.test.ts`

`PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node scripts/test-native-push-sql.mjs`

These tests use isolated PostgreSQL and synthetic/mocked providers. They cannot send a real notification.

## Official references checked

- [Capacitor 8 push plugin](https://capacitorjs.com/docs/apis/push-notifications): native setup, permission checks, registration callbacks, action listener and unregister.
- [Apple token authentication](https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns): ES256 JWT, key/team IDs and token age.
- [Apple APNs requests](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns): HTTP/2, environment endpoints, alert headers and variable-length device tokens.
- [FCM HTTP v1 authorization](https://firebase.google.com/docs/cloud-messaging/auth-server) and [send method](https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages/send): scoped service account OAuth and single-device sends.

Context7 was unavailable in this agent's tool inventory, so official documentation and the official npm registry/package sources were used directly. No SDK API was inferred from memory.
