import { describe, expect, it, vi } from "vitest";
import { createCommunitySyncHandler } from "./handler";

// Synthetic receiver contract fixtures; not samples from a real GHL workflow.
const config = { id: "synthetic-config", enabled: true, location_id: "synthetic-location", group_id: "synthetic-group" };
const event = { schemaVersion: 1, eventId: "synthetic-event", locationId: config.location_id, groupId: config.group_id, entity: "post", operation: "upsert", externalId: "synthetic-post", sourceUpdatedAt: "2026-09-29T15:00:00Z", authorExternalId: "synthetic-author", title: "Synthetic title", body: "Synthetic body" };
const settings: Record<string, string> = { GHL_COMMUNITY_SYNC_SECRET: "synthetic-secret", GHL_COMMUNITY_SYNC_CONFIG_ID: config.id };
const env = (key: string) => settings[key];
function setup(options: { config?: typeof config | null; configError?: { code: string }; insertError?: { code: string }; data?: unknown; rpcError?: { code: string; message: string } } = {}) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: options.config === undefined ? config : options.config, error: options.configError ?? null });
  const insert = vi.fn().mockResolvedValue({ error: options.insertError ?? null });
  const eq = vi.fn(() => ({ maybeSingle }));
  const from = vi.fn(() => ({ select: vi.fn(() => ({ eq })), insert }));
  const rpc = vi.fn().mockResolvedValue({ data: options.data === undefined ? { status: "applied" } : options.data, error: options.rpcError ?? null });
  const admin = { from, rpc };
  return { admin, from, rpc, insert, maybeSingle, eq, handler: createCommunitySyncHandler(admin, env) };
}
const request = (body: unknown = event, route = "apply", secret = "synthetic-secret") => new Request(`https://example.com/functions/v1/academy-community-sync/${route}`, { method: "POST", headers: { "content-type": "application/json", "x-community-sync-secret": secret }, body: JSON.stringify(body) });

describe("community receiver boundary", () => {
  it("rejects bad auth before reading any body or querying source config", async () => {
    const { handler, from, rpc } = setup();
    const req = request(event, "apply", "wrong");
    const bodyRead = vi.fn(() => { throw new Error("Body must not be touched"); });
    Object.defineProperty(req, "body", { get: bodyRead });
    const result = await handler(req);
    expect(result.status).toBe(401);
    expect(bodyRead).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("fails closed without configured secret", async () => {
    const { admin, from } = setup();
    admin.rpc.mockResolvedValue({ data: null, error: null });
    expect((await createCommunitySyncHandler(admin, () => undefined)(request())).status).toBe(401);
    expect(from).not.toHaveBeenCalled();
  });
  it.each([{ ...config, enabled: false }, null, { ...config, id: "another-config" }])("rejects disabled, missing or mismatched config", async changed => {
    const { handler, insert, rpc } = setup({ config: changed });
    expect((await handler(request())).status).toBe(503);
    expect(insert).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("captures raw data privately without calling apply or returning member content", async () => {
    const { handler, insert, rpc } = setup();
    const payload = { contact_id: "synthetic-member", community_unknown_shape: { text: "Private synthetic post" } };
    const result = await handler(request(payload, "capture"));
    expect(result.status).toBe(202);
    expect(await result.json()).toEqual({ accepted: true, status: "needs_mapping", duplicate: false });
    expect(insert).toHaveBeenCalledWith({ config_id: config.id, payload, payload_hash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(rpc).not.toHaveBeenCalled();
    expect(result.headers.get("cache-control")).toBe("no-store");
  });
  it("never applies even a valid normalized event received on capture route", async () => {
    const { handler, rpc } = setup();
    expect((await handler(request(event, "capture"))).status).toBe(202);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("treats duplicate capture as accepted but database failures as retryable", async () => {
    let test = setup({ insertError: { code: "23505" } });
    const result = await test.handler(request({}, "capture"));
    expect(result.status).toBe(202);
    expect((await result.json()).duplicate).toBe(true);
    test = setup({ insertError: { code: "XX000" } });
    expect((await test.handler(request({}, "capture"))).status).toBe(503);
  });
  it.each([{ locationId: "another-location" }, { groupId: "another-group" }])("denies an authenticated event from another source", async change => {
    const { handler, rpc } = setup();
    expect((await handler(request({ ...event, ...change }))).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects invalid contracts before any mutations", async () => {
    const { handler, rpc, insert } = setup();
    expect((await handler(request({ ...event, externalId: undefined }))).status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });
  it("only passes the validated normalized event to the transactional RPC", async () => {
    const { handler, rpc, eq } = setup();
    expect((await handler(request())).status).toBe(200);
    expect(eq).toHaveBeenCalledWith("id", config.id);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("apply_academy_community_event", { p_config_id: config.id, p_event: { ...event, sourceUpdatedAt: "2026-09-29T15:00:00.000Z" } });
  });
  it.each(["duplicate", "stale", "conflict", "pending"])("preserves explicit RPC status %s", async status => {
    const { handler } = setup({ data: { status } });
    const result = await handler(request());
    expect(result.status).toBe(status === "pending" ? 202 : 200);
    expect(await result.json()).toEqual({ status });
  });
  it("does not leak database errors or claim success for empty/unknown results", async () => {
    let test = setup({ rpcError: { code: "XX000", message: "private diagnostic" } });
    const result = await test.handler(request());
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain("private diagnostic");
    test = setup({ data: null });
    expect((await test.handler(request())).status).toBe(503);
    test = setup({ data: { status: "unsupported" } });
    expect((await test.handler(request())).status).toBe(503);
  });
  it("rejects malformed and oversized JSON without mutations", async () => {
    const { handler, insert, rpc } = setup();
    const malformed = request();
    const broken = new Request(malformed.url, { method: "POST", headers: malformed.headers, body: "{" });
    expect((await handler(broken)).status).toBe(400);
    expect((await handler(request({ body: "x".repeat(262144) }))).status).toBe(413);
    expect((await handler(request([]))).status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects other methods and unknown routes", async () => {
    const { handler, rpc } = setup();
    expect((await handler(new Request("https://example.com/capture"))).status).toBe(405);
    expect((await handler(request({}, "unknown"))).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("returns a generic retryable failure when the database throws", async () => {
    const { handler, maybeSingle } = setup();
    maybeSingle.mockRejectedValue(new Error("private credential"));
    const result = await handler(request());
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain("credential");
  });
});
