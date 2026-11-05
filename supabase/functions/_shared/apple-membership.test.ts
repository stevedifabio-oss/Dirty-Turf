import { describe, expect, it, vi } from "vitest";
import {
  APPLE_MEMBERSHIP_APP_ID, APPLE_MEMBERSHIP_BUNDLE_ID, createAppleMembershipVerifier,
  type AppleMembershipConfig, type AppleMembershipEnvironment,
} from "./apple-membership";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const PRODUCT = "dirty_turf_scanner_monthly";
const NOW = new Date("2026-11-03T22:00:00.000Z");
const DAY = 86_400_000;
const CONFIG: AppleMembershipConfig = { privateKey: "synthetic-test-only", keyId: "SYNTHETIC0", issuerId: USER };
const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
function fixture(environment: AppleMembershipEnvironment = "production") {
  const storeEnvironment = environment === "production" ? "Production" : "Sandbox";
  let nextSignature = 1;
  const decoded = new Map<string, unknown>();
  const signed = (value: unknown) => {
    const proof = `${encode({ alg: "ES256" })}.${encode(value)}.${encode({ synthetic: nextSignature++ })}`;
    decoded.set(proof, value);
    return proof;
  };
  const transaction = (changes: Record<string, unknown> = {}) => ({
    bundleId: APPLE_MEMBERSHIP_BUNDLE_ID, environment: storeEnvironment,
    appAccountToken: USER, productId: PRODUCT, type: "Auto-Renewable Subscription",
    inAppOwnershipType: "PURCHASED", transactionId: "100000000002", originalTransactionId: "100000000001",
    purchaseDate: NOW.getTime() - DAY, expiresDate: NOW.getTime() + 29 * DAY,
    ...changes,
  });
  const renewal = (changes: Record<string, unknown> = {}) => ({
    environment: storeEnvironment, originalTransactionId: "100000000001", productId: PRODUCT,
    appAccountToken: USER, autoRenewStatus: 1, ...changes,
  });
  const originalProof = signed(transaction({ transactionId: "100000000001", expiresDate: NOW.getTime() - DAY }));
  const target: Record<string, unknown> = {
    originalTransactionId: "100000000001", status: 1,
    signedTransactionInfo: signed(transaction()), signedRenewalInfo: signed(renewal()),
  };
  const response: Record<string, unknown> = {
    bundleId: APPLE_MEMBERSHIP_BUNDLE_ID, appAppleId: APPLE_MEMBERSHIP_APP_ID,
    environment: storeEnvironment, data: [{ subscriptionGroupIdentifier: "scanner", lastTransactions: [target] }],
  };
  const verify = vi.fn(async (proof: string) => {
    if (!decoded.has(proof)) throw new Error("Synthetic signature is invalid");
    return decoded.get(proof);
  });
  const getAllSubscriptionStatuses = vi.fn(async () => response);
  const verifierForEnvironment = vi.fn((requested: AppleMembershipEnvironment) => {
    if (requested !== environment) throw new Error("Wrong environment verifier");
    return { verifyAndDecodeTransaction: verify, verifyAndDecodeRenewalInfo: verify, verifyAndDecodeNotification: verify };
  });
  const clientForEnvironment = vi.fn((requested: AppleMembershipEnvironment) => {
    if (requested !== environment) throw new Error("Wrong environment API");
    return { getAllSubscriptionStatuses };
  });
  const implementation = createAppleMembershipVerifier({ verifierForEnvironment, clientForEnvironment });
  return {
    signed, transaction, renewal, originalProof, target, response, verify, getAllSubscriptionStatuses,
    verifierForEnvironment, clientForEnvironment, ...implementation,
  };
}

