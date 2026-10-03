import { describe, expect, it } from "vitest";
import { planCommunitySnapshot } from "./community-snapshot.mjs";

const config = {
  scope: { locationId: "location-1", groupId: "group-1" },
  identities: {
    authors: [{ externalId: "author-1", handles: ["steve"] }, { externalId: "author-2", handles: ["max"] }],
    categories: [{ externalId: "channel-1", names: ["General"] }, { externalId: "channel-2", names: ["Announcements"] }, { externalId: "channel-3", names: ["Announcements"] }],
  },
};
function capture(number = 1) {
  return {
    schemaVersion: 1, source: "ghl-community-browser", captureId: `capture-${number}`, scope: { ...config.scope },
    observedStartedAt: `2026-10-03T12:${String(number).padStart(2, "0")}:00Z`,
    observedCompletedAt: `2026-10-03T12:${String(number).padStart(2, "0")}:30Z`,
    coverage: { posts: "complete", comments: "complete" },
    posts: [{ externalId: "post-1", authorExternalId: "author-1", title: "Question", body: "Complete source body",
      bodyComplete: true, commentsComplete: true, categoryExternalId: "channel-1", categoryComplete: true,
      pinnedComplete: true, pinned: true, mediaComplete: true, media: [{ url: "https://cdn.example.com/photo.jpg", type: "image" }] }],
    comments: [
      { externalId: "comment-1", postExternalId: "post-1", parentExternalId: null, authorHandle: "max", body: "Root comment", bodyComplete: true, mediaComplete: true, media: [] },
      { externalId: "comment-2", postExternalId: "post-1", parentExternalId: "comment-1", authorHandle: "steve", body: "Nested reply", bodyComplete: true, mediaComplete: false },
    ],
  };
}
const initial = () => planCommunitySnapshot(null, capture(), config);
const codes = result => result.blocked.map(item => item.code);

const partialConfig = () => ({ ...config, capabilities: { commentMedia: true, partialRecords: true, sourceFieldHolds: true, mediaOnlyComments: true } });
function completeCapture(number = 1) {
  const source = capture(number);
  source.comments[1].mediaComplete = true; source.comments[1].media = [];
  return source;
}

