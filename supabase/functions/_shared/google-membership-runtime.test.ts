import { beforeAll, describe, expect, it, vi } from "vitest";
import { createGooglePublisherTransport } from "./google-membership-runtime";

const now = new Date("2026-11-03T18:00:00Z");
const purchaseToken = "fixture-google-purchase-token";
const tokenUrl = "https://oauth2.googleapis.com/token";
const productId = "dirty_turf_scanner_monthly";
const oauthToken = "fixture-oauth-access-token";
let serviceAccount: Record<string, string>;
let keyPair: CryptoKeyPair;
beforeAll(async () => {
  keyPair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const bytes = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keyPair.privateKey));
  const encoded = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(""));
  const keyLabel = "PRIVATE KEY";
  const key = `-----BEGIN ${keyLabel}-----\n${encoded.match(/.{1,64}/g)!.join("\n")}\n-----END ${keyLabel}-----\n`;
  serviceAccount = { type: "service_account", client_email: "billing-verifier@fixture-project.iam.gserviceaccount.com", private_key_id: "fixture-key-id", private_key: key, token_uri: tokenUrl };
});
const config = () => ({ serviceAccountJson: JSON.stringify(serviceAccount) });
function oauthResponse() { return Response.json({ access_token: oauthToken, token_type: "Bearer", expires_in: 3600 }); }
function decode(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")), char => char.charCodeAt(0));
}

