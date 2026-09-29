# Community post and comment sync

## Deployed September 29, 2026

The production backend can atomically apply versioned post/comment events while preserving native IDs, author mappings, reply parents, reactions, mirrored post media and local moderation. It deduplicates events, rejects older versions, records conflicts and retains deletion tombstones. Remote deletion archives posts or replaces a comment body; it never cascades away local replies. Imported events do not replay community emails.

`academy-community-sync` is deployed with a dedicated server-only Vault secret. `/apply` accepts the strict `schemaVersion: 1` contract defined in `_shared/community-sync.ts`. Its service-only SQL RPCs and four tables are inaccessible to anonymous and signed-in member roles. A five-minute retry job revisits events waiting for authors, categories, posts or reply parents.

## GoHighLevel connection: capture active, automatic application pending

Workflow `57bf209d-11ca-475a-ad8e-5aff6b22ce4e`, **Dirty Turf Community — payload verification**, is published. Both Group Post Created and Group Comment Created are restricted to **7 Figure Turf Cleaning**. Re-entry is enabled. Its only action sends the standard webhook to the private authenticated `/capture` endpoint. It sends no messages to members.

A controlled workflow test using the owner's existing contact reached the private inbox at **21:16:55 UTC**. This proves transport/authentication. Manual tests supply an empty `triggerData` object and blank post title, so they do not prove native post/comment identifiers or content.

**No native-payload adapter is enabled yet.** Real post/comment events stay in the private inbox as `needs_mapping`; they do not automatically appear in the app. A real source post and comment/reply must be captured before mapping stable source IDs, timestamps, authors, parents and media. The user was asked to authorize a clearly labeled test post/reply because GHL may notify members. No test post or reply has been published.

Public GHL documentation does not establish native Community edit/delete webhooks or a complete read API. Do not guess identities from text or treat missing items as deletions. Social Planner's community comment API covers only posts published through Social Planner and cannot replace native Community synchronization. Comment attachments are rejected by the normalized contract until the app has an explicit representation for them.

Existing imports are adopted only if current fields match their recorded source payload. Production adoption retained all 62 posts as local/protected and adopted 59 imported comments; the app-created comment remained local. Missing historical source versions are not invented. The group allowlist currently uses the stored source slug; map the actual event group ID only after inspecting a real scoped source event.

## Remaining acceptance

1. Capture an authorized real post plus comment and nested reply.
2. Implement a fixture-backed adapter for the observed event shape; preserve the raw source IDs used by the historical import.
3. Confirm media and update/delete capabilities separately. Unsupported events remain review items.
4. Replay the same source events: one native post/reply each, matching author/thread, no duplicate member email.
5. Verify appearance in the current web/iPhone/Android clients and enable automatic application only for the verified payload types.

Verification: 375 application tests; 79 isolated PostgreSQL assertions across all 37 migrations; type, schema, secret, store metadata, build and PWA checks. Live unauthenticated POST is 401; GET is 405. No member/grant changes (63 members,111 grants). Existing web, iOS and Android embedded frontend hashes match; this backend work requires no replacement store binary.

References: [GHL Community triggers](https://ideas.gohighlevel.com/changelog/new-communities-triggers-in-workflows-automate-more-faster), [standard webhook payload](https://help.gohighlevel.com/support/solutions/articles/155000003299), [Social Planner limitations](https://help.gohighlevel.com/support/solutions/articles/155000006433).
