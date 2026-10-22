# Dirty Turf member migration plan

Prepared October 3, 2026; revised October 20 after the owner supplied GHL's
development-team response. This is a rollout plan and communication draft.
GHL confirmed that complete native Community synchronization and historical
backfill are not supported by its current public APIs, including Social Planner.
There is no confirmed alternative/beta or availability timeline. See
[the recorded support decision](community-sync.md).

Keep GHL as the main discussion space until Steve can approve a changeover.
Use Dirty Turf for Academy/tools and a controlled Community pilot in the meantime.
Do not promise that activity in the two communities is automatically shared.
The existing guarded browser collector can assist a bounded migration capture;
it depends on this Mac, Codex and signed-in Chrome and is not a permanent sync.

**Destination:** Dirty Turf's own Academy and Community on web, iPhone and Android.
GHL stays in use during the overlap. Agree which history will be imported or
retained as an archive, with missing media and other exceptions recorded. At the
approved changeover, all new community posts/replies move to Dirty Turf. Existing
eligible members keep their approved free Community and whole current Academy
access. The migration does not require them to buy again.

## Preparation completed October 20

- Saved a fresh private inventory of **63 unique visible directory cards**:
  61 contributors and two admins. The directory did not expose membership emails
  or restricted/historical membership coverage in this session. This is an
  inventory for reconciliation, not proof that 63 accounts are ready or eligible.
- Prepared private JSON/CSV owner-review worksheets for those 63 records. Saved
  evidence supplies 59 historical email/identity prefills, one additional old app
  link and three records without an old app link. Historical facts remain marked
  stale/unverified; all fresh confirmation and approval fields are blank.
