import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import appleServerLibrary from "@apple/app-store-server-library";
import { APPLE_MEMBERSHIP_APP_ID, APPLE_MEMBERSHIP_BUNDLE_ID, type AppleMembershipEnvironment } from "../../../supabase/functions/_shared/apple-membership.ts";
import { PINNED_APPLE_ROOTS } from "../../../supabase/functions/_shared/apple-trust-roots.ts";
import type { AppleSignatureRequest } from "../../../supabase/functions/_shared/apple-signed-verifier-protocol.ts";

const { SignedDataVerifier, Environment } = appleServerLibrary;
const roots = PINNED_APPLE_ROOTS.map(({ base64, sha256 }) => {
  const certificate = Buffer.from(base64, "base64");
  if (createHash("sha256").update(certificate).digest("hex") !== sha256) throw new Error("Pinned Apple certificate is invalid");
  return certificate;
});
const verifiers = new Map<AppleMembershipEnvironment, InstanceType<typeof SignedDataVerifier>>();
export async function verifyAppleSignedData(request: AppleSignatureRequest): Promise<unknown> {
  let verifier = verifiers.get(request.environment);
  if (!verifier) {
    verifier = new SignedDataVerifier(roots, true,
      request.environment === "production" ? Environment.PRODUCTION : Environment.SANDBOX,
      APPLE_MEMBERSHIP_BUNDLE_ID, request.environment === "production" ? APPLE_MEMBERSHIP_APP_ID : undefined);
    verifiers.set(request.environment, verifier);
  }
  switch (request.operation) {
    case "notification": return verifier.verifyAndDecodeNotification(request.signedData);
    case "transaction": return verifier.verifyAndDecodeTransaction(request.signedData);
    case "renewal": return verifier.verifyAndDecodeRenewalInfo(request.signedData);
  }
}
