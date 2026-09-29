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
  offer_kind: "membership" | "course" | "tool";
  requires_membership: boolean;
  community_access: boolean;
  academy_billing_plan_courses: { course_id: string }[];
  academy_billing_plan_features: { feature_key: string }[];
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
  "id,academy_community_id,name,description,stripe_price_id,billing_type,billing_interval,amount_cents,currency,trial_days,offer_kind,requires_membership,community_access,academy_billing_plan_courses(course_id),academy_billing_plan_features(feature_key)";

export function checkoutPlanIsMapped(plan: CheckoutPlan) {
  if (
    !Array.isArray(plan.academy_billing_plan_courses) ||
    !Array.isArray(plan.academy_billing_plan_features)
  ) return false;
  const courses = plan.academy_billing_plan_courses.length;
  const features = plan.academy_billing_plan_features.length;
  if (plan.offer_kind === "membership") {
    return plan.community_access === true && courses > 0 && features === 0;
  }
  if (plan.community_access !== false) return false;
  if (plan.offer_kind === "course") return courses > 0 && features === 0;
  if (plan.offer_kind === "tool") return features > 0 && courses === 0;
  return false;
}

export function checkoutPlansOverlap(
  requested: CheckoutPlan,
  previous: CheckoutPlan,
) {
  if (requested.academy_community_id !== previous.academy_community_id) {
    return false;
  }
  if (requested.id === previous.id) return true;
  if (requested.community_access && previous.community_access) return true;
  return requested.academy_billing_plan_courses.some(({ course_id }) =>
    previous.academy_billing_plan_courses.some((course) =>
      course.course_id === course_id
    )
  ) || requested.academy_billing_plan_features.some(({ feature_key }) =>
    previous.academy_billing_plan_features.some((feature) =>
      feature.feature_key === feature_key
    )
  );
}

// A paid Stripe object can arrive before its webhook creates database grants.
// Known unrelated purchases are safe; unresolved Academy purchases need review.
export function stripePurchaseOverlaps(
  requested: CheckoutPlan,
  plans: CheckoutPlan[],
  metadata:
    | { plan_id?: string; academy_community_id?: string }
    | null
    | undefined,
  priceIds: string[],
) {
  const referenced = plans.filter((plan) =>
    plan.id === metadata?.plan_id || priceIds.includes(plan.stripe_price_id)
  );
  if (
    referenced.some((plan) =>
      !checkoutPlanIsMapped(plan) || checkoutPlansOverlap(requested, plan)
    )
  ) return true;
  if (
    metadata?.plan_id && !plans.some((plan) => plan.id === metadata.plan_id) &&
    metadata.academy_community_id === requested.academy_community_id
  ) return true;
  return referenced.length === 0 &&
    metadata?.academy_community_id === requested.academy_community_id;
}
