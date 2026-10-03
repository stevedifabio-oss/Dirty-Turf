import { describe, expect, it, vi } from "vitest";
import { createCommunitySyncHandler } from "./handler";
import { readCommunitySnapshotJson, COMMUNITY_SNAPSHOT_MAX_BYTES } from "./snapshot-handler";
import { canonicalCommunityJson, communitySha256 } from "../_shared/community-sync";
import { planCommunitySnapshot } from "../_shared/community-snapshot.mjs";

const config = { id: "synthetic-config", enabled: true, location_id: "synthetic-location", group_id: "synthetic-group" };
const token = "11111111-2222-4333-8444-555555555555";
const env = (key: string) => ({ GHL_COMMUNITY_SYNC_SECRET: "synthetic-secret", GHL_COMMUNITY_SYNC_CONFIG_ID: config.id })[key];
const capture = () => ({ schemaVersion: 1, source: "ghl-community-browser", captureId: "capture-1", scope: { locationId: config.location_id, groupId: config.group_id },
  observedStartedAt: "2026-10-03T12:00:00Z", observedCompletedAt: "2026-10-03T12:01:00Z", coverage: { posts: "complete", comments: "complete" },
  posts: [{ externalId: "post-1", authorExternalId: "author-1", body: "Complete body", bodyComplete: true, title: "Title", commentsComplete: true,
    categoryExternalId: null, categoryComplete: true, pinned: false, pinnedComplete: true, media: [], mediaComplete: true }],
  comments: [{ externalId: "comment-1", authorExternalId: "author-1", postExternalId: "post-1", parentExternalId: null, body: "Reply", bodyComplete: true, media: [], mediaComplete: true }] });
const context = () => ({ enabled: true, scope: { locationId: config.location_id, groupId: config.group_id }, previousState: null,
  identities: { authors: [{ externalId: "author-1" }], categories: [] }, capabilities: { commentMedia: true } });
