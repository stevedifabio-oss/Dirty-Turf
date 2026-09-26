import { looksLikeEmail, normalizeBillingEmail } from "./billing.ts";

export type CheckoutPlan = {
  id: string;
  academy_community_id: string;
  name: string;
  description: string;
  stripe_price_id: string;
  billing_type: "subscription" | "one_time";
  billing_interval: "month" | "year" | "one_time";
  amount_cents: number;
  currency: string;
  trial_days: number;
};

export function billingConfiguration(
  enabled: string | undefined,
  mode: string | undefined,
  secret: string | undefined,
) {
  const validMode = mode === "test" || mode === "live";
  const keyMode = /^(sk|rk)_live_/.test(secret || "")
    ? "live"
    : /^(sk|rk)_test_/.test(secret || "")
    ? "test"
    : null;
  return {
    enabled: enabled === "true" && validMode && mode === keyMode,
    livemode: mode === "live",
  };
}

export function checkoutEmail(value: unknown) {
  const email = normalizeBillingEmail(value);
  return email.length <= 254 && looksLikeEmail(email) ? email : null;
}

export function appOrigin(value: string | undefined) {
  try {
    const url = new URL(value || "");
    if (
      url.username || url.password || url.search || url.hash ||
      url.pathname !== "/"
    ) return null;
    if (
      url.protocol !== "https:" &&
      !(url.protocol === "http:" && url.hostname === "localhost")
    ) return null;
    return url.origin;
  } catch {
    return null;
  }
}

// The price shown to a buyer must be precisely the price charged by Stripe.
export function priceMatchesPlan(plan: CheckoutPlan, price: {
  id: string;
  active: boolean;
  livemode: boolean;
  unit_amount: number | null;
  currency: string;
  type: string;
  billing_scheme: string;
  recurring?:
    | { interval: string; interval_count: number; usage_type: string }
    | null;
}, livemode: boolean) {
  return price.id === plan.stripe_price_id && price.active &&
    price.livemode === livemode &&
    price.billing_scheme === "per_unit" &&
    price.unit_amount === plan.amount_cents &&
    price.currency === plan.currency && plan.amount_cents > 0 &&
    (plan.billing_type === "one_time"
      ? price.type === "one_time" && plan.billing_interval === "one_time"
      : price.type === "recurring" &&
        price.recurring?.interval === plan.billing_interval &&
        price.recurring?.interval_count === 1 &&
        price.recurring?.usage_type === "licensed");
}

export const checkoutPlanColumns =
  "id,academy_community_id,name,description,stripe_price_id,billing_type,billing_interval,amount_cents,currency,trial_days";
