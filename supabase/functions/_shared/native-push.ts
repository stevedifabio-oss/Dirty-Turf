// Native providers only. Never import this server module into the public client.
export type PushDelivery = { id: string; platform: "ios" | "android"; environment: "sandbox" | "production"; token: string; notification_id: string; target_type: string; target_id: string; comment_id: string | null };
export type PushOutcome = { result: "sent" | "invalid_token" | "retry" | "uncertain" | "rejected"; providerId?: string };
export const PUSH_CONFIG_NAMES = ["ACADEMY_PUSH_ENABLED", "ACADEMY_PUSH_DISPATCH_SECRET", "ACADEMY_PUSH_ENVIRONMENT", "APNS_KEY_ID", "APNS_TEAM_ID", "APNS_PRIVATE_KEY", "APNS_TOPIC", "FCM_PROJECT_ID", "FCM_CLIENT_EMAIL", "FCM_PRIVATE_KEY"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TITLE = "Dirty Turf Academy";
const BODY = "You have a new Academy notification. Open the app to view it.";
const PRIVATE_KEY_BEGIN = "-----BEGIN" + " PRIVATE KEY-----";
const PRIVATE_KEY_END = "-----END" + " PRIVATE KEY-----";
let apnsAuthentication: { key: string; token: string; until: number } | undefined;
export function safePushData(delivery: PushDelivery) {
  if (!UUID.test(delivery.id) || !UUID.test(delivery.notification_id) || !UUID.test(delivery.target_id) || !["post", "event", "course", "community"].includes(delivery.target_type)) throw new Error("Invalid push target");
  const data: Record<string, string> = { notificationId: delivery.notification_id, targetType: delivery.target_type, targetId: delivery.target_id };
  if (delivery.comment_id && UUID.test(delivery.comment_id) && delivery.target_type === "post") data.commentId = delivery.comment_id;
  return data;
}
export function configuredPushEnvironment(settings: Record<string, string | undefined>) {
  const environment = settings.ACADEMY_PUSH_ENVIRONMENT;
  if (environment !== "sandbox" && environment !== "production") throw new Error("Push environment is not configured");
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(settings.ACADEMY_PUSH_DISPATCH_SECRET ?? "")) throw new Error("Push dispatch credential is not configured");
  if (!/^[A-Z0-9]{10}$/.test(settings.APNS_KEY_ID ?? "") || !/^[A-Z0-9]{10}$/.test(settings.APNS_TEAM_ID ?? "") || settings.APNS_TOPIC !== "com.dirtyturf.academy") throw new Error("APNs configuration is incomplete");
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(settings.FCM_PROJECT_ID ?? "") || !/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(settings.FCM_CLIENT_EMAIL ?? "")) throw new Error("FCM configuration is incomplete");
  for (const name of ["APNS_PRIVATE_KEY", "FCM_PRIVATE_KEY"]) if (!settings[name]?.startsWith(PRIVATE_KEY_BEGIN) || !settings[name]?.trimEnd().endsWith(PRIVATE_KEY_END)) throw new Error("Push signing configuration is incomplete");
  return environment;
}
const encode = (value: string | Uint8Array) => btoa(typeof value === "string" ? value : Array.from(value, x => String.fromCharCode(x)).join("")).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
async function signedJwt(header: Record<string, string>, claims: Record<string, string | number>, pem: string, algorithm: "ES256" | "RS256") {
  const raw = pem.replace(PRIVATE_KEY_BEGIN, "").replace(PRIVATE_KEY_END, "").replace(/\s/g, "");
  const keyBytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", keyBytes, algorithm === "ES256" ? { name: "ECDSA", namedCurve: "P-256" } : { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const data = `${encode(JSON.stringify(header))}.${encode(JSON.stringify(claims))}`;
  const signature = await crypto.subtle.sign(algorithm === "ES256" ? { name: "ECDSA", hash: "SHA-256" } : "RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(data));
  return `${data}.${encode(new Uint8Array(signature))}`;
}
// Authentication is completed BEFORE the worker's final authorization read.
export async function preparePushSender(platform: "ios" | "android", environment: "sandbox" | "production", settings: Record<string, string | undefined>, fetchImpl: typeof fetch = fetch, now = Date.now()) {
  const issuedAt = Math.floor(now / 1000);
  let bearer: string;
  if (platform === "ios") {
    const key = [environment, settings.APNS_KEY_ID, settings.APNS_TEAM_ID, settings.APNS_PRIVATE_KEY].join("|");
    if (apnsAuthentication?.key === key && apnsAuthentication.until > now) bearer = apnsAuthentication.token;
    else {
      bearer = await signedJwt({ alg: "ES256", kid: settings.APNS_KEY_ID! }, { iss: settings.APNS_TEAM_ID!, iat: issuedAt }, settings.APNS_PRIVATE_KEY!, "ES256");
      apnsAuthentication = { key, token: bearer, until: now + 45 * 60_000 };
    }
  } else {
    const assertion = await signedJwt({ alg: "RS256", typ: "JWT" }, { iss: settings.FCM_CLIENT_EMAIL!, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: issuedAt, exp: issuedAt + 3600 }, settings.FCM_PRIVATE_KEY!, "RS256");
    const response = await fetchImpl("https://oauth2.googleapis.com/token", { method: "POST", redirect: "error", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }), signal: AbortSignal.timeout(20_000) });
    const data = await response.json().catch(() => null);
    if (!response.ok || typeof data?.access_token !== "string" || !data.access_token || data.token_type?.toLowerCase() !== "bearer") throw new Error("FCM authentication failed");
    bearer = data.access_token;
  }
  return async (delivery: PushDelivery): Promise<PushOutcome> => {
    const data = safePushData(delivery);
    if (delivery.platform !== platform || delivery.environment !== environment) throw new Error("Push provider mismatch");
    if (platform === "ios" && !/^(?:[a-f0-9]{2})+$/i.test(delivery.token)) throw new Error("Invalid APNs device token");
    if (delivery.token.length < 20 || delivery.token.length > 4096 || /\s/.test(delivery.token)) throw new Error("Invalid push token");
    try {
      if (platform === "ios") {
        const origin = environment === "sandbox" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
        const response = await fetchImpl(`${origin}/3/device/${delivery.token}`, { method: "POST", redirect: "error", headers: { authorization: `bearer ${bearer}`, "content-type": "application/json", "apns-topic": settings.APNS_TOPIC!, "apns-push-type": "alert", "apns-priority": "10", "apns-id": delivery.id, "apns-collapse-id": delivery.notification_id, "apns-expiration": String(issuedAt + 3600) }, body: JSON.stringify({ aps: { alert: { title: TITLE, body: BODY }, sound: "default" }, ...data }), signal: AbortSignal.timeout(20_000) });
        if (response.status === 200) return { result: "sent", providerId: response.headers.get("apns-id") ?? delivery.id };
        const failure = await response.json().catch(() => null);
        if (response.status === 410 && failure?.reason === "Unregistered") return { result: "invalid_token" };
        return { result: response.status === 429 ? "retry" : response.status >= 500 ? "uncertain" : "rejected" };
      }
      const response = await fetchImpl(`https://fcm.googleapis.com/v1/projects/${settings.FCM_PROJECT_ID}/messages:send`, { method: "POST", redirect: "error", headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" }, body: JSON.stringify({ message: { token: delivery.token, notification: { title: TITLE, body: BODY }, data, android: { priority: "normal", ttl: "3600s", collapse_key: delivery.notification_id, notification: { channel_id: "academy", tag: delivery.notification_id, visibility: "PRIVATE" } } } }), signal: AbortSignal.timeout(20_000) });
      const result = await response.json().catch(() => null);
      if (response.ok && typeof result?.name === "string" && result.name) return { result: "sent", providerId: result.name };
      if (response.status === 404 && Array.isArray(result?.error?.details) && result.error.details.some((entry: { errorCode?: string }) => entry.errorCode === "UNREGISTERED")) return { result: "invalid_token" };
      return { result: response.status === 429 ? "retry" : response.status >= 500 || response.ok ? "uncertain" : "rejected" };
    } catch {
      // Transport/timeout results are ambiguous; never auto-replay a possible alert.
      return { result: "uncertain" };
    }
  };
}
