# Local Community bridge operations

The source is the existing 7 Figure Turf Cleaning GHL Community. The destination
is the shared Dirty Turf Academy database used by web, iOS and Android. This
bridge reads the owner's authorized Chrome session through CUA. It requires this
Mac, Codex and Chrome to remain available and signed in. It is not a cloud worker
and does not provide instant delivery or complete native video export.

## Verified first production application — October 3, 2026

The final capture contains 67 posts and 74 comments. A second fresh Home read
reached the end and returned the identical 67 source post IDs. The production
receipt reports **14 added, 116 updated, 0 unchanged and 11 held**. The response
is `status:partial`, `fullSync:false`. Replaying the same capture returned
`status:duplicate`; it did not create a second copy.

Private proof: `output/private/community-first-live-apply-oct3.json` and
`output/private/community-first-live-repeat-oct3.json`. The 11 holds are five
protected-video records, four records with unverified author identity, and two
comments whose parent post is held. These are known gaps, not a complete mirror.

Use the checkout containing this file. Keep `.env.community-sync.local` private
and ignored. It contains the existing server-only integration secret; never read
or print its contents. CLI commands load it with `node --env-file`.

## Each scheduled run

1. Create a fresh capture ID and unique receipt filenames under `output/private`.
   Begin a 3,600-second lease using `scripts/sync-community-snapshot.mjs`. Exit
   quietly if another reader is busy; never reuse an expired capture ID.
2. Use CUA's documented browser controls to obtain Steve's authorized Chrome
   source tab. Import `scripts/lib/community-browser-reader.mjs` in the CUA
   session. Use its functions with the CUA tab; do not launch another browser
   technology or extract cookies, tokens, hidden framework state or network data.
3. Record the observation start, then capture the fresh full Home feed. Read the
   current channel links from the source DOM; keep their exact encoded URL slugs.
   Load both private author identities and known-media mappings listed below.
   Display names alone never resolve an author; historical synthetic member IDs
   are not proof of a current GHL author ID.
4. Read all source threads in sequential batches of up to eight with
   `resolveCategory:true`, the current observed channel URL allowlist, and
   `expectedMediaByRecord`. Keep each CUA tool invocation within 60 seconds;
   reduce the batch size if necessary. Never run source navigation concurrently.
   Await the reader's comment/body, pagination, network-idle and known-wrapper
   guards. Save each completed batch privately. Renew at least every 20 minutes
   during long runs and before apply if the last begin/renewal is older than
   20 minutes, using the original begin receipt. Unknown
   authors, body fields or media remain explicit field holds. Never replace them
   with guessed IDs, empty arrays, fabricated timestamps or placeholder text.
5. Independently capture a second fresh full Home feed. Require both feed-end
   markers and exactly matching source post-ID sets. If the source changed,
   restart the capture; do not certify partial pagination as complete.
6. Assemble the capture using the second feed's IDs/count as the independent
   coverage check. Write the capture and evidence with mode `0600`. Apply only
   after complete post-ID and comment/parent-graph coverage is proven. Do not
   freeze future runs to 67 or an older historical count; derive the count from
   the two current full reads. A transient `No posts found` is not an end marker.
7. Submit the capture with the matching lease receipt through the CLI. The
   endpoint computes mappings and the plan from the authoritative database. It
   applies verified records and holds incomplete records/dependents atomically.
   Preserve the returned private receipt and compare its held/conflict lists with
   the prior run. `partial` and `fullSync:false` never mean a complete mirror.
8. On a failed or blocked run with an acquired lease, use the matching CLI `fail`
   action to release it with a safe error code. A busy-reader response has no
   acquired lease; exit without releasing the other reader's lease. A lost-response retry uses the same capture
   and lease; a later observation needs a new ID. Never apply an old observation
   after a newer accepted baseline.

## Source configuration

