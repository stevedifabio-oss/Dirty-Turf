import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGoogleMembershipVerifier, GOOGLE_MEMBERSHIP_PACKAGE, type GoogleMembershipDependencies } from "./google-membership";

const userId = "00000000-1111-4222-8333-444444444444";
const accountHash = "6bda766231cc1a705b966314dba71fdc54fe8bdf733b151a364ed87884feff74";
const purchaseToken = "fixture-google-purchase-token";
const config = { serviceAccountJson: "server-only-fixture" };
const now = new Date("2026-11-03T18:00:00Z");
const expiry = "2026-12-03T18:00:00Z";
const productId = "dirty_turf_scanner_monthly";
function subscription() {
  return {
    kind: "androidpublisher#subscriptionPurchaseV2",
    subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
    acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING",
    externalAccountIdentifiers: { obfuscatedExternalAccountId: accountHash },
    lineItems: [{ productId, expiryTime: expiry, autoRenewingPlan: { autoRenewEnabled: true }, offerDetails: { basePlanId: "monthly" } }],
  };
}
let purchase: any;
let dependencies: GoogleMembershipDependencies;
beforeEach(() => {
  purchase = subscription();
  dependencies = {
    getSubscription: vi.fn(async () => purchase),
    acknowledgeSubscription: vi.fn(async () => {}),
    sha256: async (value) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, "0")).join(""),
  };
});
const verifier = () => createGoogleMembershipVerifier(dependencies);

