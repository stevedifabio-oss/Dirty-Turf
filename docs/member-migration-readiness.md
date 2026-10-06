# Member migration readiness audit

This read-only tool compares a fresh **exact Community roster** with the app's
accounts and access. The earlier `academy:access-audit` checks an import manifest;
this audit checks actual Auth links and grants against current source membership.
It creates no login, invitation, access grant, billing change or message.

## Inputs

Keep all three JSON files private (`chmod 600`) outside Git. Never use all CRM
contacts as the Community roster. Both snapshots must prove complete coverage,
be at most 24 hours old by default, and be taken within one hour of each other.
The complete roster must include available restricted/historical source members;
do not filter to active records and describe the result as complete.

1. Capture the exact `7 Figure Turf Cleaning` group and save a complete roster,
   source IDs, status, role and exact membership email. Verify every pagination
   page. Record missing emails as `""`; never guess identities from names or
   infer membership from a CRM contact. Source roster shape (synthetic example):

   ```json
   {
     "schemaVersion": 1,
     "source": "ghl-exact-community-roster",
     "scope": {"locationId": "location-1", "groupId": "stable-group-id"},
     "groupSlug": "group-slug",
     "capturedAt": "2026-10-05T14:30:00Z",
     "coverage": "complete",
     "members": [
       {"externalId": "verified-member-id", "contactId": "verified-contact-id", "email": "member@example.test", "status": "active", "role": "member"}
     ]
   }
   ```

   `contactId` may be `null` when not observed. Explicit statuses are `active`,
   `pending`, `suspended`, `cancelled`; roles are `owner`, `admin`, `moderator`,
   `member`. Unknown source states must be resolved before a readiness claim.

2. Use [the SELECT-only app export](../scripts/sql/export-member-migration-readiness.sql)
   in an authorized owner/admin SQL session. It reads only the needed identity,
   grant and billing-kind fields. It selects no passwords, tokens, personal
   metadata, community content or payment details. Save the **JSON object in
   `member_migration_export`**, not the enclosing SQL result array, under
   `output/private/` with mode `0600`.

   The live app community stores the slug `7-figure-turf-cleaning`; its independently
   verified stable GHL group ID is `6a5ff7019b8d5f3bf162a694`. Reconfirm that mapping
   in the fresh source DOM before replacing the query's proof-reference/time
   placeholders. The source roster and CLI use the stable ID. The export preserves
   the database slug and fresh proof reference separately. If the group or app
   mapping changes, stop and reconcile it rather than changing IDs to make a match.
   Do not expose `auth.users` through a public view or export secret Auth columns.
   [Supabase documents authorized SQL user exports](https://supabase.com/docs/guides/auth/managing-user-data#exporting-users).

3. Supply a separately reviewed, approved free-member cohort. Do not manufacture
   approval or automatically add everyone in the current roster. Record the
   actual approval reference/date and the current Academy course IDs included
   by the approved access policy. Existing members retain the whole current
   Academy; separate new courses or tool purchases require separate decisions.

   ```json
   {
     "schemaVersion": 1,
     "scope": {"locationId": "location-1", "groupId": "stable-group-id"},
     "approvedAt": "2026-10-03T10:00:00Z",
     "approvedBy": "approved-cohort-reference",
     "freeMemberExternalIds": ["verified-member-id"],
     "currentAcademyCourseIds": ["app-course-id"]
   }
   ```

The cohort can be older than the fresh snapshots: it freezes the approved free
members, rather than admitting new arrivals automatically.

## Run

```sh
node scripts/audit-member-migration.mjs \
  --roster output/private/fresh-exact-group-roster.json \
  --app-snapshot output/private/fresh-app-members.json \
  --cohort output/private/approved-free-cohort.json \
  --location-id eqVZcs8fro8qiGD2sgoG \
  --group-id 6a5ff7019b8d5f3bf162a694 \
  --report output/private/member-migration-readiness-new.json
```

The console prints counts and reason codes only. The report includes private
source/app IDs and email addresses, plus SHA-256 hashes of all inputs. It is saved
atomically with mode `0600` and never overwrites an earlier report. Exit code `1`
means validation failed or a technical exception needs review. An optional
`--max-age-hours` accepts 1–168 hours for deliberate archive review; keep the
default or a stricter window for rollout decisions.

## What it checks

- Exact source member/contact IDs must agree; email alone cannot merge identities.
- Active source members need unique email, matching active app identity/role,
  confirmed unbanned/undeleted Auth user and matching invite linkage.
- Community and all approved current Academy courses need effective grants.
  Included courses must be published; a grant cannot make a draft/archived course
  available to an ordinary member.
  Free-cohort access must have permanent imported/manual grants. Temporary Stripe
  access does not prove existing members keep free access.
- Active membership billing on a free-cohort member needs review. Separate tool
  subscriptions are permitted. Existing source billing agreements remain unassessed.
- Free imported/manual membership access outside the approved cohort needs review.
- Restricted source members still active in the app need review. Missing active
  imported source rows are review-only; no deletion or revocation is proposed.
  App-only members are preserved and never treated as source roster omissions.

`technicalReady` covers these snapshot checks only. It does not prove a completed
migration: source billing reconciliation, installed-device pilot, Community/media
acceptance, announcement delivery, campaign sign-ins and Steve's changeover approval
remain separate gates. Old Auth sign-ins and accepted invite rows never count as
successful onboarding in a new campaign. Use the
[member migration plan](member-migration-plan.md) for those gates.
