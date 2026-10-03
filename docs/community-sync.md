# Community post and comment sync

## Deployed September 29, 2026

The production backend can atomically apply versioned post/comment events while preserving native IDs, author mappings, reply parents, reactions, mirrored post media and local moderation. It deduplicates events, rejects older versions, records conflicts and retains deletion tombstones. Remote deletion archives posts or replaces a comment body; it never cascades away local replies. Imported events do not replay community emails.

`academy-community-sync` is deployed with a dedicated server-only Vault secret. `/apply` accepts the strict `schemaVersion: 1` contract defined in `_shared/community-sync.ts`. Its service-only SQL RPCs and four tables are inaccessible to anonymous and signed-in member roles. A five-minute retry job revisits events waiting for authors, categories, posts or reply parents.

## GoHighLevel connection: capture active, automatic application pending

Workflow `57bf209d-11ca-475a-ad8e-5aff6b22ce4e`, **Dirty Turf Community — payload verification**, is published. Both Group Post Created and Group Comment Created are restricted to **7 Figure Turf Cleaning**. Re-entry is enabled. Its only action sends the standard webhook to the private authenticated `/capture` endpoint. It sends no messages to members.

A controlled workflow test using the owner's existing contact reached the private inbox at **21:16:55 UTC**. This proves transport/authentication. Manual tests supply an empty `triggerData` object and blank post title, so they do not prove native post/comment identifiers or content.

**No native-payload adapter is enabled yet.** The owner authorized and we published a clearly labeled General-channel test post, comment and nested reply on September 29. Source post `6abc30b5b17c9b8832d92c2b`, comment `6abc30f144024e173c15ba62`. The real post reached the receiver at 21:42:17 UTC and the comment at 21:43:18 UTC. Both carried an empty `triggerData` object; only our explicitly mapped post title was included for the post. Neither carried stable content IDs, source timestamps, media or a reply parent. The nested reply is visible in GHL but supplies no distinct identity through this payload. Raw captures remain private as `needs_mapping` and are not applied.

The live workflow variable picker exposes four post fields (title, content, group name, channel name) and five comment fields (the same plus comment content). It does not expose identifiers, versions or reply parents. Full native Community mirroring is blocked on a supported source interface carrying these fields; inventing IDs from titles or guessing parents would corrupt threads. The source group DOM identifies `6a5ff7019b8d5f3bf162a694`, but the actual webhook does not carry it.

Public GHL documentation does not establish native Community edit/delete webhooks or a complete read API. Do not guess identities from text or treat missing items as deletions. Social Planner's community comment API covers only posts published through Social Planner and cannot replace native Community synchronization. Comment attachments are rejected by the normalized contract until the app has an explicit representation for them.

Existing imports are adopted only if current fields match their recorded source payload. The original capture included 162 profile/avatar artifacts which the importer correctly excluded, causing all 62 otherwise-identical posts to fail their media comparison. The September 29 reconciliation migration normalizes those known artifacts on the archived side only. All 62 posts and 59 imported comments are now enrolled; the app-created comment remains local. Actual attachment additions, removals, replacements, unknown URLs and local edits remain protected. Missing historical source versions are not invented. The group allowlist currently uses the stored source slug; map the actual event group ID only after inspecting a real scoped source event.

Production enrollment ran with the service role, as required by the existing post-write guard. Before/after checks confirmed identical post-content fingerprints, 11 attachments, 63 members, 111 grants, 62 posts, 60 comments and 7 email delivery records. No content, access or email was changed by enrollment. This shared database fix applies to web, Apple and Android without a new client binary. Automatic native GHL event application remains blocked by the missing source identities described above.

## Remaining acceptance

1. Obtain a supported GHL payload/API containing post ID, comment ID, reply-parent ID, author/contact ID, group/channel IDs, timestamps and attachments. Real native post/comment/reply testing is complete and demonstrates the current gap.
2. Implement a fixture-backed adapter once that interface exists; preserve the raw source IDs used by the historical import.
3. Confirm media and update/delete capabilities separately. Unsupported events remain review items.
4. Replay the same source events: one native post/reply each, matching author/thread, no duplicate member email.
5. Verify appearance in the current web/iPhone/Android clients and enable automatic application only for the verified payload types.

