import { describe, expect, it, vi } from "vitest";
vi.mock("./backend", () => ({ supabase: null }));
import { billingPageRoute, checkoutDestination, loadMembershipCatalog, membershipPrice, membershipRequestId, parseMembershipCatalog } from "./membershipBilling";
const plan = { id: "plan-1", name: "Academy", description: "Course access", amountCents: 12500, currency: "usd", billingInterval: "month" as const, trialDays: 0 };

describe("membership purchase boundaries", () => {
  it("excludes every payment route from native apps", () => {
    for (const path of ["/membership", "/membership/", "/billing", "/checkout/return"]) expect(billingPageRoute(path, true)).toBeNull();
    expect(billingPageRoute("/membership/", false)).toBe("membership");
    expect(billingPageRoute("/checkout/return", false)).toBe("return");
    expect(billingPageRoute("/billing", false)).toBe("billing");
    expect(billingPageRoute("/anything", false)).toBeNull();
  });
  it("fails closed for disabled, unavailable or malformed catalog data", async () => {
    expect(await loadMembershipCatalog()).toEqual({ enabled: false, plans: [] });
    expect(parseMembershipCatalog({ enabled: false, plans: [plan] }).plans).toEqual([]);
    for (const data of [null, {}, { enabled: true, plans: [{ ...plan, amountCents: -1 }] }, { enabled: true, plans: [plan, plan] }]) expect(() => parseMembershipCatalog(data)).toThrow();
    expect(parseMembershipCatalog({ enabled: true, plans: [plan] }).plans).toEqual([plan]);
  });
  it("uses configured currency and price without inventing values", () => {
    expect(membershipPrice(plan)).toBe("$125.00");
    expect(membershipPrice({ ...plan, currency: "jpy", amountCents: 1500 })).toBe("¥1,500");
    expect(membershipPrice({ ...plan, currency: "isk", amountCents: 500 })).toBe("ISK 5");
    expect(membershipPrice({ ...plan, currency: "ugx", amountCents: 500 })).toBe("UGX 5");
  });
  it("only opens HTTPS Stripe Checkout destinations", () => {
    expect(checkoutDestination("https://checkout.stripe.com/c/pay/cs_test_example")).toContain("checkout.stripe.com");
    for (const url of ["https://checkout.stripe.com.evil.example/pay", "javascript:alert(1)", "http://checkout.stripe.com/pay", "https://user@checkout.stripe.com/pay"]) expect(() => checkoutDestination(url)).toThrow();
  });
  it("reuses checkout identity across cancellation or reload without storing the email", async () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const first = await membershipRequestId("plan-1", "Member@example.com", storage);
    expect(await membershipRequestId("plan-1", " member@example.com ", storage)).toBe(first);
    expect(await membershipRequestId("plan-2", "member@example.com", storage)).not.toBe(first);
    expect(JSON.stringify([...values])).not.toContain("member@example.com");
    const key = [...values.keys()][0];
    values.set(key, JSON.stringify({ id: first, createdAt: Date.now() - 3_600_001 }));
    expect(await membershipRequestId("plan-1", "member@example.com", storage)).not.toBe(first);
  });
});

import { planOwned, planPurchaseState } from "./membershipBilling";
import type { AccessState } from "./academyAccess";
const member: AccessState = { status: "member", canManage: false, pricingGatesEnabled: true, communityAccess: true, courseIds: ["cert"], features: [] };
const courseOffer = { ...plan, offerKind: "course" as const, billingInterval: "one_time" as const, courseIds: ["full"], featureKeys: [] };
const toolOffer = { ...plan, offerKind: "tool" as const, courseIds: [], featureKeys: ["measuring_tool"] };
describe("independent offers", () => {
  it("recognizes free existing membership without granting the paid upgrades", () => {
    expect(planOwned({ ...plan, offerKind: "membership" }, member)).toBe(true);
    expect(planPurchaseState(courseOffer, member)).toBe("available");
    expect(planPurchaseState(toolOffer, member)).toBe("available");
    expect(planPurchaseState({ ...courseOffer, courseIds: ["cert"] }, member)).toBe("owned");
    expect(planPurchaseState(toolOffer, { ...member, features: ["measuring_tool"] })).toBe("owned");
  });
  it("requires account verification for upgrades and never sells on a lookup failure", () => {
    expect(planPurchaseState(courseOffer, { status: "signed_out" })).toBe("sign_in");
    expect(planPurchaseState(plan, { status: "signed_out" })).toBe("available");
    expect(planPurchaseState(plan, { status: "error" })).toBe("unavailable");
    expect(planPurchaseState(toolOffer, { status: "loading" })).toBe("unavailable");
    expect(planPurchaseState({ ...toolOffer, requiresMembership: true }, { ...member, communityAccess: false })).toBe("membership_required");
  });
  it("allows independent upgrades for verified members without an active base subscription", () => {
    const identity: AccessState = { status: "no_access", hasMemberIdentity: true };
    expect(planPurchaseState(courseOffer, identity)).toBe("available");
    expect(planPurchaseState(toolOffer, identity)).toBe("available");
    expect(planPurchaseState({ ...toolOffer, requiresMembership: true }, identity)).toBe("membership_required");
    expect(planPurchaseState(courseOffer, { status: "no_access" })).toBe("unavailable");
  });
  it("requires course/tool mappings and hides unbuilt SEO tools", () => {
    for (const malformed of [{ ...courseOffer, courseIds: [] }, { ...toolOffer, featureKeys: [] }, { ...courseOffer, requiresMembership: "yes" }]) expect(() => parseMembershipCatalog({ enabled: true, plans: [malformed] })).toThrow();
    expect(parseMembershipCatalog({ enabled: true, plans: [{ ...toolOffer, featureKeys: ["seo_tools"] }] }).plans).toEqual([]);
    expect(parseMembershipCatalog({ enabled: true, plans: [toolOffer] }).plans).toEqual([toolOffer]);
  });
});
