import type { VerifiedStoreMembership } from "./store-membership-handler.ts";
import { readLimitedJson, RequestBodyTooLarge } from "./limited-json.ts";
type Dependencies = {
  authenticate(request: Request): Promise<boolean>;
  sourceKey(token: string): Promise<string>;
  lookup(sourceKey: string): Promise<string | null>;
  accountBinding?(token: string): Promise<string>;
  resolveAccount?(hash: string): Promise<string | null>;
  verify(token: string, userId: string): Promise<VerifiedStoreMembership>;
  apply(value: VerifiedStoreMembership): Promise<void>;
  acknowledge?(token: string, userId: string): Promise<VerifiedStoreMembership>;
};
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
export function createGoogleMembershipNotificationHandler(deps: Dependencies) {
  return async (request: Request) => {
    if (request.method !== "POST") return new Response(null, { status: 405 });
    try { if (!await deps.authenticate(request)) return new Response(null, { status: 401 }); }
    catch { return new Response(null, { status: 401 }); }
    try {
      const body = await readLimitedJson(request, 100_000);
      if (!object(body) || !object(body.message) || typeof body.message.data !== "string" || body.message.data.length > 70_000) return new Response(null, { status: 400 });
      const bytes = Uint8Array.from(atob(body.message.data), value => value.charCodeAt(0));
      const notification: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      if (!object(notification) || notification.packageName !== "com.dirtyturf.academy") return new Response(null, { status: 400 });
      if (object(notification.testNotification)) return new Response(null, { status: 204 });
      const event = notification.subscriptionNotification ?? notification.voidedPurchaseNotification;
      if (!object(event)) return new Response(null, { status: 204 });
      const token = event.purchaseToken;
      if (typeof token !== "string" || token.length < 10 || token.length > 8_192) return new Response(null, { status: 400 });
      const sourceKey = await deps.sourceKey(token);
      let userId = await deps.lookup(sourceKey);
      // A pending payment can complete while the app is closed. Only Google's
      // authoritative account binding may resolve a previously unseen token.
      if (!userId && deps.accountBinding && deps.resolveAccount) {
        const hash = await deps.accountBinding(token);
        if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error("Invalid store account binding");
        userId = await deps.resolveAccount(hash);
      }
      if (!userId) return new Response(null, { status: 204 });
      const verified = await deps.verify(token, userId);
      if (verified.provider !== "google" || verified.userId !== userId || verified.sourceKey !== sourceKey) throw new Error("Subscription binding mismatch");
      // Event arrival order and client claims do not determine access. Every
      // notification triggers an authoritative current Google lookup.
      await deps.apply(verified);
      if (verified.status === "active" && deps.acknowledge) await deps.apply(await deps.acknowledge(token, userId));
      return new Response(null, { status: 204 });
    } catch (error) { return new Response(null, { status: error instanceof RequestBodyTooLarge ? 413 : 503 }); }
  };
}
