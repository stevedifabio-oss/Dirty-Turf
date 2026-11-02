import { beforeEach, describe, expect, it, vi } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("./backend", () => ({ supabase: { rpc } }));
import { loadFreeAccess, saveFreeAccess } from "./freeAccess";

describe("owner free access requests", () => {
  beforeEach(() => rpc.mockReset());
  it("sends only the selected scope and expiration, with no billing mutation", async () => {
    rpc.mockResolvedValue({ error: null });
    const end = new Date(Date.now() + 86_400_000).toISOString();
    await saveFreeAccess("member", "measuring_tool", true, end);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("admin_set_free_access", { p_member_id: "member", p_resource: "measuring_tool", p_enabled: true, p_ends_at: end });
  });
  it("removes only this owner's free source without cancelling purchases", async () => {
    rpc.mockResolvedValue({ error: null });
    await saveFreeAccess("member", "community", false, null);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("admin_set_free_access", { p_member_id: "member", p_resource: "community", p_enabled: false, p_ends_at: null });
  });
  it("rejects expired grants before sending and does not hide server failures", async () => {
    await expect(saveFreeAccess("member", "community", true, "2000-01-01")).rejects.toThrow("future");
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ error: { message: "private detail" } });
    await expect(saveFreeAccess("member", "community", true, null)).rejects.toThrow("Reload free grants");
    await expect(loadFreeAccess("member")).rejects.not.toThrow("private detail");
  });
  it("explains an existing course restriction without blaming the owner's login", async () => {
    rpc.mockResolvedValue({ error: { code: "P0001", message: "This course is blocked. Review its existing access restriction first." } });
    await expect(saveFreeAccess("member", "course", true, null)).rejects.toThrow("Enable its checkbox under Course access restrictions below");
  });
  it("distinguishes authorization failures from service availability", async () => {
    rpc.mockResolvedValue({ error: { code: "42501", message: "private detail" } });
    await expect(saveFreeAccess("member", "community", true, null)).rejects.toThrow("steve@dirtyturf.com");
    rpc.mockResolvedValue({ error: { code: "PGRST202", message: "private detail" } });
    await expect(saveFreeAccess("member", "community", true, null)).rejects.toThrow("service is unavailable");
  });
  it("validates owner inventory rather than treating malformed responses as saved", async () => {
    rpc.mockResolvedValue({ data: [{ resource: "community", endsAt: null }], error: null });
    expect(await loadFreeAccess("member")).toEqual([{ resource: "community", endsAt: null }]);
    rpc.mockResolvedValue({ data: [{ resource: "community", endsAt: "invalid" }], error: null });
    await expect(loadFreeAccess("member")).rejects.toThrow("verified");
  });
});
