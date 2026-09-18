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

## Store copy

### Subtitle / short description

Turf training, community, measurement, and infill tools for professional
cleaners.

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

An existing Dirty Turf Academy membership is required. Purchases and billing
management are completed on the Dirty Turf website. The mobile apps do not
offer or link to external purchases.

### Keywords

`turf cleaning, artificial turf, infill, field service, academy, measurement`

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
external checkout link, or billing portal. A pre-existing reviewer membership
will be provided in the private review fields after SMTP and member
provisioning are verified. The reviewer signs in with a one-time Magic Link.

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

Capture screenshots from the final signed builds for: sign-in, Academy course,
lesson, community feed, map tracing, manual calculator, saved calculation, and
settings/privacy. Record the exact device and store-required dimensions with
each asset.

## Account-side blockers

- The explicit Apple App ID and App Store Connect record are created. EU trader
  status must still be completed by the Dirty Turf account holder. The device
  archive also needs one client iPhone registered so Xcode can create the
  development provisioning profile before TestFlight export.
- The Google Play app record is created, `com.dirtyturf.academy` is reserved,
  and Play App Signing is accepted. The release AAB still needs a client-owned
  upload key before it can be signed and uploaded to Internal testing.
- Reviewer credentials cannot be created until the owner organization, Academy
  import, custom SMTP, and Magic Link pilot are complete.

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

The build fails on a partial configuration. With no signing variables it still
produces an explicitly unsigned local artifact for compilation QA.
