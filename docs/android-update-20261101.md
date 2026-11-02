# Android update preparation — November 1, 2026

Candidate: Dirty Turf Academy 1.0.1 (13), package com.dirtyturf.academy.

This candidate starts from published canonical main f1f1d7e3b20fa28464d746940575b58f98c22ff1 and restores the Android AR flags/yellow live measuring line and saved-session foreground refresh from the earlier prepared candidate. It includes the latest shared sign-in/profile, owner-only member access, course editor and Turf Scanner property inspections/photos. Native purchase restrictions, workspace isolation and held billing/push activation remain intact. Web-only marketing services retain their existing native boundary.

Google Play's refreshed latest-bundles inventory still shows code 12 as highest on November 1; code 13 is unused at this checkpoint. Recheck before upload. Steve's Fold6 is connected and authorized; the installed production package remains 1.0 (12), alongside the separate pushpreview app.

The original dirty-turf-upload keystore and password are available locally. Its alias is dirty-turf-upload; certificate SHA-1 is 5F:0D:7A:96:E5:FF:CA:22:CA:4F:41:6D:46:96:BC:91:A1:4B:69:12 and SHA-256 is F3:98:3D:1C:21:C3:75:52:CC:B5:68:18:B1:9E:8D:F0:4B:71:B1:4C:75:BA:76:CD:AE:85:19:81:48:89:0C:22. These match the original Google Play upload certificate and recorded release runbook. Passwords are passed only through the signing process environment, never command-line arguments, source or logs.

The pending replacement certificate is 22:FA:89:4D:69:61:35:AA:A5:13:B3:D4:65:D8:F2:2E:64:A3:43:D2:65:A2:4E:47:6C:7F:4E:CC:0D:0E:8D:DA, scheduled for November 3, 2026 at 3:59 PM Arizona time. The reset has not been cancelled. Play acceptance must confirm whether the original key is usable during this pending period; a certificate match to the historical original alone is not proof of current upload acceptance.

Verification so far: configured production-client native sync and web/Android/iOS asset parity passed, with App and Push Notifications plugins registered. TypeScript, 60 focused auth/session/property tests, secret scan and store metadata checks passed. Signed AAB/APK compilation, native tests/lint and full artifact hash/certificate checks are in progress. Receipts and logs remain ignored under output/release/android-current-20261101.

Use Google Play internal testing for installation onto the existing production app: Play signs delivered APKs with its app-signing certificate, which differs from the upload certificate. Do not uninstall the member's production app or force an incompatible locally upload-signed APK over it. Internal upload, processing, physical acceptance, production review submission and public availability must be recorded separately. No store upload or production submission is claimed by this preparation document.
