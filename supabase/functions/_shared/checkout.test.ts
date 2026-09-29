import { describe, expect, it } from "vitest";
import { appOrigin, billingConfiguration, checkoutEmail, priceMatchesPlan, checkoutPlansOverlap, checkoutPlanIsMapped, stripePurchaseOverlaps, type CheckoutPlan } from "./checkout";
const plan: CheckoutPlan = { id: "plan", academy_community_id: "community", name: "Academy", description: "", stripe_price_id: "price_demo", billing_type: "subscription", billing_interval: "month", amount_cents: 9900, currency: "usd", trial_days: 0, offer_kind: "membership", requires_membership: false, community_access: true, academy_billing_plan_courses: [{ course_id: "certification" }], academy_billing_plan_features: [] };
const price = { id: "price_demo", active: true, livemode: false, unit_amount: 9900, currency: "usd", type: "recurring", billing_scheme: "per_unit", recurring: { interval: "month", interval_count: 1, usage_type: "licensed" } };
describe("checkout activation boundaries", () => {
  it("stays disabled until flag, explicit mode, and matching server key are present", () => {
    expect(billingConfiguration(undefined, "test", "sk_test_placeholder").enabled).toBe(false);
    expect(billingConfiguration("true", undefined, "sk_test_placeholder").enabled).toBe(false);
    expect(billingConfiguration("true", "test", "sk_live_placeholder").enabled).toBe(false);
    expect(billingConfiguration("true", "test", "pk_test_placeholder").enabled).toBe(false);
    expect(billingConfiguration("true", "test", "rk_test_placeholder").enabled).toBe(true);
    expect(billingConfiguration("true", "live", "sk_live_placeholder").livemode).toBe(true);
  });
  it("rejects redirects with credentials, paths, non-HTTPS, or queries", () => {
    expect(appOrigin("https://app.dirtyturf.com")).toBe("https://app.dirtyturf.com");
    for (const url of ["http://app.dirtyturf.com", "https://x:password@app.dirtyturf.com", "https://app.dirtyturf.com/path", "https://app.dirtyturf.com?url=evil", "not a URL"]) expect(appOrigin(url)).toBeNull();
  });
  it("normalizes identities and bounds request size", () => {
    expect(checkoutEmail(" Buyer@Example.COM ")).toBe("buyer@example.com");
    expect(checkoutEmail("a".repeat(255) + "@example.com")).toBeNull();
    expect(checkoutEmail(null)).toBeNull();
  });
});
describe("charged price equals advertised plan", () => {
  it("accepts an exact monthly plan", () => expect(priceMatchesPlan(plan, price, false)).toBe(true));
  it.each([
    { active: false }, { livemode: true }, { unit_amount: null }, { unit_amount: 19900 },
    { currency: "eur" }, { billing_scheme: "tiered" }, { id: "price_other" },
    { recurring: { interval: "month", interval_count: 3, usage_type: "licensed" } },
    { recurring: { interval: "month", interval_count: 1, usage_type: "metered" } },
    { recurring: { interval: "year", interval_count: 1, usage_type: "licensed" } },
  ])("rejects mismatched configuration %j", (change) => expect(priceMatchesPlan(plan, { ...price, ...change }, false)).toBe(false));
  it("requires the one-time type for a lifetime purchase", () => {
    const once = { ...plan, billing_type: "one_time", billing_interval: "one_time" } as CheckoutPlan;
    expect(priceMatchesPlan(once, price, false)).toBe(false);
    expect(priceMatchesPlan(once, { ...price, type: "one_time", recurring: null }, false)).toBe(true);
  });
});


describe("independent Academy offers", () => {
  const turf: CheckoutPlan = { ...plan, id: "turf", stripe_price_id: "price_turf", offer_kind: "course", community_access: false, academy_billing_plan_courses: [{ course_id: "turf" }] };
  const tile: CheckoutPlan = { ...turf, id: "tile", stripe_price_id: "price_tile", academy_billing_plan_courses: [{ course_id: "tile" }] };
  const measurement: CheckoutPlan = { ...plan, id: "measurement", stripe_price_id: "price_measurement", offer_kind: "tool", community_access: false, academy_billing_plan_courses: [], academy_billing_plan_features: [{ feature_key: "measuring_tool" }] };
  it("requires real entitlement mappings before selling upgrades", () => {
    expect(checkoutPlanIsMapped(turf)).toBe(true);
    expect(checkoutPlanIsMapped({ ...plan, academy_billing_plan_courses: [] })).toBe(false);
    expect(checkoutPlanIsMapped({ ...turf, academy_billing_plan_features: [{ feature_key: "measuring_tool" }] })).toBe(false);
    expect(checkoutPlanIsMapped(measurement)).toBe(true);
    expect(checkoutPlanIsMapped({ ...turf, academy_billing_plan_courses: [] })).toBe(false);
    expect(checkoutPlanIsMapped({ ...measurement, academy_billing_plan_features: [] })).toBe(false);
    expect(checkoutPlanIsMapped({ ...measurement, community_access: true })).toBe(false);
  });
  it("blocks the same entitlement sold in a different bundle", () => {
    expect(checkoutPlansOverlap(turf, { ...tile, academy_billing_plan_courses: [{ course_id: "tile" }, { course_id: "turf" }] })).toBe(true);
    expect(checkoutPlansOverlap(measurement, { ...measurement, id: "other-tool-price" })).toBe(true);
    expect(checkoutPlansOverlap(plan, { ...plan, id: "other-membership" })).toBe(true);
  });
  it("allows a distinct upgrade alongside membership or another paid course", () => {
    expect(checkoutPlansOverlap(turf, plan)).toBe(false);
    expect(checkoutPlansOverlap(turf, tile)).toBe(false);
    expect(checkoutPlansOverlap(measurement, turf)).toBe(false);
  });
  it("checks known pending Stripe purchases per entitlement and holds unresolved Academy purchases", () => {
    const plans = [plan, turf, tile, measurement];
    expect(stripePurchaseOverlaps(turf, plans, { plan_id: "tile" }, [])).toBe(false);
    expect(stripePurchaseOverlaps(turf, plans, {}, ["price_turf"])).toBe(true);
    expect(stripePurchaseOverlaps(turf, plans, { academy_community_id: "community" }, ["price_unknown_ghl"])).toBe(true);
    expect(stripePurchaseOverlaps(turf, plans, {}, ["unrelated_business"])).toBe(false);
    expect(stripePurchaseOverlaps(turf, plans, { plan_id: "unmapped", academy_community_id: "community" }, ["price_tile"])).toBe(true);
  });
});
