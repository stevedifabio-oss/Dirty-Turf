import { describe, expect, it } from "vitest";
import {
  academyPaymentLink,
  checkoutReturnNotice,
  normalizeAcademyPaymentLink,
} from "./academyPaymentLink";

describe("Academy web acquisition", () => {
  it("accepts only Stripe-hosted HTTPS Payment Links", () => {
    expect(normalizeAcademyPaymentLink(" https://buy.stripe.com/test_123?prefilled_email=a%40b.com "))
      .toBe("https://buy.stripe.com/test_123?prefilled_email=a%40b.com");
    expect(normalizeAcademyPaymentLink("http://buy.stripe.com/test_123")).toBeUndefined();
    expect(normalizeAcademyPaymentLink("https://buy.stripe.com.attacker.example/test_123")).toBeUndefined();
    expect(normalizeAcademyPaymentLink("javascript:alert(1)")).toBeUndefined();
  });

  it("never exposes the purchase URL to a native app", () => {
    expect(academyPaymentLink(true)).toBeUndefined();
  });

  it("explains Stripe return states without trusting arbitrary values", () => {
    expect(checkoutReturnNotice("?checkout=success")).toContain("same email");
    expect(checkoutReturnNotice("?checkout=cancelled")).toContain("not completed");
    expect(checkoutReturnNotice("?checkout=anything-else")).toBe("");
  });
});