describe("Apple verified independent memberships", () => {
  it("refreshes an expired device proof against the current signed subscription before granting access", async () => {
    const f = fixture();
    const result = await f.verifyAppleMembership(f.originalProof, USER, CONFIG, NOW);
    expect(f.getAllSubscriptionStatuses).toHaveBeenCalledWith("100000000001");
    expect(result).toEqual({
      provider: "apple", sourceKey: "100000000001", userId: USER, productId: PRODUCT,
      status: "active", currentPeriodEnd: new Date(NOW.getTime() + 29 * DAY).toISOString(),
      autoRenew: true, environment: "production", verifiedAt: NOW.toISOString(),
    });
  });
  it("retains paid access after renewal cancellation until the verified expiry", async () => {
    const f = fixture();
    f.target.signedRenewalInfo = f.signed(f.renewal({ autoRenewStatus: 0 }));
    const result = await f.verifyAppleMembership(f.originalProof, USER, CONFIG, NOW);
    expect(result.status).toBe("active");
    expect(result.autoRenew).toBe(false);
  });
  it.each([2, 3])("denies access for authoritative Apple state %s even when device proof was valid", async (status) => {
    const f = fixture(); f.target.status = status;
    expect((await f.verifyAppleMembership(f.originalProof, USER, CONFIG, NOW)).status).toBe("expired");
  });
  it("does not reactivate a refunded subscription from a still-signed old device proof", async () => {
    const f = fixture(); f.target.status = 5;
    expect((await f.verifyAppleMembership(f.originalProof, USER, CONFIG, NOW)).status).toBe("revoked");
  });
  it("honors a signed latest revocation even when the status flag disagrees", async () => {
    const f = fixture();
    f.target.signedTransactionInfo = f.signed(f.transaction({ revocationDate: NOW.getTime() - 1000 }));
    expect((await f.verifyAppleMembership(f.originalProof, USER, CONFIG, NOW)).status).toBe("revoked");
  });
  it("does not grant beyond expiry even if the API calls the subscription active", async () => {
    const f = fixture();
    f.target.signedTransactionInfo = f.signed(f.transaction({ expiresDate: NOW.getTime() }));
    expect((await f.verifyAppleMembership(f.originalProof, USER, CONFIG, NOW)).status).toBe("expired");
  });
  it("uses only Apple's signed grace period end for billing grace access", async () => {
    const f = fixture(); f.target.status = 4;
    f.target.signedTransactionInfo = f.signed(f.transaction({ expiresDate: NOW.getTime() - DAY }));
    f.target.signedRenewalInfo = f.signed(f.renewal({ gracePeriodExpiresDate: NOW.getTime() + DAY }));
    const result = await f.verifyAppleMembership(f.originalProof, USER, CONFIG, NOW);
    expect(result.status).toBe("active");
    expect(result.currentPeriodEnd).toBe(new Date(NOW.getTime() + DAY).toISOString());
    f.target.signedRenewalInfo = f.signed(f.renewal({ gracePeriodExpiresDate: NOW.getTime() }));
    expect((await f.verifyAppleMembership(f.originalProof, USER, CONFIG, NOW)).status).toBe("expired");
  });
  it("fails closed on missing or inconsistent grace dates", async () => {
    const f = fixture(); f.target.status = 4;
    await expect(f.verifyAppleMembership(f.originalProof, USER, CONFIG, NOW)).rejects.toThrow();
    f.target.signedRenewalInfo = f.signed(f.renewal({ gracePeriodExpiresDate: NOW.getTime() + DAY }));
    await expect(f.verifyAppleMembership(f.originalProof, USER, CONFIG, NOW)).rejects.toThrow("grace");
  });
  it("refuses another app account before making a provider lookup", async () => {
    const f = fixture();
    await expect(f.verifyAppleMembership(f.originalProof, OTHER, CONFIG, NOW)).rejects.toThrow("another account");
    expect(f.getAllSubscriptionStatuses).not.toHaveBeenCalled();
  });
  it.each([
    { productId: "unrelated_product" }, { type: "Non-Consumable" }, { bundleId: "com.unrelated.app" },
    { inAppOwnershipType: "FAMILY_SHARED" }, { isUpgraded: true }, { appAccountToken: undefined },
  ])("rejects unsupported initial transaction scope %j", async (changes) => {
    const f = fixture();
    await expect(f.verifyAppleMembership(f.signed(f.transaction(changes)), USER, CONFIG, NOW)).rejects.toThrow();
    expect(f.getAllSubscriptionStatuses).not.toHaveBeenCalled();
  });
  it.each([
    { appAccountToken: OTHER }, { productId: "dirty_turf_community_monthly" },
    { originalTransactionId: "100000000099" }, { environment: "Sandbox" },
    { expiresDate: "future" }, { purchaseDate: NOW.getTime() + DAY },
  ])("rejects a latest transaction whose identity or time conflicts %j", async (changes) => {
    const f = fixture(); f.target.signedTransactionInfo = f.signed(f.transaction(changes));
    await expect(f.verifyAppleMembership(f.originalProof, USER, CONFIG, NOW)).rejects.toThrow();
  });
  it.each([
    { appAccountToken: OTHER }, { originalTransactionId: "100000000099" },
    { environment: "Sandbox" }, { productId: "dirty_turf_community_monthly" }, { autoRenewStatus: 7 },
  ])("rejects conflicting signed renewal information %j", async (changes) => {
    const f = fixture(); f.target.signedRenewalInfo = f.signed(f.renewal(changes));
    await expect(f.verifyAppleMembership(f.originalProof, USER, CONFIG, NOW)).rejects.toThrow();
  });
  it.each([
    { bundleId: "com.unrelated.app" }, { appAppleId: 123 }, { environment: "Sandbox" }, { data: [] },
  ])("rejects an API response without the exact app and subscription %j", async (changes) => {
    const f = fixture(); Object.assign(f.response, changes);
    await expect(f.verifyAppleMembership(f.originalProof, USER, CONFIG, NOW)).rejects.toThrow();
  });
  it("does not guess when the API has duplicate lineage entries", async () => {
    const f = fixture(); f.response.data = [{ lastTransactions: [f.target, f.target] }];
    await expect(f.verifyAppleMembership(f.originalProof, USER, CONFIG, NOW)).rejects.toThrow("resolved");
  });
  it("selects the matching original transaction instead of another membership in the response", async () => {
    const f = fixture();
    f.response.data = [{ lastTransactions: [{ originalTransactionId: "100000000099" }] }, { lastTransactions: [f.target] }];
    expect((await f.verifyAppleMembership(f.originalProof, USER, CONFIG, NOW)).productId).toBe(PRODUCT);
  });
  it("does not fall back to old device data when Apple is unavailable", async () => {
    const f = fixture(); f.getAllSubscriptionStatuses.mockRejectedValueOnce(new Error("Synthetic outage"));
    await expect(f.verifyAppleMembership(f.originalProof, USER, CONFIG, NOW)).rejects.toThrow("outage");
  });
  it("requires cryptographic verification before any authoritative API call", async () => {
    const f = fixture(); const tampered = f.originalProof + "tampered";
    await expect(f.verifyAppleMembership(tampered, USER, CONFIG, NOW)).rejects.toThrow("signature");
    expect(f.getAllSubscriptionStatuses).not.toHaveBeenCalled();
  });
  it.each(["", "a.b.c", "not-a-jws", "a." + "a".repeat(65_536) + ".c"])("rejects malformed or oversized proof", async (proof) => {
    const f = fixture();
    await expect(f.verifyAppleMembership(proof, USER, CONFIG, NOW)).rejects.toThrow();
    expect(f.verify).not.toHaveBeenCalled();
  });
  it("isolates the sandbox verifier and API instead of granting as production", async () => {
    const f = fixture("sandbox");
    const result = await f.verifyAppleMembership(f.originalProof, USER, CONFIG, NOW);
    expect(result.environment).toBe("sandbox");
    expect(f.clientForEnvironment).toHaveBeenCalledWith("sandbox", CONFIG);
  });
  it("never accepts Xcode or LocalTesting proofs on the hosted verifier", async () => {
    const f = fixture();
    await expect(f.verifyAppleMembership(f.signed(f.transaction({ environment: "Xcode" })), USER, CONFIG, NOW)).rejects.toThrow("environment");
    expect(f.verify).not.toHaveBeenCalled();
  });
});

