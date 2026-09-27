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