Verification: 380 application tests; 108 isolated PostgreSQL assertions across all 38 migrations; type, schema, secret, store metadata, build and PWA checks. Regression coverage includes avatar cleanup, retained mirrored images, removed/replaced attachments, lookalike hosts, paths embedded in query strings, idempotent enrollment and denied member access to the private helper. Live unauthenticated POST is 401; GET is 405. No member/grant changes (63 members,111 grants). Existing web, iOS and Android embedded frontend hashes match; this backend work requires no replacement store binary.

References: [GHL Community triggers](https://ideas.gohighlevel.com/changelog/new-communities-triggers-in-workflows-automate-more-faster), [standard webhook payload](https://help.gohighlevel.com/support/solutions/articles/155000003299), [Social Planner limitations](https://help.gohighlevel.com/support/solutions/articles/155000006433).

## October 3: live Social Planner bridge investigation

The existing **7 Figure Turf Cleaning** group was connected to GHL's built-in
Social Planner. The official accounts API now returns all **16 Community channel
accounts**. This connection alone does not import existing native Community posts.
No post/comment was created, no member message was sent, and no default posting
user was selected during this investigation.

Read-only requests used the existing location-scoped private integration and the
documented Social Planner API (`Version: v3`):

| Request | Result after connecting the group |
| --- | --- |
| `GET /social-media-posting/{locationId}/accounts` | HTTP 200; 16 Community channel accounts |
| `POST /social-media-posting/{locationId}/posts/list` with all 16 account IDs, `type: all`, `skip: "0"`, `limit: "100"` | HTTP 201; zero posts, count 0 |
| `POST /social-media-posting/comments/community/list?locationId=…` with all 16 origin IDs, skip 0, limit 100 | HTTP 201; zero comments, total 0, hasMore false |
| `GET /social-media-posting/{locationId}/posts/6abc30b5b17c9b8832d92c2b` for the known native test post | HTTP 400; no post returned |

The Community settings UI offers group/channel resynchronization, not native-post
sync. The connected accounts report `syncPosts: false`; the UI exposes no
Community native-post sync toggle. We did not force an undocumented setting.
Private response receipts are in ignored `output/private/social-planner-*-oct3.json`.

A production database read at 17:49 UTC confirmed six inbox captures, all still
`needs_mapping`, and no applied event ledger entries. The last capture arrived
October 2 at 10:25:47 UTC. Transport is active; content application is not.

This agrees with GHL's [comment-management guide](https://help.gohighlevel.com/support/solutions/articles/155000006433),
which excludes posts created directly inside Communities. Its
[Post Sync guide](https://help.gohighlevel.com/support/solutions/articles/155000007733-social-planner-post-sync),
updated October 1, does not list Communities and says native deletions are retained
even for supported networks. Therefore this cannot provide a complete mirror.

### App refresh improvement

The shared frontend now refreshes its loaded Community feed, comments, events and
members every 60 seconds while that view is visible, and on focus, reconnect,
native resume and entering Community/Events. It preserves drafts, active video,
loaded older pages and pending member writes; stale responses cannot overwrite
newer writes or another account. Network failures retain already-loaded content.
Comment reads now paginate beyond the former 500-comment cap. A failed or
incomplete read leaves the displayed collection intact rather than hiding newer
replies. Reaction lookups use bounded batches.

This refresh only reads data that has reached the app database. It does not turn
the upstream GHL capture inbox into an automatic native Community mirror.
The change passed 446 tests across 58 files, plus secret/schema/store checks,
TypeScript, the production build and the PWA manifest check.
Apple build 14 and Android build 9 submitted earlier on October 3 do not contain
this subsequent frontend change. A merged web change and replacement native
binaries must be verified separately before calling the refresh live there.

### Required source contracts by content type

| GHL changes | Current path | Remaining gate |
| --- | --- | --- |
| Allowlisted course/module/lesson content | Official Courses v3 reader and guarded five-minute worker; see `course-sync.md` | Verify new media/quiz representations before applying unsupported asset types |
| Native Community posts/comments/replies | Creation notifications captured privately; strict apply endpoint exists | Stable source IDs, author/parent relationships, timestamps and media |
| Community edits/deletions, pins/reactions | No complete supported feed verified | Updated records/deletion tombstones or a complete versioned snapshot |
| Group members, roles and entitlements | Historical import; CRM contacts alone do not establish group membership | Group-specific membership/access feed; preserve local Stripe/manual access |
| Community events/RSVPs | Historical import and app-native events | Group event and participant IDs, revisions, cancellation and recurrence data |

A production source adapter needs both fast change notifications and periodic
reconciliation. Notifications may be duplicated, arrive out of order or be
missed. Apply only source-owned records with their stable IDs and versions;
preserve app-only discussions, moderation, progress and billing grants. An item
missing from an incomplete or failed read is never a deletion.

The supported alternative worth validating is opening the **actual GHL
Community** through its [contact-specific Client Portal magic link](https://help.gohighlevel.com/support/solutions/articles/155000001667-client-portal-single-sign-on-sso-and-magic-links).
It shares the source discussions directly but changes the Community experience
and authentication boundary. A safe app implementation requires server-side
member/contact matching and a fresh, short-lived link for that member. No shared
admin link, public credentials or assumed iframe support.

On October 3, a dashboard-generated contact magic link successfully signed Steve
into his existing portal account and opened the private group. The live group
showed 69 posts, including his October 2 **App test**, with its original
Discussion/Learning/Events/Members navigation. No email was sent and no post or
comment was created. This proves manual member-specific browser access.
Automatic link generation, native navigation, return-to-app behavior and
ordinary-member isolation still require proof. Do not silently replace the
native Community with this option; a user decision is pending.

## GHL support request — draft, not sent

**Subject:** Native Communities integration: missing event identities and Social Planner read coverage

We own Dirty Turf's existing 7 Figure Turf Cleaning group and need a supported
one-way integration into our member app. Courses are already integrated through
the official Courses v3 read API. Native Community data is blocked by the
following reproducible source-interface gaps:

1. Published Group Post Created and Group Comment Created workflows deliver to
   our authenticated webhook. Real native post/comment tests, including a nested
   reply, produce an empty `triggerData` object. The custom-value picker exposes
   title/content/group/channel names but no stable post ID, comment ID, parent ID,
   source version or attachments.
2. On October 3 we connected the existing Community group to Social Planner.
   `GET /social-media-posting/{locationId}/accounts` returns 16 Community channel
   accounts. The documented posts-list and Community-comments-list endpoints,
   scoped to every connected channel, return zero records, although the native
   Community has existing member posts and comments. A lookup of a known native
   post ID returns HTTP 400. These are authenticated responses, not 401/403 errors.
3. The Community settings screen has no native-post sync toggle. Your comment
   management guide excludes natively created Community posts, and the October 1
   Post Sync guide does not list Communities. Group/channel resync does not
   resolve the missing content.

Please confirm the supported interface or feature access for native Community
post/comment/reply reads and changes, including:

- Stable group/channel/post/comment/reply-parent IDs and author/contact identity.
- Creation/update timestamps, rich text, images/video/files and pagination.
- Edits, deletions, pins/reactions and scoped group membership/access changes.
- Community events, recurrence, cancellations and RSVP changes.
- Snapshot/backfill and missed-event recovery, not only Social Planner-created posts.

If no public Community interface currently supports this, please confirm that
explicitly and identify any available private beta/export or product roadmap
route. We can supply our location/group/workflow IDs and redacted request and
response examples through the authenticated support case. We will not send API
keys, member content or personal contact lists.
