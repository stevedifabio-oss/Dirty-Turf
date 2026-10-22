# Apple migration release preparation

Prepared during the 22 October readiness audit. **Draft only: nothing submitted, uploaded or sent.**

## Verified distribution

- Public submission build 15 is Rejected. The recorded issues are UGC consent/walkthrough, business-model information, and Android references in Apple metadata.
- TestFlight build 16 is Testing for the existing Internal Testers and iPhone Testers groups. This does not establish public App Store approval.
- Source version 17 is reserved locally. It has not been packaged, signed, installed, uploaded or reviewed in this session.

## Business-model facts for the owner to review

Use these facts to answer Apple's exact questions in App Store Connect; do not submit an unrelated generic response or claim a policy exemption has been approved.

1. Dirty Turf Academy serves turf-cleaning operators and members with training, an operator community, events and field tools. Eligible existing members retain their approved free Community and current Academy access.
2. The website offers a $39.99/month membership. Optional course and measuring access are separate. The current live measuring price is $29.95/month; the proposed $10/month price is for **new purchases after the reviewed price change**, with existing subscriptions unchanged.
3. The iPhone source presents existing account access. Native purchase controls, external checkout links and the billing portal are disabled. Web Stripe purchases are a separate path; do not claim the absence of an in-app button by itself resolves all purchase-policy requirements.
4. Paid benefits include digital training/community access and software tools used in the app. Website, GHL build-out, SEO/AEO and advertising-management services are web-only offers in the proposed release. These different benefit types must be described accurately rather than all called physical services or reader content.
5. The reusable reviewer account must have the required access without purchasing or relying on magic-link email receipt. Verify the saved email/password on the exact intended build before submission, then enter them only in Apple's secure review fields. Do not put credentials in this document, Git or a screen recording.

## Policy decision still required

Apple's current guidance distinguishes reader content, multiplatform digital features and limited free companion-tool cases. Those categories have different purchase requirements. **Inference for this app:** a mixed course/community/measuring product should not assert reader-app or companion-tool eligibility merely because Stripe checkout is hidden. Resolve Apple's business-model questions and any required purchase approach before promising public release. See [Apple App Review Guidelines, section 3.1](https://developer.apple.com/app-store/review/guidelines/) and [reader-app eligibility](https://developer.apple.com/support/reader-apps).

## Exact physical-device recording to prepare

Record the final intended iPhone build on a physical iPhone. This audit's synthetic browser evidence is not a replacement.

1. Show the app version/build, then its signed-out welcome screen.
2. Open Terms and Community Rules before signing in; show the objectionable-content prohibition and reporting/blocking explanation. Close the reader and explicitly agree as the account owner.
3. Sign in using the review account without exposing the password or sign-in link in the recording.
4. Open Academy and representative content. Demonstrate the fields/tools relevant to the submitted feature list, including appropriate permission denial/recovery where practical.
5. With separately authorized controlled content/accounts, show the actual post/comment report flow and member block flow, then the resulting view and moderator receipt. Do not report a real member as a test or alter their access.
6. Close/reopen the app and confirm retained login. Record the device model, OS, build and result privately.

Before resubmission, attach the approved recording, answer the exact business-model questions, use the corrected iPhone/iPad-only metadata, verify reviewer access, and confirm the uploaded artifact matches the approved frontend. Publishing/upload approval remains a separate step.
