# Release status — September 29, 2026

## Google Play — verified in the signed-in console

- Internal testing is active. **1.0 (6), Native login and session fix**, is available to internal testers; released September 26.
- Production track marks **1.0 (5), Member sign-in update**, rejected. Policy status lists a September 28 rejection: reviewers could not sign in with the supplied credentials. The issue detail says a previous version remains available on Google Play; this does not mean build 5 is approved.
- Publishing overview also lists build 5 under changes in review. Treat this as unresolved/resubmitted review activity; the policy rejection is still present. An open-testing resume change is separately not submitted.
- Saved the dedicated Google reviewer entry as **Dirty Turf App Review** with corrected instructions of **372/500 characters**. Reload confirmed the saved entry includes username, password and instructions. Preserved the supplied credentials. Correction to earlier notes: browser inspection hid the credential values, but the visible counters showed the fields populated; absence of readable values was not evidence they were empty. No password was reset, and successful password sign-in has not been verified in this pass.
- Read-only backend checks confirmed the dedicated reviewer identity is email-confirmed, has a password, is an active member with an unexpired manual community grant, and can qualify for the published open-access Academy course. This does not prove password sign-in on the installed build.

## Android next candidate — local only

Signed **1.0 (7)** at `android/app/build/outputs/bundle/release/app-release.aab`.

- Package `com.dirtyturf.academy`; embedded version verified.
- Bundle validation passed; signature matches the existing protected upload key.
- All 49 web assets match the local web build.
- SHA-256: `395622a50aad9d7435c52f4f12b7d718a983167eae05f7bd40d5ca98588ef307`.
- Includes the pending pricing UI, course refresh and email-related frontend changes. Backend services and activation switches remain separate release work.
- Not uploaded, submitted, installed on a phone, or published.

## Apple — verified after owner sign-in

App Store Connect shows **iOS 1.0 (10), Waiting for Review**, submitted September 25 at 3:52 PM. Submission `2d48a399-2dbb-4817-9eae-ec91e6bdef40` includes the physical-iPhone walkthrough response and recording. It has not been approved.

TestFlight: build **11** upload completed September 26, is **Ready to Submit**, assigned to Internal Testers, with one install shown. Build **10** is **Testing**, assigned to Internal Testers and iPhone Testers, with two installs shown. The App Store review still selects build 10; no selection or submission was changed.

Local iOS source is **1.0 (11)** and the simulator app matches the local web entry. There is no signed IPA/archive in this worktree. No Apple build was uploaded or changed during this pass.

## Remaining work

1. Verify the saved reviewer credentials on the intended release candidate and send the appropriate Google review changes; saving the entry alone does not resolve the rejection.
2. Apple build 10 remains waiting for review. Prepare the newer Apple binary separately before any intentional replacement; local changes sharing build number 11 are not identical to the September 26 uploaded build.
3. Finish course entitlement mapping and the Stripe backend/webhook runtime setup; verify payment/access behavior before enabling sales.
4. Complete the pending GitHub release when its hold is lifted. GitHub triggers Netlify automatically. No manual Netlify deployment is needed.

No store submission, customer message, payment, production database write, GitHub push or app deployment occurred during this pass. Stripe Google Pay and portal privacy-link configuration were saved live.

Google reviewer text limit: maximum 500 characters. The corrected 372-character instructions were saved and verified after reload; no review submission was sent during this correction.
