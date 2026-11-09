import type { AppleMembershipEnvironment, AppleSignedDataVerifier } from "./apple-membership.ts";
import {
  APPLE_SIGNATURE_ENDPOINT, APPLE_SIGNATURE_MAX_RESPONSE, object, readBoundedText,
  validSignatureSecret, validateDecodedSignature, validateSignatureRequest, type AppleSignatureOperation,
} from "./apple-signed-verifier-protocol.ts";

// The URL is deliberately not environment-configurable: receipts must only go to
// the canonical signature service, never an arbitrary or redirected endpoint.
export function createRemoteAppleVerifier(
  environment: AppleMembershipEnvironment, secret: string | undefined, fetcher: typeof fetch = fetch,
): AppleSignedDataVerifier {
  async function verify(operation: AppleSignatureOperation, signedData: string) {
    if (!validSignatureSecret(secret)) throw new Error("Apple signature verifier is not configured");
    const request = validateSignatureRequest({ operation, environment, signedData });
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        fetcher(APPLE_SIGNATURE_ENDPOINT, {
          method: "POST", redirect: "error", signal: controller.signal,
          headers: { "authorization": `Bearer ${secret}`, "content-type": "application/json" },
          body: JSON.stringify(request),
        }).then(async (result) => {
          if (result.status !== 200 || result.redirected || result.url && result.url !== APPLE_SIGNATURE_ENDPOINT ||
              result.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new Error("Apple signature service unavailable");
          const contentLength = result.headers.get("content-length");
          if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > APPLE_SIGNATURE_MAX_RESPONSE)) throw new Error("Apple signature response exceeds limit");
          return object(JSON.parse(await readBoundedText(result.body, APPLE_SIGNATURE_MAX_RESPONSE)));
        }),
        new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => {
          controller.abort(); reject(new Error("Apple signature service timed out"));
        }, 12_000); }),
      ]);
      if (Object.keys(response).sort().join(",") !== "decoded,environment,operation" || response.environment !== environment || response.operation !== operation) throw new Error("Unexpected Apple signature response");
      return validateDecodedSignature(response.decoded, request);
    } finally { if (timeout !== undefined) clearTimeout(timeout); }
  }
  return {
    verifyAndDecodeNotification: (signedData) => verify("notification", signedData),
    verifyAndDecodeTransaction: (signedData) => verify("transaction", signedData),
    verifyAndDecodeRenewalInfo: (signedData) => verify("renewal", signedData),
  };
}
