# Native push preparation

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
