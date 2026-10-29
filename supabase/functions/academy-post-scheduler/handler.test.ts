import { describe, expect, it } from "vitest";
import { handlePostScheduler } from "./handler";

const secret = "a".repeat(40);
const settings = { enabled: "true", secret };
const request = (body = "{}", authorization = secret) => new Request("https://example.test", {
  method: "POST", headers: { "x-post-scheduler-secret": authorization }, body,
});

describe("scheduled post worker", () => {
  it("rejects unauthenticated or unconfigured requests before creating an admin client", async () => {
    const unexpected = () => { throw new Error("must not create client"); };
    expect((await handlePostScheduler(request(), {}, unexpected)).status).toBe(503);
    expect((await handlePostScheduler(request("{}", "wrong"), settings, unexpected)).status).toBe(401);
    expect((await handlePostScheduler(new Request("https://example.test"), settings, unexpected)).status).toBe(405);
    expect(await (await handlePostScheduler(request(), { ...settings, enabled: "false" }, unexpected)).json()).toEqual({ enabled: false, published: 0 });
  });
  it("passes only a bounded limit, never the caller's clock", async () => {
    let received: unknown;
    const admin = () => ({ rpc: async (name: string, args: Record<string, unknown>) => { received = { name, args }; return { data: { published: 1 }, error: null }; } });
    expect(await (await handlePostScheduler(request('{"limit":2}'), settings, admin)).json()).toEqual({ published: 1 });
    expect(received).toEqual({ name: "publish_due_academy_posts", args: { p_limit: 2 } });
    for (const body of ['{"p_now":"2020-01-01"}', '{"limit":0}', '{"limit":101}', '{"limit":1.5}', 'null', '[]', 'x', ' '.repeat(1025)]) {
      expect((await handlePostScheduler(request(body), settings, admin)).status).toBe(400);
    }
  });
  it("returns only safe errors when the database/client fails", async () => {
    const response = await handlePostScheduler(request(), settings, () => ({ rpc: async () => ({ data: null, error: { secret: "private" } }) }));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private");
    expect((await handlePostScheduler(request(), settings, () => { throw new Error("private config"); })).status).toBe(500);
  });
});
