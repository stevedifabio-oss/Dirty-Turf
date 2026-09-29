# Release status — September 29, 2026

## Google Play — verified in the signed-in console

- Internal testing is active. **1.0 (6), Native login and session fix**, is available to internal testers; released September 26.
- Production track marks **1.0 (5), Member sign-in update**, rejected. Policy status lists a September 28 rejection: reviewers could not sign in with the supplied credentials. The issue detail says a previous version remains available on Google Play; this does not mean build 5 is approved.
- Publishing overview also lists build 5 under changes in review. Treat this as unresolved/resubmitted review activity; the policy rejection is still present. An open-testing resume change is separately not submitted.
- The existing sign-in-details entry is named for Steve. Its editor opened with empty username, password and extra-information fields. Prepared a dedicated review-account email and password-login instructions in the editor, but **did not save** because the reusable password is missing. The editor is left open for the owner. No reviewer password was reset.
- Read-only backend checks confirmed the dedicated reviewer identity is email-confirmed, has a password, is an active member with an unexpired manual community grant, and can qualify for the published open-access Academy course. This does not prove password sign-in on the installed build.

## Android next candidate — local only

Signed **1.0 (7)** at `android/app/build/outputs/bundle/release/app-release.aab`.

- Package `com.dirtyturf.academy`; embedded version verified.
- Bundle validation passed; signature matches the existing protected upload key.
- All 49 web assets match the local web build.
- SHA-256: `395622a50aad9d7435c52f4f12b7d718a983167eae05f7bd40d5ca98588ef307`.
- Includes the pending pricing UI, course refresh and email-related frontend changes. Backend services and activation switches remain separate release work.
- Not uploaded, submitted, installed on a phone, or published.

## Apple — current review status not verified

App Store Connect is signed out. The app record is `6813588770`; the open tab points to a review submission but cannot show its status until the owner signs in. Prior upload evidence is not current approval evidence.

Local iOS source is **1.0 (11)** and the simulator app matches the local web entry. There is no signed IPA/archive in this worktree. No Apple build was uploaded or changed during this pass.

## Remaining work

1. Enter the dedicated reviewer password in the prepared Google editor, verify sign-in on the release candidate, then save reviewer details and resolve the rejection with the intended build.
2. Sign in to App Store Connect; inspect the current review message and selected build before preparing the next signed Apple release.
3. Finish course entitlement mapping and the Stripe backend/webhook runtime setup; verify payment/access behavior before enabling sales.
4. Complete the pending GitHub release when its hold is lifted. GitHub triggers Netlify automatically. No manual Netlify deployment is needed.

No store submission, customer message, payment, production database write, GitHub push or app deployment occurred during this pass. Stripe Google Pay and portal privacy-link configuration were saved live.
