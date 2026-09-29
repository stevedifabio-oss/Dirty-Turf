import { afterEach, describe, expect, it, vi } from "vitest";
import unsubscribe from "../email-unsubscribe.mts";

afterEach(() => vi.unstubAllGlobals());
const origin = "https://app.dirtyturf.com";
describe("email unsubscribe page", () => {
  it("renders a verified GET confirmation with no write and private browser headers", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('<!doctype html><form method="post">Confirm</form>'));
    vi.stubGlobal("fetch", fetcher);
    const response = await unsubscribe(new Request(`${origin}/email/unsubscribe?token=payload.signature`));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("content-security-policy")).toContain("form-action 'self'");
    expect(fetcher.mock.calls[0][1].method).toBe("GET");
    expect(fetcher.mock.calls[0][0].origin).toBe("https://ipbtldajgsoxixqmajec.supabase.co");
  });
  it("forwards an explicit form confirmation without cookies or credentials", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("<!doctype html><h1>Unsubscribed</h1>"));
    vi.stubGlobal("fetch", fetcher);
    const response = await unsubscribe(new Request(`${origin}/email/unsubscribe`, { method: "POST", headers: { origin, cookie: "private=never-forward", "content-type": "application/x-www-form-urlencoded" }, body: "token=payload.signature" }));
    expect(response.status).toBe(200);
    expect(fetcher.mock.calls[0][1]).not.toHaveProperty("headers");
    expect(fetcher.mock.calls[0][1].method).toBe("POST");
    expect(fetcher.mock.calls[0][0].searchParams.get("token")).toBe("payload.signature");
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
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("private upstream");
  });
  it("keeps signature validation failures as errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<!doctype html><h1>Invalid link</h1>", { status: 400 })));
    expect((await unsubscribe(new Request(`${origin}/email/unsubscribe?token=payload.signature`))).status).toBe(400);
  });
});