- Prepared the [pilot and communication launch pack](member-migration-launch-pack.md)
  and a [local tracker/preparation generator](member-migration-readiness.md#prepare-the-rollout-package).
  Neither sends invitations nor changes accounts, access or billing.
- Checked the connected Supabase account: Dirty Turf's project is absent from
  its project list and its database read was denied. A fresh SELECT-only app
  export still needs an authorized project owner/admin session.
- Reviewed the saved history: the last accepted catalog is October 6, with five
  unresolved video/media holds. It is not a current or complete media archive.
  Steve must choose required copies versus a protected archive and accept or
  resolve exceptions before changeover.
- Preserved 45 saved JSON payloads, including the 29 original ordered import
  batches and accepted 142-record historical baseline, in a private dated local
  archive. Extraction and hashes were verified. It does not include the five
  missing videos or prove an off-device backup/full app restore. The original
  archive's older acceptance-hash mismatch remains documented for review.

Next evidence: exact membership emails/statuses and source identity proof, the
fresh app export, and Steve's approved existing-free cohort. Keep private member
worksheets outside Git. Complete the device pilot and agree the history treatment
before choosing the final date or sending announcements.

## Recommended sequence

| Stage | What happens | Exit requirement | Owner |
| --- | --- | --- | --- |
| Prepare | Refresh the exact group roster, reconcile accounts/access, agree historical import/archive scope | Every eligible account ready; required history verified or exceptions explicitly accepted | Build team; Steve resolves membership/history exceptions |
| Pilot | Steve, the owner, a moderator and 3–5 members try web, iPhone and Android | Login, retained sessions, access and discussions pass | Build team and pilot members |
| Invite | Branded announcement and waves of up to 25 members | Delivery/access problems assigned and resolved | Build team prepares; owner authorizes sending |
| Changeover | Complete the agreed final history capture/archive and direct new discussions to Dirty Turf | Required history reconciled; Steve approves one posting destination | Steve and build team |
| Support | Help remaining members sign in; retain source archive and GHL read access where available | Recovery period completed; hosting/email dependencies checked | Steve and build team |

Allow approximately **14 days between the first full invitation wave and the
changeover**, once readiness checks pass. This is a recommended member transition
window, not a promise that unfinished integration work will take 14 days. Keep a
recommended **30-day recovery period** afterward. Choose actual dates after the
pilot, member readiness and agreed historical treatment pass. A full automatic
GHL Community mirror is not an exit requirement because GHL does not support it.

## 1. Prepare all eligible members

- Take a fresh roster of the exact **7 Figure Turf Cleaning** group. Reconcile
  source member/contact IDs, verified email, status, role, enrollment and access
  against the app. Preserve members added directly to the app.
- Use the current roster as the total. Earlier project notes recorded 60 initial
  source emails, then 62 active linked accounts and one cancelled historical
  author. Those are dated observations, not today's confirmed member count.
- Prepare one correctly linked account per eligible person. Review duplicate
  emails, missing emails and conflicting identity links. Before authorized silent
  provisioning, reconcile the exact execution queue: the existing endpoint has
  no member-ID filter, and its count-only preview uses a different selection rule
  from provisioning. A batch limit cannot select the pilot or prove who will be
  processed. Independently verify the full queue or add reviewed exact targeting
  before execution; then re-export and audit the resulting accounts.
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
- Inventory the agreed Community history: source authors, posts, comments,
  reply parents and media. For content being copied, use complete guarded reads
  and replay checks to prevent duplicates or historical notification replay.
  A missing record must be reviewed rather than deleted. Explicitly record
  unsupported videos and deletion, reaction, RSVP or membership coverage; obtain
  Steve's decision on retention/deferred copies before promising completeness.

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
- Any assisted historical import must preserve those app-created records. During
  the pilot, GHL remains the main community. Explain that neither community is a
  real-time copy of the other and that app pilot posts do not copy back to GHL.
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
We'll preserve the agreed existing history and explain any archive or media
exceptions before the move.

Need help? Email **hello@dirtyturf.com** with your membership email, device and
what happened. You do not need to send your password or sign-in link.

— Dirty Turf Academy

## 4. Final changeover and recovery

Approve the move only when every eligible account is prepared, pilot checks pass,
the agreed historical import/archive is verified, invitation failures are resolved
and no critical login/access issue remains open. A provisioned account is ready
for a dormant member to return later; every member need not log in on the same day.
Resolve recorded historical reaction, RSVP, deletion and progress limitations or
obtain Steve's explicit acceptance of their documented treatment before cutover.
Missing required posts/replies must be recovered or explicitly accepted as a
documented history exception. Incorrect member access must be fixed before moving.

At the agreed time, pause new GHL Community posts/comments only if a verified
supported control permits it; otherwise Steve must direct members to stop posting
there and use the approved move notice. Complete the agreed bounded final
capture/archive, reconcile copied IDs/counts/media and spot-check threads.
Publish the move notice only after sending/publication is authorized, and direct
all new discussions to the app. If required history or access checks fail, keep
GHL as the posting destination and postpone the move. Do not keep promising a
live mirror during the overlap.

Keep a protected archive and GHL read access where supported during the recovery
period. Do not delete source content. If rollback is needed, preserve/export new
app activity too; the one-way bridge does not return it to GHL automatically.

Community changeover does not require ending GHL course authoring. Courses may
continue updating from GHL through their existing reader. Before retiring any GHL
service, check course API access, original media hosting, CRM, email delivery and
billing dependencies. Confirm retirement separately with Steve.

## Text to send Steve

> Steve, GHL confirmed it can't automatically sync native community posts and
> replies into our app. We'll keep discussions there until the move is ready.
> First we'll verify member accounts and free access, test with 3–5 members,
> preserve the agreed history, then announce one date to move new discussions
> into Dirty Turf. Existing approved members keep free Community and the whole
> current Academy. Please review the prepared member list, confirm emails and
> anyone who should be restricted, pick 3–5 testers, and tell us which old
> posts/videos must be copied. We'll agree the switch date after testing. Please
> leave GHL running until then.

## Evidence and implementation references

- [Migration archive, identity and progress rules](highlevel-live-and-native-migration.md)
- [Community bridge proof and remaining acceptance](community-sync.md)
- [Recorded member readiness and pricing decisions](production-priorities.md)
- [Provisioning and notification implementation](../supabase/functions/academy-invite-members/index.ts)

This plan was checked against project documentation and current local code. It
does not represent a fresh live roster/store audit or a completed member rollout.
