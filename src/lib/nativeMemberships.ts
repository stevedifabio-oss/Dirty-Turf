import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { supabase } from "./backend";

export const MEMBERSHIP_PRODUCTS = ["dirty_turf_community_monthly", "dirty_turf_scanner_monthly", "dirty_turf_academy_monthly"] as const;
export type MembershipProductId = typeof MEMBERSHIP_PRODUCTS[number];
export type StoreProduct = { id: MembershipProductId; displayName: string; displayPrice: string; priceAmountMicros: number; currencyCode: string };
export type StoreProof = { provider: "google" | "apple"; productId: string; purchaseToken?: string; signedTransactionInfo?: string; transactionId?: string; purchaseState?: string };
type StoreBridge = {
  getProducts(): Promise<{ available: boolean; products: StoreProduct[] }>;
  purchase(options: { productId: string; accountToken: string }): Promise<{ status: "purchased" | "pending" | "cancelled"; purchases: StoreProof[] }>;
  restorePurchases(options?: { sync?: boolean }): Promise<{ purchases: StoreProof[] }>;
  finishTransaction(options: { transactionId: string }): Promise<void>;
  manageSubscriptions(options?: { productId?: string }): Promise<{ opened: boolean }>;
  addListener(event: "billingPurchaseUpdated", listener: (value: { status: string; purchases: StoreProof[] }) => void): Promise<PluginListenerHandle>;
};
const store = registerPlugin<StoreBridge>("MembershipBilling");
export type StoreStatus = { enabled: boolean; products: MembershipProductId[]; ownedProducts: MembershipProductId[]; restorableProducts?: MembershipProductId[]; trialEligible: boolean; trialUsed: boolean; trialExpiresAt: string | null };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const nativeMembershipProvider = () => Capacitor.getPlatform() === "android" ? "google" : "apple";
export function nativeMembershipsSupported() { return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("MembershipBilling"); }

