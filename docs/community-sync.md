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

## GHL support request — draft, not sent

We need a supported one-way export/API/webhook for native Community posts, comments and nested replies in our existing 7 Figure Turf Cleaning group. Live Group Post Created and Group Comment Created workflow events reach our webhook, but `triggerData` is empty. The custom-value picker exposes text/title/group/channel names only. Please identify the supported source interface for stable post/comment/reply-parent IDs, author/contact IDs, group/channel IDs, source create/update timestamps, attachments and edit/delete events. Social Planner-only content does not cover posts created by our members inside Communities. Without stable identities, replay-safe thread synchronization cannot be enabled.
