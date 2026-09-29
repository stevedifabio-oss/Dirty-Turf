import { Capacitor } from "@capacitor/core";
import type { AccessState } from "./academyAccess";
import { supabase } from "./backend";

export type MembershipPlan = {
  id: string;
  name: string;
  description: string;
  amountCents: number;
  currency: string;
  billingInterval: "month" | "year" | "one_time";
  trialDays: number;
  offerKind?: "membership" | "course" | "tool";
  requiresMembership?: boolean;
  courseIds?: string[];
  featureKeys?: string[];
};
export type MembershipCatalog = { enabled: boolean; plans: MembershipPlan[] };
export type BillingPageRoute = "membership" | "return" | "billing";

export function billingPageRoute(path: string, native: boolean): BillingPageRoute | null {
  if (native) return null;
  const normalized = path.replace(/\/+$/, "");
  if (normalized === "/membership") return "membership";
  if (normalized === "/checkout/return") return "return";
  if (normalized === "/billing") return "billing";
  return null;
}

export function parseMembershipCatalog(value: unknown): MembershipCatalog {
  if (!value || typeof value !== "object") throw new Error("Membership plans could not be loaded.");
  const raw = value as Record<string, unknown>;
  if (typeof raw.enabled !== "boolean" || !Array.isArray(raw.plans)) throw new Error("Membership plans could not be loaded.");
  const plans = raw.plans as MembershipPlan[];
  if (plans.some((plan) => !plan || typeof plan.id !== "string" || !plan.id ||
    typeof plan.name !== "string" || !plan.name || typeof plan.description !== "string" ||
    !Number.isSafeInteger(plan.amountCents) || plan.amountCents < 0 ||
    typeof plan.currency !== "string" || !/^[a-z]{3}$/i.test(plan.currency) ||
    !["month", "year", "one_time"].includes(plan.billingInterval) ||
    !Number.isInteger(plan.trialDays) || plan.trialDays < 0) ||
    new Set(plans.map((plan) => plan.id)).size !== plans.length) {
    throw new Error("Membership plans could not be loaded.");
  }
  for (const plan of plans) {
    if (plan.offerKind !== undefined && !["membership", "course", "tool"].includes(plan.offerKind)) throw new Error("Invalid offer type.");
    for (const values of [plan.courseIds, plan.featureKeys]) if (values !== undefined && (!Array.isArray(values) || values.some((id) => typeof id !== "string" || !id))) throw new Error("Invalid offer access.");
    if (plan.requiresMembership !== undefined && typeof plan.requiresMembership !== "boolean") throw new Error("Invalid offer requirement.");
    if (plan.offerKind === "course" && !plan.courseIds?.length) throw new Error("Course access has not been configured.");
    if (plan.offerKind === "tool" && !plan.featureKeys?.length) throw new Error("Tool access has not been configured.");
  }
  // Only expose tools that are actually implemented in this app.
  return { enabled: raw.enabled, plans: raw.enabled ? plans.filter((plan) => plan.offerKind !== "tool" || plan.featureKeys?.every((key) => key === "measuring_tool")) : [] };
}

export function membershipPrice(plan: MembershipPlan) {
  // Stripe amounts use currency minor units, including zero-decimal currencies.
  const formatter = new Intl.NumberFormat("en-US", { style: "currency", currency: plan.currency.toUpperCase() });
  const digits = ["ISK", "UGX"].includes(plan.currency.toUpperCase()) ? 2 : formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(plan.amountCents / 10 ** digits);
}

export function checkoutDestination(value: unknown) {
  if (typeof value !== "string") throw new Error("Secure checkout could not be opened.");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com" || url.username || url.password) {
    throw new Error("Secure checkout could not be opened.");
  }
  return url.href;
}

export async function loadMembershipCatalog(): Promise<MembershipCatalog> {
  if (Capacitor.isNativePlatform()) return { enabled: false, plans: [] };
  if (!supabase) return { enabled: false, plans: [] };
  const { data, error } = await supabase.functions.invoke("public-billing-plans", { method: "GET" });
  if (error) throw new Error("Membership plans could not load. Please try again.");
  return parseMembershipCatalog(data);
}

export async function beginMembershipCheckout(planId: string, email: string, requestId: string) {
  if (Capacitor.isNativePlatform()) throw new Error("Checkout is available on the Academy website.");
  if (!supabase) throw new Error("Online checkout is not available yet. Please try again later.");
  const { data: auth, error: authError } = await supabase.auth.getSession();
  if (authError) throw new Error("Your session could not be checked. Please sign in again.");
  const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY)?.trim();
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  if (!key || !url) throw new Error("Online checkout is not available yet.");
  const response = await fetch(`${url.replace(/\/$/, "")}/functions/v1/create-checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key, ...(auth.session ? { Authorization: `Bearer ${auth.session.access_token}` } : {}) },
    body: JSON.stringify({ planId, email: email.trim(), requestId }),
  });
  if (!response.ok) {
    // Only display a known access-conflict explanation; never leak provider errors.
    const status = response.status;
    if (status === 409) {
      const body = await response.json().catch(() => null);
      if (body?.code === "checkout_in_progress") throw new Error("A checkout is already open for this email. Select your original membership option to resume it, or try a different option after that checkout expires (up to one hour).");
    }
    if (status === 409) throw new Error("Please sign in or contact support to check your existing access before purchasing.");
    if (status === 503) throw new Error("Online checkout is not available yet. Please try again later.");
    throw new Error("Checkout could not open. Please try again or contact support.");
  }
  const data = await response.json();
  return checkoutDestination(data?.url);
}

export async function membershipRequestId(planId: string, email: string, storage: Pick<Storage, "getItem" | "setItem"> | null) {
  const bytes = new TextEncoder().encode(`${planId}:${email.trim().toLowerCase()}`);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const key = `academy-checkout:${hash}`;
  try {
    const prior = JSON.parse(storage?.getItem(key) ?? "null");
    if (prior && typeof prior.id === "string" && /^[0-9a-f-]{36}$/i.test(prior.id) && Number.isFinite(prior.createdAt) && Date.now() - prior.createdAt < 60 * 60 * 1000) return prior.id as string;
  } catch { /* Private browsing may disable storage; use the in-memory request. */ }
  const id = crypto.randomUUID();
  try { storage?.setItem(key, JSON.stringify({ id, createdAt: Date.now() })); } catch { /* Checkout still works without storage. */ }
  return id;
}

export function planOwned(plan: MembershipPlan, access: AccessState) {
  if (access.status !== "member") return false;
  if ((plan.offerKind ?? "membership") === "membership") return !access.pricingGatesEnabled || access.communityAccess || access.canManage;
  if (!access.pricingGatesEnabled) return true; // Legacy access cannot safely establish separate upgrade ownership.
  const courses = plan.courseIds ?? [];
  const features = plan.featureKeys ?? [];
  return access.canManage || ((courses.length + features.length > 0) && courses.every((id) => access.courseIds.includes(id)) && features.every((key) => access.features.includes(key)));
}
export function planPurchaseState(plan: MembershipPlan, access: AccessState): "available" | "owned" | "sign_in" | "membership_required" | "unavailable" {
  if (access.status === "error" || access.status === "loading") return "unavailable";
  if (planOwned(plan, access)) return "owned";
  if ((plan.offerKind ?? "membership") !== "membership" && access.status !== "member" && !(access.status === "no_access" && access.hasMemberIdentity)) return access.status === "no_access" ? "unavailable" : "sign_in";
  if (plan.requiresMembership && (access.status !== "member" || !access.communityAccess)) return "membership_required";
  return "available";
}