- Home: `https://academy.dirtyturf.com/communities/groups/7-figure-turf-cleaning/home`
- Enrolled source scope: location `eqVZcs8fro8qiGD2sgoG`, group slug
  `7-figure-turf-cleaning`.
- Independently observed GHL group object ID: `6a5ff7019b8d5f3bf162a694`.
- Private verified handles: `output/private/community-reader-author-identities-oct3.json`.
- Required independently observed media identities:
  `output/private/community-final-known-media-oct3.json`. Load this file into
  `expectedMediaByRecord`; do not omit it because an early DOM read shows no
  attachment. It contains typed `post:SOURCE_ID` / `comment:SOURCE_ID` keys and
  exact video-wrapper DOM IDs. Keep existing entries; append only independently
  observed associations. A missing known wrapper is held, never treated as a
  verified media deletion.
- Source DOM channel controls: `[id^="channel-sidebar-item-"] a[href]`.
  Resolve their DOM hrefs against the current HTTPS source origin; accept only
  the exact same group's `/channels/{slug}` routes. Do not choose between the two
  Announcements channels by display name.

## CUA capture sequence

Initialize CUA with its documented entry point in a separate tool call and read
the returned documentation. Obtain Steve's existing authorized source tab and
bind it to `communitySourceTab`. If the source needs sign-in, fail the current
lease safely and request sign-in; restart with a new capture afterward.

Run this setup after the browser entry point. Set `communityWorkspace` to the
checkout containing this runbook, and use the same fresh ID as the CLI begin.
The examples use the verified `media11` reader; use a new import suffix after
future code changes so the CUA module cache does not retain an older reader.

```js
var communityWorkspace = "/Users/wififunded/.codex/worktrees/course-sync-emails";
var communityCaptureId = "NEW_CAPTURE_ID";
var communityFs = await import("node:fs/promises");
var communityUrl = await import("node:url");
var communityReader = await import(communityUrl.pathToFileURL(
  communityWorkspace + "/scripts/lib/community-browser-reader.mjs"
).href + "?v=media11");
var communitySave = async (file, snapshot, cwd) => {
  if (!/^output\/private\/[^/.][^/]*\.json$/.test(file)) {
    throw new Error("Invalid private capture destination");
  }
  await communityFs.writeFile(cwd + "/" + file,
    JSON.stringify(snapshot, null, 2) + "\n",
    { encoding: "utf8", mode: 0o600, flag: "wx" });
};
var communityAuthors = JSON.parse(await communityFs.readFile(
  communityWorkspace + "/output/private/community-reader-author-identities-oct3.json", "utf8"
));
var communityKnownMedia = JSON.parse(await communityFs.readFile(
  communityWorkspace + "/output/private/community-final-known-media-oct3.json", "utf8"
));
var communitySource = {
  tab: communitySourceTab,
  scope: { locationId: "eqVZcs8fro8qiGD2sgoG", groupId: "7-figure-turf-cleaning" },
  sourceGroupId: "6a5ff7019b8d5f3bf162a694",
  feedUrl: "https://academy.dirtyturf.com/communities/groups/7-figure-turf-cleaning/home"
};
var communityStartedAt = new Date().toISOString();
var communityFeedBefore = await communityReader.captureCommunityFeed(communitySource);
var communityChannels = await communitySourceTab.playwright.evaluate(() =>
  [...document.querySelectorAll('[id^="channel-sidebar-item-"] a[href]')]
    .map(a => a.href)
);
var communityThreads = [];
var communityNextOffset = 0;
```

Run one bounded batch per CUA tool call; repeat until the offset reaches the
first feed's card count. Each call awaits the preceding batch before navigating.

