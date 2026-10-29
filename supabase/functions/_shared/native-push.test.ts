import { beforeAll, describe, expect, it, vi } from "vitest";
import { configuredPushEnvironment, preparePushSender, safePushData, type PushDelivery } from "./native-push";
export let apnsPem: string, fcmPem: string;
const pem = async (algorithm: RsaHashedKeyGenParams | EcKeyGenParams) => {
  const keys = await crypto.subtle.generateKey(algorithm, true, ["sign", "verify"]);
  const bytes = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keys.privateKey));
  return "-----BEGIN" + ` PRIVATE KEY-----\n${btoa(Array.from(bytes, n => String.fromCharCode(n)).join(""))}\n-----END` + " PRIVATE KEY-----";
};
beforeAll(async () => { apnsPem = await pem({ name: "ECDSA", namedCurve: "P-256" }); fcmPem = await pem({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }); });
export const testSettings = () => ({ ACADEMY_PUSH_ENABLED: "true", ACADEMY_PUSH_DISPATCH_SECRET: "synthetic-dispatch-credential-at-least-32-characters", ACADEMY_PUSH_ENVIRONMENT: "production", APNS_KEY_ID: "ABC123DEFG", APNS_TEAM_ID: "DEF123GHIJ", APNS_PRIVATE_KEY: apnsPem, APNS_TOPIC: "com.dirtyturf.academy", FCM_PROJECT_ID: "synthetic-project", FCM_CLIENT_EMAIL: "sender@synthetic-project.iam.gserviceaccount.com", FCM_PRIVATE_KEY: fcmPem });
export const delivery: PushDelivery = { id: "11111111-1111-4111-8111-111111111111", platform: "ios", environment: "production", token: "a".repeat(64), notification_id: "22222222-2222-4222-8222-222222222222", target_type: "post", target_id: "33333333-3333-4333-8333-333333333333", comment_id: null };
describe("native push provider boundary", () => {
  it("requires complete provider configuration and an exact environment", () => {
    expect(configuredPushEnvironment(testSettings())).toBe("production");
    for (const change of [{ APNS_TOPIC: "other.app" }, { ACADEMY_PUSH_ENVIRONMENT: "guess" }, { FCM_PROJECT_ID: "https://evil.test" }, { APNS_PRIVATE_KEY: "missing" }]) expect(() => configuredPushEnvironment({ ...testSettings(), ...change })).toThrow();
  });
  it("uses generic lock-screen copy and sends identifiers only", async () => {
    let request: RequestInit | undefined; let endpoint = "";
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => { endpoint = String(url); request = init; return new Response(null, { status: 200, headers: { "apns-id": delivery.id } }); }) as typeof fetch;
    const sender = await preparePushSender("ios", "production", testSettings(), fetcher);
    expect(await sender({ ...delivery, ...{ body: "SECRET DISCUSSION TEXT", title: "Private title" } })).toEqual({ result: "sent", providerId: delivery.id });
    expect(endpoint).toBe(`https://api.push.apple.com/3/device/${delivery.token}`);
    const body = JSON.parse(String(request?.body));
    expect(body.aps.alert.body).not.toContain("SECRET"); expect(body.aps.alert.title).toBe("Dirty Turf Academy");
    expect(Object.keys(body).sort()).toEqual(["aps", "notificationId", "targetId", "targetType"]);
    expect((request?.headers as Record<string, string>)["apns-id"]).toBe(delivery.id);
  });
  it("keeps sandbox tokens on the sandbox origin", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 200 })) as typeof fetch;
    const sender = await preparePushSender("ios", "sandbox", testSettings(), fetcher);
    await sender({ ...delivery, environment: "sandbox" });
    expect(String(fetcher.mock.calls[0][0])).toContain("api.sandbox.push.apple.com");
    await expect(sender(delivery)).rejects.toThrow("mismatch");
  });
  it("accepts variable-length APNs tokens rather than assuming 32 bytes", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 200 })) as typeof fetch;
    const sender = await preparePushSender("ios", "production", testSettings(), fetcher);
    expect((await sender({ ...delivery, token: "ab".repeat(48) })).result).toBe("sent");
    await expect(sender({ ...delivery, token: "ab".repeat(48) + "a" })).rejects.toThrow("token");
  });
  it.each([[410, "Unregistered", "invalid_token"], [400, "BadDeviceToken", "rejected"], [429, "TooManyRequests", "retry"], [503, "ServiceUnavailable", "uncertain"]])("classifies APNs %s without guessing a retry", async (status, reason, result) => {
    const sender = await preparePushSender("ios", "production", testSettings(), vi.fn(async () => new Response(JSON.stringify({ reason }), { status: Number(status) })) as typeof fetch);
    expect((await sender(delivery)).result).toBe(result);
  });
  it("holds transport timeouts without automatic resends", async () => {
    const sender = await preparePushSender("ios", "production", testSettings(), vi.fn(async () => { throw new Error("synthetic timeout"); }) as typeof fetch);
    expect((await sender(delivery)).result).toBe("uncertain");
  });
  it("authenticates FCM with a signed scoped assertion before sending", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => { calls.push({ url: String(url), init }); return calls.length === 1 ? Response.json({ access_token: "synthetic-oauth-token", token_type: "Bearer" }) : Response.json({ name: "projects/synthetic-project/messages/accepted" }); }) as typeof fetch;
    const sender = await preparePushSender("android", "production", testSettings(), fetcher);
    expect(calls).toHaveLength(1);
    const assertion = (calls[0].init?.body as URLSearchParams).get("assertion")!;
    const claims = JSON.parse(atob(assertion.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    expect(claims.aud).toBe("https://oauth2.googleapis.com/token"); expect(claims.scope).toBe("https://www.googleapis.com/auth/firebase.messaging");
    expect((await sender({ ...delivery, platform: "android" })).result).toBe("sent");
    const message = JSON.parse(String(calls[1].init?.body)).message;
    expect(message.android.notification.channel_id).toBe("academy"); expect(message.android.notification.visibility).toBe("PRIVATE"); expect(message.data.notificationId).toBe(delivery.notification_id);
  });
  it("retires only FCM's explicit unregistered-token response", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => String(url).includes("oauth2") ? Response.json({ access_token: "synthetic", token_type: "Bearer" }) : Response.json({ error: { details: [{ errorCode: "UNREGISTERED" }] } }, { status: 404 })) as typeof fetch;
    const sender = await preparePushSender("android", "production", testSettings(), fetcher);
    expect((await sender({ ...delivery, platform: "android" })).result).toBe("invalid_token");
  });
  it("rejects arbitrary target identifiers before a provider call", () => {
    expect(() => safePushData({ ...delivery, target_id: "https://evil.test" })).toThrow();
    expect(() => safePushData({ ...delivery, target_type: "billing" })).toThrow();
  });
});
