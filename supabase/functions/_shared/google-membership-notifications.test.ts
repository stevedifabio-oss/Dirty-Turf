import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGoogleMembershipNotificationHandler } from "./google-membership-notifications";
import type { VerifiedStoreMembership } from "./store-membership-handler";
const userId = "b65d858f-49e0-491e-94d2-973fe782be92";
const value: VerifiedStoreMembership = { provider: "google", sourceKey: "a".repeat(64), userId, productId: "dirty_turf_scanner_monthly", status: "active", currentPeriodEnd: "2026-12-01T00:00:00Z", autoRenew: true, environment: "production", verifiedAt: "2026-11-03T00:00:00Z" };
const request = (payload: unknown) => new Request("https://example.test/google-store-membership-notifications", { method: "POST", body: JSON.stringify({ message: { data: btoa(JSON.stringify(payload)) } }) });
const payload = { packageName: "com.dirtyturf.academy", subscriptionNotification: { purchaseToken: "synthetic-purchase-token", notificationType: 2 } };
describe("Google subscription notifications", () => {
  let deps: Parameters<typeof createGoogleMembershipNotificationHandler>[0];
  beforeEach(() => { deps = { authenticate: vi.fn(async () => true), sourceKey: vi.fn(async () => value.sourceKey), lookup: vi.fn(async () => userId), verify: vi.fn(async () => value), apply: vi.fn(async () => undefined) }; });
  it("rejects unsigned or wrong-audience push requests before reading purchase data", async () => {
    vi.mocked(deps.authenticate).mockResolvedValue(false);
    expect((await createGoogleMembershipNotificationHandler(deps)(request(payload))).status).toBe(401);
    expect(deps.lookup).not.toHaveBeenCalled(); expect(deps.apply).not.toHaveBeenCalled();
  });
  it("rejects a different app's notification", async () => {
    expect((await createGoogleMembershipNotificationHandler(deps)(request({ ...payload, packageName: "different.app" }))).status).toBe(400);
    expect(deps.verify).not.toHaveBeenCalled();
  });
  it("looks up the immutable binding and refreshes authoritative subscription state", async () => {
    expect((await createGoogleMembershipNotificationHandler(deps)(request(payload))).status).toBe(204);
    expect(deps.verify).toHaveBeenCalledWith("synthetic-purchase-token", userId); expect(deps.apply).toHaveBeenCalledWith(value);
  });
  it("never invents an owner for a token arriving before initial fulfillment", async () => {
    vi.mocked(deps.lookup).mockResolvedValue(null);
    expect((await createGoogleMembershipNotificationHandler(deps)(request(payload))).status).toBe(204);
    expect(deps.verify).not.toHaveBeenCalled(); expect(deps.apply).not.toHaveBeenCalled();
  });
  it("fulfills and acknowledges a pending payment that completes with the app closed", async () => {
    vi.mocked(deps.lookup).mockResolvedValue(null);
    deps.accountBinding = vi.fn(async () => "c".repeat(64)); deps.resolveAccount = vi.fn(async () => userId);
    deps.acknowledge = vi.fn(async () => value);
    expect((await createGoogleMembershipNotificationHandler(deps)(request(payload))).status).toBe(204);
    expect(deps.resolveAccount).toHaveBeenCalledWith("c".repeat(64)); expect(deps.verify).toHaveBeenCalledWith("synthetic-purchase-token", userId);
    expect(deps.acknowledge).toHaveBeenCalledWith("synthetic-purchase-token", userId);
    expect(vi.mocked(deps.apply).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(deps.acknowledge).mock.invocationCallOrder[0]);
  });
  it("retries a failed acknowledgement after a durable grant", async () => {
    deps.acknowledge = vi.fn(async () => { throw new Error("temporary provider failure"); });
    expect((await createGoogleMembershipNotificationHandler(deps)(request(payload))).status).toBe(503);
    expect(deps.apply).toHaveBeenCalledWith(value);
  });
  it("uses Google's current expiry even if the notification says renewed", async () => {
    vi.mocked(deps.verify).mockResolvedValue({ ...value, status: "expired" });
    expect((await createGoogleMembershipNotificationHandler(deps)(request(payload))).status).toBe(204);
    expect(deps.apply).toHaveBeenCalledWith(expect.objectContaining({ status: "expired" }));
  });
  it.each([{ ...value, sourceKey: "b".repeat(64) }, { ...value, userId: "someone-else" }])("rejects mismatched immutable bindings", async record => {
    vi.mocked(deps.verify).mockResolvedValue(record);
    expect((await createGoogleMembershipNotificationHandler(deps)(request(payload))).status).toBe(503); expect(deps.apply).not.toHaveBeenCalled();
  });
  it("retries provider failures without changing grants", async () => {
    vi.mocked(deps.verify).mockRejectedValue(new Error("private provider error"));
    const response = await createGoogleMembershipNotificationHandler(deps)(request(payload));
    expect(response.status).toBe(503); expect(await response.text()).toBe(""); expect(deps.apply).not.toHaveBeenCalled();
  });
  it("acknowledges a valid test notification without any grant", async () => {
    expect((await createGoogleMembershipNotificationHandler(deps)(request({ packageName: "com.dirtyturf.academy", testNotification: {} }))).status).toBe(204);
    expect(deps.lookup).not.toHaveBeenCalled(); expect(deps.apply).not.toHaveBeenCalled();
  });
});