describe("server-only Google Publisher transport", () => {
  it("signs a restricted RS256 OAuth assertion, then queries only the fixed app package", async () => {
    const request = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(init?.redirect).toBe("error");
      if (String(url) === tokenUrl) {
        const assertion = new URLSearchParams(String(init?.body)).get("assertion")!;
        const [header, payload, signature] = assertion.split(".");
        expect(JSON.parse(new TextDecoder().decode(decode(header)))).toEqual({ alg: "RS256", typ: "JWT", kid: "fixture-key-id" });
        expect(JSON.parse(new TextDecoder().decode(decode(payload)))).toEqual({
          iss: serviceAccount.client_email, scope: "https://www.googleapis.com/auth/androidpublisher", aud: tokenUrl,
          iat: Math.floor(now.getTime() / 1000) - 30, exp: Math.floor(now.getTime() / 1000) + 3000,
        });
        expect(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", keyPair.publicKey, decode(signature), new TextEncoder().encode(`${header}.${payload}`))).toBe(true);
        return oauthResponse();
      }
      expect(String(url)).toBe(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.dirtyturf.academy/purchases/subscriptionsv2/tokens/${purchaseToken}`);
      expect(init?.method).toBe("GET");
      expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${oauthToken}`);
      return Response.json({ subscriptionState: "fixture-response" });
    });
    const transport = createGooglePublisherTransport({ fetch: request, now: () => now });
    expect(await transport.getSubscription(purchaseToken, config())).toEqual({ subscriptionState: "fixture-response" });
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("does not send credentials to a token URI in untrusted configuration", async () => {
    const request = vi.fn();
    const transport = createGooglePublisherTransport({ fetch: request });
    await expect(transport.getSubscription(purchaseToken, { serviceAccountJson: JSON.stringify({ ...serviceAccount, token_uri: "https://untrusted.example/token" }) })).rejects.toThrow("credentials are not configured");
    expect(request).not.toHaveBeenCalled();
  });
  it("encodes opaque purchase tokens in a fixed package URL", async () => {
    const token = "opaque-token/with?query#and%percent";
    const request = vi.fn(async (url: string | URL | Request) => String(url) === tokenUrl ? oauthResponse() : Response.json({}));
    const transport = createGooglePublisherTransport({ fetch: request, now: () => now });
    await transport.getSubscription(token, config());
    expect(String(request.mock.calls[1][0])).toContain(`/com.dirtyturf.academy/purchases/subscriptionsv2/tokens/${encodeURIComponent(token)}`);
  });
  it("shares an in-flight OAuth refresh and caches its result, then refreshes near expiry", async () => {
    let currentTime = now.getTime();
    let tokenCalls = 0;
    const request = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === tokenUrl) { tokenCalls++; return oauthResponse(); }
      return Response.json({});
    });
    const transport = createGooglePublisherTransport({ fetch: request, now: () => new Date(currentTime) });
    await Promise.all([transport.getSubscription(purchaseToken, config()), transport.getSubscription(purchaseToken, config())]);
    expect(tokenCalls).toBe(1);
    await transport.getSubscription(purchaseToken, config());
    expect(tokenCalls).toBe(1);
    currentTime += 3550 * 1000;
    await transport.getSubscription(purchaseToken, config());
    expect(tokenCalls).toBe(2);
  });
  it("discards an unauthorized cached token so the next request can recover", async () => {
    let tokenCalls = 0;
    let providerCalls = 0;
    const request = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === tokenUrl) { tokenCalls++; return oauthResponse(); }
      providerCalls++;
      return providerCalls === 1 ? new Response("Unauthorized", { status: 401 }) : Response.json({});
    });
    const transport = createGooglePublisherTransport({ fetch: request, now: () => now });
    await expect(transport.getSubscription(purchaseToken, config())).rejects.toThrow();
    await transport.getSubscription(purchaseToken, config());
    expect(tokenCalls).toBe(2);
  });
  it.each([400, 403, 404, 410, 429, 500])("fails closed on provider HTTP %i without leaking tokens or provider body", async (status) => {
    const request = vi.fn(async (url: string | URL | Request) => String(url) === tokenUrl ? oauthResponse() : new Response(`sensitive-provider-body-${purchaseToken}`, { status }));
    const transport = createGooglePublisherTransport({ fetch: request, now: () => now });
    await expect(transport.getSubscription(purchaseToken, config())).rejects.toThrow("temporarily unavailable");
    expect(request.mock.calls.some(call => String(call[0]).endsWith(":acknowledge"))).toBe(false);
  });
  it("bounds the Google response size and rejects malformed JSON", async () => {
    for (const body of ["x".repeat(65537), "{malformed}"]) {
      const request = vi.fn(async (url: string | URL | Request) => String(url) === tokenUrl ? oauthResponse() : new Response(body));
      await expect(createGooglePublisherTransport({ fetch: request, now: () => now }).getSubscription(purchaseToken, config())).rejects.toThrow();
    }
  });
  it("rejects an invalid OAuth token response before contacting Publisher", async () => {
    const request = vi.fn(async () => Response.json({ access_token: "bad\nheader-token", token_type: "Bearer", expires_in: 3600 }));
    await expect(createGooglePublisherTransport({ fetch: request, now: () => now }).getSubscription(purchaseToken, config())).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("aborts a stalled Publisher request within the configured bounded timeout", async () => {
    const request = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === tokenUrl) return oauthResponse();
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    });
    const transport = createGooglePublisherTransport({ fetch: request, now: () => now, requestTimeoutMs: 100 });
    await expect(transport.getSubscription(purchaseToken, config())).rejects.toThrow("temporarily unavailable");
  });
  it("acknowledges only a known subscription through the fixed authenticated Google API", async () => {
    const request = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => String(url) === tokenUrl ? oauthResponse() : new Response(null, { status: 204 }));
    const transport = createGooglePublisherTransport({ fetch: request, now: () => now });
    await transport.acknowledgeSubscription(purchaseToken, productId, config());
    const [url, init] = request.mock.calls[1];
    expect(String(url)).toBe(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.dirtyturf.academy/purchases/subscriptions/${productId}/tokens/${purchaseToken}:acknowledge`);
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe("{}");
    expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${oauthToken}`);
    await expect(transport.acknowledgeSubscription(purchaseToken, "unmapped", config())).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("fails on acknowledgement HTTP errors", async () => {
    const request = vi.fn(async (url: string | URL | Request) => String(url) === tokenUrl ? oauthResponse() : new Response("provider detail", { status: 500 }));
    await expect(createGooglePublisherTransport({ fetch: request, now: () => now }).acknowledgeSubscription(purchaseToken, productId, config())).rejects.toThrow("acknowledgement failed");
  });
  it("hashes the same canonical account identifier as the Android client", async () => {
    expect(await createGooglePublisherTransport().sha256("00000000-1111-4222-8333-444444444444")).toBe("6bda766231cc1a705b966314dba71fdc54fe8bdf733b151a364ed87884feff74");
  });
});
