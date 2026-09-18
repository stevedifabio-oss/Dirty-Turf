# Dirty Turf Academy store submission

This file is the prepared source of truth for the App Store Connect and Google
Play records. The permanent web origin is `https://app.dirtyturf.com`. Do not
add a purchase link to either native listing or reviewer notes.

## App identity

| Field | Value |
| --- | --- |
| App name | Dirty Turf Academy |
| Apple bundle ID | `com.dirtyturf.academy` |
| App Store Connect Apple ID | `6813588770` |
| Apple SKU | `dirty-turf-academy-ios` |
| Android package | `com.dirtyturf.academy` |
| Google Play app ID | `4973615558687213779` |
| Primary language | English (U.S.) |
| Primary category | Education |
| Secondary category | Business |
| Price | Free |
| Ads | No |
| Business model | Consumption-only native client for a web-purchased Academy membership |

The machine-readable submission values live in `store/metadata.json`. Run
`npm run store:check` before entering any value in a store console; the check
enforces platform character limits, native identity and version parity,
required permissions, legal routes, and the 1024-pixel opaque iOS icon.

## Store copy

### Apple subtitle

Turf training and field tools

### Google Play short description

Academy, community, measurement, and infill tools for turf cleaning pros.

### Apple promotional text

Train with Dirty Turf Academy, connect with operators, and measure jobs with
practical turf tools in one member app.

### Full description

Dirty Turf Academy gives professional turf cleaning owners and operators one
place to learn, connect, and work in the field.

Members can continue Academy courses, track lesson progress, join the private
operator community, view events, and use practical turf tools from the same
account on desktop, iPhone, and Android.

Field tools include point-to-point live camera measurement on supported
devices, property tracing with current and historical map imagery, manual
length-by-width measurement, and an infill calculator. Select the required
pounds per square foot to see total material and rounded-up 40-pound and
50-pound bag counts. Operators can also calculate a customer price from their
charge per square foot and save job history to the company workspace.

An existing Dirty Turf Academy membership is required. Members sign in to
access the training, community, and field tools included with their account.

### Keywords

`turf cleaning,artificial turf,infill,field service,academy,measurement`

## Public URLs

Use these after the custom domain is live and TLS is valid:

- Privacy policy: `https://app.dirtyturf.com/privacy.html`
- Support: `https://app.dirtyturf.com/support.html`
- Account deletion: `https://app.dirtyturf.com/delete-account.html`

The pages already exist in `public/` and use relative internal links, so no
code change is required when the custom domain is assigned.

## Reviewer notes

Dirty Turf Academy is a membership-based training and operator tool. The iOS
and Android builds are consumption-only. They contain no purchase button,
external checkout link, or billing portal. A dedicated pre-existing reviewer
membership will be provided only in each store's private review fields after
member provisioning is verified. The reviewer selects `Use a password` and
signs in with the reusable email and password kept in the client vault. Regular
members continue to use Magic Links; store review must not depend on email
delivery or a one-time link.

Live camera measurement requires ARKit on iOS or ARCore on Android. On
unsupported hardware, the app clearly directs the reviewer to map or manual
measurement. Camera and location permissions are requested only when the
reviewer opens the related tool.

## Privacy and data-safety answers

Use these as the conservative disclosure baseline and reconcile them against
the final production build before submission.

| Data category | Collected | Linked | Purpose | Tracking |
| --- | --- | --- | --- | --- |
| Name and email | Yes | Yes | Authentication, account, support | No |
| User ID | Yes | Yes | Authentication and access control | No |
| Purchase/subscription status | Yes | Yes | Membership entitlement and support | No |
| Posts, comments, reactions, profile | Yes | Yes | Community features | No |
| Course progress and event responses | Yes | Yes | Academy features | No |
| Job labels, measurements, rates, photos | Optional | Yes | Company field tools | No |
| Precise location | Optional | Yes | Centering the measurement map | No |
| Device, request, and error diagnostics | Yes | Possibly | Security and reliability | No |
| Payment-card details | No | No | Entered directly on Stripe web pages | No |

