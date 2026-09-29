import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const platform = vi.hoisted(() => ({ native: false }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => platform.native } }));
vi.mock("../lib/backend", () => ({ supabase: null }));
import { CheckoutReturn, EnrollmentForm } from "./MembershipPages";

describe("membership pages", () => {
  it("never treats reaching a return URL as proof of payment", () => {
    const html = renderToStaticMarkup(<CheckoutReturn />);
    expect(html).toContain("Your purchase unlocks once payment is confirmed");
    expect(html).not.toContain("Payment successful");
    expect(html).toContain("Checking your existing sign-in");
  });
  it("shows configured recurring terms and accessible selection", () => {
    const html = renderToStaticMarkup(<EnrollmentForm verifiedAccess={{ status: "signed_out" }} plans={[{ id: "fixture", name: "Monthly Academy", description: "Training", amountCents: 12500, currency: "usd", billingInterval: "month", trialDays: 7 }]} />);
    expect(html).toContain("$125.00");
    expect(html).toContain("renews automatically");
    expect(html).toContain("7-day trial");
    expect(html).toContain('type="radio"');
    expect(html).toContain('type="email"');
  });
  it("does not show subscription renewal language for one-time purchases", () => {
    const html = renderToStaticMarkup(<EnrollmentForm plans={[{ id: "fixture", name: "Academy", description: "Training", amountCents: 12500, currency: "usd", billingInterval: "one_time", trialDays: 0 }]} />);
    expect(html).toContain("one-time payment");
    expect(html).not.toContain("renews automatically");
  });
});

import { AvailableUpgrades, AccessRequired } from "./AccessOffers";
import type { AccessState } from "../lib/academyAccess";
const member: AccessState = { status: "member", canManage: false, pricingGatesEnabled: true, communityAccess: true, courseIds: ["cert"], features: [] };
const offers = [
  { id: "membership", name: "Community membership", description: "Community and certification", amountCents: 3999, currency: "usd", billingInterval: "month" as const, trialDays: 0, offerKind: "membership" as const },
  { id: "course", name: "Full course", description: "Full turf training", amountCents: 14995, currency: "usd", billingInterval: "one_time" as const, trialDays: 0, offerKind: "course" as const, courseIds: ["full"] },
  { id: "tool", name: "Measuring tool", description: "Map and camera", amountCents: 2995, currency: "usd", billingInterval: "month" as const, trialDays: 0, offerKind: "tool" as const, featureKeys: ["measuring_tool"] },
];
describe("upgrade presentation", () => {
  it("separates independent offers and identifies access already owned", () => {
    const html = renderToStaticMarkup(<EnrollmentForm plans={offers} verifiedAccess={member} verifiedEmail="fixture@example.test" />);
    expect(html).toContain("Community and certification membership");
    expect(html).toContain("Individual course upgrades");
    expect(html).toContain("Tool subscriptions");
    expect(html).toContain("Already included in your access");
    expect(html).not.toContain("$39.99");
    expect(html).not.toContain("renews automatically");
    expect(html).toContain("$149.95");
    expect(html).toContain("$29.95");
  });
  it("offers retry on failed verification and disables checkout", () => {
    const html = renderToStaticMarkup(<EnrollmentForm plans={offers} verifiedAccess={{ status: "error" }} />);
    expect(html).toContain("Check access again");
    expect(html).toMatch(/<button class="primary-button wide" disabled=""/);
  });
  it("native apps suppress prices, checkout, and external upgrade links", () => {
    platform.native = true;
    try {
      expect(renderToStaticMarkup(<EnrollmentForm plans={offers} verifiedAccess={member} />)).toBe("");
      expect(renderToStaticMarkup(<AvailableUpgrades access={member} />)).toBe("");
      expect(renderToStaticMarkup(<CheckoutReturn />)).toBe("");
      const notice = renderToStaticMarkup(<AccessRequired title="Measuring tool access required">Enter dimensions manually.</AccessRequired>);
      expect(notice).toContain("Enter dimensions manually");
      expect(notice).not.toContain("href");
      expect(notice).not.toContain("$");
    } finally { platform.native = false; }
  });
});
