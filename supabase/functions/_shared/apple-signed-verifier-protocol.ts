import { APPLE_MEMBERSHIP_APP_ID, APPLE_MEMBERSHIP_BUNDLE_ID, type AppleMembershipEnvironment } from "./apple-membership.ts";

export const APPLE_SIGNATURE_ENDPOINT = "https://app.dirtyturf.com/.netlify/functions/apple-signed-verifier";
export const APPLE_SIGNATURE_MAX_BODY = 70_000;
export const APPLE_SIGNATURE_MAX_RESPONSE = 100_000;
export type AppleSignatureOperation = "notification" | "transaction" | "renewal";
export type AppleSignatureRequest = { operation: AppleSignatureOperation; environment: AppleMembershipEnvironment; signedData: string };
export const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Apple signature data");
  return value as Record<string, unknown>;
};
export function validateSignatureRequest(value: unknown): AppleSignatureRequest {
  const input = object(value);
  if (Object.keys(input).sort().join(",") !== "environment,operation,signedData" ||
      !["notification", "transaction", "renewal"].includes(input.operation as string) ||
      !["production", "sandbox"].includes(input.environment as string) ||
      typeof input.signedData !== "string" || input.signedData.length > 65_536 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(input.signedData)) throw new Error("Invalid Apple signature request");
  return input as AppleSignatureRequest;
}
export function validateDecodedSignature(decoded: unknown, request: Pick<AppleSignatureRequest, "operation" | "environment">) {
  const value = object(decoded);
  const identity = request.operation === "notification" ? object(value.data ?? value.summary) : value;
  if (identity.environment !== (request.environment === "production" ? "Production" : "Sandbox")) throw new Error("Apple signature environment mismatch");
  if (request.operation !== "renewal" && (identity.bundleId !== APPLE_MEMBERSHIP_BUNDLE_ID ||
      (request.environment === "production" && request.operation === "notification" && identity.appAppleId !== APPLE_MEMBERSHIP_APP_ID) ||
      (identity.appAppleId !== undefined && identity.appAppleId !== APPLE_MEMBERSHIP_APP_ID))) throw new Error("Apple signature application mismatch");
  return value;
}
export async function readBoundedText(body: ReadableStream<Uint8Array> | null, max: number): Promise<string> {
  if (!body) throw new Error("Missing Apple signature body");
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) throw new RangeError("Apple signature body exceeds limit");
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
export function validSignatureSecret(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43,128}$/.test(value);
}
