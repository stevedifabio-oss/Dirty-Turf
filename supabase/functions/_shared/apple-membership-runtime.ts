import { createRemoteAppleVerifier } from "./apple-signed-verifier-client.ts";
import { AppStoreServerAPIClient, Environment } from "npm:@apple/app-store-server-library@3.1.0";
import {
  APPLE_MEMBERSHIP_BUNDLE_ID,
  createAppleMembershipVerifier, type AppleMembershipConfig, type AppleMembershipEnvironment,
} from "./apple-membership.ts";

const sdkEnvironment = (environment: AppleMembershipEnvironment) => environment === "production" ? Environment.PRODUCTION : Environment.SANDBOX;
function configured(config: AppleMembershipConfig) {
  const pemLabel = ["PRIVATE", "KEY"].join(" ");
  if (!config || typeof config.privateKey !== "string" || !config.privateKey.startsWith(`-----BEGIN ${pemLabel}-----`) ||
      !config.privateKey.trimEnd().endsWith(`-----END ${pemLabel}-----`) ||
      !/^[A-Z0-9]{10}$/.test(config.keyId) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(config.issuerId)) {
    throw new Error("Apple membership server credentials are not configured");
  }
}
const implementation = createAppleMembershipVerifier({
  verifierForEnvironment(environment) {
    return createRemoteAppleVerifier(environment, Deno.env.get("APPLE_SIGNATURE_VERIFIER_SECRET"));
  },
  clientForEnvironment(environment, config) {
    configured(config);
    return new AppStoreServerAPIClient(
      config.privateKey, config.keyId, config.issuerId, APPLE_MEMBERSHIP_BUNDLE_ID, sdkEnvironment(environment),
    );
  },
});

async function withinVerificationDeadline<T>(operation: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("Apple membership verification timed out")), 30_000);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export function verifyAppleMembership(
  signedTransactionInfo: string, expectedUserId: string, config: AppleMembershipConfig, now = new Date(),
) {
  return withinVerificationDeadline(implementation.verifyAppleMembership(signedTransactionInfo, expectedUserId, config, now));
}

export function verifyAppleMembershipNotification(signedPayload: string, config: AppleMembershipConfig, now = new Date()) {
  return withinVerificationDeadline(implementation.verifyAppleMembershipNotification(signedPayload, config, now));
}
