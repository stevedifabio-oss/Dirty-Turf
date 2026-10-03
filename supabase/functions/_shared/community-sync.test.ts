import { describe, expect, it } from "vitest";
import {
  canonicalCommunityJson, communitySha256, CommunitySyncValidationError,
  readCommunitySyncJson, secretMatches, validateCommunitySyncEvent,
} from "./community-sync";

// Synthetic contract fixtures only: these are not observed GoHighLevel webhook payloads.
const post = () => ({ schemaVersion: 1, eventId: "synthetic-event-1", locationId: "synthetic-location", groupId: "synthetic-group", entity: "post", operation: "upsert", externalId: "synthetic-post", sourceUpdatedAt: "2026-09-29T15:00:00Z", authorExternalId: "synthetic-author", title: "Synthetic post", body: "Example text" });
const comment = () => ({ ...post(), entity: "comment", externalId: "synthetic-comment", postExternalId: "synthetic-post", title: undefined });
const request = (body: string, headers: Record<string, string> = {}) => new Request("https://example.com/apply", { method: "POST", headers: { "content-type": "application/json", ...headers }, body });

describe("explicit community v1 contract (synthetic fixtures)", () => {
  it("normalizes timestamps while preserving source identity and text", () => {
    expect(validateCommunitySyncEvent(post())).toMatchObject({ sourceUpdatedAt: "2026-09-29T15:00:00.000Z", externalId: "synthetic-post", body: "Example text" });
  });
  it("preserves absent media separately from an explicit clearing array", () => {
    expect(validateCommunitySyncEvent(post())).not.toHaveProperty("media");
    expect(validateCommunitySyncEvent({ ...post(), media: [] }).media).toEqual([]);
  });
  it("supports stable comment parents and explicit top-level null", () => {
    expect(validateCommunitySyncEvent({ ...comment(), parentExternalId: "synthetic-parent" }).parentExternalId).toBe("synthetic-parent");
    expect(validateCommunitySyncEvent({ ...comment(), parentExternalId: null }).parentExternalId).toBeNull();
  });
  it.each([
    { schemaVersion: 2 }, { schemaVersion: "1" }, { entity: "reaction" }, { operation: "create" },
    { groupId: "../group" }, { externalId: "" }, { eventId: "a".repeat(201) },
    { locationId: " location" }, { sourceUpdatedAt: "2026-02-30T12:00:00Z" },
    { sourceUpdatedAt: "2026-09-29" }, { sourceUpdatedAt: "2026-09-29T25:00:00Z" },
    { sourceCreatedAt: "2026-09-30T00:00:00Z" }, { authorExternalId: undefined },
    { body: " " }, { title: "x" }, { title: "x".repeat(121) }, { body: "x".repeat(5001) },
    { pinned: "true" }, { unknownNativeField: "anything" },
  ])("rejects invalid source contract %j", change => {
    expect(() => validateCommunitySyncEvent({ ...post(), ...change })).toThrow(CommunitySyncValidationError);
  });
  it("does not guess native GHL trigger field names", () => {
    expect(() => validateCommunitySyncEvent({ contact_id: "contact", post_title: "Post", post_content: "Text", group: "group" })).toThrow();
  });
  it("requires post identity for comments including deletion", () => {
    expect(() => validateCommunitySyncEvent({ ...comment(), postExternalId: undefined })).toThrow();
    expect(() => validateCommunitySyncEvent({ ...comment(), operation: "delete", body: undefined, postExternalId: undefined })).toThrow();
  });
  it("rejects comment self parenting and overlong bodies", () => {
    expect(() => validateCommunitySyncEvent({ ...comment(), parentExternalId: "synthetic-comment" })).toThrow();
    expect(() => validateCommunitySyncEvent({ ...comment(), body: "x".repeat(3001) })).toThrow();
  });
  it("keeps comment media absent, populated and explicitly cleared distinct", () => {
    expect(validateCommunitySyncEvent(comment())).not.toHaveProperty("media");
    expect(validateCommunitySyncEvent({ ...comment(), media: [] }).media).toEqual([]);
    const media = [{ type: "video", url: "https://cdn.example.com/reply.mp4", name: "Reply video" }];
    expect(validateCommunitySyncEvent({ ...comment(), media }).media).toEqual(media);
    expect(() => validateCommunitySyncEvent({ ...comment(), media: [{ ...media[0], storage_path: "private/reply.mp4" }] })).toThrow();
    expect(() => validateCommunitySyncEvent({ ...comment(), operation: "delete", body: undefined, media })).toThrow();
  });
  it("accepts a content-free deletion without author", () => {
    expect(validateCommunitySyncEvent({ ...post(), operation: "delete", title: undefined, body: undefined, authorExternalId: undefined }).operation).toBe("delete");
    expect(() => validateCommunitySyncEvent({ ...post(), operation: "delete" })).toThrow();
  });
  it("accepts safe source assets but not storage metadata from the sender", () => {
    const media = [{ type: "source-asset", url: "https://cdn.example.com/image.png?signature=example", name: "Image" }];
    expect(validateCommunitySyncEvent({ ...post(), media }).media).toEqual(media);
    expect(() => validateCommunitySyncEvent({ ...post(), media: [{ ...media[0], storageBucket: "private" }] })).toThrow();
  });
  it.each(["javascript:alert(1)", "http://example.com/x", "https://user:password@example.com/x", "https://127.0.0.1/x", "https://localhost/x", "https://foo.internal/x", "https://example.com:8443/x", "https://[::1]/x", "https://example.com/a b", "https://example.com/\\x"])("rejects unsafe media URL %s", url => {
    expect(() => validateCommunitySyncEvent({ ...post(), media: [{ type: "image", url }] })).toThrow();
  });
  it("counts Unicode characters consistently with database lengths", () => {
    expect(validateCommunitySyncEvent({ ...comment(), body: "🌱".repeat(3000) }).body).toHaveLength(6000);
    expect(() => validateCommunitySyncEvent({ ...post(), title: "🌱" })).toThrow();
  });
});

