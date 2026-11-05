export const APPLE_MEMBERSHIP_BUNDLE_ID = "com.dirtyturf.academy";
export const APPLE_MEMBERSHIP_APP_ID = 6813588770;
export const APPLE_MEMBERSHIP_PRODUCTS = new Set([
  "dirty_turf_community_monthly", "dirty_turf_scanner_monthly", "dirty_turf_academy_monthly",
]);
export type AppleMembershipEnvironment = "production" | "sandbox";
export type AppleMembershipConfig = { privateKey: string; keyId: string; issuerId: string };
export type VerifiedAppleMembership = {
  provider: "apple";
  sourceKey: string;
  userId: string;
  productId: string;
  status: "active" | "expired" | "revoked";
  currentPeriodEnd: string;
  autoRenew: boolean;
  environment: AppleMembershipEnvironment;
  verifiedAt: string;
};
export type AppleSignedDataVerifier = {
  verifyAndDecodeTransaction(value: string): Promise<unknown>;
  verifyAndDecodeRenewalInfo(value: string): Promise<unknown>;
  verifyAndDecodeNotification(value: string): Promise<unknown>;
};
export type AppleMembershipDependencies = {
  verifierForEnvironment(environment: AppleMembershipEnvironment): AppleSignedDataVerifier;
  clientForEnvironment(environment: AppleMembershipEnvironment, config: AppleMembershipConfig): {
    getAllSubscriptionStatuses(originalTransactionId: string): Promise<unknown>;
  };
};

const failure = (message = "Apple membership verification failed") => new Error(message);
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw failure();
  return value as Record<string, unknown>;
}
function account(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw failure("Apple purchase account is invalid");
  return value.toLowerCase();
}
function transactionID(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,29}$/.test(value)) throw failure("Apple transaction identity is invalid");
  return value;
}
function timestamp(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || !Number.isFinite(new Date(value).getTime())) throw failure("Apple subscription time is invalid");
  return value;
}
function environment(value: unknown): AppleMembershipEnvironment {
  if (value === "Production") return "production";
  if (value === "Sandbox") return "sandbox";
  throw failure("Apple purchase environment is not supported");
}
function signedValue(value: unknown): string {
  if (typeof value !== "string" || value.length > 65_536 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) throw failure("Apple signed purchase proof is invalid");
  return value;
}

// This untrusted decode only selects which verifier to use. Nothing from it may
// grant access; the official SDK must verify the complete signed value next.
function verifierEnvironment(value: string, notification: boolean): AppleMembershipEnvironment {
  const payload = signedValue(value).split(".")[1];
  let decoded: Record<string, unknown>;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
    decoded = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  } catch { throw failure("Apple signed purchase proof is invalid"); }
  if (notification) return environment(object(decoded.data ?? decoded.summary).environment);
  return environment(decoded.environment);
}

function validateApp(value: Record<string, unknown>, expectedEnvironment: AppleMembershipEnvironment, requireAppID: boolean) {
  if (value.bundleId !== APPLE_MEMBERSHIP_BUNDLE_ID || environment(value.environment) !== expectedEnvironment ||
      (requireAppID && expectedEnvironment === "production" && value.appAppleId !== APPLE_MEMBERSHIP_APP_ID) ||
      (value.appAppleId !== undefined && value.appAppleId !== APPLE_MEMBERSHIP_APP_ID)) throw failure("Apple application identity does not match");
}

function validateTransaction(value: unknown, userId: string, expectedEnvironment: AppleMembershipEnvironment) {
  const transaction = object(value);
  validateApp(transaction, expectedEnvironment, false);
  if (account(transaction.appAccountToken) !== userId) throw failure("Apple purchase belongs to another account");
  if (typeof transaction.productId !== "string" || !APPLE_MEMBERSHIP_PRODUCTS.has(transaction.productId) ||
      transaction.type !== "Auto-Renewable Subscription" || transaction.inAppOwnershipType !== "PURCHASED" || transaction.isUpgraded === true) {
    throw failure("Apple membership product is not supported");
  }
  transactionID(transaction.transactionId);
  transactionID(transaction.originalTransactionId);
  timestamp(transaction.expiresDate);
  timestamp(transaction.purchaseDate);
  return transaction;
}

