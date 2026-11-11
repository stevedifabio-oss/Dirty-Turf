import { readLimitedJson, RequestBodyTooLarge } from "./limited-json.ts";
export type VerifiedStoreMembership = {
  provider: "google" | "apple"; sourceKey: string; userId: string; productId: string;
  status: "active" | "expired" | "revoked"; currentPeriodEnd: string;
  autoRenew: boolean; environment: "production" | "sandbox"; verifiedAt: string;
};
export type MembershipVerificationDependencies = {
  authenticate(authorization: string): Promise<string | null>;
  availability(authorization: string, provider: "google" | "apple"): Promise<{ enabled: boolean; products: string[]; restorableProducts?: string[] }>;
  reserveVerification?(userId: string): Promise<boolean>;
  verifyGoogle(token: string, userId: string): Promise<VerifiedStoreMembership>;
  verifyApple(signedTransactionInfo: string, userId: string): Promise<VerifiedStoreMembership>;
  apply(value: VerifiedStoreMembership): Promise<void>;
  acknowledgeGoogle(token: string, userId: string): Promise<void>;
};
const response = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function createMembershipVerificationHandler(deps: MembershipVerificationDependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return response(405, { error: "Method not allowed" });
    const authorization = request.headers.get("authorization") ?? "";
    if (!/^Bearer \S+$/.test(authorization)) return response(401, { error: "Please sign in again" });
    let userId: string | null;
    try { userId = await deps.authenticate(authorization); } catch { userId = null; }
    if (!userId || !uuid.test(userId)) return response(401, { error: "Please sign in again" });
    let raw: unknown;
    try {
      raw = await readLimitedJson(request, 65_536);
    } catch (error) { return response(error instanceof RequestBodyTooLarge ? 413 : 400, { error: "Invalid purchase proof" }); }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return response(422, { error: "Invalid purchase proof" });
    const proof = raw as Record<string, unknown>;
    if (!["google", "apple"].includes(String(proof.provider)) || typeof proof.productId !== "string" || proof.purchaseState === "pending") return response(422, { error: "A completed store purchase is required" });
    const provider = proof.provider as "google" | "apple";
    const credential = provider === "google" ? proof.purchaseToken : proof.signedTransactionInfo;
    if (typeof credential !== "string" || credential.length < 10 || credential.length > (provider === "google" ? 8_192 : 60_000)) return response(422, { error: "Invalid purchase proof" });
    try {
      const available = await deps.availability(authorization, provider);
      if (!(available.enabled && available.products.includes(proof.productId)) && !available.restorableProducts?.includes(proof.productId)) return response(503, { error: "This membership is not available for purchase" });
      if (deps.reserveVerification && !await deps.reserveVerification(userId)) return response(429, { error: "Please wait a minute before checking purchases again." });
      const verified = provider === "google" ? await deps.verifyGoogle(credential, userId) : await deps.verifyApple(credential, userId);
      if (verified.userId.toLowerCase() !== userId.toLowerCase() || verified.productId !== proof.productId || verified.provider !== provider) throw new Error("Purchase ownership mismatch");
      await deps.apply(verified);
      // Acknowledgement occurs only after authoritative verification and durable
      // fulfillment. A failed response leaves the proof restorable and retryable.
      if (provider === "google" && verified.status === "active") await deps.acknowledgeGoogle(credential, userId);
      return response(200, { verified: true, active: verified.status === "active", productId: verified.productId, expiresAt: verified.currentPeriodEnd });
    } catch {
      // Provider errors can contain tokens or signed data. Return no raw details.
      return response(503, { error: "Purchase confirmation is temporarily unavailable. Restore purchases to retry." });
    }
  };
}
