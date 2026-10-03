# October 3 measurement and reviewer-access fixes

## Measurement editing

The shared number control converted every keystroke with `Number()`, so deleting
the final digit immediately reinserted zero. The replacement preserves the text
being edited separately from the numeric calculation. Length, width, measured
area, and service price now allow blank edits and incomplete decimals. Decimal
commas work on mobile keyboards. AR results still replace the field externally.

Nine focused regression cases pass; the complete check passes 422 tests across
56 files, plus secret/schema/store/type/build/PWA checks. Browser verification
confirmed that two backspaces clear `38` completely; `12.5 × 8` gives 100 sq ft
and a `0,72` rate gives $72.00. Physical-device verification remains separate.

## Reviewer access

Google rejected the September 29 production submission for login access on
October 2. On October 3 the existing dedicated reviewer password in macOS
Keychain successfully authenticated against production; email was confirmed and
membership active. It had Academy and Community access but no measuring-tool
grant after pricing was enabled. A scoped manual measuring-tool grant was
restored for that reviewer only. No administrator privileges or other member
access were changed, and no password was reset.

The new release probe checks fresh password authentication, the effective access
response, course/community reads, measuring-tool access, absence of management
privileges, and logout of only its own probe session. All nine checks passed:

```sh
REVIEWER_EMAIL=app-reviewer@dirtyturf.com \
REVIEWER_KEYCHAIN_SERVICE='Dirty Turf App Review' \
node --env-file=.env.production.local scripts/check-reviewer-access.mjs
```

Alternatively provide `REVIEWER_PASSWORD` securely through the environment.
Never put passwords or tokens in commands, logs, the repository, or review notes.
The Google Play password field is masked to browser automation. Its stored
password still needs to be matched to the verified Keychain item before a new
production submission. Updated reviewer instructions are prepared at 368/500
characters. Backend success alone does not verify Google's stored credential.

## Native candidates

Android 1.0 (9) and iOS 1.0 (14) contain the measurement fix. All 49 frontend
files match across web output, Android APK/AAB, and exported iOS IPA. Android's
registered upload certificate and iOS distribution signature were verified.
Local artifacts do not establish store review approval or installed-device use.

## Community

Posting in the app writes to its shared community for web/iPhone/Android. It does
not publish back into GHL. Native GHL create notifications remain captured for
mapping, not automatically applied, because the verified source notifications
lack stable post/comment/reply identities. See `community-sync.md` for the exact
source-interface blocker and the support request draft. Do not call this a
working automatic community mirror.
