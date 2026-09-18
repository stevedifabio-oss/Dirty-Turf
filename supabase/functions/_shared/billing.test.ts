import { describe, expect, it } from "vitest";
import {
  isUuid,
  looksLikeEmail,
  normalizeBillingEmail,
  normalizeStripeSubscriptionStatus,
  stringId,
  unixTimestamp,
} from "./billing";

describe("Academy billing boundaries", () => {
  it("maps Stripe states to the smaller entitlement state machine", () => {
    expect(normalizeStripeSubscriptionStatus("trialing")).toBe("trialing");
    expect(normalizeStripeSubscriptionStatus("unpaid")).toBe("past_due");
    expect(normalizeStripeSubscriptionStatus("canceled")).toBe("cancelled");
    expect(normalizeStripeSubscriptionStatus("incomplete_expired")).toBe("expired");
    expect(normalizeStripeSubscriptionStatus("incomplete")).toBe("pending");
  });

  it("normalizes and validates buyer identity without accepting malformed email", () => {
    const email = normalizeBillingEmail(" Buyer@Example.COM ");
    expect(email).toBe("buyer@example.com");
    expect(looksLikeEmail(email)).toBe(true);
    expect(looksLikeEmail("not-an-email")).toBe(false);
  });

  it("normalizes expandable Stripe identifiers and Unix timestamps", () => {
    expect(stringId("cus_123")).toBe("cus_123");
    expect(stringId({ id: "sub_123" })).toBe("sub_123");
    expect(stringId(null)).toBe("");
    expect(unixTimestamp(1_700_000_000)).toBe("2023-11-14T22:13:20.000Z");
    expect(unixTimestamp(undefined)).toBeNull();
  });

  it("accepts only canonical UUIDs for public request identifiers", () => {
    expect(isUuid("4b2fb554-266e-4e86-8c2e-1707be98b6a4")).toBe(true);
    expect(isUuid("checkout-123")).toBe(false);
  });
});