describe("verified independent Google subscriptions", () => {
  it("uses Google state, exact account binding and expiry without acknowledging during verification", async () => {
    const result = await verifier().verifyGoogleMembership(purchaseToken, userId.toUpperCase(), config, now);
    expect(result).toMatchObject({ provider: "google", userId, productId, status: "active", autoRenew: true, currentPeriodEnd: "2026-12-03T18:00:00.000Z", environment: "production", verifiedAt: now.toISOString(), acknowledgementRequired: true });
    expect(result.sourceKey).toMatch(/^[0-9a-f]{64}$/);
    expect(result.sourceKey).not.toBe(purchaseToken);
    expect(dependencies.getSubscription).toHaveBeenCalledWith(purchaseToken, config);
    expect(dependencies.acknowledgeSubscription).not.toHaveBeenCalled();
  });
  it.each(["dirty_turf_community_monthly", "dirty_turf_scanner_monthly", "dirty_turf_academy_monthly"])("accepts independent product %s", async (id) => {
    purchase.lineItems[0].productId = id;
    expect((await verifier().verifyGoogleMembership(purchaseToken, userId, config, now)).productId).toBe(id);
  });
  it("keeps a canceled subscription active only through its verified paid expiry", async () => {
    purchase.subscriptionState = "SUBSCRIPTION_STATE_CANCELED";
    purchase.lineItems[0].autoRenewingPlan.autoRenewEnabled = false;
    expect(await verifier().verifyGoogleMembership(purchaseToken, userId, config, now)).toMatchObject({ status: "active", autoRenew: false });
    expect(await verifier().verifyGoogleMembership(purchaseToken, userId, config, new Date(expiry))).toMatchObject({ status: "expired", autoRenew: false });
  });
  it("uses Google's current grace-period expiry and grants no time beyond it", async () => {
    purchase.subscriptionState = "SUBSCRIPTION_STATE_IN_GRACE_PERIOD";
    purchase.lineItems[0].expiryTime = "2026-11-04T18:00:00Z";
    expect((await verifier().verifyGoogleMembership(purchaseToken, userId, config, now)).status).toBe("active");
    expect((await verifier().verifyGoogleMembership(purchaseToken, userId, config, new Date("2026-11-04T18:00:01Z"))).status).toBe("expired");
  });
  it.each(["SUBSCRIPTION_STATE_PENDING", "SUBSCRIPTION_STATE_PAUSED", "SUBSCRIPTION_STATE_ON_HOLD", "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED"])("does not grant access in %s even with a future expiry", async (state) => {
    purchase.subscriptionState = state;
    expect(await verifier().verifyGoogleMembership(purchaseToken, userId, config, now)).toMatchObject({ status: "revoked", autoRenew: false });
  });
  it("denies expired state regardless of a future timestamp", async () => {
    purchase.subscriptionState = "SUBSCRIPTION_STATE_EXPIRED";
    expect((await verifier().verifyGoogleMembership(purchaseToken, userId, config, now)).status).toBe("expired");
  });
  it("never derives identity from email, client product fields or raw user IDs", async () => {
    purchase.externalAccountIdentifiers = { externalAccountId: userId, obfuscatedExternalAccountId: "f".repeat(64) };
    await expect(verifier().verifyGoogleMembership(purchaseToken, userId, config, now)).rejects.toMatchObject({ code: "GOOGLE_PURCHASE_ACCOUNT_MISMATCH" });
    expect(dependencies.acknowledgeSubscription).not.toHaveBeenCalled();
  });
  it("rejects an absent purchaser binding", async () => {
    delete purchase.externalAccountIdentifiers;
    await expect(verifier().verifyGoogleMembership(purchaseToken, userId, config, now)).rejects.toThrow();
  });
  it.each([
    (value: any) => { value.packageName = "com.other.app"; },
    (value: any) => { value.kind = "untrusted-client-purchase"; },
    (value: any) => { value.lineItems[0].productId = "unknown_product"; },
    (value: any) => { value.lineItems.push({ ...value.lineItems[0] }); },
    (value: any) => { value.lineItems[0].offerDetails.basePlanId = "annual"; },
    (value: any) => { value.lineItems[0].offerDetails.offerId = "free-trial"; },
    (value: any) => { value.lineItems[0].offerPhase = { freeTrial: {} }; },
    (value: any) => { value.lineItems[0].prepaidPlan = {}; },
    (value: any) => { value.lineItems[0].autoRenewingPlan.installmentDetails = {}; },
    (value: any) => { value.lineItems[0].deferredItemReplacement = { productId: "dirty_turf_academy_monthly" }; },
    (value: any) => { value.subscriptionState = "SUBSCRIPTION_STATE_UNSPECIFIED"; },
    (value: any) => { value.acknowledgementState = "unknown"; },
  ])("rejects unsupported app, product, plan or purchase shape %#", async (mutate) => {
    mutate(purchase);
    await expect(verifier().verifyGoogleMembership(purchaseToken, userId, config, now)).rejects.toThrow();
    expect(dependencies.acknowledgeSubscription).not.toHaveBeenCalled();
  });
  it.each([undefined, "not a date", "2026-02-30T10:00:00Z", "2026-13-03T10:00:00Z", "2026-12-03T99:00:00Z"])("rejects invalid authoritative expiry %s", async (value) => {
    purchase.lineItems[0].expiryTime = value;
    await expect(verifier().verifyGoogleMembership(purchaseToken, userId, config, now)).rejects.toThrow("time is invalid");
  });
  it("normalizes fractional Google timestamps", async () => {
    purchase.lineItems[0].expiryTime = "2026-12-03T18:00:00.123456789Z";
    expect((await verifier().verifyGoogleMembership(purchaseToken, userId, config, now)).currentPeriodEnd).toBe("2026-12-03T18:00:00.123Z");
  });
  it("marks Google license-test purchases sandbox for the server allowlist", async () => {
    purchase.testPurchase = {};
    expect((await verifier().verifyGoogleMembership(purchaseToken, userId, config, now)).environment).toBe("sandbox");
  });
  it("does not accept malformed identity/token input or contact the provider", async () => {
    await expect(verifier().verifyGoogleMembership("short", userId, config, now)).rejects.toThrow();
    await expect(verifier().verifyGoogleMembership("valid-token\nwith-controls", userId, config, now)).rejects.toThrow();
    await expect(verifier().verifyGoogleMembership(purchaseToken, "not-a-user", config, now)).rejects.toThrow();
    expect(dependencies.getSubscription).not.toHaveBeenCalled();
  });
  it("fails closed on a Google API error and never acknowledges", async () => {
    vi.mocked(dependencies.getSubscription).mockRejectedValue(new Error("provider unavailable"));
    await expect(verifier().verifyGoogleMembership(purchaseToken, userId, config, now)).rejects.toThrow();
    expect(dependencies.acknowledgeSubscription).not.toHaveBeenCalled();
  });
});