export function parseStoreStatus(value: unknown): StoreStatus {
  const raw = value as Partial<StoreStatus> | null;
  if (!raw || typeof raw.enabled !== "boolean" || !Array.isArray(raw.products) || raw.products.some(id => !MEMBERSHIP_PRODUCTS.includes(id)) ||
      !Array.isArray(raw.ownedProducts) || raw.ownedProducts.some(id => !MEMBERSHIP_PRODUCTS.includes(id)) ||
      !(raw.restorableProducts === undefined || Array.isArray(raw.restorableProducts) && raw.restorableProducts.every(id => MEMBERSHIP_PRODUCTS.includes(id))) ||
      typeof raw.trialEligible !== "boolean" || typeof raw.trialUsed !== "boolean" ||
      !(raw.trialExpiresAt === null || typeof raw.trialExpiresAt === "string" && Number.isFinite(Date.parse(raw.trialExpiresAt)))) throw new Error("Membership access could not be checked.");
  return raw as StoreStatus;
}
export function validateStoreProducts(value: unknown, enabled: readonly string[]): StoreProduct[] {
  if (!Array.isArray(value)) throw new Error("Store prices could not be loaded.");
  const seen = new Set<string>();
  return value.filter((raw): raw is StoreProduct => {
    if (!raw || typeof raw !== "object") return false;
    const p = raw as StoreProduct;
    if (!MEMBERSHIP_PRODUCTS.includes(p.id) || !enabled.includes(p.id) || seen.has(p.id) || typeof p.displayName !== "string" ||
        typeof p.displayPrice !== "string" || !p.displayPrice.trim() || !Number.isSafeInteger(p.priceAmountMicros) || p.priceAmountMicros <= 0 || !/^[A-Z]{3}$/.test(p.currencyCode)) return false;
    seen.add(p.id); return true;
  });
}
async function identity() {
  if (!supabase) throw new Error("Sign in to choose your memberships.");
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session || !uuid.test(data.session.user.id)) throw new Error("Please sign in again.");
  return { id: data.session.user.id, token: data.session.access_token };
}
async function stillSameUser(id: string) { if ((await identity()).id !== id) throw new Error("Your account changed. Sign in again to check this purchase."); }
export async function loadNativeMemberships() {
  await identity();
  const { data, error } = await supabase!.rpc("get_membership_store_status", { p_provider: nativeMembershipProvider() });
  if (error) throw new Error("Membership options are temporarily unavailable. Please try again.");
  const status = parseStoreStatus(data);
  const result = nativeMembershipsSupported() && status.enabled ? await store.getProducts() : { available: false, products: [] };
  return { status, available: result.available && nativeMembershipsSupported(), products: validateStoreProducts(result.products, status.products) };
}
async function verifyProof(proof: StoreProof, account: { id: string; token: string }) {
  if (!MEMBERSHIP_PRODUCTS.includes(proof.productId as MembershipProductId) || proof.provider !== nativeMembershipProvider() || proof.purchaseState === "pending") return false;
  const backendUrl = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!backendUrl || !key) throw new Error("Purchase verification is temporarily unavailable.");
  // Capture the purchasing account's JWT. A later account switch cannot redirect
  // an in-flight purchase to a different member. Proofs never enter local storage.
  const response = await fetch(`${backendUrl.replace(/\/$/, "")}/functions/v1/verify-store-membership`, {
    method: "POST", headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${account.token}` },
    body: JSON.stringify(proof), signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error("Your store purchase could not be confirmed yet. Use Restore purchases to retry; do not buy it again.");
  const result = await response.json();
  if (result?.verified !== true) throw new Error("Your store purchase is still being confirmed.");
  await stillSameUser(account.id);
  if (proof.provider === "apple" && proof.transactionId) await store.finishTransaction({ transactionId: proof.transactionId });
  await stillSameUser(account.id);
  return true;
}
async function verifyAll(proofs: StoreProof[], account: { id: string; token: string }, continueOnFailure = false) {
  if (!Array.isArray(proofs) || proofs.length > 30) throw new Error("Purchases could not be checked.");
  let confirmed = 0;
  let failed = 0;
  let firstFailure: unknown;
  try {
    for (const proof of proofs) {
      await stillSameUser(account.id);
      try { if (await verifyProof(proof, account)) confirmed++; }
      catch (error) { if (!continueOnFailure) throw error; failed++; firstFailure ??= error; }
    }
  } finally { if (confirmed) window.dispatchEvent(new Event("dirty-turf-memberships-updated")); }
  if (failed && !confirmed) throw firstFailure;
  return { confirmed, failed };
}
export async function purchaseNativeMembership(productId: MembershipProductId) {
  const account = await identity();
  const catalog = await loadNativeMemberships();
  if (!catalog.available || !catalog.products.some(product => product.id === productId)) throw new Error("This membership is not available for purchase right now.");
  if (catalog.status.ownedProducts.includes(productId)) throw new Error("You already have access to this product. No additional subscription is needed.");
  await stillSameUser(account.id);
  const result = await store.purchase({ productId, accountToken: account.id });
  if (result.status === "purchased") await verifyAll(result.purchases, account);
  return result.status;
}
export async function restoreNativeMemberships(interactive = true) {
  const account = await identity();
  if (!nativeMembershipsSupported()) throw new Error("Update the app to manage purchases.");
  const { purchases } = await store.restorePurchases({ sync: interactive });
  return verifyAll(purchases, account, true);
}
export async function listenForNativeMemberships(onFailure: () => void) {
  if (!nativeMembershipsSupported()) return () => undefined;
  const account = await identity();
  const listener = await store.addListener("billingPurchaseUpdated", value => {
    if (value.status === "purchased") void stillSameUser(account.id).then(() => verifyAll(value.purchases, account)).catch(onFailure);
  });
  return () => { void listener.remove(); };
}
export async function startScannerTrial() {
  const account = await identity();
  const backendUrl = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!backendUrl || !key) throw new Error("The trial could not be started. Please try again.");
  const response = await fetch(`${backendUrl.replace(/\/$/, "")}/rest/v1/rpc/start_turf_scanner_trial`, {
    method: "POST", headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${account.token}` },
    body: "{}", signal: AbortSignal.timeout(15_000),
  });
  const data = response.ok ? await response.json() : null;
  if (!data || typeof data.expiresAt !== "string" || !Number.isFinite(Date.parse(data.expiresAt))) throw new Error("The trial could not be started. Please try again.");
  await stillSameUser(account.id);
  window.dispatchEvent(new Event("dirty-turf-memberships-updated"));
  return data as { started: boolean; alreadyUsed: boolean; expiresAt: string };
}
export async function manageNativeMemberships() {
  if (!nativeMembershipsSupported()) throw new Error("Update the app to manage purchases.");
  await store.manageSubscriptions();
}
