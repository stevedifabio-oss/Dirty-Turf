# Dirty Turf member migration plan

Prepared October 3, 2026; readiness tooling updated October 5. This is a rollout
plan and communication draft. A guarded temporary Community bridge is built;
the remaining source holds, current member reconciliation and installed-device
pilot must pass before the full member move. The bridge depends on this Mac,
Codex and Steve's signed-in Chrome session being available.

**Destination:** Dirty Turf's own Academy and Community on web, iPhone and Android.
GHL stays in use during the overlap. Its activity flows one way into the app until
the agreed Community changeover. Existing members keep their free Community and
whole current Academy access. The migration does not require them to buy again.

## Recommended sequence

| Stage | What happens | Exit requirement | Owner |
| --- | --- | --- | --- |
| Prepare | Refresh the exact group roster, reconcile accounts/access, finish the Community bridge | Every eligible account ready; content catch-up proven | Build team; Steve resolves membership exceptions |
| Pilot | Steve, the owner, a moderator and 3–5 members try web, iPhone and Android | Login, retained sessions, access and discussions pass | Build team and pilot members |
| Invite | Branded announcement and waves of up to 25 members | Delivery/access problems assigned and resolved | Build team prepares; owner authorizes sending |
| Changeover | Briefly stop GHL Community writes and import the final changes | Content reconciled; Steve approves new posting destination | Steve and build team |
| Support | Help remaining members sign in; retain source archive and GHL read access where available | Recovery period completed; hosting/email dependencies checked | Steve and build team |

Allow approximately **14 days between the first full invitation wave and the
changeover**, once readiness checks pass. This is a recommended member transition
window, not a promise that unfinished integration work will take 14 days. Keep a
recommended **30-day recovery period** afterward. Choose actual dates after the
pilot and source bridge pass.

## 1. Prepare all eligible members

- Take a fresh roster of the exact **7 Figure Turf Cleaning** group. Reconcile
  source member/contact IDs, verified email, status, role, enrollment and access
  against the app. Preserve members added directly to the app.
- Use the current roster as the total. Earlier project notes recorded 60 initial
  source emails, then 62 active linked accounts and one cancelled historical
  author. Those are dated observations, not today's confirmed member count.
- Prepare one correctly linked account per eligible person. Preview first, then
  silently provision missing accounts in batches of up to 50, and preview again.
  Review duplicate emails, missing emails and conflicting identity links.
- Freeze the approved existing-member cohort that keeps free Academy/Community
  access. Check moderator/owner roles and extra purchased access separately.
  Members joining during the overlap follow their actual existing/new paid access
  rules; they must not automatically become grandfathered free members. Keep
  cancelled/suspended members restricted and historical author attribution intact.
  Reconcile existing billing agreements before introducing any replacement
  subscription, so migration cannot charge someone twice. The measuring-tool
  subscription remains a separate optional entitlement.
- Run the [private member-readiness audit](member-migration-readiness.md) with a
  fresh complete exact group roster, a fresh app export and the approved free
  cohort. Resolve its identity, account, access and billing exceptions before
  provisioning or inviting. The audit reads local evidence and never creates
  accounts, changes grants, charges members or sends messages.
- Preserve native lesson completions and imported course percentage progress.
  Do not turn a percentage into invented lesson completions or certificates.
- Verify a full Community catch-up: all pages, source authors, posts, comments,
  reply parents, edits and media. Repeat it to confirm no duplicates or historical
  notification replay. A missing record must be reviewed rather than deleted.
  Record unresolved deletion, reaction, RSVP or membership coverage explicitly.

Maintain a private rollout tracker with: member identity, eligibility, account
ready, access checked, announcement delivery, first successful app sign-in,
problem/assigned owner and resolution. Keep account preparation, message delivery
and successful onboarding as distinct states. Previously recorded sign-ins do not
prove completion of this migration campaign.

## 2. Pilot before the full announcement

Use the actual builds intended for members. On web, an iPhone and an Android:

- Open/install the app, enter the existing membership email and request a fresh
  sign-in link. Tap it on the same device and confirm the correct account opens.
- Close and reopen the app, then reopen the following day to check retained login.
- Open Academy lessons and downloads, verify progress and free member access,
  then make an authorized pilot post/reply and confirm its correct author/thread.
- Check GHL catch-up preserves those app-created records. During the pilot, GHL
  remains the main community; explain that app posts do not copy back to GHL.
- Verify restricted accounts cannot regain access and ordinary members cannot
  use moderator controls.
