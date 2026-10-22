import type { GrowthServiceKey } from "./growth";
import type { ServiceOrder } from "./serviceCheckout";

export function serviceName(key: GrowthServiceKey) {
  return ({ website: "Website", ghl: "GoHighLevel", "seo-aeo": "SEO and AEO", "facebook-ads": "Facebook ads management", "website-care": "Website care", "ghl-subscription": "GoHighLevel subscription" })[key];
}

export function serviceOrderHasPortal(order: ServiceOrder) {
  return order.status === "paid" && order.billingInterval === "month";
}

/** A paid order is a receipt; only a subscription status describes its lifecycle. */
export function serviceOrderStatus(order: ServiceOrder) {
  if (order.status !== "paid") return ({ pending: "Payment pending", failed: "Payment failed", cancelled: "Checkout cancelled" })[order.status];
  if (order.billingInterval !== "month") return "Payment confirmed";
  if (order.subscriptionStatus === "canceled") return "Subscription cancelled";
  if (order.cancelAtPeriodEnd) {
    const end = order.currentPeriodEnd ? new Date(order.currentPeriodEnd) : null;
    return end && Number.isFinite(end.valueOf()) ? `Cancellation scheduled for ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(end)}` : "Cancellation scheduled";
  }
  return order.subscriptionStatus ? ({ incomplete: "Subscription incomplete", incomplete_expired: "Subscription expired", trialing: "Trial subscription", active: "Active subscription", past_due: "Payment overdue", unpaid: "Subscription unpaid", paused: "Subscription paused" })[order.subscriptionStatus] : "Payment confirmed; checking subscription status";
}
