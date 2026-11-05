export const GOOGLE_MEMBERSHIP_PACKAGE = "com.dirtyturf.academy";
export const GOOGLE_MEMBERSHIP_PRODUCTS = new Set([
  "dirty_turf_community_monthly", "dirty_turf_scanner_monthly", "dirty_turf_academy_monthly",
]);

export type GoogleMembershipConfig = { serviceAccountJson: string };
export type VerifiedGoogleMembership = {
  provider: "google";
  sourceKey: string;
  userId: string;
  productId: string;
  status: "active" | "expired" | "revoked";
  currentPeriodEnd: string;
  autoRenew: boolean;
  environment: "production" | "sandbox";
  verifiedAt: string;
  acknowledgementRequired: boolean;
};
export type GoogleMembershipDependencies = {
  getSubscription(purchaseToken: string, config: GoogleMembershipConfig): Promise<unknown>;
  acknowledgeSubscription(purchaseToken: string, productId: string, config: GoogleMembershipConfig): Promise<void>;
  sha256(value: string): Promise<string>;
};

export class GoogleMembershipError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "GoogleMembershipError";
  }
}
const invalid = (message = "Google membership verification failed") => new GoogleMembershipError("INVALID_GOOGLE_PURCHASE", message);
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function userAccount(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw invalid("Google purchase account is invalid");
  }
  return value.toLowerCase();
}
export function validatedGooglePurchaseToken(value: unknown): string {
  // Tokens are opaque. Encode them as path components; never interpret them as URLs.
  if (typeof value !== "string" || value.length < 16 || value.length > 8192 || !/^[\x21-\x7e]+$/.test(value)) {
    throw invalid("Google purchase proof is invalid");
  }
  return value;
}
function timestamp(value: unknown): number {
  if (typeof value !== "string") throw invalid("Google subscription time is invalid");
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12 || Number(match[3]) < 1 ||
      Number(match[3]) > new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate() ||
      Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59 || Number(match[7] ?? 0) > 23 || Number(match[8] ?? 0) > 59) {
    throw invalid("Google subscription time is invalid");
  }
  const result = Date.parse(value);
  if (!Number.isFinite(result) || result <= 0) throw invalid("Google subscription time is invalid");
  return result;
}
const activeStates = new Set(["SUBSCRIPTION_STATE_ACTIVE", "SUBSCRIPTION_STATE_IN_GRACE_PERIOD", "SUBSCRIPTION_STATE_CANCELED"]);
const deniedStates = new Set([
  "SUBSCRIPTION_STATE_PENDING", "SUBSCRIPTION_STATE_PAUSED", "SUBSCRIPTION_STATE_ON_HOLD", "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED",
]);

function purchaseShape(value: unknown) {
  const purchase = object(value);
  // packageName is not normally returned by this API. The transport fixes the package in the request URL.
  if ((purchase.packageName !== undefined && purchase.packageName !== GOOGLE_MEMBERSHIP_PACKAGE) ||
      (purchase.kind !== undefined && purchase.kind !== "androidpublisher#subscriptionPurchaseV2")) {
    throw invalid("Google application identity does not match");
  }
  if (!Array.isArray(purchase.lineItems) || purchase.lineItems.length !== 1) throw invalid("Google membership purchase must contain one independent product");
  const item = object(purchase.lineItems[0]);
  const productId = item.productId;
  if (typeof productId !== "string" || !GOOGLE_MEMBERSHIP_PRODUCTS.has(productId)) throw invalid("Google membership product is not supported");
  const plan = object(item.autoRenewingPlan);
  const offer = object(item.offerDetails);
  if (offer.basePlanId !== "monthly" || (offer.offerId !== undefined && offer.offerId !== null) ||
      typeof plan.autoRenewEnabled !== "boolean" || item.prepaidPlan != null || plan.installmentDetails != null ||
      item.deferredItemReplacement != null || item.deferredItemRemoval != null || item.itemReplacement != null) {
    throw invalid("Google membership must use the independent monthly base plan");
  }
  if (item.offerPhase != null) {
    const phase = object(item.offerPhase);
    if (phase.freeTrial != null || phase.introductoryPrice != null || phase.prorationPeriod != null) {
      throw invalid("Google membership purchase cannot use an automatic trial or replacement offer");
    }
  }
  const identifiers = object(purchase.externalAccountIdentifiers);
  const binding = identifiers.obfuscatedExternalAccountId;
  if (typeof binding !== "string" || !/^[a-f0-9]{64}$/.test(binding)) throw invalid("Google purchase account binding is invalid");
  return { purchase, item, plan, productId, binding };
}