Additional answers:

- Data is encrypted in transit.
- Users can request deletion in the app and at the public deletion URL.
- No advertising SDK or cross-app tracking is included.
- The app is not designed for children under 13.
- Community content is member-only and includes reporting/moderation data
  structures; complete the store social-content questions conservatively.

## Permissions and review evidence

- Camera: live AR measurement and user-selected job photos.
- Photos: user-selected job history images.
- Location: center the map on the current job location.
- Notifications: do not claim push notifications until a production provider
  and permission flow are implemented and tested.
- Encryption: `ITSAppUsesNonExemptEncryption` is `false`; the app uses only
  exempt operating-system HTTPS/TLS and does not implement proprietary crypto.

The Google Play asset set is prepared under `output/store-assets/`:

- `feature-graphic.jpg`: 1024 x 500
- `phone-home.jpg`, `phone-community.jpg`, `phone-tools.jpg`,
  `phone-events.jpg`, and `phone-calculator.jpg`: 1080 x 1920
- `public/icons/icon-512.png`: 512 x 512

Capture the final Apple screenshots from the signed TestFlight build for:
sign-in, Academy course, lesson, community feed, map tracing, manual calculator,
saved calculation, and settings/privacy. Record the exact device and
store-required dimensions with each asset.

## Account-side blockers

- The explicit Apple App ID and App Store Connect record are created. EU trader
  status must still be completed by the Dirty Turf account holder. This Mac has
  no usable Apple code-signing identity, so a distribution certificate/profile
  still has to be issued to the client team before a TestFlight archive can be
  uploaded. A physical iPhone is also required for the ARKit acceptance test.
- The Google Play app record is created, `com.dirtyturf.academy` is reserved,
  Play App Signing is accepted, the Education listing and graphics are saved,
  and signed release `1 (1.0)` is Active on Internal testing. The checked
  `Testers` list contains four accounts. Back up the upload keystore and its
  protected environment values in the Dirty Turf client vault before another
  machine or release depends on them.
- Google Play Data safety has been prepared for location, email, user ID,
  address, photos, app interactions, search history, and other user-generated
  content. Complete the three App activity detail panels and review every
  answer. Content rating and the 18+ target audience are saved; a private
  reviewer login and the remaining declarations still require final review.
- The owner organization, Academy import, and custom Auth SMTP are complete.
  Reviewer credentials remain pending until the dedicated password account and
  representative member pilot pass on production web and native builds.

## Android release signing

The Gradle release build reads the client-owned upload key only from the local
environment. Keep the key file and all four values outside Git:

```bash
export ANDROID_KEYSTORE_PATH=/absolute/path/to/dirty-turf-upload.jks
export ANDROID_KEYSTORE_PASSWORD='stored-in-client-vault'
export ANDROID_KEY_ALIAS='stored-in-client-vault'
export ANDROID_KEY_PASSWORD='stored-in-client-vault'
npm run native:android:signing-status
npm run native:android:release
```

The build fails on a partial configuration. Release `1 (1.0)` was signed with
the protected client upload key and accepted by Play. Future version codes must
use the same key; if it is lost, request an upload-key reset through Play
Console rather than creating an unrelated replacement.

## Galaxy device smoke test

The preferred Galaxy path is now the active Play Internal test. On a phone
signed in with one of the four configured tester accounts, open
`https://play.google.com/apps/internaltest/4701757813213362221`, accept the
invitation, then install from Google Play.

For direct pre-release diagnostics, the debug APK can still be installed over
USB. Tap **Build number** seven times under **Settings > About phone > Software
information**, enable **USB debugging** under **Developer options**, connect a
data-capable USB cable, approve the computer prompt, then run:

```bash
npm run native:android:install-device
```

The command finds the local Android SDK, verifies that exactly one authorized
device is connected, installs the current debug APK, and launches
`com.dirtyturf.academy`. Use the Play build for final acceptance and the direct
build only when logs or rapid iteration are required.