export function createAppleMembershipVerifier(dependencies: AppleMembershipDependencies) {
  async function refresh(
    proof: string, expectedUserId: string, config: AppleMembershipConfig, now: Date,
  ): Promise<VerifiedAppleMembership> {
    const currentTime = now.getTime();
    if (!Number.isFinite(currentTime)) throw failure("Verification time is invalid");
    const userId = account(expectedUserId);
    const targetEnvironment = verifierEnvironment(proof, false);
    const verifier = dependencies.verifierForEnvironment(targetEnvironment);
    const original = validateTransaction(await verifier.verifyAndDecodeTransaction(signedValue(proof)), userId, targetEnvironment);
    const sourceKey = transactionID(original.originalTransactionId);
    // An authentic but old device/notification JWS cannot reactivate a refund.
    // Always read the current subscription status from Apple's authenticated API.
    const response = object(await dependencies.clientForEnvironment(targetEnvironment, config).getAllSubscriptionStatuses(sourceKey));
    validateApp(response, targetEnvironment, true);
    if (!Array.isArray(response.data) || response.data.length > 100) throw failure();
    const matches: Record<string, unknown>[] = [];
    for (const rawGroup of response.data) {
      const group = object(rawGroup);
      if (!Array.isArray(group.lastTransactions) || group.lastTransactions.length > 100) throw failure();
      for (const rawItem of group.lastTransactions) {
        const item = object(rawItem);
        if (item.originalTransactionId === sourceKey) matches.push(item);
      }
    }
    if (matches.length !== 1) throw failure("Apple subscription status could not be resolved");
    const item = matches[0];
    const latest = validateTransaction(await verifier.verifyAndDecodeTransaction(signedValue(item.signedTransactionInfo)), userId, targetEnvironment);
    const renewal = object(await verifier.verifyAndDecodeRenewalInfo(signedValue(item.signedRenewalInfo)));
    if (transactionID(latest.originalTransactionId) !== sourceKey || latest.productId !== original.productId ||
        transactionID(renewal.originalTransactionId) !== sourceKey || renewal.productId !== latest.productId ||
        environment(renewal.environment) !== targetEnvironment ||
        (renewal.appAccountToken !== undefined && account(renewal.appAccountToken) !== userId) ||
        (renewal.autoRenewStatus !== 0 && renewal.autoRenewStatus !== 1) ||
        ![1, 2, 3, 4, 5].includes(item.status as number)) throw failure("Apple subscription lineage does not match");
    const expiresAt = timestamp(latest.expiresDate);
    if (timestamp(latest.purchaseDate) > currentTime + 300_000) throw failure("Apple purchase date is in the future");
    let periodEnd = expiresAt;
    let status: VerifiedAppleMembership["status"] = "expired";
    if (item.status === 5 || latest.revocationDate !== undefined) {
      if (latest.revocationDate !== undefined) timestamp(latest.revocationDate);
      status = "revoked";
    } else if (item.status === 4) {
      periodEnd = timestamp(renewal.gracePeriodExpiresDate);
      if (periodEnd < expiresAt) throw failure("Apple grace period is invalid");
      status = periodEnd > currentTime ? "active" : "expired";
    } else if (item.status === 1 && expiresAt > currentTime) {
      status = "active";
    }
    return {
      provider: "apple", sourceKey, userId, productId: latest.productId as string,
      status, currentPeriodEnd: new Date(periodEnd).toISOString(),
      autoRenew: status === "active" && renewal.autoRenewStatus === 1,
      environment: targetEnvironment, verifiedAt: now.toISOString(),
    };
  }

  return {
    verifyAppleMembership(proof: string, expectedUserId: string, config: AppleMembershipConfig, now = new Date()) {
      return refresh(proof, expectedUserId, config, now);
    },
    async verifyAppleMembershipNotification(signedPayload: string, config: AppleMembershipConfig, now = new Date()): Promise<VerifiedAppleMembership | null> {
      const targetEnvironment = verifierEnvironment(signedPayload, true);
      const verifier = dependencies.verifierForEnvironment(targetEnvironment);
      const notification = object(await verifier.verifyAndDecodeNotification(signedValue(signedPayload)));
      const data = object(notification.data ?? notification.summary);
      validateApp(data, targetEnvironment, true);
      // Apple's signed TEST/summary notifications do not represent a membership.
      if (data.signedTransactionInfo === undefined) {
        if (notification.notificationType === "TEST" || notification.summary !== undefined) return null;
        throw failure("Apple notification has no transaction");
      }
      const proof = signedValue(data.signedTransactionInfo);
      const transaction = object(await verifier.verifyAndDecodeTransaction(proof));
      const userId = account(transaction.appAccountToken);
      validateTransaction(transaction, userId, targetEnvironment);
      return refresh(proof, userId, config, now);
    },
  };
}