- Confirm `hello@dirtyturf.com` receives replies and assign a support owner
  before including it in invitations. Recommended: Steve or his confirmed
  delegate handles membership questions; the build team handles technical issues.

Verify public App Store and Google Play availability before including public
download links. TestFlight/internal testing is pilot distribution. If either store
is still pending, members can use the web app while that release is completed.

## 3. Invite and support everyone

Send a **durable migration announcement**, using the existing Dirty Turf logo,
green palette, branded email typography and support address. Its main button
links to **https://app.dirtyturf.com/**. Insert store links only after they are
verified. The announcement should include the agreed posting changeover date.

The existing `academy-invite-members` notification action sends a login email;
it is not the full migration announcement. Members should open/install the app
first, then request their own fresh link. Magic links are single-use and expire;
see [Supabase's passwordless sign-in documentation](https://supabase.com/docs/guides/auth/auth-email-passwordless).

- Send the announcement in reviewed waves of up to 25 after sending is authorized.
  Check the first wave's inbox delivery and support issues before continuing.
- Send a reminder around day 3 and day 7 only to members who still need onboarding,
  using reliable campaign sign-in records and existing communication preferences.
- Resolve bounced mail, changed emails and access errors individually. Follow up
  personally only when the owner authorizes that contact.
- Refresh the source roster before every wave and just before changeover so new
  eligible members are included under the correct free/paid policy and cancelled
  access is respected. Member sync is a separate reconciliation task until its
  source adapter is validated.

### Member announcement draft — send after readiness passes

**Subject:** Your Dirty Turf Academy access is moving to our new app

Hi [First name],

We're moving the Academy and Community into the Dirty Turf app. Your existing
Community and current Academy access stays free, and your account will use the
same email address you use now.

1. Open https://app.dirtyturf.com/ on your phone or computer.
2. Enter your current Academy membership email.
3. Select **Email me a sign-in link** and open the latest email on that device.
4. Open Academy to access your training.

Continue posting in the current GHL Community until **[confirmed changeover
date]**. From that date, use Community in Dirty Turf for all new posts and replies.
We'll copy the final changes across before the move.

Need help? Email **hello@dirtyturf.com** with your membership email, device and
what happened. You do not need to send your password or sign-in link.

— Dirty Turf Academy

## 4. Final changeover and recovery

Approve the move only when every eligible account is prepared, pilot checks pass,
the source catch-up succeeds repeatedly, invitation failures are resolved and no
critical login/access/content issue remains open. A provisioned account is ready
for a dormant member to return later; every member need not log in on the same day.
Resolve recorded historical reaction, RSVP, deletion and progress limitations or
obtain Steve's explicit acceptance of their documented treatment before cutover.
Missing posts/replies or incorrect access must be fixed before moving members.

At the agreed time, pause new GHL Community posts/comments using a verified
supported control. Capture the final changes, apply guarded deltas, reconcile
IDs/counts/media and spot-check representative threads. Then publish the approved
move notice in GHL and direct all new discussions to the app. If the final capture
or checks fail, keep GHL as the posting destination and postpone the move.

Keep a protected archive and GHL read access where supported during the recovery
period. Do not delete source content. If rollback is needed, preserve/export new
app activity too; the one-way bridge does not return it to GHL automatically.

Community changeover does not require ending GHL course authoring. Courses may
continue updating from GHL through their existing reader. Before retiring any GHL
service, check course API access, original media hosting, CRM, email delivery and
billing dependencies. Confirm retirement separately with Steve.

## Text to send Steve

> Steve, the plan is to move everyone into Dirty Turf's own app community. We'll
> keep GHL running during the transition while we copy its activity into the app.
> First we'll refresh everyone's accounts and free existing-member access,
> finish the Community catch-up process, and test a small group on iPhone,
> Android and web. Then we'll invite everyone using their current email and
> allow about two weeks for the move. We'll pick one changeover date, copy the
> final GHL changes, and direct all new posts and replies to Dirty Turf. We'll
> retain a recovery copy and help anyone who hasn't signed in yet. Existing
> members won't need to pay again for access they already have. Course updates are
> running; full automatic Community catch-up is the main remaining launch gate.

## Evidence and implementation references

- [Migration archive, identity and progress rules](highlevel-live-and-native-migration.md)
- [Community bridge proof and remaining acceptance](community-sync.md)
- [Recorded member readiness and pricing decisions](production-priorities.md)
- [Provisioning and notification implementation](../supabase/functions/academy-invite-members/index.ts)

This plan was checked against project documentation and current local code. It
does not represent a fresh live roster/store audit or a completed member rollout.
