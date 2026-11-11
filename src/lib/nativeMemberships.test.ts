import { afterEach, describe, expect, it, vi } from "vitest";
import { MEMBERSHIP_PRODUCTS, parseStoreStatus, validateStoreProducts } from "./nativeMemberships";
vi.mock("./backend", () => ({ supabase: null }));

afterEach(() => vi.unstubAllGlobals());
describe("independent native membership availability", () => {
  const status = { enabled: true, products: [...MEMBERSHIP_PRODUCTS], ownedProducts: [], trialEligible: true, trialUsed: false, trialExpiresAt: null };
  it.each(MEMBERSHIP_PRODUCTS)("allows %s without any other owned product", id => {
    expect(parseStoreStatus({ ...status, products: [id], ownedProducts: [id] }).ownedProducts).toEqual([id]);
  });
  it("never treats a trial as a paid subscription", () => {
    expect(parseStoreStatus({ ...status, trialUsed: true, trialEligible: false, trialExpiresAt: "2026-11-10T12:00:00Z" }).ownedProducts).toEqual([]);
  });
  it.each([{ ...status, enabled: "yes" }, { ...status, products: ["unreviewed_product"] }, { ...status, ownedProducts: ["unreviewed_product"] }, { ...status, restorableProducts: "all" }, { ...status, restorableProducts: ["unreviewed_product"] }, { ...status, trialExpiresAt: "never" }])("rejects malformed or unmapped server status", raw => {
    expect(() => parseStoreStatus(raw)).toThrow();
  });
  it("uses only reviewed prices returned by the store and removes duplicates", () => {
    const product = { id: MEMBERSHIP_PRODUCTS[1], displayName: "Turf Scanner", displayPrice: "$24.95", priceAmountMicros: 24_950_000, currencyCode: "USD" };
    expect(validateStoreProducts([product, product, { ...product, id: "free_everything" }], [product.id])).toEqual([product]);
    expect(validateStoreProducts([product], [])).toEqual([]);
    expect(validateStoreProducts([{ ...product, priceAmountMicros: -1 }, { ...product, displayPrice: "" }], [product.id])).toEqual([]);
  });
});
