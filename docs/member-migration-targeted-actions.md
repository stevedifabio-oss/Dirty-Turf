# Targeted member account preparation

Prepared locally on October 22, 2026. This document does not authorize deployment,
account creation, changes to access, or sending messages.

The `academy-invite-members` upgrade separates silent account preparation from
sign-in email delivery. It changes no membership eligibility, grants, courses,
subscriptions or billing. Review the exact source roster and approved cohort
before selecting anyone; an active imported row alone does not establish approval.

## Review before executing

1. Use `action: "preview"` with `previewAction: "provision"` or `"notify"` to obtain
   a read-only candidate inventory. A request without member IDs selects nobody
   and returns no execution token. An administrator session is required.
2. Select the exact `academyMemberIds` to review. Preparation accepts at most 50;
   sign-in emails accept at most 25. The server returns each selected member's ID,
   name, email and invite state. Resolve every blocked row; do not substitute
   someone else to fill a batch.
3. A safe complete selection returns a signed `previewToken` and
   `previewExpiresAt`. The preview lasts ten minutes and binds the administrator,
   community, action, exact selection, source/account state, resend choice and
   approved redirect. It does not authorize an announcement or grant access.
4. Only after separate authorization, submit the same exact member IDs and token
   with `action: "provision"` or `"notify"`. Missing, changed, consumed or expired
   previews fail closed. Review a fresh preview before another attempt.
5. Refresh the app export and migration audit after account preparation. Test the
   actual member experience and deliver an approved announcement separately.

Silent account preparation may create and link the selected Auth identity and a
workspace. It sends no email. Notification requires an already prepared,
unrestricted identity and sends a login link without creating an account.
Already signed-in members and previously sent emails are not silently resent.
The optional explicit resend API flag still requires a new reviewed preview.

## Concurrency and failure handling

The server consumes the reviewed invitation version before Auth or email side
effects. A simultaneous request cannot claim the same invitation version twice.
It rechecks the active member and Auth identity, prevents identity reassignment,
and preserves a cancellation or changed invitation rather than overwriting it.

If delivery succeeds but the result cannot be saved because the invitation
changed, the result is a failure requiring review; it is never reported as a
confirmed successful send. Network failures can leave uncertain email delivery.
Review delivery and account state before an explicitly authorized retry. This is
not a replacement for a durable campaign ledger or a mass-email system.

An email attempt persists a delivery-review hold before contacting Auth.
Provider errors, a missing success receipt or an interrupted process cannot
become a normal automatically retryable row. A new normal send preview and
account preparation both return `email_delivery_outcome_requires_review` until
delivery is reviewed. A separately authorized resend needs `resend: true` in both
its fresh preview and execution. The app does not expose that resend option.

## Release checks

- Deploy the endpoint and matching member-selection UI together after approval.
  The old whole-community action is intentionally incompatible with mutations.
- Verify `APP_URL`/redirect allowlisting and the configured authentication email
  provider before an authorized pilot. No API key belongs in the browser.
- Run planner, actual entry-point boundary, migration audit and UI regression
  tests. A local harness does not prove live email delivery or installed-device
  onboarding.
- Keep the eligibility review, billing reconciliation, device pilot, support
  receipt, history acceptance and changeover approval gates from the launch pack.
