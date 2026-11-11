import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMembershipVerificationHandler, type MembershipVerificationDependencies, type VerifiedStoreMembership } from "./store-membership-handler";

const uid = "e9bc91a5-9762-47f7-8542-aa1183f87396";
const productId = "dirty_turf_scanner_monthly";
const verified: VerifiedStoreMembership = { provider: "google", sourceKey: "a".repeat(64), userId: uid, productId, status: "active", currentPeriodEnd: "2026-12-03T12:00:00Z", autoRenew: true, environment: "production", verifiedAt: "2026-11-03T12:00:00Z" };
const request = (body: unknown, authorization = "Bearer member-jwt") => new Request("https://example.test/verify-store-membership", { method: "POST", headers: { Authorization: authorization, "Content-Type": "application/json" }, body: JSON.stringify(body) });
describe("store proof fulfillment boundary", () => {
  let deps: MembershipVerificationDependencies;
  beforeEach(() => { deps = { authenticate: vi.fn(async () => uid), availability: vi.fn(async () => ({ enabled: true, products: [productId] })), verifyGoogle: vi.fn(async () => verified), verifyApple: vi.fn(async () => ({ ...verified, provider: "apple" })), apply: vi.fn(async () => undefined), acknowledgeGoogle: vi.fn(async () => undefined) }; });
  it("requires real sign-in before inspecting proof", async () => {
    const response = await createMembershipVerificationHandler(deps)(request({}, ""));
    expect(response.status).toBe(401); expect(deps.verifyGoogle).not.toHaveBeenCalled();
  });
  it("does not turn on access just because a client reports purchased", async () => {
    vi.mocked(deps.verifyGoogle).mockRejectedValue(new Error("Invalid signature token=private"));
    const response = await createMembershipVerificationHandler(deps)(request({ provider: "google", productId, purchaseToken: "synthetic-proof-token", status: "purchased" }));
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("private"); expect(deps.apply).not.toHaveBeenCalled(); expect(deps.acknowledgeGoogle).not.toHaveBeenCalled();
  });
  it("applies exactly the verified Scanner entitlement before acknowledging it", async () => {
    const response = await createMembershipVerificationHandler(deps)(request({ provider: "google", productId, purchaseToken: "synthetic-proof-token", userId: "spoofed-user", communityAccess: true }));
    expect(response.status).toBe(200); expect(deps.verifyGoogle).toHaveBeenCalledWith("synthetic-proof-token", uid);
    expect(deps.apply).toHaveBeenCalledWith(verified); expect(deps.acknowledgeGoogle).toHaveBeenCalledWith("synthetic-proof-token", uid);
    expect(vi.mocked(deps.apply).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(deps.acknowledgeGoogle).mock.invocationCallOrder[0]);
  });
  it("preserves pending payments without granting or acknowledging", async () => {
    const response = await createMembershipVerificationHandler(deps)(request({ provider: "google", productId, purchaseToken: "synthetic-proof-token", purchaseState: "pending" }));
    expect(response.status).toBe(422); expect(deps.apply).not.toHaveBeenCalled();
  });
  it("respects the held activation flag", async () => {
    vi.mocked(deps.availability).mockResolvedValue({ enabled: false, products: [productId] });
    expect((await createMembershipVerificationHandler(deps)(request({ provider: "google", productId, purchaseToken: "synthetic-proof-token" }))).status).toBe(503);
    expect(deps.verifyGoogle).not.toHaveBeenCalled();
  });
  it("restores an existing store membership while new enrollment is held", async () => {
    vi.mocked(deps.availability).mockResolvedValue({ enabled: false, products: [], restorableProducts: [productId] });
    expect((await createMembershipVerificationHandler(deps)(request({ provider: "google", productId, purchaseToken: "synthetic-proof-token" }))).status).toBe(200);
    expect(deps.apply).toHaveBeenCalledWith(verified);
  });
  it("limits provider calls per verified account without acknowledging or granting", async () => {
    deps.reserveVerification = vi.fn(async () => false);
    expect((await createMembershipVerificationHandler(deps)(request({ provider: "google", productId, purchaseToken: "synthetic-proof-token" }))).status).toBe(429);
    expect(deps.verifyGoogle).not.toHaveBeenCalled(); expect(deps.apply).not.toHaveBeenCalled();
  });
  it.each([{ ...verified, userId: "0d3d1522-d69a-439c-8931-07bed114ce71" }, { ...verified, productId: "dirty_turf_community_monthly" }, { ...verified, provider: "apple" as const }])("rejects a mismatched verified identity or product", async record => {
    vi.mocked(deps.verifyGoogle).mockResolvedValue(record);
    expect((await createMembershipVerificationHandler(deps)(request({ provider: "google", productId, purchaseToken: "synthetic-proof-token" }))).status).toBe(503);
    expect(deps.apply).not.toHaveBeenCalled();
  });
  it("does not acknowledge if durable fulfillment fails", async () => {
    vi.mocked(deps.apply).mockRejectedValue(new Error("database unavailable"));
    expect((await createMembershipVerificationHandler(deps)(request({ provider: "google", productId, purchaseToken: "synthetic-proof-token" }))).status).toBe(503);
    expect(deps.acknowledgeGoogle).not.toHaveBeenCalled();
  });
  it("reconciles expired access without acknowledging an expired purchase", async () => {
    vi.mocked(deps.verifyGoogle).mockResolvedValue({ ...verified, status: "expired" });
    const response = await createMembershipVerificationHandler(deps)(request({ provider: "google", productId, purchaseToken: "synthetic-proof-token" }));
    expect(response.status).toBe(200); expect((await response.json()).active).toBe(false); expect(deps.apply).toHaveBeenCalled(); expect(deps.acknowledgeGoogle).not.toHaveBeenCalled();
  });
  it("requires server verification for an Apple proof too", async () => {
    const response = await createMembershipVerificationHandler(deps)(request({ provider: "apple", productId, signedTransactionInfo: "synthetic.signed.transaction" }));
    expect(response.status).toBe(200); expect(deps.verifyApple).toHaveBeenCalledWith("synthetic.signed.transaction", uid); expect(deps.acknowledgeGoogle).not.toHaveBeenCalled();
  });
  it("rejects oversized proof before any provider call", async () => {
    const response = await createMembershipVerificationHandler(deps)(request({ provider: "google", productId, purchaseToken: "a".repeat(70_000) }));
    expect(response.status).toBe(413); expect(deps.verifyGoogle).not.toHaveBeenCalled();
  });
});
