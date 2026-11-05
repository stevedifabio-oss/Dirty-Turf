import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
  account: { id: "00000000-1111-4222-8333-444444444444", token: "initiator-session-token" } as { id: string; token: string } | null,
  platform: "android",
  getSession: vi.fn(), rpc: vi.fn(),
  getProducts: vi.fn(), purchase: vi.fn(), restorePurchases: vi.fn(), finishTransaction: vi.fn(), manageSubscriptions: vi.fn(), addListener: vi.fn(),
}));
vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: () => fixtures.platform, isNativePlatform: () => true, isPluginAvailable: () => true },
  registerPlugin: () => ({
    getProducts: fixtures.getProducts, purchase: fixtures.purchase, restorePurchases: fixtures.restorePurchases,
    finishTransaction: fixtures.finishTransaction, manageSubscriptions: fixtures.manageSubscriptions, addListener: fixtures.addListener,
  }),
}));
vi.mock("./backend", () => ({ supabase: { auth: { getSession: fixtures.getSession }, rpc: fixtures.rpc } }));

import { purchaseNativeMembership, restoreNativeMemberships, startScannerTrial } from "./nativeMemberships";

const initiator = { id: "00000000-1111-4222-8333-444444444444", token: "initiator-session-token" };
const nextAccount = { id: "00000000-1111-4222-8333-555555555555", token: "different-session-token" };
const scanner = "dirty_turf_scanner_monthly";
const status = { enabled: true, products: [scanner], ownedProducts: [], trialEligible: true, trialUsed: false, trialExpiresAt: null };
const product = { id: scanner, displayName: "Turf Scanner", displayPrice: "$24.95", priceAmountMicros: 24_950_000, currencyCode: "USD" };
const googleProof = { provider: "google", productId: scanner, purchaseToken: "fixture-google-purchase-token", purchaseState: "purchased" };
const appleProof = { provider: "apple", productId: scanner, signedTransactionInfo: "fixture-header.fixture-payload.fixture-signature", transactionId: "1234567890", purchaseState: "purchased" };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function session(account: typeof fixtures.account) {
  return { data: { session: account ? { user: { id: account.id }, access_token: account.token } : null }, error: null };
}
let request: ReturnType<typeof vi.fn>;
let dispatch: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  fixtures.account = { ...initiator };
  fixtures.platform = "android";
  fixtures.getSession.mockImplementation(async () => session(fixtures.account));
  fixtures.rpc.mockImplementation(async (name: string) => name === "get_membership_store_status"
    ? { data: status, error: null } : { data: { started: true, alreadyUsed: false, expiresAt: "2026-11-10T18:00:00Z" }, error: null });
  fixtures.getProducts.mockResolvedValue({ available: true, products: [product] });
  fixtures.purchase.mockResolvedValue({ status: "purchased", purchases: [googleProof] });
  fixtures.restorePurchases.mockResolvedValue({ purchases: [googleProof] });
  fixtures.finishTransaction.mockResolvedValue(undefined);
  request = vi.fn(async () => Response.json({ verified: true, active: true, productId: scanner, expiresAt: "2026-12-03T18:00:00Z" }));
  dispatch = vi.fn();
  vi.stubGlobal("fetch", request);
  vi.stubGlobal("window", { dispatchEvent: dispatch });
  vi.stubEnv("VITE_SUPABASE_URL", "https://backend.example.test");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_fixture");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("native membership account and purchase lifecycle", () => {
  it.each(["catalog", "store prices"])("does not open a charge if the account changes while %s is loading", async stage => {
    const loading = deferred<any>();
    if (stage === "catalog") fixtures.rpc.mockReturnValueOnce(loading.promise);
    else fixtures.getProducts.mockReturnValueOnce(loading.promise);
    const operation = purchaseNativeMembership(scanner);
    await vi.waitFor(() => expect(stage === "catalog" ? fixtures.rpc : fixtures.getProducts).toHaveBeenCalled());
    fixtures.account = { ...nextAccount };
    loading.resolve(stage === "catalog" ? { data: status, error: null } : { available: true, products: [product] });
    await expect(operation).rejects.toThrow(/account changed|sign in again/i);
    expect(fixtures.purchase).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });
  it("does not open a charge after signing out during store-price loading", async () => {
    const prices = deferred<any>();
    fixtures.getProducts.mockReturnValueOnce(prices.promise);
    const operation = purchaseNativeMembership(scanner);
    await vi.waitFor(() => expect(fixtures.getProducts).toHaveBeenCalled());
    fixtures.account = null;
    prices.resolve({ available: true, products: [product] });
    await expect(operation).rejects.toThrow(/sign in/i);
    expect(fixtures.purchase).not.toHaveBeenCalled();
  });
  it("does not create another subscription when refreshed server access already includes the product", async () => {
    fixtures.rpc.mockResolvedValueOnce({ data: { ...status, ownedProducts: [scanner] }, error: null });
    await expect(purchaseNativeMembership(scanner)).rejects.toThrow(/already have access/i);
    expect(fixtures.purchase).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });
  it("does not submit a proof for the newly signed-in account after an in-flight store purchase switches accounts", async () => {
    const storeResult = deferred<any>();
    fixtures.purchase.mockReturnValueOnce(storeResult.promise);
    const operation = purchaseNativeMembership(scanner);
    await vi.waitFor(() => expect(fixtures.purchase).toHaveBeenCalled());
    fixtures.account = { ...nextAccount };
    storeResult.resolve({ status: "purchased", purchases: [googleProof] });
    await expect(operation).rejects.toThrow(/account changed/i);
    expect(request).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });
  it("keeps the initiating JWT on in-flight proof verification and rejects account-switched completion", async () => {
    const response = deferred<Response>();
    request.mockReturnValueOnce(response.promise);
    const operation = purchaseNativeMembership(scanner);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(fixtures.purchase).toHaveBeenCalledWith({ productId: scanner, accountToken: initiator.id });
    fixtures.account = { ...nextAccount };
    response.resolve(Response.json({ verified: true, active: true }));
    await expect(operation).rejects.toThrow(/account changed/i);
    expect(request).toHaveBeenCalledTimes(1);
    const [url, init] = request.mock.calls[0];
    expect(url).toBe("https://backend.example.test/functions/v1/verify-store-membership");
    expect(new Headers(init.headers).get("Authorization")).toBe(`Bearer ${initiator.token}`);
    expect(new Headers(init.headers).get("Authorization")).not.toBe(`Bearer ${nextAccount.token}`);
    expect(dispatch).not.toHaveBeenCalled();
  });
  it.each([503, 200])("does not finish an Apple transaction when verification is unavailable/unverified (HTTP %s)", async httpStatus => {
    fixtures.platform = "ios";
    fixtures.restorePurchases.mockResolvedValueOnce({ purchases: [appleProof] });
    request.mockResolvedValueOnce(Response.json({ verified: false }, { status: httpStatus }));
    await expect(restoreNativeMemberships()).rejects.toThrow(/confirm/i);
    expect(fixtures.finishTransaction).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });
  it("finishes an Apple transaction only after server confirmation", async () => {
    fixtures.platform = "ios";
    fixtures.restorePurchases.mockResolvedValueOnce({ purchases: [appleProof] });
    const response = deferred<Response>();
    request.mockReturnValueOnce(response.promise);
    const operation = restoreNativeMemberships();
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(fixtures.finishTransaction).not.toHaveBeenCalled();
    response.resolve(Response.json({ verified: true, active: true }));
    expect(await operation).toEqual({ confirmed: 1, failed: 0 });
    expect(fixtures.finishTransaction).toHaveBeenCalledWith({ transactionId: appleProof.transactionId });
  });
  it("does not verify, finish or announce pending purchases as completed", async () => {
    fixtures.platform = "ios";
    fixtures.restorePurchases.mockResolvedValueOnce({ purchases: [{ ...appleProof, purchaseState: "pending" }] });
    expect(await restoreNativeMemberships()).toEqual({ confirmed: 0, failed: 0 });
    expect(request).not.toHaveBeenCalled();
    expect(fixtures.finishTransaction).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });
  it("continues restoring another independent membership after one proof cannot be confirmed", async () => {
    fixtures.platform = "ios";
    const academyProof = { ...appleProof, productId: "dirty_turf_academy_monthly", transactionId: "1234567891" };
    fixtures.restorePurchases.mockResolvedValueOnce({ purchases: [appleProof, academyProof] });
    request.mockResolvedValueOnce(Response.json({ verified: false }, { status: 503 }));
    request.mockResolvedValueOnce(Response.json({ verified: true, active: true }));
    expect(await restoreNativeMemberships()).toEqual({ confirmed: 1, failed: 1 });
    expect(request).toHaveBeenCalledTimes(2);
    expect(fixtures.finishTransaction).toHaveBeenCalledTimes(1);
    expect(fixtures.finishTransaction).toHaveBeenCalledWith({ transactionId: academyProof.transactionId });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
  it("starts a trial using the captured initiator JWT rather than the SDK's newly switched account", async () => {
    fixtures.getSession.mockImplementationOnce(async () => {
      fixtures.account = { ...nextAccount };
      return session(initiator);
    });
    request.mockResolvedValueOnce(Response.json({ started: true, alreadyUsed: false, expiresAt: "2026-11-10T18:00:00Z" }));
    await expect(startScannerTrial()).rejects.toThrow(/account changed/i);
    expect(fixtures.rpc).not.toHaveBeenCalledWith("start_turf_scanner_trial");
    expect(request).toHaveBeenCalledTimes(1);
    const [url, init] = request.mock.calls[0];
    expect(url).toBe("https://backend.example.test/rest/v1/rpc/start_turf_scanner_trial");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Authorization")).toBe(`Bearer ${initiator.token}`);
    expect(new Headers(init.headers).get("Authorization")).not.toBe(`Bearer ${nextAccount.token}`);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