const receipt = () => ({ status: "applied", fullSync: true, observationSequence: 1, added: 2, updated: 0, unchanged: 0, held: [], conflicts: [], missingReviewOnly: [] });
function setup(overrides: { context?: unknown; error?: boolean; begin?: unknown; apply?: unknown } = {}) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: config, error: null });
  const insert = vi.fn();
  const from = vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })), insert }));
  const rpc = vi.fn(async (name: string) => {
    if (overrides.error) return { data: null, error: { message: "private provider credential" } };
    if (name === "get_academy_community_snapshot_context") return { data: overrides.context === undefined ? context() : overrides.context, error: null };
    if (name === "begin_academy_community_snapshot") return { data: overrides.begin ?? { status: "capturing", observationSequence: 1, leaseToken: token, previousState: null, scope: context().scope }, error: null };
    if (name === "apply_academy_community_snapshot") return { data: overrides.apply ?? receipt(), error: null };
    return { data: true, error: null };
  });
  return { from, rpc, insert, handler: createCommunitySyncHandler({ from, rpc }, env) };
}
const request = (action: string, body: unknown, secret = "synthetic-secret") => new Request(`https://example.com/functions/v1/academy-community-sync/snapshot/${action}`, {
  method: "POST", headers: { "content-type": "application/json", "x-community-sync-secret": secret }, body: JSON.stringify(body),
});
describe("authenticated Community snapshot endpoint", () => {
  it("authenticates before reading a larger snapshot body", async () => {
    const test = setup(), req = request("apply", { capture: capture(), leaseToken: token }, "bad");
    const read = vi.fn(() => { throw new Error("Do not read unauthenticated body"); });
    Object.defineProperty(req, "body", { get: read });
    expect((await test.handler(req)).status).toBe(401);
    expect(read).not.toHaveBeenCalled(); expect(test.rpc).not.toHaveBeenCalled();
  });
  it("begins and renews bounded server leases using only configured source", async () => {
    const test = setup();
    expect((await test.handler(request("begin", { captureId: "capture-1", leaseSeconds: 3600 }))).status).toBe(200);
    expect(test.rpc).toHaveBeenCalledWith("begin_academy_community_snapshot", { p_config_id: config.id, p_capture_id: "capture-1", p_lease_seconds: 3600 });
    expect((await test.handler(request("renew", { captureId: "capture-1", leaseToken: token }))).status).toBe(200);
    expect(test.rpc).toHaveBeenCalledWith("renew_academy_community_snapshot", { p_config_id: config.id, p_capture_id: "capture-1", p_lease_token: token, p_lease_seconds: 1800 });
  });
  it.each([59, 3601, 1.5, "1800"])("rejects invalid lease duration %s", async seconds => {
    const test = setup(); expect((await test.handler(request("begin", { captureId: "capture-1", leaseSeconds: seconds }))).status).toBe(422);
    expect(test.rpc).not.toHaveBeenCalled();
  });
  it("returns busy leases with an explicit conflict response", async () => {
    const test = setup({ begin: { status: "busy", retryAt: "2026-10-03T12:30:00Z" } });
    const result = await test.handler(request("begin", { captureId: "capture-1" }));
    expect(result.status).toBe(409); expect(await result.json()).toMatchObject({ status: "busy" });
  });
  it("recomputes canonical plan from DB baseline and source identity IDs", async () => {
    const test = setup(), source = capture();
    const result = await test.handler(request("apply", { capture: source, leaseToken: token }));
    expect(result.status).toBe(200); expect(await result.json()).toEqual(receipt());
    expect(test.rpc).toHaveBeenCalledWith("get_academy_community_snapshot_context", { p_config_id: config.id, p_capture_id: "capture-1", p_lease_token: token });
    const plan = test.rpc.mock.calls.find(call => call[0] === "apply_academy_community_snapshot")?.[1].p_plan;
    expect(plan.counts.added).toBe(2); expect(plan.nextState.records).toHaveLength(2);
    expect(plan.nextState.records[0].source).toEqual({});
  });
  it("preserves exact percent-encoded GHL category slugs in a complete production-shaped category context", async () => {
    const source = capture(), categoryId = "Chemistry-%26-Cleaners-0fMEH";
    source.posts[0].categoryExternalId = categoryId;
    const categories = [{ externalId: categoryId }, ...Array.from({ length: 14 }, (_, index) => ({ externalId: `Category-${index}-source` }))];
    const test = setup({ context: { ...context(), identities: { ...context().identities, categories } } });
    expect((await test.handler(request("apply", { capture: source, leaseToken: token }))).status).toBe(200);
    const plan = test.rpc.mock.calls.find(call => call[0] === "apply_academy_community_snapshot")?.[1].p_plan;
    expect(plan.nextState.records.find(record => record.entity === "post").content.categoryExternalId).toBe(categoryId);
  });
  it.each(["Chemistry-%-bad", "Chemistry-%2-bad", "Chemistry-%ZZ-bad", "Chemistry & Cleaners"])("rejects incomplete escapes or decoded names %s", async categoryId => {
    const test = setup({ context: { ...context(), identities: { ...context().identities, categories: [{ externalId: categoryId }] } } });
    expect((await test.handler(request("apply", { capture: capture(), leaseToken: token }))).status).toBe(503);
    expect(test.rpc).not.toHaveBeenCalledWith("apply_academy_community_snapshot", expect.anything());
  });
  it("uses a schema-proven comment media capability and never caller capability", async () => {
    const source = capture(); source.comments[0].media = [{ url: "https://cdn.example.com/reply.mp4", type: "video" }];
    let test = setup(); expect((await test.handler(request("apply", { capture: source, leaseToken: token }))).status).toBe(200);
    test = setup({ context: { ...context(), capabilities: { commentMedia: false } } });
    expect((await test.handler(request("apply", { capture: source, leaseToken: token }))).status).toBe(422);
    expect(test.rpc).not.toHaveBeenCalledWith("apply_academy_community_snapshot", expect.anything());
  });
  it.each(["plan", "config", "previousState", "capabilities"])("rejects caller supplied %s before planning", async field => {
    const test = setup(); expect((await test.handler(request("apply", { capture: capture(), leaseToken: token, [field]: {} }))).status).toBe(422);
    expect(test.rpc).not.toHaveBeenCalled();
  });
  it("denies wrong scope and unknown source authors or display handle matching", async () => {
    let test = setup(), source = capture(); source.scope.groupId = "other-group";
    expect((await test.handler(request("apply", { capture: source, leaseToken: token }))).status).toBe(403); expect(test.rpc).not.toHaveBeenCalled();
    test = setup(); source = capture(); source.posts[0].authorExternalId = "unknown";
    expect((await test.handler(request("apply", { capture: source, leaseToken: token }))).status).toBe(422);
    expect(test.rpc).not.toHaveBeenCalledWith("apply_academy_community_snapshot", expect.anything());
    test = setup(); source = capture(); source.posts[0].authorHandle = "unverified-handle";
    expect((await test.handler(request("apply", { capture: source, leaseToken: token }))).status).toBe(422);
    expect(test.rpc).not.toHaveBeenCalled();
  });
  it("blocks incomplete captures and preserves optional field review gates", async () => {
    let test = setup(), source = capture(); source.coverage.comments = "partial";
    expect((await test.handler(request("apply", { capture: source, leaseToken: token }))).status).toBe(422);
    test = setup(); source = capture(); source.posts[0].mediaComplete = false;
    expect((await test.handler(request("apply", { capture: source, leaseToken: token }))).status).toBe(422);
    expect(test.rpc).not.toHaveBeenCalledWith("apply_academy_community_snapshot", expect.anything());
  });
  it("uses schema-authorized per-record holds while verified independent records apply", async () => {
    const source = capture(); source.comments[0].mediaComplete = false; delete source.comments[0].media;
    const held = [{ entity: "comment", externalId: "comment-1", reason: "unobserved_media" }];
    const test = setup({ context: { ...context(), capabilities: { commentMedia: true, partialRecords: true } },
      apply: { ...receipt(), status: "partial", fullSync: false, added: 1, held } });
    const result = await test.handler(request("apply", { capture: source, leaseToken: token }));
    expect(result.status).toBe(200); expect(await result.json()).toEqual({ ...receipt(), status: "partial", fullSync: false, added: 1, held });
    expect(test.rpc.mock.calls.find(call => call[0] === "apply_academy_community_snapshot")?.[1].p_plan.held).toEqual(held);
  });
  it("holds stable unlinked authors individually without guessed mappings", async () => {
    const source = capture(); source.comments[0].authorExternalId = "unknown-source-author";
    const held = [{ entity: "comment", externalId: "comment-1", reason: "unknown_author" }];
    const test = setup({ context: { ...context(), capabilities: { commentMedia: true, partialRecords: true } }, apply: { ...receipt(), status: "partial", fullSync: false, added: 1, held } });
    expect((await test.handler(request("apply", { capture: source, leaseToken: token }))).status).toBe(200);
    const plan = test.rpc.mock.calls.find(call => call[0] === "apply_academy_community_snapshot")?.[1].p_plan;
    expect(plan.held).toEqual(held);
    expect(plan.nextState.records.find(record => record.externalId === "comment-1").content.authorExternalId).toBe("unknown-source-author");
  });
  it("holds an explicitly unresolved author and preserves only verified record identity/body", async () => {
    const source = capture(); delete source.comments[0].authorExternalId; source.comments[0].authorComplete = false;
    const held = [{ entity: "comment", externalId: "comment-1", reason: "unknown_author" }];
    const test = setup({ context: { ...context(), capabilities: { commentMedia: true, partialRecords: true, sourceFieldHolds: true } }, apply: { ...receipt(), status: "partial", fullSync: false, held } });
    expect((await test.handler(request("apply", { capture: source, leaseToken: token }))).status).toBe(200);
    const plan = test.rpc.mock.calls.find(call => call[0] === "apply_academy_community_snapshot")?.[1].p_plan;
    expect(plan.held).toEqual(held); expect(plan.nextState.records.find(record => record.externalId === "comment-1").content).not.toHaveProperty("authorExternalId");
  });
  it("holds omitted source text only after the database proves source-field hold support", async () => {
    const source = capture(); source.comments[0].bodyComplete = false; delete source.comments[0].body;
    const held = [{ entity: "comment", externalId: "comment-1", reason: "unobserved_body" }];
    const capabilities = { commentMedia: true, partialRecords: true, sourceFieldHolds: true, mediaOnlyComments: true };
    const test = setup({ context: { ...context(), capabilities }, apply: { ...receipt(), status: "partial", fullSync: false, held } });
    const response = await test.handler(request("apply", { capture: source, leaseToken: token }));
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ status: "partial", fullSync: false, held });
    const plan = test.rpc.mock.calls.find(call => call[0] === "apply_academy_community_snapshot")?.[1].p_plan;
    expect(plan.nextState.records[0].content).not.toHaveProperty("body");
    const older = setup({ context: { ...context(), capabilities: { commentMedia: true, partialRecords: true } } });
    expect((await older.handler(request("apply", { capture: source, leaseToken: token }))).status).toBe(422);
    expect(older.rpc).not.toHaveBeenCalledWith("apply_academy_community_snapshot", expect.anything());
  });
  it("requires the database media-only comment capability before publishing a blank attachment comment", async () => {
    const source = capture(); source.comments[0].body = ""; source.comments[0].media = [{ type: "image", url: "https://cdn.example.com/real-image" }];
    const enabled = setup({ context: { ...context(), capabilities: { commentMedia: true, mediaOnlyComments: true } } });
    expect((await enabled.handler(request("apply", { capture: source, leaseToken: token }))).status).toBe(200);
    const older = setup(); expect((await older.handler(request("apply", { capture: source, leaseToken: token }))).status).toBe(422);
    expect(older.rpc).not.toHaveBeenCalledWith("apply_academy_community_snapshot", expect.anything());
  });
  it("keeps blank unobservable source media held and refuses contradictory body completeness", async () => {
    const source = capture(); source.comments[0].body = ""; source.comments[0].mediaComplete = false; delete source.comments[0].media;
    const held = [{ entity: "comment", externalId: "comment-1", reason: "unobserved_media" }];
    const test = setup({ context: { ...context(), capabilities: { commentMedia: true, partialRecords: true, sourceFieldHolds: true, mediaOnlyComments: true } }, apply: { ...receipt(), status: "partial", fullSync: false, held } });
    expect((await test.handler(request("apply", { capture: source, leaseToken: token }))).status).toBe(200);
    source.comments[0].bodyComplete = false;
    expect((await test.handler(request("apply", { capture: source, leaseToken: token }))).status).toBe(422);
  });
  it("never relaxes catalog completeness or missing source-author identity for partial application", async () => {
    const contextValue = { ...context(), capabilities: { commentMedia: true, partialRecords: true } };
    for (const change of [source => { source.coverage.posts = "partial"; }, source => { delete source.comments[0].authorExternalId; }]) {
      const test = setup({ context: contextValue }), source = capture(); change(source);
      expect((await test.handler(request("apply", { capture: source, leaseToken: token }))).status).toBe(422);
      expect(test.rpc).not.toHaveBeenCalledWith("apply_academy_community_snapshot", expect.anything());
    }
  });
  it("propagates held post dependencies without inventing default media", async () => {
    const source = capture(); source.posts[0].mediaComplete = false; delete source.posts[0].media;
    const held = [{ entity: "comment", externalId: "comment-1", reason: "held_post" }, { entity: "post", externalId: "post-1", reason: "unobserved_media" }];
    const test = setup({ context: { ...context(), capabilities: { commentMedia: true, partialRecords: true } }, apply: { ...receipt(), status: "partial", held } });
    expect((await test.handler(request("apply", { capture: source, leaseToken: token }))).status).toBe(200);
    const plan = test.rpc.mock.calls.find(call => call[0] === "apply_academy_community_snapshot")?.[1].p_plan;
    expect(plan.held).toEqual([{ entity: "comment", externalId: "comment-1", reason: "held_post" }, { entity: "post", externalId: "post-1", reason: "unobserved_media" }]);
    expect(plan.nextState.records.find(record => record.entity === "post").content).not.toHaveProperty("media");
  });
  it("allows safe catch-up while retaining missing source records for review only", async () => {
    const first = capture(), previous = planCommunitySnapshot(null, first, { scope: context().scope, identities: context().identities, capabilities: context().capabilities }).nextState;
    const later = capture(); later.captureId = "capture-2"; later.observedStartedAt = "2026-10-03T12:02:00Z"; later.observedCompletedAt = "2026-10-03T12:03:00Z";
    later.comments = []; later.posts[0].body = "Updated source body";
    const test = setup({ context: { ...context(), previousState: previous } });
    expect((await test.handler(request("apply", { capture: later, leaseToken: token }))).status).toBe(200);
    const plan = test.rpc.mock.calls.find(call => call[0] === "apply_academy_community_snapshot")?.[1].p_plan;
    expect(plan.counts).toEqual({ added: 0, updated: 1, unchanged: 0, missing: 1 });
    expect(plan.missing).toEqual([{ entity: "comment", externalId: "comment-1", action: "review_only" }]);
    expect(plan.nextState.records).toHaveLength(2);
  });
  it("rejects unexpected raw DOM metadata and unsafe media metadata", async () => {
    for (const change of [source => { source.posts[0].rawText = "Private UI"; }, source => { source.posts[0].media = [{ url: "https://cdn.example.com/file", type: "file", storage_path: "arbitrary" }]; }]) {
      const test = setup(), source = capture(); change(source);
      expect((await test.handler(request("apply", { capture: source, leaseToken: token }))).status).toBe(422); expect(test.rpc).not.toHaveBeenCalled();
    }
  });
  it("supports response-loss retry only for the same immutable capture hash", async () => {
    const source = capture(), completed = { ...context(), run: { status: "applied", captureHash: await communitySha256(canonicalCommunityJson(source)), result: receipt() } };
    const test = setup({ context: completed });
    const retry = await test.handler(request("apply", { capture: source, leaseToken: token }));
    expect(retry.status).toBe(200); expect(await retry.json()).toEqual({ status: "duplicate", result: receipt() });
    source.posts[0].body = "Changed reused capture";
    expect((await test.handler(request("apply", { capture: source, leaseToken: token }))).status).toBe(422);
    expect(test.rpc).not.toHaveBeenCalledWith("apply_academy_community_snapshot", expect.anything());
  });
  it("preserves partial receipts on response-loss retry and never accepts an incorrect fullSync claim", async () => {
    const source = capture(), held = [{ entity: "comment", externalId: "comment-1", reason: "unknown_author" }];
    const stored = { ...receipt(), status: "partial", fullSync: true, held };
    const test = setup({ context: { ...context(), run: { status: "applied", captureHash: await communitySha256(canonicalCommunityJson(source)), result: stored } } });
    const response = await test.handler(request("apply", { capture: source, leaseToken: token }));
    expect(await response.json()).toEqual({ status: "duplicate", result: { ...stored, fullSync: false } });
  });
  it("reports legacy conflict results as partial with no full-sync claim", async () => {
    const conflicts = [{ entity: "comment", externalId: "comment-1", reason: "local_edit_or_delete" }];
    const test = setup({ apply: { ...receipt(), conflicts } });
    const response = await test.handler(request("apply", { capture: capture(), leaseToken: token }));
    expect(await response.json()).toEqual({ ...receipt(), status: "partial", fullSync: false, conflicts });
  });
  it("never claims success if a writer fails to confirm the exact held records", async () => {
    const source = capture(); source.comments[0].mediaComplete = false; delete source.comments[0].media;
    const test = setup({ context: { ...context(), capabilities: { commentMedia: true, partialRecords: true } }, apply: receipt() });
    const response = await test.handler(request("apply", { capture: source, leaseToken: token }));
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "Snapshot writer did not confirm record holds" });
  });
  it("fails closed when context scope differs or DB unexpectedly returns aliases", async () => {
    for (const altered of [{ ...context(), scope: { ...context().scope, groupId: "other" } }, { ...context(), identities: { authors: [{ externalId: "author-1", handles: ["steve"] }], categories: [] } }]) {
      const test = setup({ context: altered }); expect((await test.handler(request("apply", { capture: capture(), leaseToken: token }))).status).toBe(503);
      expect(test.rpc).not.toHaveBeenCalledWith("apply_academy_community_snapshot", expect.anything());
    }
  });
  it("keeps provider diagnostics and source content out of apply receipts", async () => {
    let test = setup({ error: true });
    const error = await test.handler(request("apply", { capture: capture(), leaseToken: token }));
    expect(await error.text()).not.toContain("credential");
    test = setup({ apply: { ...receipt(), sourceBody: "private content" } });
    expect(await (await test.handler(request("apply", { capture: capture(), leaseToken: token }))).json()).toEqual(receipt());
  });
  it("fails a lease with safe code and returns read-only status without a lease token", async () => {
    const test = setup();
    expect((await test.handler(request("fail", { captureId: "capture-1", leaseToken: token, errorCode: "source_session_expired" }))).status).toBe(200);
    const result = await test.handler(request("status", {})); expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ scope: context().scope, run: null, previousState: null });
  });
  it("rejects malformed and oversized body, unknown routes, and forged Content-Length", async () => {
    const test = setup();
    expect((await test.handler(request("invalid", {}))).status).toBe(404);
    expect((await test.handler(request("apply", { body: "x".repeat(COMMUNITY_SNAPSHOT_MAX_BYTES) }))).status).toBe(413);
    const valid = request("status", {}), forged = new Request(valid.url, { method: "POST", headers: { ...Object.fromEntries(valid.headers), "content-length": "1" }, body: JSON.stringify({ body: "x".repeat(COMMUNITY_SNAPSHOT_MAX_BYTES) }) });
    expect((await test.handler(forged)).status).toBe(413); expect(test.rpc).not.toHaveBeenCalled();
  });
  it("allows bounded captures larger than the event receiver's 256KiB limit", async () => {
    const req = request("apply", { padding: "x".repeat(300 * 1024) });
    expect((await readCommunitySnapshotJson(req)).padding.length).toBe(300 * 1024);
  });
  it("accepts a complete valid large capture through the guarded apply route", async () => {
    const test = setup(), source = capture(); source.comments = [];
    source.posts = Array.from({ length: 60 }, (_, index) => ({ ...source.posts[0], externalId: `post-${index}`, body: "x".repeat(5000) }));
    expect(JSON.stringify(source).length).toBeGreaterThan(256 * 1024);
    expect((await test.handler(request("apply", { capture: source, leaseToken: token }))).status).toBe(200);
    expect(test.rpc.mock.calls.find(call => call[0] === "apply_academy_community_snapshot")?.[1].p_plan.counts.added).toBe(60);
  });
});
