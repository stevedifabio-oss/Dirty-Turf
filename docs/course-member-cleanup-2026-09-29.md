# Course and member cleanup — September 29, 2026

## Shipped changes

- PR28 merged as `e07d96817481d02c677aeba6a0c835ab6aa8dd1e`. The GitHub-triggered Netlify deployment published at 6:09 PM local; no manual deployment was used.
- The member course outline now shows 20 populated sections and hides 16 empty source containers. It opens the first populated section, retains stable module identities, and preserves all 109 published lessons and carried-over progress.
- Lesson resource cards distinguish ordinary websites from actual files. Imported opaque URL labels display a readable hostname; authored titles remain intact.
- Admin Studio now distinguishes pending account setup from cancelled historical membership and successfully provisioned invitations. The live access-review count fell from 60 to 1.

## Member reconciliation

63 records: 61 active members have linked login accounts; one active member has an existing pending manual invitation; one cancelled member remains as a historical author.

- Ralph has a saved invitation for Rangel Janitorial. He is a manually added member, with no GHL import mapping, no linked login and no course grants. Creating his login is pending the requested owner confirmation. No invitation email was sent.
- Derek Baca is explicitly cancelled in the imported source record and is retained for historical comment attribution. His absence from active sign-in provisioning is intentional.
- No member, invitation, access grant, progress record, source content or historical discussion was deleted or reassigned.

## Content and media verification

- All 109 published lessons have nonempty content and resolve to visible populated modules.
- All 137 mirrored lesson-image records have matching nonempty private storage objects with matching byte sizes.
- Six current external lesson images returned successful image responses. One image in “Van Setup With a Truck Mount” is not in the asset catalog and still relies on its working GHL URL.
- 35 resource links represent 18 distinct URLs: 14 returned successful responses; four vendor URLs returned HTTP403 to automated checks. These are unverified vendor restrictions, not confirmed dead links.
- No published video/audio/iframe source was found, so no video playback acceptance is claimed.
- Other storage objects include community/historical data and were retained.

## Verification

- `npm run check`: 393 tests across 54 files, secret/schema/store/type checks, production build and PWA checks passed.
- Android signed release AAB/debug APK and signed iOS archive built successfully.
- Dist, Android/iOS bundled sources, debug APK, release AAB and archived iOS app share embedded frontend hash `259100b3218cf2d200533fba65e4fef7743aed877b29d9fd2ac80b44baf22a1b`.
- Authenticated production browser: 109 lessons, 20 populated sections, first section expanded, carried-over progress unchanged at 55%, website resource labels and corrected admin review count verified. Desktop before/after screenshots inspected; no captured browser errors.
- Browser viewport override did not take effect, so a new mobile-width browser acceptance is not claimed. The paired physical iPhone is unavailable; neither newest binary has new installed-device acceptance.

## Store release checkpoint

- Android1.0(8) is available to existing internal testers. Production submission replaces build7, with full rollout to the existing selected countries and managed publishing off. Google’s quick checks completed; build8 is under Changes in review. Approval is still required for public release. The unrelated Open Testing resume draft remains unsubmitted.
- Android’s two nonblocking warnings concern missing deobfuscation/debug symbols. Minification is disabled; bundled third-party native crash symbols remain unavailable.
- iOS1.0(13) uploaded successfully and is assigned to the existing Internal Testers and iPhone Testers groups. It replaced build12 in the App Store submission at 6:19 PM local. Apple confirmed “1 Item Submitted”; automatic release after approval remains selected. [Submission](https://appstoreconnect.apple.com/apps/6813588770/distribution/reviewsubmissions/details/3f2aa639-5fc5-4eb9-a5a0-a5f78845cce3). Reviewer credentials and the accurate build10 walkthrough attribution were preserved; review notes now identify build13.

Community source-payload limitations, real paid purchase/access/cancellation verification and genuine upcoming-event details remain tracked in [production-priorities.md](production-priorities.md).