describe("Apple signed subscription notifications", () => {
  it("derives the member from the verified transaction then refreshes current status", async () => {
    const f = fixture(); f.target.status = 5;
    const notification = f.signed({
      notificationType: "DID_RENEW", appAccountToken: OTHER,
      data: { bundleId: APPLE_MEMBERSHIP_BUNDLE_ID, appAppleId: APPLE_MEMBERSHIP_APP_ID,
        environment: "Production", signedTransactionInfo: f.originalProof },
    });
    const result = await f.verifyAppleMembershipNotification(notification, CONFIG, NOW);
    expect(result?.userId).toBe(USER);
    expect(result?.status).toBe("revoked");
  });
  it("does not process unsigned notification data", async () => {
    const f = fixture();
    const notification = f.signed({ data: { environment: "Production" } }) + "tampered";
    await expect(f.verifyAppleMembershipNotification(notification, CONFIG, NOW)).rejects.toThrow("signature");
    expect(f.getAllSubscriptionStatuses).not.toHaveBeenCalled();
  });
  it("acknowledges a fully verified TEST without inventing an entitlement", async () => {
    const f = fixture();
    const notification = f.signed({ notificationType: "TEST", data: {
      bundleId: APPLE_MEMBERSHIP_BUNDLE_ID, appAppleId: APPLE_MEMBERSHIP_APP_ID, environment: "Production",
    } });
    expect(await f.verifyAppleMembershipNotification(notification, CONFIG, NOW)).toBeNull();
    expect(f.getAllSubscriptionStatuses).not.toHaveBeenCalled();
  });
  it("rejects a signed notification for the wrong app even with a valid transaction", async () => {
    const f = fixture();
    const notification = f.signed({ data: { bundleId: "com.unrelated.app", appAppleId: APPLE_MEMBERSHIP_APP_ID,
      environment: "Production", signedTransactionInfo: f.originalProof } });
    await expect(f.verifyAppleMembershipNotification(notification, CONFIG, NOW)).rejects.toThrow("application");
    expect(f.getAllSubscriptionStatuses).not.toHaveBeenCalled();
  });
});