describe("bounded community receiver helpers", () => {
  it("parses JSON and permits explicit charset", async () => {
    await expect(readCommunitySyncJson(request('{"ok":true}', { "content-type": "application/json; charset=utf-8" }))).resolves.toEqual({ ok: true });
  });
  it("rejects a declared oversized body before parsing", async () => {
    await expect(readCommunitySyncJson(request("{}", { "content-length": "100" }), 10)).rejects.toMatchObject({ status: 413 });
  });
  it("enforces byte limit independently of a missing or dishonest Content-Length", async () => {
    await expect(readCommunitySyncJson(request('"🌱🌱"'), 8)).rejects.toMatchObject({ status: 413 });
    await expect(readCommunitySyncJson(request('{"large":true}', { "content-length": "2" }), 8)).rejects.toMatchObject({ status: 413 });
  });
  it("cancels a chunked source after hitting the limit", async () => {
    let cancelled = false;
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("123456")); controller.enqueue(new TextEncoder().encode("789012")); }, cancel() { cancelled = true; } });
    const req = new Request("https://example.com", { method: "POST", headers: { "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
    await expect(readCommunitySyncJson(req, 10)).rejects.toMatchObject({ status: 413 });
    expect(cancelled).toBe(true);
  });
  it.each([
    ["{", {}], ["{}", { "content-type": "text/plain" }], ["{}", { "content-encoding": "gzip" }],
  ])("rejects malformed or unsupported bodies", async (body, headers) => {
    await expect(readCommunitySyncJson(request(body as string, headers as Record<string, string>))).rejects.toBeInstanceOf(CommunitySyncValidationError);
  });
  it("canonicalizes nested keys and keeps ordered arrays distinct", async () => {
    const a = canonicalCommunityJson({ b: { y: 2, x: 1 }, a: [1, 2] });
    const b = canonicalCommunityJson({ a: [1, 2], b: { x: 1, y: 2 } });
    expect(a).toBe(b);
    expect(await communitySha256(a)).toBe(await communitySha256(b));
    expect(canonicalCommunityJson([1, 2])).not.toBe(canonicalCommunityJson([2, 1]));
    expect(await communitySha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("rejects non-JSON canonical values instead of silently dropping them", () => {
    expect(() => canonicalCommunityJson({ missing: undefined })).toThrow();
    expect(() => canonicalCommunityJson(NaN)).toThrow();
  });
  it("compares exact secret digests and rejects empty configuration", async () => {
    await expect(secretMatches("synthetic-secret", "synthetic-secret")).resolves.toBe(true);
    await expect(secretMatches("synthetic-secret", "synthetic-secreu")).resolves.toBe(false);
    await expect(secretMatches("short", "synthetic-secret")).resolves.toBe(false);
    await expect(secretMatches("", "")).resolves.toBe(false);
    await expect(secretMatches(undefined, "synthetic-secret")).resolves.toBe(false);
  });
});
