import { afterEach, describe, expect, it, vi } from "vitest";
import unsubscribe from "../email-unsubscribe.mts";
import { buildNotificationPreferenceStatus, buildUnsubscribeConfirmation } from "../../../supabase/functions/_shared/notification-email.ts";

afterEach(() => vi.unstubAllGlobals());
const origin = "https://app.dirtyturf.com";
function expectPrivateDocument(html: string) {
  const policy = '<meta name="referrer" content="no-referrer">';
  expect(html).toContain(`<head>${policy}`);
  expect(html.indexOf(policy)).toBeLessThan(html.indexOf("<style>"));
  expect(html.indexOf(policy)).toBeLessThan(html.indexOf("<img "));
}
describe("email unsubscribe page", () => {
  it("renders a verified GET confirmation with no write and private browser headers", async () => {
    const page = buildUnsubscribeConfirmation("payload.signature", "Comments and replies", origin);
    const fetcher = vi.fn().mockResolvedValue(new Response(page));
    vi.stubGlobal("fetch", fetcher);
    const response = await unsubscribe(new Request(`${origin}/email/unsubscribe?token=payload.signature`));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("content-security-policy")).toContain("form-action 'self'");
    expect(response.headers.get("content-security-policy")).toContain("img-src 'self'");
    expect(response.headers.get("content-security-policy")).toContain("font-src 'self'");
    expect(fetcher.mock.calls[0][1].method).toBe("GET");
    expect(fetcher.mock.calls[0][0].origin).toBe("https://ipbtldajgsoxixqmajec.supabase.co");
    const html = await response.text();
    expectPrivateDocument(html);
    expect(html).toContain('<form method="post">');
    expect(html).toContain('name="token" value="payload.signature"');
  });
  it("forwards an explicit form confirmation without cookies or credentials", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(buildNotificationPreferenceStatus("You are unsubscribed", "Comments and replies emails are now off.", origin)));
    vi.stubGlobal("fetch", fetcher);
    const response = await unsubscribe(new Request(`${origin}/email/unsubscribe`, { method: "POST", headers: { origin, cookie: "private=never-forward", "content-type": "application/x-www-form-urlencoded" }, body: "token=payload.signature" }));
    expect(response.status).toBe(200);
    expect(fetcher.mock.calls[0][1]).not.toHaveProperty("headers");
    expect(fetcher.mock.calls[0][1].method).toBe("POST");
    expect(fetcher.mock.calls[0][0].searchParams.get("token")).toBe("payload.signature");
    expectPrivateDocument(await response.text());
  });
  it("rejects foreign-origin writes, invalid tokens and unsupported methods before fetching", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect((await unsubscribe(new Request(`${origin}/email/unsubscribe?token=payload.signature`, { method: "POST", headers: { origin: "https://other.example" } }))).status).toBe(403);
    expect((await unsubscribe(new Request(`${origin}/email/unsubscribe?token=%3Cscript%3E`))).status).toBe(400);
    expect((await unsubscribe(new Request(`${origin}/email/unsubscribe`, { method: "DELETE" }))).status).toBe(405);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("bounds form input and handles gateway failures without exposing upstream data", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("private upstream diagnostic", { status: 500 })); vi.stubGlobal("fetch", fetcher);
    const large = await unsubscribe(new Request(`${origin}/email/unsubscribe`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "token=" + "x".repeat(4096) }));
    expect(large.status).toBe(413); expect(fetcher).not.toHaveBeenCalled();
    const response = await unsubscribe(new Request(`${origin}/email/unsubscribe?token=payload.signature`));
    expect(response.status).toBe(503); const html=await response.text(); expect(html).not.toContain("private upstream");
    expect(html).toContain("/dirty-turf-logo.png"); expect(html).toContain("Poppins"); expect(html).toContain("Outfit");
    expectPrivateDocument(html);
  });
  it("keeps signature validation failures as errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(buildNotificationPreferenceStatus("This link is no longer valid", "Open notification settings in the Academy.", origin), { status: 400 })));
    const response = await unsubscribe(new Request(`${origin}/email/unsubscribe?token=payload.signature`));
    expect(response.status).toBe(400);
    expectPrivateDocument(await response.text());
  });
  it("sets the document policy on local errors before any branded resource", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const response = await unsubscribe(new Request(`${origin}/email/unsubscribe`));
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expectPrivateDocument(await response.text());
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects upstream HTML without the branded document head", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<!doctype html><h1>Untrusted upstream fragment</h1>")));
    const response = await unsubscribe(new Request(`${origin}/email/unsubscribe?token=payload.signature`));
    expect(response.status).toBe(503);
    const html = await response.text();
    expect(html).not.toContain("Untrusted upstream fragment");
    expectPrivateDocument(html);
  });
});
