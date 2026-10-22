# Dirty Turf member migration launch pack

**DRAFT — prepared October 20, 2026 for owner review. Nothing in this pack has
been sent, published or executed.** Checkboxes and evidence fields below are
pending; this document does not establish live readiness or store availability.

Use with the [migration plan](member-migration-plan.md) and
[private readiness audit](member-migration-readiness.md). The recorded
[GHL support decision](community-sync.md) confirms that its current public APIs
cannot provide complete native Community synchronization or historical backfill.
During preparation and the pilot, **GHL remains the main discussion space**.
Steve must approve the date when all new posts and replies move to Dirty Turf.
Activity does not automatically copy between the communities.

Existing eligible members keep their approved free Community access and the
whole current Academy. Migration must not require another membership purchase
or create a second subscription. The optional measuring tool remains a separate
entitlement. Do not send the free-member drafts below to members whose eligibility
or billing treatment is unresolved.

## 1. Owner decisions to complete

Record approvals in the private rollout tracker. Keep member emails, account IDs,
billing evidence and private archive locations outside Git.

| Decision | Ready-to-complete request | Approval record |
| --- | --- | --- |
| Pilot members | Steve selects 3–5 members, with their exact membership emails supplied privately. Include ordinary members across iPhone, Android and web; also include Steve, the owner and a moderator. | [pilot names and private roster reference; approving owner] |
| Existing free cohort | Confirm the exact membership emails and which existing members retain free Community and the whole current Academy; confirm current course IDs and the treatment of late joiners, changed emails, duplicates, cancelled/suspended members and other exceptions. The visible directory alone does not establish this roster. | [approved cohort reference/date; exception decisions] |
| Billing | Reconcile existing GHL/source membership agreements and app entitlements before any replacement subscription. Resolve duplicate-charge risks; retain legitimate separate tool purchases. | [billing reviewer; reconciliation evidence and decisions] |
| Community history | Choose which posts, replies and media must appear in the app and which remain in a protected archive. Explicitly accept any missing video/attachment, author/parent, reaction, RSVP or deletion limitations. | [required history scope; archive plan; accepted exceptions] |
| Support | Confirm the person handling membership questions, the technical escalation owner and that the chosen reply inbox receives replies. Verify `hello@dirtyturf.com` before using it. | [membership support owner; technical owner; tested support address] |
| Timing | Choose a readiness-based invitation schedule and changeover date after audit, pilot and history acceptance. The migration plan recommends about 14 days from the first full invitation wave to changeover and a 30-day recovery period; these are planning windows. | [invitation start; changeover date/time/timezone; recovery end] |
| Communication approval | Review the exact recipients, final copy, links and history summary. Authorize each announcement/reminder wave and GHL notice before sending or publishing. | [approver; approved copy/version; wave authorization] |

Do not retire GHL services as part of Community approval. Course authoring/API
access, original media hosting, CRM, email and billing dependencies need a
separate decision before retirement.

## 2. Pilot packet

### Preparation gate

- [ ] Obtain complete fresh snapshots of the exact **7 Figure Turf Cleaning**
  Community roster and the app, following the readiness audit's scope, pagination,
  freshness and private-storage rules. Include restricted/historical source members
  where available; preserve app-only members.
- [ ] Run the read-only readiness audit against the separately approved free
  cohort. Record [private report reference and reviewer]. Resolve identity,
  account, role, access and billing exceptions. Snapshot readiness alone does not
  pass the device or launch gates.
- [ ] Record [required Academy courses/content] and [agreed Community history
  scope and exceptions]. Preserve existing app activity, progress and moderation
  in any later guarded history application. Do not infer deleted content from
  missing source records.
- [ ] Confirm [pilot participants], [pilot coordinator], [support owner] and
  [support inbox receipt evidence]. Use authorized pilot accounts and agreed test
  content; record evidence privately.
- [ ] Identify the actual member-facing web deployment and installed iPhone and
  Android builds. A local browser pass, binary build or store submission alone
  cannot pass installed-device acceptance.

### Build and distribution record

Complete this record before testing; do not copy old release status into it.

| Surface | Exact artifact and device | Distribution proof | Reviewer/result |
| --- | --- | --- | --- |
| Web | [live URL; deployed revision/build; browser/version; device] | [authenticated route opens for eligible member] | [reviewer; date; evidence; pending/pass/fail] |
| iPhone | [device/iOS; app version/build; tested artifact reference] | [verified public App Store listing OR authorized TestFlight pilot route] | [reviewer; date; evidence; pending/pass/fail] |
| Android | [device/Android; app version/build; tested artifact reference] | [verified public Google Play listing OR authorized testing route] | [reviewer; date; evidence; pending/pass/fail] |

