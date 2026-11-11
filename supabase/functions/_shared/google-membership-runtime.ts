import {
  createGoogleMembershipVerifier, GOOGLE_MEMBERSHIP_PACKAGE, GOOGLE_MEMBERSHIP_PRODUCTS, GoogleMembershipError,
  type GoogleMembershipConfig, type GoogleMembershipDependencies, validatedGooglePurchaseToken,
} from "./google-membership.ts";

const OAUTH_URL = "https://oauth2.googleapis.com/token";
const PUBLISHER_URL = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${GOOGLE_MEMBERSHIP_PACKAGE}`;
const PUBLISHER_SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const encoder = new TextEncoder();
const keyLabel = "PRIVATE KEY";
const pemBegin = `-----BEGIN ${keyLabel}-----`;
const pemEnd = `-----END ${keyLabel}-----`;
const pemPattern = new RegExp(String.raw`^${pemBegin}\r?\n[A-Za-z0-9+/=\r\n]+\r?\n${pemEnd}\s*$`);

type ServiceAccount = { client_email: string; private_key: string; private_key_id?: string };
type AccessToken = { value: string; expiresAt: number };
export type GooglePublisherRuntimeDependencies = { fetch?: typeof fetch; crypto?: Crypto; now?: () => Date; requestTimeoutMs?: number };

function unavailable(message = "Google membership verification is temporarily unavailable") {
  return new GoogleMembershipError("GOOGLE_MEMBERSHIP_UNAVAILABLE", message);
}
function configured(value: GoogleMembershipConfig): ServiceAccount {
  if (!value || typeof value.serviceAccountJson !== "string" || value.serviceAccountJson.length > 32768) throw unavailable("Google membership server credentials are not configured");
  let config: Record<string, unknown>;
  try { config = JSON.parse(value.serviceAccountJson); } catch { throw unavailable("Google membership server credentials are not configured"); }
  if (!config || typeof config !== "object" || Array.isArray(config) || config.type !== "service_account" ||
      typeof config.client_email !== "string" || config.client_email.length > 254 || !/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.iam\.gserviceaccount\.com$/.test(config.client_email) ||
      typeof config.private_key !== "string" || config.private_key.length > 16384 ||
      !pemPattern.test(config.private_key) ||
      (config.private_key_id !== undefined && (typeof config.private_key_id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(config.private_key_id))) ||
      (config.token_uri !== undefined && config.token_uri !== OAUTH_URL)) {
    throw unavailable("Google membership server credentials are not configured");
  }
  return config as unknown as ServiceAccount;
}
function base64url(bytes: Uint8Array) {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join("")).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function encodedJson(value: unknown) { return base64url(encoder.encode(JSON.stringify(value))); }
function privateKeyBytes(pem: string) {
  const base64 = pem.replace(pemBegin, "").replace(pemEnd, "").replace(/\s/g, "");
  try { return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0)); }
  catch { throw unavailable("Google membership server credentials are not configured"); }
}

async function jsonBody(response: Response, maximumBytes: number): Promise<Record<string, unknown>> {
  if (Number(response.headers.get("content-length") ?? 0) > maximumBytes || !response.body) throw unavailable();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) { await reader.cancel(); throw unavailable(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable();
    return value;
  } catch { throw unavailable(); }
}

/** Server-only OAuth client. URLs/scope are fixed; credentials and tokens never enter logs or responses. */
export function createGooglePublisherTransport(overrides: GooglePublisherRuntimeDependencies = {}): GoogleMembershipDependencies {
  const request = overrides.fetch ?? globalThis.fetch;
  const cryptography = overrides.crypto ?? globalThis.crypto;
  const clock = overrides.now ?? (() => new Date());
  const requestTimeoutMs = overrides.requestTimeoutMs ?? 15000;
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 15000) throw unavailable();
  const tokens = new Map<string, AccessToken>();
  const pending = new Map<string, Promise<AccessToken>>();

  async function sha256(value: string) {
    const digest = await cryptography.subtle.digest("SHA-256", encoder.encode(value));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  async function fetchBounded(url: string, init: RequestInit, bodyLimit: number, unauthorized?: () => Promise<void>) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await request(url, { ...init, signal: controller.signal, redirect: "error" });
      if (!response.ok) {
        if (response.status === 401 && unauthorized) await unauthorized();
        await response.body?.cancel().catch(() => {});
        throw unavailable();
      }
      return await jsonBody(response, bodyLimit);
    } catch { throw unavailable(); }
    finally { clearTimeout(timeout); }
  }
  async function getToken(config: GoogleMembershipConfig): Promise<string> {
    const service = configured(config);
    const keyId = await sha256(config.serviceAccountJson);
    const time = clock().getTime();
    if (!Number.isFinite(time)) throw unavailable();
    const cached = tokens.get(keyId);
    if (cached && cached.expiresAt > time + 60000) return cached.value;
    let job = pending.get(keyId);
    if (!job) {
      job = (async () => {
        const issuedAt = Math.floor(time / 1000);
        const unsigned = `${encodedJson({ alg: "RS256", typ: "JWT", ...(service.private_key_id ? { kid: service.private_key_id } : {}) })}.${encodedJson({
          iss: service.client_email, scope: PUBLISHER_SCOPE, aud: OAUTH_URL, iat: issuedAt - 30, exp: issuedAt + 3000,
        })}`;
        let signature: ArrayBuffer;
        try {
          const key = await cryptography.subtle.importKey("pkcs8", privateKeyBytes(service.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
          if ((key.algorithm as RsaHashedKeyAlgorithm).modulusLength < 2048) throw unavailable();
          signature = await cryptography.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(unsigned));
        } catch { throw unavailable("Google membership server credentials are not configured"); }
        const body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${base64url(new Uint8Array(signature))}` });
        const result = await fetchBounded(OAUTH_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }, 16384);
        if (typeof result.access_token !== "string" || result.access_token.length < 16 || result.access_token.length > 8192 ||
            !/^[A-Za-z0-9._~+/=-]+$/.test(result.access_token) || result.token_type !== "Bearer" ||
            typeof result.expires_in !== "number" || !Number.isSafeInteger(result.expires_in) || result.expires_in < 120 || result.expires_in > 3600) {
          throw unavailable();
        }
        const token = { value: result.access_token, expiresAt: time + result.expires_in * 1000 };
        if (tokens.size >= 2 && !tokens.has(keyId)) tokens.delete(tokens.keys().next().value!);
        tokens.set(keyId, token);
        return token;
      })();
      pending.set(keyId, job);
      job.finally(() => pending.delete(keyId)).catch(() => {});
    }
    return (await job).value;
  }

  return {
    sha256,
    async getSubscription(purchaseToken, config) {
      const token = validatedGooglePurchaseToken(purchaseToken);
      const accessToken = await getToken(config);
      return fetchBounded(`${PUBLISHER_URL}/purchases/subscriptionsv2/tokens/${encodeURIComponent(token)}`, {
        method: "GET", headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      }, 65536, async () => { tokens.delete(await sha256(config.serviceAccountJson)); });
    },
    async acknowledgeSubscription(purchaseToken, productId, config) {
      const token = validatedGooglePurchaseToken(purchaseToken);
      if (!GOOGLE_MEMBERSHIP_PRODUCTS.has(productId)) throw unavailable();
      const accessToken = await getToken(config);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
      try {
        const response = await request(`${PUBLISHER_URL}/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}:acknowledge`, {
          method: "POST", redirect: "error", signal: controller.signal,
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: "{}",
        });
        if (response.status === 401) tokens.delete(await sha256(config.serviceAccountJson));
        await response.body?.cancel().catch(() => {});
        if (!response.ok) throw unavailable("Google purchase acknowledgement failed");
      } catch { throw unavailable("Google purchase acknowledgement failed"); }
      finally { clearTimeout(timeout); }
    },
  };
}

const implementation = createGoogleMembershipVerifier(createGooglePublisherTransport());
export const verifyGoogleMembership = implementation.verifyGoogleMembership;
export const acknowledgeGoogleMembership = implementation.acknowledgeGoogleMembership;
export const googleMembershipSourceKey = implementation.googleMembershipSourceKey;
export const getGoogleMembershipAccountBinding = implementation.getGoogleMembershipAccountBinding;
