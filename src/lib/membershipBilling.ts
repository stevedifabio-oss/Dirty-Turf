import { Capacitor } from "@capacitor/core";
import { supabase } from "./backend";

export type MembershipPlan = {
  id: string;
  name: string;
  description: string;
  amountCents: number;
  currency: string;
  billingInterval: "month" | "year" | "one_time";
  trialDays: number;
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
  return { enabled: raw.enabled, plans: raw.enabled ? plans : [] };
}

export function membershipPrice(plan: MembershipPlan) {
  // Stripe amounts use currency minor units, including zero-decimal currencies.
  const formatter = new Intl.NumberFormat("en-US", { style: "currency", currency: plan.currency.toUpperCase() });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
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
