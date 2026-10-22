import { describe, expect, it } from "vitest";
import type { ServiceOrder } from "./serviceCheckout";
import { serviceOrderHasPortal, serviceOrderStatus } from "./serviceBillingPresentation";

const paid: ServiceOrder = { id: "receipt", quoteId: "quote", serviceKey: "website-care", amountCents: 9700, billingInterval: "month", status: "paid", createdAt: "2026-10-22T15:00:00Z" };
describe("service billing presentation", () => {
  it("separates the paid receipt from the current subscription lifecycle", () => {
    expect(serviceOrderStatus(paid)).toBe("Payment confirmed; checking subscription status");
    expect(serviceOrderStatus({ ...paid, subscriptionStatus: "canceled" })).toBe("Subscription cancelled");
    expect(serviceOrderStatus({ ...paid, subscriptionStatus: "past_due" })).toBe("Payment overdue");
    expect(serviceOrderStatus({ ...paid, subscriptionStatus: "active", cancelAtPeriodEnd: true, currentPeriodEnd: "2026-11-22T15:00:00Z" })).toContain("Cancellation scheduled for Nov 22, 2026");
  });
  it("allows secure management for historical monthly receipts without offering a portal for pending or one-time purchases", () => {
    expect(serviceOrderHasPortal({ ...paid, subscriptionStatus: "canceled" })).toBe(true);
    expect(serviceOrderHasPortal({ ...paid, status: "pending" })).toBe(false);
    expect(serviceOrderHasPortal({ ...paid, billingInterval: "one_time" })).toBe(false);
  });
});
