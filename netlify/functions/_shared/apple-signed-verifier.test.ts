import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppleSignatureHandler } from "./apple-signed-verifier-handler.ts";
import { verifyAppleSignedData } from "./apple-signed-verifier-sdk.ts";
import { createRemoteAppleVerifier } from "../../../supabase/functions/_shared/apple-signed-verifier-client.ts";
import { APPLE_SIGNATURE_ENDPOINT } from "../../../supabase/functions/_shared/apple-signed-verifier-protocol.ts";

const secret = "A".repeat(43);
const signedData = "e30.e30.c2lnbmF0dXJl";
const input = { operation: "transaction", environment: "sandbox", signedData };
const decoded = { bundleId: "com.dirtyturf.academy", environment: "Sandbox" };
function request(body: unknown = input, headers: Record<string, string> = {}, method = "POST") {
  return new Request(APPLE_SIGNATURE_ENDPOINT, { method, headers: { authorization: `Bearer ${secret}`, "content-type": "application/json", ...headers },
    ...(method === "GET" ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) });
}
const goodResponse = () => Response.json({ operation: "transaction", environment: "sandbox", decoded });
afterEach(() => vi.useRealTimers());

describe("signature helper authentication and input boundary", () => {
  it("fails closed while unconfigured without invoking the SDK", async () => {
    const verify = vi.fn(); const handler = createAppleSignatureHandler(() => undefined, verify);
    expect((await handler(request())).status).toBe(503); expect(verify).not.toHaveBeenCalled();
  });
  it.each(["", "Bearer wrong", `Bearer ${"A".repeat(300)}`])("rejects unauthorized input before reading its body", async (authorization) => {
    const verify = vi.fn(); const req = request("{", { authorization });
    const read = vi.spyOn(req, "body", "get");
    expect((await createAppleSignatureHandler(() => secret, verify)(req)).status).toBe(401);
    expect(read).not.toHaveBeenCalled(); expect(verify).not.toHaveBeenCalled();
  });
  it.each([
    ["{", 400], [{ ...input, operation: "anything" }, 400], [{ ...input, environment: "Xcode" }, 400],
    [{ ...input, signedData: "not-jws" }, 400], [{ ...input, extra: true }, 400],
    [{ ...input, signedData: "A".repeat(65_537) }, 400], ["A".repeat(70_001), 413],
  ])("rejects malformed or oversized requests", async (body, status) => {
    const verify = vi.fn(); expect((await createAppleSignatureHandler(() => secret, verify)(request(body))).status).toBe(status);
    expect(verify).not.toHaveBeenCalled();
  });
  it("rejects declared oversize, wrong content type, GET, and query parameters", async () => {
    const handler = createAppleSignatureHandler(() => secret, vi.fn());
    expect((await handler(request(input, { "content-length": "70001" }))).status).toBe(413);
    expect((await handler(request(input, { "content-type": "text/plain" }))).status).toBe(415);
    expect((await handler(request(input, {}, "GET"))).status).toBe(405);
    const queried = new Request(`${APPLE_SIGNATURE_ENDPOINT}?proof=forbidden`, request());
    expect((await handler(queried)).status).toBe(405);
  });
});
describe("verified SDK boundary", () => {
  it("returns the verified payload with no-store and no CORS", async () => {
    const verify = vi.fn().mockResolvedValue(decoded);
    const response = await createAppleSignatureHandler(() => secret, verify)(request());
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ ...input, signedData: undefined, decoded });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
    expect(verify).toHaveBeenCalledWith(input);
  });
  it.each([{ ...decoded, environment: "Production" }, { ...decoded, bundleId: "other.app" }, { ...decoded, appAppleId: 123 }, null])("rejects SDK payload identity mismatches", async (value) => {
    expect((await createAppleSignatureHandler(() => secret, vi.fn().mockResolvedValue(value))(request())).status).toBe(503);
  });
  it("requires production notification app ID", async () => {
    const response = await createAppleSignatureHandler(() => secret, vi.fn().mockResolvedValue({ data: { bundleId: decoded.bundleId, environment: "Production" } }))(
      request({ ...input, operation: "notification", environment: "production" }));
    expect(response.status).toBe(503);
  });
  it("does not expose SDK faults or raw proofs", async () => {
    const response = await createAppleSignatureHandler(() => secret, vi.fn().mockRejectedValue(new Error(`private ${signedData}`)))(request());
    expect(response.status).toBe(503); expect(await response.text()).not.toContain(signedData);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("rejects a forged proof using the real pinned official SDK", async () => {
    const response = await createAppleSignatureHandler(() => secret, verifyAppleSignedData)(request());
    expect(response.status).toBe(503);
  });
});
describe("Edge signature client", () => {
  it("round trips through the authenticated handler without Apple credentials", async () => {
    const handler = createAppleSignatureHandler(() => secret, async () => decoded);
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => handler(new Request(url, init)));
    expect(await createRemoteAppleVerifier("sandbox", secret, fetcher as typeof fetch).verifyAndDecodeTransaction(signedData)).toEqual(decoded);
    expect(fetcher.mock.calls[0][0]).toBe(APPLE_SIGNATURE_ENDPOINT);
    expect(fetcher.mock.calls[0][1]?.redirect).toBe("error");
  });
  it("rejects missing secret before network access", async () => {
    const fetcher = vi.fn(); await expect(createRemoteAppleVerifier("sandbox", undefined, fetcher).verifyAndDecodeTransaction(signedData)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    () => new Response("", { status: 302, headers: { location: "https://other.example" } }),
    () => new Response("<html>SPA</html>", { headers: { "content-type": "text/html" } }),
    () => Response.json({ operation: "notification", environment: "sandbox", decoded }),
    () => Response.json({ operation: "transaction", environment: "production", decoded }),
    () => Response.json({ operation: "transaction", environment: "sandbox", decoded: { ...decoded, bundleId: "other.app" } }),
    () => Response.json({ operation: "transaction", environment: "sandbox", decoded, extra: true }),
    () => new Response("A".repeat(100_001), { headers: { "content-type": "application/json" } }),
    () => new Response("{", { headers: { "content-type": "application/json" } }),
    () => new Response("{}", { headers: { "content-type": "application/json", "content-length": "100001" } }),
  ])("fails closed on unexpected helper responses", async (makeResponse) => {
    await expect(createRemoteAppleVerifier("sandbox", secret, vi.fn(async () => makeResponse())).verifyAndDecodeTransaction(signedData)).rejects.toThrow();
  });
  it("aborts a stalled helper", async () => {
    vi.useFakeTimers(); let signal: AbortSignal | undefined;
    const fetcher = vi.fn((_url: unknown, init?: RequestInit) => { signal = init?.signal ?? undefined; return new Promise<Response>(() => undefined); });
    const pending = createRemoteAppleVerifier("sandbox", secret, fetcher as typeof fetch).verifyAndDecodeTransaction(signedData);
    const assertion = expect(pending).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(12_000); await assertion; expect(signal?.aborted).toBe(true);
  });
  it("returns supported renewal/notification operations", async () => {
    const handler = createAppleSignatureHandler(() => secret, async (req) => req.operation === "notification" ? { notificationType: "TEST", data: decoded } : decoded);
    const fetcher = ((url: string, init: RequestInit) => handler(new Request(url, init))) as typeof fetch;
    expect(await createRemoteAppleVerifier("sandbox", secret, fetcher).verifyAndDecodeRenewalInfo(signedData)).toEqual(decoded);
    expect(await createRemoteAppleVerifier("sandbox", secret, fetcher).verifyAndDecodeNotification(signedData)).toEqual({ notificationType: "TEST", data: decoded });
  });
});