describe("guarded record holds", () => {
  it("holds an unobserved body and descendants without inventing source text", () => {
    const source = completeCapture(); source.comments[0].bodyComplete = false; delete source.comments[0].body;
    const plan = planCommunitySnapshot(null, source, partialConfig());
    expect(plan.captureAccepted).toBe(true);
    expect(plan.held).toEqual([{ entity: "comment", externalId: "comment-1", reason: "unobserved_body" }, { entity: "comment", externalId: "comment-2", reason: "held_parent" }]);
    expect(plan.nextState.records.find(record => record.externalId === "comment-1")).toMatchObject({ bodyComplete: false, unobservedFields: ["body"] });
    expect(plan.nextState.records.find(record => record.externalId === "comment-1").content).not.toHaveProperty("body");
  });
  it("allows simultaneous author/body omissions with one explicit primary hold", () => {
    const source = completeCapture(); Object.assign(source.comments[0], { authorComplete: false, bodyComplete: false });
    delete source.comments[0].authorHandle; delete source.comments[0].body;
    const first = planCommunitySnapshot(null, source, partialConfig());
    expect(first.captureAccepted).toBe(true); expect(first.held[0].reason).toBe("unknown_author");
    expect(first.nextState.records[0].unobservedFields).toEqual(["authorExternalId", "body"]);
    const later = completeCapture(2); later.comments[0].authorExternalId = "author-2"; delete later.comments[0].authorHandle;
    const recovered = planCommunitySnapshot(first.nextState, later, partialConfig());
    expect(recovered.captureAccepted).toBe(true); expect(recovered.held).toEqual([]);
  });
  it("preserves previously known text while an existing source body is unobserved", () => {
    const previous = planCommunitySnapshot(null, completeCapture(), partialConfig()).nextState;
    const later = completeCapture(2); later.comments[0].bodyComplete = false; delete later.comments[0].body;
    const plan = planCommunitySnapshot(previous, later, partialConfig());
    expect(plan.captureAccepted).toBe(true); expect(plan.held[0].reason).toBe("unobserved_body");
    expect(plan.nextState.records[0].content.body).toBe("Root comment");
    expect(plan.nextState.records[0].bodyComplete).toBe(false);
  });
  it("rejects contradictory or implicit missing body evidence", () => {
    const source = completeCapture(); source.comments[0].bodyComplete = false;
    expect(codes(planCommunitySnapshot(null, source, partialConfig()))).toContain("contradictory_body_completeness");
    source.comments[0].bodyComplete = true; delete source.comments[0].body;
    expect(codes(planCommunitySnapshot(null, source, partialConfig()))).toContain("incomplete_or_invalid_body");
  });
  it.each(["author", "body"])("requires schema authorization before a missing %s can be held", field => {
    const source = completeCapture(), olderSchema = partialConfig(); delete olderSchema.capabilities.sourceFieldHolds;
    source.comments[0][`${field}Complete`] = false; delete source.comments[0][field === "author" ? "authorHandle" : "body"];
    expect(codes(planCommunitySnapshot(null, source, olderSchema))).toContain("unsupported_source_field_holds");
  });
  it.each(["image", "video", "file"])("accepts a proven media-only comment with durable %s", type => {
    const source = completeCapture(); source.comments[0].body = "";
    source.comments[0].media = [{ type, url: "https://cdn.example.com/verified-attachment" }];
    const plan = planCommunitySnapshot(null, source, partialConfig());
    expect(plan.captureAccepted).toBe(true); expect(plan.held).toEqual([]);
    expect(plan.nextState.records[0].content.body).toBe("");
  });
  it("holds blank comments with unobserved media or no verified attachment", () => {
    const source = completeCapture(); source.comments[0].body = ""; source.comments[0].mediaComplete = false; delete source.comments[0].media;
    let plan = planCommunitySnapshot(null, source, partialConfig());
    expect(plan.captureAccepted).toBe(true); expect(plan.held[0].reason).toBe("unobserved_media");
    source.comments[0].mediaComplete = true; source.comments[0].media = [];
    plan = planCommunitySnapshot(null, source, partialConfig());
    expect(plan.captureAccepted).toBe(true); expect(plan.held[0].reason).toBe("empty_body");
    source.comments[0].media = [{ type: "image", url: "https://cdn.example.com/image" }];
    const olderSchema = partialConfig(); delete olderSchema.capabilities.mediaOnlyComments;
    expect(planCommunitySnapshot(null, source, olderSchema).held[0].reason).toBe("empty_body");
  });
  it("allows only previously unobserved body enrichment at a genuine unchanged source version", () => {
    const source = completeCapture(); source.comments[0].sourceUpdatedAt = "2026-09-02T00:00:00Z"; source.comments[0].bodyComplete = false; delete source.comments[0].body;
    const first = planCommunitySnapshot(null, source, partialConfig());
    const later = completeCapture(2); later.comments[0].sourceUpdatedAt = source.comments[0].sourceUpdatedAt;
    expect(planCommunitySnapshot(first.nextState, later, partialConfig()).captureAccepted).toBe(true);
    later.comments[0].media = [{ type: "image", url: "https://cdn.example.com/unrelated-new-image" }];
    expect(codes(planCommunitySnapshot(first.nextState, later, partialConfig()))).toContain("same_source_version_changed");
  });
  it("rejects forged prior missing-body annotations without a valid held record", () => {
    const previous = planCommunitySnapshot(null, completeCapture(), partialConfig()).nextState;
    previous.records[0].bodyComplete = false; previous.records[0].unobservedFields = ["body"];
    expect(codes(planCommunitySnapshot(previous, completeCapture(2), partialConfig()))).toContain("invalid_previous_record");
  });
  it("holds unknown media and descendants while keeping independent source records available", () => {
    const source = completeCapture(); source.comments[0].mediaComplete = false; delete source.comments[0].media;
    const plan = planCommunitySnapshot(null, source, partialConfig());
    expect(plan.captureAccepted).toBe(true);
    expect(plan.held).toEqual([{ entity: "comment", externalId: "comment-1", reason: "unobserved_media" }, { entity: "comment", externalId: "comment-2", reason: "held_parent" }]);
    expect(plan.nextState.records).toHaveLength(3); expect(plan.nextState.held).toEqual(plan.held);
    expect(plan.nextState.records.find(record => record.externalId === "comment-1").content).not.toHaveProperty("media");
  });
  it("holds existing edits with unobserved media while retaining the known attachment data", () => {
    const previous = planCommunitySnapshot(null, completeCapture(), partialConfig()).nextState;
    const later = completeCapture(2); later.posts[0].body = "Verified edited text"; later.posts[0].mediaComplete = false; delete later.posts[0].media;
    const plan = planCommunitySnapshot(previous, later, partialConfig());
    expect(plan.captureAccepted).toBe(true); expect(plan.counts.updated).toBe(1);
    expect(plan.held.find(record => record.entity === "post").reason).toBe("unobserved_media");
    expect(plan.nextState.records.find(record => record.entity === "post").content.media).toEqual(previous.records.find(record => record.entity === "post").content.media);
    expect(plan.nextState.records.find(record => record.entity === "post").unobservedFields).toEqual(["media"]);
  });
  it("holds stable unlinked authors and categories without inventing target mappings", () => {
    const source = completeCapture(); source.posts[0].authorExternalId = "unlinked-source-author";
    const plan = planCommunitySnapshot(null, source, partialConfig());
    expect(plan.captureAccepted).toBe(true); expect(plan.held.find(record => record.entity === "post").reason).toBe("unknown_author");
    expect(plan.nextState.records.find(record => record.entity === "post").content.authorExternalId).toBe("unlinked-source-author");
    source.posts[0].authorExternalId = "author-1"; source.posts[0].categoryExternalId = "Unlinked-%26-Channel";
    expect(planCommunitySnapshot(null, source, partialConfig()).held.find(record => record.entity === "post").reason).toBe("unknown_category");
  });
  it("keeps missing stable author identity and incomplete catalog coverage blocked", () => {
    const source = completeCapture(); delete source.posts[0].authorExternalId;
    expect(planCommunitySnapshot(null, source, partialConfig()).captureAccepted).toBe(false);
    source.posts[0].authorExternalId = "author-1"; source.coverage.posts = "partial";
    expect(codes(planCommunitySnapshot(null, source, partialConfig()))).toContain("incomplete_posts_coverage");
  });
  it("holds explicitly unobserved authors by record identity without fabricating an author", () => {
    const source = completeCapture(); delete source.comments[0].authorExternalId; delete source.comments[0].authorHandle; source.comments[0].authorComplete = false;
    const plan = planCommunitySnapshot(null, source, partialConfig());
    expect(plan.captureAccepted).toBe(true); expect(plan.held).toEqual([{ entity: "comment", externalId: "comment-1", reason: "unknown_author" }, { entity: "comment", externalId: "comment-2", reason: "held_parent" }]);
    const record = plan.nextState.records.find(record => record.externalId === "comment-1");
    expect(record.content).not.toHaveProperty("authorExternalId"); expect(record.authorComplete).toBe(false); expect(record.unobservedFields).toContain("authorExternalId");
    const later = completeCapture(2); later.comments[0].authorExternalId = "author-2"; later.comments[0].authorComplete = true;
    expect(planCommunitySnapshot(plan.nextState, later, partialConfig()).held).toEqual([]);
  });
  it("does not let absent current author evidence replace previously known authorship", () => {
    const previous = planCommunitySnapshot(null, completeCapture(), partialConfig()).nextState;
    const later = completeCapture(2); delete later.comments[0].authorExternalId; delete later.comments[0].authorHandle; later.comments[0].authorComplete = false;
    const held = planCommunitySnapshot(previous, later, partialConfig());
    expect(held.captureAccepted).toBe(true); expect(held.nextState.records.find(record => record.externalId === "comment-1").content.authorExternalId).toBe("author-2");
    const recovered = completeCapture(3); recovered.comments[0].authorExternalId = "author-1"; delete recovered.comments[0].authorHandle;
    expect(codes(planCommunitySnapshot(held.nextState, recovered, partialConfig()))).toContain("author_changed");
  });
  it("rejects contradictory or forged author-completeness annotations", () => {
    const source = completeCapture(); source.posts[0].authorComplete = false;
    expect(codes(planCommunitySnapshot(null, source, partialConfig()))).toContain("contradictory_author_completeness");
    const previous = planCommunitySnapshot(null, completeCapture(), partialConfig()).nextState;
    delete previous.records[0].content.authorExternalId; previous.records[0].authorComplete = false;
    expect(codes(planCommunitySnapshot(previous, completeCapture(2), partialConfig()))).toContain("invalid_previous_record");
  });
  it("keeps missing previously held source records held for later recovery", () => {
    const source = completeCapture(); source.comments[0].mediaComplete = false; delete source.comments[0].media;
    const previous = planCommunitySnapshot(null, source, partialConfig()).nextState;
    const later = completeCapture(2); later.comments = [];
    const plan = planCommunitySnapshot(previous, later, partialConfig());
    expect(plan.captureAccepted).toBe(true); expect(plan.held).toEqual(previous.held); expect(plan.counts.missing).toBe(2);
  });
  it("releases a recovered hold even when content hash stays unchanged", () => {
    const first = completeCapture(); first.comments[0].authorExternalId = "unlinked-source-author"; delete first.comments[0].authorHandle;
    const previous = planCommunitySnapshot(null, first, partialConfig()).nextState;
    const later = completeCapture(2); later.comments[0].authorExternalId = "unlinked-source-author"; delete later.comments[0].authorHandle;
    const recoveredConfig = partialConfig(); recoveredConfig.identities = { ...config.identities, authors: [...config.identities.authors, { externalId: "unlinked-source-author" }] };
    const plan = planCommunitySnapshot(previous, later, recoveredConfig);
    expect(plan.captureAccepted).toBe(true); expect(plan.held).toEqual([]); expect(plan.counts).toEqual({ added: 0, updated: 0, unchanged: 3, missing: 0 });
  });
  it("allows only recovered optional-field evidence at the same genuine source version", () => {
    const first = completeCapture(); first.posts[0].sourceUpdatedAt = "2026-09-02T00:00:00Z"; first.posts[0].mediaComplete = false; delete first.posts[0].media;
    const previous = planCommunitySnapshot(null, first, partialConfig()).nextState;
    const later = completeCapture(2); later.posts[0].sourceUpdatedAt = first.posts[0].sourceUpdatedAt; later.posts[0].media = [];
    const recovered = planCommunitySnapshot(previous, later, partialConfig());
    expect(recovered.captureAccepted).toBe(true); expect(recovered.held).toEqual([]);
    later.posts[0].body = "Unrelated changed body at the same version";
    expect(codes(planCommunitySnapshot(previous, later, partialConfig()))).toContain("same_source_version_changed");
  });
  it("allows independently verified author enrichment at an unchanged genuine source version", () => {
    const source = completeCapture(); delete source.posts[0].authorExternalId; source.posts[0].authorComplete = false; source.posts[0].sourceUpdatedAt = "2026-09-02T00:00:00Z";
    const previous = planCommunitySnapshot(null, source, partialConfig()).nextState;
    const later = completeCapture(2); later.posts[0].sourceUpdatedAt = source.posts[0].sourceUpdatedAt; later.posts[0].authorComplete = true;
    expect(planCommunitySnapshot(previous, later, partialConfig()).captureAccepted).toBe(true);
    later.posts[0].title = "Changed title at same version";
    expect(codes(planCommunitySnapshot(previous, later, partialConfig()))).toContain("same_source_version_changed");
  });
  it("rejects corrupted prior hold annotations rather than weakening write guards", () => {
    const previous = planCommunitySnapshot(null, completeCapture(), partialConfig()).nextState;
    previous.held = [{ entity: "post", externalId: "post-1", reason: "made_up_reason" }];
    expect(codes(planCommunitySnapshot(previous, completeCapture(2), partialConfig()))).toContain("invalid_previous_holds");
    previous.held = []; previous.records[0].unobservedFields = ["body"];
    expect(codes(planCommunitySnapshot(previous, completeCapture(2), partialConfig()))).toContain("invalid_previous_record");
  });
});