**Public store link gate:** independently verify that each public listing is
available to intended members and installs the intended release before adding
its link to member copy. TestFlight and internal testing links are pilot routes.
If a public release is pending, use the verified web route and explain that
option; do not describe a testing build as a public release.

### Execute on web, a physical iPhone and a physical Android

For each row, record actual results separately for all three surfaces. Use
`pending`, `pass` or `fail` with [reviewer/date/private evidence]; a blank field
does not pass. Retest a failed row on the final intended artifact after a fix.

| Check | What must be demonstrated | Web | iPhone | Android |
| --- | --- | --- | --- | --- |
| Fresh login | Open/install first, use the exact membership email, request a fresh sign-in link and open the latest email on that same device. The correct account opens. An expired/used link gives a recoverable path to request a new one. | [result/evidence] | [result/evidence] | [result/evidence] |
| Retained login | Close and reopen, return from another app/tab, then reopen the following day. The member retains the correct session and can reach Academy and Community. | [result/evidence] | [result/evidence] | [result/evidence] |
| Free access | Approved existing member can access Community and every included current Academy course without a new membership checkout. Separately purchased tool access follows its entitlement. | [result/evidence] | [result/evidence] | [result/evidence] |
| Lessons and media | Open representative lessons, images, videos and downloads from the agreed content inventory on the actual device. Record inaccessible media and owner-accepted exceptions explicitly. Do not treat asset counts as playback proof. | [result/evidence] | [result/evidence] | [result/evidence] |
| Progress | Previously recorded native lesson completions remain intact. Imported course percentage remains correctly represented; no arbitrary lesson completions or certificates are invented. New authorized completion persists after reopening. | [result/evidence] | [result/evidence] | [result/evidence] |
| Posts and replies | With approved pilot content, create a post, reply and nested reply where supported. Verify the right author, thread and parent, refresh/reopen, and confirm the records persist without duplication. Verify any agreed attachment path. | [result/evidence] | [result/evidence] | [result/evidence] |
| Report and block | Exercise reporting and blocking with agreed pilot accounts/content; verify receipt by the authorized moderation flow and the resulting member experience. Confirm a member can recover from a failed action and is not shown false success. | [result/evidence] | [result/evidence] | [result/evidence] |
| Roles and restricted access | Ordinary members cannot use moderator/admin controls or read private member data. Authorized moderators can handle a pilot report. A controlled cancelled/suspended/restricted account cannot regain protected access through a direct link, refresh or fresh login. | [result/evidence] | [result/evidence] | [result/evidence] |
| Permissions and recovery | Request only permissions needed for the exercised feature. Denying a permission leaves login, Academy and Community usable where the permission is unrelated; provide a recoverable explanation for a blocked feature. Check a brief offline interruption does not falsely confirm a post or erase saved progress. | [result/evidence] | [result/evidence] | [result/evidence] |
| Support route | The member can find the approved support contact; a coordinated test reply reaches the assigned support owner. No password or magic link is requested. | [result/evidence] | [result/evidence] | [result/evidence] |

During this pilot, participants continue ordinary discussions in GHL. Pilot posts
in Dirty Turf are test activity and do not copy back to GHL. Preserve these
app-created records during any later history capture/application.

### Pilot sign-off and full-wave gate

- [ ] Every required row passes on each intended surface; [issue tracker] has no
  unresolved critical login, access or discussion issue.
- [ ] Every eligible account is ready for a returning member, including those
  who have not signed in during the pilot. Required access errors are fixed.
- [ ] Agreed copied history/archive is reconciled and spot-checked; Steve accepts
  [documented exceptions]. No claim of complete media/history is based on counts
  alone.
- [ ] Support route, inbox delivery, final links and final copy are verified.
  Steve approves [changeover schedule] and the owner authorizes [first wave].
- [ ] Send only after authorization, in reviewed waves of up to 25. Check the
  first wave's delivery/access issues before proceeding. Refresh the exact roster
  before each wave and immediately before changeover.

Keep separate tracker states for account ready, announcement delivered, campaign
sign-in completed and support issue resolved. Old Auth sign-ins and accepted
invitation rows do not establish onboarding in this campaign. A login email from
the existing invite action does not replace the durable announcement below.

## 3. Member announcement draft

**Audience:** approved existing free cohort after readiness and sending approval.
Use existing Dirty Turf branding for the final email.

**Subject:** Your Dirty Turf Academy access is moving to our app

Hi [First name],

We're moving the Academy and Community into Dirty Turf. Your approved free
Community access and the whole current Academy carry over. You do not need to
buy another membership. The optional measuring tool is separate.

1. Open **https://app.dirtyturf.com/** on your phone or computer.
2. Enter the email address you use for your current Academy membership.
3. Choose **Email me a sign-in link**, then open the latest email on that same
   device. Request a new link if the earlier one has expired or was already used.
4. Open Academy and check that your training is available.