```js
var communityBatchOffset = communityNextOffset;
var communityBatch = await communityReader.captureCommunityThreads({
  ...communitySource,
  cards: communityFeedBefore.cards.slice(communityBatchOffset, communityBatchOffset + 8),
  authors: communityAuthors,
  resolveCategory: true,
  sourceObservedChannels: communityChannels,
  expectedMediaByRecord: communityKnownMedia
});
await communitySave(
  "output/private/" + communityCaptureId + "-threads-" + communityBatchOffset + ".json",
  communityBatch, communityWorkspace
);
communityThreads.push(...communityBatch);
communityNextOffset += communityBatch.length;
```

After every thread has been captured, perform a fresh full Home read and compare
IDs, not merely counts. The reader must see the exact end-of-posts footer in
both reads. Save diagnostics on mismatch, fail the lease and start a new capture.

```js
var communityFeedAfter = await communityReader.captureCommunityFeed(communitySource);
var communityBeforeIds = communityFeedBefore.cards.map(p => p.externalId).sort();
var communityAfterIds = communityFeedAfter.cards.map(p => p.externalId).sort();
if (!communityFeedBefore.feedReachedEnd || !communityFeedAfter.feedReachedEnd ||
    JSON.stringify(communityBeforeIds) !== JSON.stringify(communityAfterIds)) {
  throw new Error("Source post catalog changed or pagination is incomplete");
}
var communityResult = communityReader.assembleCommunityCapture({
  scope: communitySource.scope,
  captureId: communityCaptureId,
  observedStartedAt: communityStartedAt,
  observedCompletedAt: new Date().toISOString(),
  feed: communityFeedBefore,
  threads: communityThreads,
  expectedPostCount: communityAfterIds.length,
  expectedPostIds: communityAfterIds
});
await communitySave("output/private/" + communityCaptureId + "-capture.json",
  communityResult.capture, communityWorkspace);
await communitySave("output/private/" + communityCaptureId + "-evidence.json",
  communityResult.evidence, communityWorkspace);
if (communityResult.capture.coverage.posts !== "complete" ||
    communityResult.capture.coverage.comments !== "complete") {
  throw new Error("Source identity or thread coverage is incomplete");
}
```

Complete structural coverage proves the post/comment catalog and parent graph.
It does not resolve field holds. Network-idle timeout or unavailable media
settling leaves media unknown; unhydrated bodies are omitted with
`bodyComplete:false`; unresolved authors are omitted with `authorComplete:false`.
The production endpoint decides which records can be applied safely.

## CLI examples

Use fresh names for every receipt; the CLI refuses to overwrite an existing file.

```sh
node --env-file=.env.community-sync.local scripts/sync-community-snapshot.mjs \
  --action begin --capture-id NEW_CAPTURE_ID --lease-seconds 3600 \
  --receipt output/private/NEW_CAPTURE_ID-lease.json

node --env-file=.env.community-sync.local scripts/sync-community-snapshot.mjs \
  --action renew --lease output/private/NEW_CAPTURE_ID-lease.json \
  --lease-seconds 3600 --receipt output/private/NEW_CAPTURE_ID-renew-1.json

node --env-file=.env.community-sync.local scripts/sync-community-snapshot.mjs \
  --action apply --capture output/private/NEW_CAPTURE_ID-capture.json \
  --lease output/private/NEW_CAPTURE_ID-lease.json \
  --receipt output/private/NEW_CAPTURE_ID-apply.json
```

Only if the capture stops before an accepted apply:

```sh
node --env-file=.env.community-sync.local scripts/sync-community-snapshot.mjs \
  --action fail --lease output/private/NEW_CAPTURE_ID-lease.json \
  --error-code source_capture_incomplete \
  --receipt output/private/NEW_CAPTURE_ID-fail.json
```

Use a new filename for each renewal. Continue passing the original **begin**
receipt to renew/apply/fail; a renewal receipt is confirmation, not a replacement
lease file accepted by the CLI. Do not run `fail` after a successful apply. For an
uncertain apply response, retry the exact saved capture and original lease with
a fresh apply-receipt filename; do not recapture under the same ID.