describe("authoritative Google account binding for app-closed payment completion", () => {
  it("returns only the hashed account binding obtained from the Publisher API", async () => {
    expect(await verifier().getGoogleMembershipAccountBinding(purchaseToken, config)).toBe(accountHash);
    expect(dependencies.getSubscription).toHaveBeenCalledWith(purchaseToken, config);
    expect(dependencies.acknowledgeSubscription).not.toHaveBeenCalled();
  });
  it("can resolve a pending owner before expiry exists without granting or acknowledging", async () => {
    purchase.subscriptionState = "SUBSCRIPTION_STATE_PENDING";
    delete purchase.lineItems[0].expiryTime;
    expect(await verifier().getGoogleMembershipAccountBinding(purchaseToken, config)).toBe(accountHash);
    await expect(verifier().verifyGoogleMembership(purchaseToken, userId, config, now)).rejects.toThrow("time is invalid");
    expect(dependencies.acknowledgeSubscription).not.toHaveBeenCalled();
  });
  it.each([undefined, userId, "member@example.test", "f".repeat(63), "F".repeat(64)])("rejects a missing, raw or malformed account binding %s", async binding => {
    purchase.externalAccountIdentifiers = { externalAccountId: userId, obfuscatedExternalAccountId: binding };
    await expect(verifier().getGoogleMembershipAccountBinding(purchaseToken, config)).rejects.toThrow("binding is invalid");
  });
  it.each([
    (value: any) => { value.packageName = "com.other.app"; },
    (value: any) => { value.lineItems[0].productId = "unknown_product"; },
    (value: any) => { value.lineItems.push({ ...value.lineItems[0] }); },
    (value: any) => { value.lineItems[0].offerDetails.basePlanId = "annual"; },
    (value: any) => { value.lineItems[0].offerDetails.offerId = "trial"; },
  ])("checks application, independent product and monthly plan before returning a binding %#", async mutate => {
    mutate(purchase);
    await expect(verifier().getGoogleMembershipAccountBinding(purchaseToken, config)).rejects.toThrow();
    expect(dependencies.acknowledgeSubscription).not.toHaveBeenCalled();
  });
});

describe("post-grant Google acknowledgement", () => {
  it("rechecks the authoritative purchase/account before acknowledging a pending active purchase", async () => {
    const result = await verifier().acknowledgeGoogleMembership(purchaseToken, userId, config, now);
    expect(dependencies.getSubscription).toHaveBeenCalledTimes(1);
    expect(dependencies.acknowledgeSubscription).toHaveBeenCalledWith(purchaseToken, productId, config);
    expect(result.acknowledgementRequired).toBe(false);
  });
  it("does not send duplicate acknowledgement when Google already acknowledged", async () => {
    purchase.acknowledgementState = "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED";
    await verifier().acknowledgeGoogleMembership(purchaseToken, userId, config, now);
    expect(dependencies.acknowledgeSubscription).not.toHaveBeenCalled();
  });
  it.each(["SUBSCRIPTION_STATE_PENDING", "SUBSCRIPTION_STATE_ON_HOLD", "SUBSCRIPTION_STATE_EXPIRED"])("never acknowledges %s", async (state) => {
    purchase.subscriptionState = state;
    await expect(verifier().acknowledgeGoogleMembership(purchaseToken, userId, config, now)).rejects.toThrow();
    expect(dependencies.acknowledgeSubscription).not.toHaveBeenCalled();
  });
  it("never acknowledges another account's purchase", async () => {
    purchase.externalAccountIdentifiers.obfuscatedExternalAccountId = "different";
    await expect(verifier().acknowledgeGoogleMembership(purchaseToken, userId, config, now)).rejects.toThrow();
    expect(dependencies.acknowledgeSubscription).not.toHaveBeenCalled();
  });
  it("requires a successful acknowledgement result", async () => {
    vi.mocked(dependencies.acknowledgeSubscription).mockRejectedValue(new Error("ack unavailable"));
    await expect(verifier().acknowledgeGoogleMembership(purchaseToken, userId, config, now)).rejects.toThrow("ack unavailable");
  });
});