describe("one-way Community snapshot planning", () => {
  it("resolves stored percent-encoded category slugs without decoding", () => {
    const source = capture(), categoryId = "Chemistry-%26-Cleaners-0fMEH";
    source.posts[0].categoryExternalId = categoryId;
    const plan = planCommunitySnapshot(null, source, { ...config, identities: { ...config.identities, categories: [{ externalId: categoryId }] } });
    expect(plan.captureAccepted).toBe(true);
    expect(plan.changes.find(record => record.entity === "post").content.categoryExternalId).toBe(categoryId);
  });
  it("accepts real source identities and nested parents without creating source timestamps or a writer", () => {
    const plan = initial();
    expect(plan.captureAccepted).toBe(true);
    expect(plan.counts).toEqual({ added: 3, updated: 0, unchanged: 0, missing: 0 });
    expect(plan).toMatchObject({ plannerOnly: true, productionWriterAvailable: false, applyReady: false, status: "captured" });
    expect(plan.changes.find(row => row.externalId === "comment-2").content).toMatchObject({ authorExternalId: "author-1", parentExternalId: "comment-1" });
    for (const row of plan.nextState.records) expect(row.source).toEqual({});
    expect(JSON.stringify(plan)).not.toContain("sourceUpdatedAt");
  });

  it("recognizes an exact replay, and a later identical capture plans no content writes", () => {
    const first = initial();
    const replay = planCommunitySnapshot(first.nextState, capture(), config);
    expect(replay.status).toBe("duplicate");
    expect(replay.changes).toEqual([]);
    const next = planCommunitySnapshot(first.nextState, capture(2), config);
    expect(next.captureAccepted).toBe(true);
    expect(next.status).toBe("unchanged");
    expect(next.counts).toEqual({ added: 0, updated: 0, unchanged: 3, missing: 0 });
    expect(next.nextState.snapshotHash).toBe(first.nextState.snapshotHash);
    expect(next.nextState.observedCompletedAt).not.toBe(first.nextState.observedCompletedAt);
  });

  it("ignores relative ages, reaction counters and capture UI metadata in content hashes", () => {
    const source = capture();
    Object.assign(source.posts[0], { timestamp: "1mo", reactionText: "1 like", commentCountText: "2 comments", rawText: "UI text" });
    const first = planCommunitySnapshot(null, source, config);
    const later = capture(2);
    Object.assign(later.posts[0], { timestamp: "2mo", reactionText: "9 likes", commentCountText: "5 comments", rawText: "Changed UI" });
    later.comments[0].timestamp = "4h";
    const plan = planCommunitySnapshot(first.nextState, later, config);
    expect(plan.status).toBe("unchanged");
    expect(plan.nextState.snapshotHash).toBe(first.nextState.snapshotHash);
  });

  it("plans edited content with expected prior hashes while preserving unknown pins/categories/media", () => {
    const previous = initial().nextState;
    const later = capture(2);
    Object.assign(later.posts[0], { body: "Updated source body", categoryComplete: false, categoryName: "Announcements", pinnedComplete: false, mediaComplete: false });
    delete later.posts[0].categoryExternalId;
    delete later.posts[0].pinned;
    delete later.posts[0].media;
    const plan = planCommunitySnapshot(previous, later, config);
    expect(plan.counts.updated).toBe(1);
    const change = plan.changes[0];
    expect(change.expectedPreviousContentHash).toBe(previous.records.find(row => row.entity === "post").contentHash);
    expect(change.content).toMatchObject({ body: "Updated source body", categoryExternalId: "channel-1", pinned: true,
      media: [{ url: "https://cdn.example.com/photo.jpg", type: "image" }] });
  });

  it("distinguishes unknown attachments from a verified empty attachment list", () => {
    const previous = initial().nextState;
    const later = capture(2);
    later.posts[0].media = [];
    expect(planCommunitySnapshot(previous, later, config).changes[0].content.media).toEqual([]);
    later.posts[0].mediaComplete = false;
    expect(planCommunitySnapshot(previous, later, config).status).toBe("unchanged");
  });

  it("makes unobserved optional fields on new records explicit review items, never default values", () => {
    const source = capture();
    Object.assign(source.posts[0], { mediaComplete: false, categoryComplete: false, pinnedComplete: false });
    const plan = planCommunitySnapshot(null, source, config);
    expect(plan.captureAccepted).toBe(true);
    expect(plan.requiresReview).toBe(true);
    expect(plan.review.map(item => item.code)).toEqual(expect.arrayContaining([
      "new_post_media_unobserved", "new_post_category_unobserved", "new_post_pinned_unobserved", "new_comment_media_unobserved",
    ]));
    const record = plan.nextState.records.find(row => row.entity === "post");
    expect(record.content).not.toHaveProperty("media");
    expect(record.content).not.toHaveProperty("categoryExternalId");
    expect(record.content).not.toHaveProperty("pinned");
    expect(plan.applyReady).toBe(false);
  });

  it("retains comment videos and flags missing app support without claiming apply readiness", () => {
    const source = capture();
    source.comments[0].media = [{ url: "https://cdn.example.com/reply.mp4", type: "video", name: "Reply video" }];
    const plan = planCommunitySnapshot(null, source, config);
    expect(plan.captureAccepted).toBe(true);
    expect(plan.review).toContainEqual({ code: "comment_media_requires_target_support", entity: "comment", externalId: "comment-1" });
    expect(plan.nextState.records.find(row => row.externalId === "comment-1").content.media[0].type).toBe("video");
    expect(plan.applyReady).toBe(false);
  });

  it("treats missing records as review-only and retains them for later reappearance", () => {
    const previous = initial().nextState;
    const later = capture(2); later.posts = []; later.comments = [];
    const missing = planCommunitySnapshot(previous, later, config);
    expect(missing.captureAccepted).toBe(true);
    expect(missing.changes).toEqual([]);
    expect(missing.counts.missing).toBe(3);
    expect(missing.missing.every(item => item.action === "review_only")).toBe(true);
    expect(missing.nextState.records).toEqual(previous.records);
    const restored = planCommunitySnapshot(missing.nextState, capture(3), config);
    expect(restored.counts).toEqual({ added: 0, updated: 0, unchanged: 3, missing: 0 });
  });

  it("keeps genuine source timestamps separate and rejects a regressed genuine source version", () => {
    const source = capture();
    source.posts[0].sourceCreatedAt = "2026-09-01T00:00:00Z";
    source.posts[0].sourceUpdatedAt = "2026-09-02T00:00:00Z";
    const previous = planCommunitySnapshot(null, source, config).nextState;
    const later = capture(2); later.posts[0].sourceUpdatedAt = "2026-09-01T12:00:00Z";
    expect(codes(planCommunitySnapshot(previous, later, config))).toContain("source_version_regressed");
    delete later.posts[0].sourceUpdatedAt;
    const next = planCommunitySnapshot(previous, later, config);
    expect(next.nextState.records.find(row => row.entity === "post").source.sourceUpdatedAt).toBe("2026-09-02T00:00:00.000Z");
  });

  it("blocks changed content carrying the same explicit genuine source version", () => {
    const source = capture(); source.posts[0].sourceUpdatedAt = "2026-09-02T00:00:00Z";
    const previous = planCommunitySnapshot(null, source, config).nextState;
    const later = capture(2);
    later.posts[0].sourceUpdatedAt = "2026-09-02T00:00:00Z";
    later.posts[0].body = "Different content with unchanged source version";
    expect(codes(planCommunitySnapshot(previous, later, config))).toContain("same_source_version_changed");
    later.posts[0].sourceUpdatedAt = "2026-09-02T01:00:00Z";
    expect(planCommunitySnapshot(previous, later, config).counts.updated).toBe(1);
  });
});