The current known native video identities must remain reviewed until GHL exposes
a supported durable file/export route. A temporary `blob:` playback URL is never
an importable attachment. Missing records are review items, not automatic deletes.
Existing app posts/replies, local moderation, reactions, member access and billing
must remain intact. Imported changes suppress duplicate community email sends.

Do not send members messages, alter the GHL group, change billing, or publish a
migration announcement during this job. Stay quiet for unchanged successful runs;
notify only on a meaningful catch-up, a new unresolved hold, a failure, or required
user action. Do not repeatedly notify about an unchanged known video hold.

## New verified source authors

Resolve a new author only after the source avatar's stable ID and an independently
opened profile route prove the same handle. Save that proof privately, including
the exact displayed name, source record ID and observed HTTPS profile URL. A name
match, historical synthetic ID or contact lookup from another account is not
proof. If the profile cannot be verified, keep the author and dependent records
held.

Use the trusted service SQL path to create an **author-only** row. First read exact
HighLevel member/contact links and source-member ledger records in this enrolled
community. One existing exact mapping is reused without changes; multiple
mappings or a ledger record without a reconciled link require review. Do not run
`academy-import`: it also changes access grants. Do not create auth users, emails,
invites, course enrollments, billing or grants. The target row stays `pending`
with `user_id=NULL`; this author representation does not enable login.

The concrete guarded operation and safe verification queries are private:
`output/private/new-james-author-guarded-oct3.sql`. For a future author, replace
the proof values in this template using the saved exact source evidence. Execute
only through the trusted service path; never put service credentials in Chrome,
the app or a capture.

```sql
do $$
declare cfg public.academy_community_sync_configs; author_id uuid; links integer;
 source_id text := 'VERIFIED_STABLE_SOURCE_ID';
 source_record_id text := 'VERIFIED_POST_OR_COMMENT_ID';
 source_name text := 'EXACT_OBSERVED_DISPLAY_NAME';
begin
 select * into strict cfg from public.academy_community_sync_configs
  where enabled and location_id='eqVZcs8fro8qiGD2sgoG'
   and group_id='7-figure-turf-cleaning' for update;
 if not exists(select 1 from jsonb_array_elements(cfg.last_snapshot_state->'records') r
  where r->>'entity' in ('post','comment') and r->>'externalId'=source_record_id
   and r->'content'->>'authorExternalId'=source_id) then
  raise exception 'Author is absent from accepted scoped source capture';
 end if;
 select count(distinct academy_member_id) into links from public.academy_member_links
  where academy_community_id=cfg.academy_community_id and external_provider='highlevel'
   and (external_member_id=source_id or external_contact_id=source_id);
 if links>1 then raise exception 'Ambiguous source author'; end if;
 if links=0 then
  if exists(select 1 from public.source_import_records where academy_community_id=cfg.academy_community_id
   and record_type='member' and external_id=source_id and imported_id is not null) then
   raise exception 'Exact source ledger requires reconciliation';
  end if;
  insert into public.academy_members(academy_community_id,user_id,role,status,display_name)
   values(cfg.academy_community_id,null,'member','pending',source_name) returning id into author_id;
  insert into public.academy_member_links(academy_community_id,academy_member_id,external_provider,external_contact_id,external_member_id,imported_at)
   values(cfg.academy_community_id,author_id,'highlevel',null,source_id,now());
 end if;
end $$;
```

Keep the exact observed profile URL and handle in the private proof and source
ledger, following the concrete guarded SQL. Verify one exact linked author, NULL
auth user, pending status, zero new invites/grants/enrollments and unchanged email
queue counts. Do not print private member details. This guard reads the accepted
snapshot baseline: apply the first capture partially if necessary, provision
only after proof, then use a **new capture ID and fresh observation** to release
the hold. Replaying an already applied capture stays a duplicate and does not
reprocess the author. Refresh the endpoint context on the next run; do not add
unproven IDs to its allowlist.
