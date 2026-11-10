import { createHash, timingSafeEqual } from "node:crypto";
import {
  APPLE_SIGNATURE_MAX_BODY, APPLE_SIGNATURE_MAX_RESPONSE, readBoundedText, validSignatureSecret,
  validateDecodedSignature, validateSignatureRequest, type AppleSignatureRequest,
} from "../../../supabase/functions/_shared/apple-signed-verifier-protocol.ts";

export type SignatureVerifier = (request: AppleSignatureRequest) => Promise<unknown>;
const response = (status: number, value: unknown) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" },
});
export function createAppleSignatureHandler(getSecret: () => string | undefined, verify: SignatureVerifier) {
  return async (request: Request): Promise<Response> => {
    const secret = getSecret();
    if (!validSignatureSecret(secret)) return response(503, { error: "Signature verification unavailable" });
    // Hash both inputs to the same length; authenticate before touching the body.
    const provided = request.headers.get("authorization") ?? "";
    if (provided.length > 256 || !timingSafeEqual(
      createHash("sha256").update(provided).digest(),
      createHash("sha256").update(`Bearer ${secret}`).digest(),
    )) return response(401, { error: "Unauthorized" });
    if (request.method !== "POST" || new URL(request.url).search) return response(405, { error: "Unsupported request" });
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return response(415, { error: "JSON required" });
    const contentLength = request.headers.get("content-length");
    if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > APPLE_SIGNATURE_MAX_BODY)) return response(413, { error: "Body exceeds limit" });
    let input: AppleSignatureRequest;
    try { input = validateSignatureRequest(JSON.parse(await readBoundedText(request.body, APPLE_SIGNATURE_MAX_BODY))); }
    catch (error) { return response(error instanceof RangeError ? 413 : 400, { error: "Invalid signature request" }); }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const decoded = validateDecodedSignature(await Promise.race([
        verify(input), new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error("Signature verification timed out")), 10_000);
        }),
      ]), input);
      const result = { operation: input.operation, environment: input.environment, decoded };
      if (new TextEncoder().encode(JSON.stringify(result)).length > APPLE_SIGNATURE_MAX_RESPONSE) throw new Error("Response exceeds limit");
      return response(200, result);
    } catch { return response(503, { error: "Signature verification unavailable" }); }
    finally { if (timeout !== undefined) clearTimeout(timeout); }
  };
}
