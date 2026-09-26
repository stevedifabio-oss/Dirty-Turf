import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("../lib/backend", () => ({ supabase: null }));
import { CheckoutReturn, EnrollmentForm } from "./MembershipPages";

describe("membership pages", () => {
  it("never treats reaching a return URL as proof of payment", () => {
    const html = renderToStaticMarkup(<CheckoutReturn />);
    expect(html).toContain("Your membership opens once payment is confirmed");
    expect(html).not.toContain("Payment successful");
    expect(html).toContain("Checkout email");
  });
  it("shows configured recurring terms and accessible selection", () => {
    const html = renderToStaticMarkup(<EnrollmentForm plans={[{ id: "fixture", name: "Monthly Academy", description: "Training", amountCents: 12500, currency: "usd", billingInterval: "month", trialDays: 7 }]} />);
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