describe("capture review boundaries", () => {
  it.each([
    ["wrong group", source => { source.scope.groupId = "other"; }, "wrong_scope"],
    ["wrong location", source => { source.scope.locationId = "other"; }, "wrong_scope"],
    ["partial feed", source => { source.coverage.posts = "partial"; }, "incomplete_posts_coverage"],
    ["partial comments", source => { source.coverage.comments = "partial"; }, "incomplete_comments_coverage"],
    ["collapsed body", source => { source.posts[0].bodyComplete = false; }, "incomplete_or_invalid_body"],
    ["unloaded replies", source => { source.posts[0].commentsComplete = false; }, "incomplete_post_comments"],
    ["unobserved media state", source => { delete source.posts[0].mediaComplete; }, "missing_media_completeness"],
    ["missing ID", source => { delete source.posts[0].externalId; }, "missing_stable_source_id"],
    ["duplicate ID", source => { source.posts.push({ ...source.posts[0] }); }, "duplicate_source_id"],
    ["unknown author handle", source => { source.comments[0].authorHandle = "unresolved"; }, "unresolved_authorExternalId"],
    ["unobserved author", source => { delete source.posts[0].authorExternalId; }, "unresolved_authorExternalId"],
    ["name-only author", source => { delete source.posts[0].authorExternalId; source.posts[0].authorName = "Steve"; }, "unresolved_authorExternalId"],
    ["ambiguous category name", source => { delete source.posts[0].categoryExternalId; source.posts[0].categoryName = "Announcements"; }, "ambiguous_categoryExternalId"],
    ["ambiguous parent", source => { delete source.comments[0].parentExternalId; }, "ambiguous_parent"],
    ["missing parent", source => { source.comments[1].parentExternalId = "missing"; }, "parent_not_captured_in_thread"],
    ["cycle", source => { source.comments[0].parentExternalId = "comment-2"; }, "parent_cycle"],
    ["unsafe media", source => { source.posts[0].media[0].url = "http://127.0.0.1/private"; }, "invalid_media"],
  ])("blocks %s without producing a next state or changes", (_name, mutate, expected) => {
    const source = capture(); mutate(source);
    const plan = planCommunitySnapshot(null, source, config);
    expect(plan.captureAccepted).toBe(false);
    expect(codes(plan)).toContain(expected);
    expect(plan.nextState).toBeUndefined();
    expect(plan.changes).toEqual([]);
  });

  it("requires unique verified handle mapping and detects conflicting explicit identities", () => {
    const ambiguous = structuredClone(config);
    ambiguous.identities.authors[0].handles.push("max");
    expect(codes(planCommunitySnapshot(null, capture(), ambiguous))).toContain("ambiguous_authorExternalId");
    const source = capture(); source.comments[0].authorExternalId = "author-1";
    expect(codes(planCommunitySnapshot(null, source, config))).toContain("conflicting_authorExternalId");
  });

  it.each([
    ["author change", source => { source.posts[0].authorExternalId = "author-2"; }, "author_changed"],
    ["reply reparenting", source => { source.comments[1].parentExternalId = null; }, "comment_parent_changed"],
    ["comment post move", source => { source.comments[0].postExternalId = "other"; }, "comment_post_changed"],
  ])("holds %s for review", (_name, mutate, expected) => {
    const later = capture(2); mutate(later);
    expect(codes(planCommunitySnapshot(initial().nextState, later, config))).toContain(expected);
  });

  it("blocks stale/overlapping captures and contradictory replay IDs", () => {
    const previous = initial().nextState;
    const overlap = capture(2); overlap.observedStartedAt = capture().observedStartedAt;
    expect(codes(planCommunitySnapshot(previous, overlap, config))).toContain("out_of_order_or_overlapping_capture");
    const changed = capture(); changed.posts[0].body = "Contradictory replay";
    expect(codes(planCommunitySnapshot(previous, changed, config))).toContain("capture_id_reused");
  });

  it("rejects a tampered baseline and fields lacking prior observation provenance", () => {
    const previous = initial().nextState;
    previous.records[0].content.body = "Changed outside accepted capture";
    expect(codes(planCommunitySnapshot(previous, capture(2), config))).toContain("invalid_previous_record");
    const unproven = initial().nextState;
    unproven.records.find(row => row.entity === "post").observedFields = ["body"];
    expect(codes(planCommunitySnapshot(unproven, capture(2), config))).toContain("invalid_previous_record");
  });
});
