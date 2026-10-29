# Native handoff preparation — October 29, 2026

This is a local preparation record for `codex/steve-maintenance-handoff-20261029`. It does not establish store approval, upload, public availability, device acceptance, or working phone notifications.

## Candidate identity

| Platform | Queued candidate | State |
| --- | --- | --- |
| iOS | 1.0.1, build 18 | Provisional numbers; Console inventory must be checked before upload |
| Android | 1.0.1, version code 13 | Provisional numbers; Console inventory must be checked before upload |

The bundle/application identifier remains `com.dirtyturf.academy`. These queued candidates are separate from the already submitted iOS 1.0 (17) and published Android 1.0 (12). This preparation does not replace those submissions.

## Verification

**Final local compilation only:** after the handoff source review fixes and dependency corrections, configured native sync, Release simulator compilation, and an unsigned generic-iOS device archive all passed. All **56 web payload files** match the Android source wrapper, iOS source wrapper, simulator app, and archive app. Both native registries include `AppPlugin` and `PushNotificationsPlugin`. The archive identifies `com.dirtyturf.academy`, version 1.0.1/build 18, minimum iOS 15, and iPhone device family. It has no code signature and is not an installable, upload-ready distribution candidate.

| Evidence | SHA-256 |
| --- | --- |
| Final 56-file web payload manifest | `5391fbc9ce24f402de733efff85b0400a820c018ece5538463b2176067c0a3a1` |
| 283 native/frontend input files, package lock and public store versions | `17da8bc7f29ef3b66098c19c1f8bd25c5d8785a2220b89b4c19b9e7b0650ccbf` |
| `DirtyTurf-1.0.1-build18-unsigned.xcarchive.tar.gz` (7,004,524 bytes) | `cd0c39ca29a9a37dded85b947935f492c2c02336e1d07b8b719e3f4dde63eb96` |

Manifest hashes use SHA-256 over UTF-8 JSON of the sorted relative-path/hash map with compact separators. The native input manifest excludes documentation, generated output and private configuration; it is not a hash of every repository file.

Android Gradle 8.14.3 starts and `:app:releaseSigningStatus` succeeds, reporting signing unconfigured. The combined AAB/APK/unit-test/lint command stops before those tasks with **SDK location not found**. No new Android AAB, APK, unit-test result, or lint pass is claimed. The Android SDK and accepted SDK-license copy were not found in known accessible locations; the external drive was inaccessible. The [official SDK download](https://developer.android.com/studio/) requires agreement to its terms before downloading. No new agreement was accepted or license hash fabricated. Steve must supply an existing authorized SDK path or complete that setup before Android packaging can proceed.

Native preparation toolchain verified locally: Node 24.14.0, npm 11.9.0, Java 21.0.11, Xcode 27.1 (27A9275). Steve's Node 22 setup and final shared checks were independently verified; see the [handoff verification record](handoff-verification-20261029.md). No duplicate shared test pass is inferred from native compilation.

## Configuration and signing limits

The configured web payload uses only the existing Dirty Turf public Supabase URL and a locally validated anon/publishable key, extracted from the same project's prior configured build. No server key or reviewer credential was read or copied into source, logs, or artifacts. The final native build variable is `VITE_PUSH_ENVIRONMENT=production`; a development-entitled iPhone build instead needs `sandbox`.

Push activation remains gated off. Native sync registers the installed plugin, but it does not enable the database readiness switches, provider delivery, or a dispatcher. No hosted settings, device data, push providers, release controls, or store submissions were changed.

The existing Dirty Turf code-signing identities are present locally. All three matching existing iOS provisioning profiles lack `aps-environment`, while the queued source includes the push entitlement. The unsigned archive demonstrates compilation only. A signed new candidate needs authorized Apple capability/provisioning setup supporting that entitlement; no automatic provisioning update was requested. Steve needs Apple Developer/App Store Connect access to team `Z36XF6NX6G` and his own authorized signing setup.

Android release signing requires the existing protected upload key and all four environment variables: `ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD`. None was configured in this build shell. Without them, a generated release bundle is unsigned. The ignored `android/app/google-services.json` must come from the matching Firebase Android app before claiming Android push readiness. Provider credentials and signing material stay outside Git.

## Reproduce preparation

Use the Node 22.12-or-later Node 22 setup in Steve's quickstart and install the locked dependencies with `npm ci`. This preparation used the separately recorded Node 24 toolchain. Supply only the project's public `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` through ignored local configuration or the build environment, plus the appropriate `VITE_PUSH_ENVIRONMENT`.

1. Run `npm run check` for the shared source and store-metadata parity.
2. Run `npm run native:sync`, then `node scripts/check-native-bundles.mjs`. Sync is required in a fresh checkout to generate the native plugin registries; copying web files alone is insufficient.
3. Install/configure Android SDK platforms and build tools required by the checked-in Gradle configuration. Set `ANDROID_HOME` or an ignored `android/local.properties` with the real `sdk.dir`. Use Java 21. From `android`, run `./gradlew :app:releaseSigningStatus :app:bundleRelease :app:assembleDebug :app:testDebugUnitTest :app:lintDebug :app:lintRelease --console=plain`. Confirm signing status and rerun `npm run native:verify:artifacts` after successful packaging.
4. On a Mac with Xcode, open `ios/App/App.xcodeproj`, scheme `App`. Release simulator compilation and an unsigned generic-iOS archive can use `CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO`. Signing and App Store export require the authorized team, profile, and entitlement setup above.
5. Recheck unused store version/build numbers before any separately authorized upload. Keep ordinary changes together in one tested candidate per platform.

## Remaining acceptance

No app was installed, launched on a device, uploaded, or submitted during this preparation. Test the exact final signed distribution candidates on iPhone and Android: login and Terms, restart/resume, lesson and video playback, Community photos/report/block, scheduler permissions, camera/location permission denial, map/manual measurement, offline recovery, and no push permission prompt while readiness is off. Phone notification delivery needs its own authorized controlled test and provider/device evidence.

Apple and Google assess new public mobile releases independently. Publishing the GitHub-connected website updates the website; installed phone apps retain their bundled code until their platform's new app release is approved, distributed, and installed.

## Local evidence

Ignored logs, receipts, native products, and manifests are under `output/release/steve-handoff-20261029/`. The final records are `native-payload-receipt.json`, `native-input-manifest.json`, `native-sync-final.log`, `ios-simulator-result.json`, `ios-archive-result.json`, `android-build-result.json`, and `android-signing-status.log`. The `.xcarchive` and compressed unsigned archive are local artifacts and are not included in the Git handoff branch. Do not place signing keys, reviewer credentials, or private provider configuration in that directory or in Git.