export function createGoogleMembershipVerifier(dependencies: GoogleMembershipDependencies) {
  async function sourceKey(purchaseToken: string) {
    return dependencies.sha256(validatedGooglePurchaseToken(purchaseToken));
  }

  async function getGoogleMembershipAccountBinding(purchaseToken: string, config: GoogleMembershipConfig): Promise<string> {
    // Used only after authenticated Google Pub/Sub delivery when the initial
    // purchase completed while the app was closed. Google, never event/client
    // identity fields, supplies the opaque binding for the server-only lookup.
    const token = validatedGooglePurchaseToken(purchaseToken);
    return purchaseShape(await dependencies.getSubscription(token, config)).binding;
  }

  async function verifyGoogleMembership(
    purchaseToken: string, expectedUserId: string, config: GoogleMembershipConfig, now = new Date(),
  ): Promise<VerifiedGoogleMembership> {
    const token = validatedGooglePurchaseToken(purchaseToken);
    const userId = userAccount(expectedUserId);
    if (!Number.isFinite(now.getTime())) throw invalid("Verification time is invalid");
    const { purchase, item, plan, productId, binding } = purchaseShape(await dependencies.getSubscription(token, config));
    if (binding !== await dependencies.sha256(userId)) {
      throw new GoogleMembershipError("GOOGLE_PURCHASE_ACCOUNT_MISMATCH", "Google purchase belongs to another member account");
    }
    const expiry = timestamp(item.expiryTime);
    const state = purchase.subscriptionState;
    if (typeof state !== "string" || (!activeStates.has(state) && !deniedStates.has(state) && state !== "SUBSCRIPTION_STATE_EXPIRED")) {
      throw invalid("Google subscription state is not supported");
    }
    if (purchase.acknowledgementState !== "ACKNOWLEDGEMENT_STATE_PENDING" && purchase.acknowledgementState !== "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED") {
      throw invalid("Google subscription acknowledgement state is invalid");
    }
    if (purchase.testPurchase != null) object(purchase.testPurchase);
    const status = deniedStates.has(state) ? "revoked" : state === "SUBSCRIPTION_STATE_EXPIRED" || expiry <= now.getTime() ? "expired" : "active";
    return {
      provider: "google",
      sourceKey: await sourceKey(token),
      userId,
      productId,
      status,
      currentPeriodEnd: new Date(expiry).toISOString(),
      autoRenew: status === "active" && state !== "SUBSCRIPTION_STATE_CANCELED" && plan.autoRenewEnabled === true,
      environment: purchase.testPurchase != null ? "sandbox" : "production",
      verifiedAt: now.toISOString(),
      acknowledgementRequired: purchase.acknowledgementState === "ACKNOWLEDGEMENT_STATE_PENDING",
    };
  }

  async function acknowledgeGoogleMembership(
    purchaseToken: string, expectedUserId: string, config: GoogleMembershipConfig, now = new Date(),
  ): Promise<VerifiedGoogleMembership> {
    // Call only after the verified record passed the server allowlist and its access grant was saved.
    // Recheck Google/account identity instead of trusting a product ID supplied by the caller.
    const verified = await verifyGoogleMembership(purchaseToken, expectedUserId, config, now);
    if (verified.status !== "active") throw invalid("Google subscription is not active and cannot be acknowledged");
    if (verified.acknowledgementRequired) await dependencies.acknowledgeSubscription(purchaseToken, verified.productId, config);
    return { ...verified, acknowledgementRequired: false };
  }

  return { verifyGoogleMembership, acknowledgeGoogleMembership, googleMembershipSourceKey: sourceKey, getGoogleMembershipAccountBinding };
}
