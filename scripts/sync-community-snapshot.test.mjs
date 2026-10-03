import { describe, expect, it, vi } from "vitest";
import { buildCommunitySnapshotRequest, parseCommunitySnapshotArgs, requestCommunitySnapshot, syncCommunitySnapshot } from "./sync-community-snapshot.mjs";
const token = "11111111-2222-4333-8444-555555555555";
const scope = { locationId: "location-1", groupId: "group-1" };
const lease = { schemaVersion: 1, action: "begin", captureId: "capture-1", result: { status: "capturing", leaseToken: token, scope } };
const source = { captureId: "capture-1", scope };
const env = { SUPABASE_URL: "https://synthetic.supabase.co", GHL_COMMUNITY_SYNC_SECRET: "synthetic-secret" };
describe("private Community snapshot client", () => {
  it("builds a matching raw capture request from private lease receipt", async () => {
    const options = parseCommunitySnapshotArgs(["--action", "apply", "--lease", "lease.json", "--capture", "capture.json", "--receipt", "output/private/receipt.json"]);
    expect(await buildCommunitySnapshotRequest(options, file => Promise.resolve(file === "lease.json" ? lease : source))).toEqual({ capture: source, leaseToken: token });
  });
  it("rejects mismatched capture identity or scope before contacting server", async () => {
    const options = { "--action": "apply", "--lease": "lease", "--capture": "capture" };
    for (const changed of [{ ...source, captureId: "other" }, { ...source, scope: { ...scope, groupId: "other" } }]) {
      await expect(buildCommunitySnapshotRequest(options, file => Promise.resolve(file === "lease" ? lease : changed))).rejects.toThrow("does not match");
    }
  });
  it.each([[], ["--action", "begin", "--receipt", "out"], ["--action", "begin", "--capture-id", "id", "--lease-seconds", "3601", "--receipt", "out"], ["--action", "apply", "--secret", "secret", "--receipt", "out"], ["--action", "status", "--lease", "file", "--receipt", "out"]])("rejects invalid command options", args => {
    expect(() => parseCommunitySnapshotArgs(args)).toThrow();
  });
  it("keeps auth secret in header, enforces trusted project URL and refuses redirects", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ status: "capturing" }));
    await requestCommunitySnapshot("begin", { captureId: "capture-1" }, env, fetcher);
    const [url, options] = fetcher.mock.calls[0];
    expect(String(url)).toBe("https://synthetic.supabase.co/functions/v1/academy-community-sync/snapshot/begin");
    expect(options.headers["x-community-sync-secret"]).toBe(env.GHL_COMMUNITY_SYNC_SECRET);
    expect(options.body).not.toContain(env.GHL_COMMUNITY_SYNC_SECRET); expect(options.redirect).toBe("error");
    for (const base of ["http://synthetic.supabase.co", "https://evil.example.com", "https://synthetic.supabase.co?secret=anything", "https://user:pass@synthetic.supabase.co"]) {
      await expect(requestCommunitySnapshot("begin", {}, { ...env, SUPABASE_URL: base }, fetcher)).rejects.toThrow();
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("saves detailed blocked receipts privately but returns only concise safe status", async () => {
    const writeReceipt = vi.fn(), fetcher = vi.fn().mockResolvedValue(Response.json({ status: "blocked", review: [{ code: "missing_is_not_deletion", externalId: "private-source-id" }] }, { status: 422 }));
    const options = parseCommunitySnapshotArgs(["--action", "begin", "--capture-id", "capture-1", "--receipt", "output/private/new.json"]);
    const result = await syncCommunitySnapshot(options, { env, fetcher, writeReceipt, preflightReceipt: vi.fn() });
    expect(result).toEqual({ action: "begin", httpStatus: 422, status: "blocked", receiptSaved: true, ok: false });
    expect(JSON.stringify(result)).not.toContain("private-source-id");
    expect(writeReceipt.mock.calls[0][1]).toMatchObject({ captureId: "capture-1", httpStatus: 422, result: { status: "blocked" } });
  });
  it("requires credentials and rejects invalid response JSON instead of claiming acceptance", async () => {
    await expect(requestCommunitySnapshot("status", {}, { SUPABASE_URL: env.SUPABASE_URL }, vi.fn())).rejects.toThrow("GHL_COMMUNITY_SYNC_SECRET");
    const fetcher = vi.fn().mockResolvedValue(new Response("not JSON"));
    await expect(requestCommunitySnapshot("status", {}, env, fetcher)).rejects.toThrow("invalid JSON");
  });
  it("validates receipt storage before a remote mutation", async () => {
    const fetcher = vi.fn(), preflightReceipt = vi.fn().mockRejectedValue(new Error("Receipt file already exists"));
    const options = parseCommunitySnapshotArgs(["--action", "begin", "--capture-id", "capture-1", "--receipt", "output/private/exists.json"]);
    await expect(syncCommunitySnapshot(options, { env, fetcher, preflightReceipt })).rejects.toThrow("already exists");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