Keep posting in the current GHL Community until **[approved changeover date,
time and timezone]**. From then, use Community in Dirty Turf for all new posts
and replies. The two communities do not automatically copy activity between
them.

[Approved short history/archive summary, verified access route and any media
exceptions members need to know.]

Need help? Reply to **[verified support address]** with your membership email,
device and what happened. Please do not send your password or sign-in link.

— Dirty Turf Academy

**Optional insertion only after the public store link gate passes:**
“You can also install Dirty Turf for [verified available platform] here:
[verified public store link].” Omit this insertion for an unavailable platform;
the verified web route remains the member option.

## 4. Reminder draft

**Audience:** approved recipients who still need onboarding, using reliable
campaign records and existing communication preferences. Recommended checkpoints
are around day 3 and day 7 after that recipient's announcement; select actual
send times only after the campaign is authorized. Suppress completed sign-ins and
resolve bounced mail or identity changes before retrying.

**Subject:** A reminder to open your Dirty Turf Academy access

Hi [First name],

Please open **https://app.dirtyturf.com/** and request a fresh sign-in link using
your current Academy membership email. Open the latest email on the same device.
Your approved free Community and whole current Academy access carry over; no new
membership purchase is needed.

Keep using the GHL Community for discussions until **[approved changeover date,
time and timezone]**. After that, post and reply in Dirty Turf.

If you've had trouble signing in or finding your training, reply to
**[verified support address]** with your membership email, device and the problem.
Do not forward a sign-in link or password.

— Dirty Turf Academy

## 5. GHL pinned move notice draft

**Publish only when Steve approves the changeover and publication is authorized.**
Before publication, verify whether GHL supports the intended posting restriction.
If it does not, Steve directs members through this notice. Do not imply GHL has
been made read-only without verifying that control.

**Community discussions have moved to Dirty Turf**

From **[approved changeover date, time and timezone]**, please start all new
posts and replies in Community at **https://app.dirtyturf.com/**.

Use your current Academy membership email and request a fresh sign-in link.
Approved existing members keep free Community and the whole current Academy;
you do not need to purchase another membership.

[Approved history/archive access summary and any important exceptions.]

Posts and replies do not automatically copy between GHL and Dirty Turf. Please
use Dirty Turf for new discussions so everyone can follow them in one place.

For help, contact **[verified support address]** with your membership email,
device and the issue. Do not send passwords or sign-in links.

## 6. Fallback and support drafts

### If readiness fails before changeover

Pause pending invitation waves. Keep GHL as the posting destination and preserve
source content. Record [blocking issue, assigned owner and retest evidence].
Steve approves any revised date; authorize a correction to already informed
members before sending it.

**Delay notice draft:**

“We're taking a little more time to finish the Dirty Turf move. Please continue
posting and replying in the current GHL Community. We'll confirm the new posting
date once the remaining checks are complete. If you need help with Academy
access, contact [verified support address].”

### If a material issue appears after changeover

Stop further invitation waves, preserve new app activity and assign technical
support. Steve chooses [one temporary posting destination and effective time]
and approves the member notice. Verify any archive/read access before promising
it. Preserve/export new app discussions before recovery work; they do not copy
back to GHL automatically. Do not delete source content or retire services.

**Temporary direction draft:**

“We're resolving [brief approved description of the issue]. Until [next approved
update time], please use [Steve-approved destination and verified link] for new
posts and replies. [Approved Academy access instructions, if affected.] We'll
confirm when normal posting can resume. Contact [verified support address] if
you need help.”

### Individual support reply draft

“Hi [First name], please open https://app.dirtyturf.com/ and use the exact email
for your Academy membership. Request a fresh sign-in link and open the latest
email on the same device. If the problem continues, tell us your device, whether
you are using the web or installed app, and the error you see. You can send a
screenshot with private information removed. Please do not send your password
or sign-in link. We'll check your account and existing access before suggesting
any purchase.”

Support owners should reconcile changed emails and identities privately, check
the approved free cohort and effective grants, and escalate incorrect access or
duplicate billing before retrying an invitation. Record resolution separately
from email acceptance or first sign-in.

## 7. Simple text to Steve — draft, not sent

> Steve, GHL confirmed it can't automatically sync native community posts and
> replies into our app. We'll keep discussions there until the move is ready.
> First we'll verify member accounts and free access, test with 3–5 members,
> preserve the agreed history, then announce one date to move new discussions
> into Dirty Turf. Existing approved members keep free Community and the whole
> current Academy. Please review the prepared member list, confirm emails and
> anyone who should be restricted, pick 3–5 testers, and tell us which old
> posts/videos must be copied. We'll agree the switch date after testing. Please
> leave GHL running until then.

The requested member names, free-cohort decisions, history scope and date must
still be supplied or confirmed by Steve. Sending this text is a separate owner
action; this file is a prepared draft.
