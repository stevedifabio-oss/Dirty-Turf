import { describe, expect, it, vi } from "vitest";
import { handleConfiguredPostScheduler, POST_SCHEDULER_CONFIG_NAMES } from "./runtime-handler";

const secret = "synthetic-scheduler-dispatch-credential-40-characters";
const request = (authorization = secret) => new Request("https://example.test/functions/v1/academy-post-scheduler", { method: "POST", headers: { "x-post-scheduler-secret": authorization }, body: '{"limit":2}' });

describe("scheduler protected runtime configuration wiring", () => {
  it("publishes through the actual handler using missing allowlisted Vault settings", async () => {
    const rpc = vi.fn(async (name: string) => ({ data: name === "get_server_runtime_config" ? { ACADEMY_POST_SCHEDULER_ENABLED: "true", ACADEMY_POST_SCHEDULER_SECRET: secret } : { published: 1 }, error: null }));
    const response = await handleConfiguredPostScheduler(request(), () => undefined, () => ({ rpc }));
    expect(await response.json()).toEqual({ published: 1 });
    expect(rpc.mock.calls).toEqual([
      ["get_server_runtime_config", { p_names: [...POST_SCHEDULER_CONFIG_NAMES] }],
      ["publish_due_academy_posts", { p_limit: 2 }],
    ]);
  });
  it("does not read Vault or create an admin client for unauthorized fully configured requests", async () => {
    const createAdmin = vi.fn(() => { throw new Error("Must not construct"); });
    const env = (name: string) => name === "ACADEMY_POST_SCHEDULER_ENABLED" ? "true" : secret;
    expect((await handleConfiguredPostScheduler(request("wrong"), env, createAdmin)).status).toBe(401);
    expect(createAdmin).not.toHaveBeenCalled();
  });
  it("preserves an explicit environment false while loading only the missing secret", async () => {
    const rpc = vi.fn(async () => ({ data: { ACADEMY_POST_SCHEDULER_ENABLED: "true", ACADEMY_POST_SCHEDULER_SECRET: secret }, error: null }));
    const response = await handleConfiguredPostScheduler(request(), name => name === "ACADEMY_POST_SCHEDULER_ENABLED" ? "false" : undefined, () => ({ rpc }));
    expect(await response.json()).toEqual({ enabled: false, published: 0 });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("get_server_runtime_config", { p_names: ["ACADEMY_POST_SCHEDULER_SECRET"] });
  });
  it("never replaces an explicit environment secret with a Vault value", async () => {
    const rpc = vi.fn(async () => ({ data: { ACADEMY_POST_SCHEDULER_ENABLED: "true", ACADEMY_POST_SCHEDULER_SECRET: secret }, error: null }));
    const response = await handleConfiguredPostScheduler(request(secret), name => name === "ACADEMY_POST_SCHEDULER_SECRET" ? "different-explicit-environment-secret-value" : undefined, () => ({ rpc }));
    expect(response.status).toBe(401);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("get_server_runtime_config", { p_names: ["ACADEMY_POST_SCHEDULER_ENABLED"] });
  });
  it.each([undefined, "false", "TRUE"])("does not publish without the exact enabled value (%s)", async enabled => {
    const rpc = vi.fn(async () => ({ data: { ACADEMY_POST_SCHEDULER_ENABLED: enabled, ACADEMY_POST_SCHEDULER_SECRET: secret }, error: null }));
    const response = await handleConfiguredPostScheduler(request(), () => undefined, () => ({ rpc }));
    expect(await response.json()).toEqual({ enabled: false, published: 0 });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["get_server_runtime_config"]);
  });
  it.each(["missing", "rejected", "network", "construction"])("fails closed without leaking details on %s configuration", async failure => {
    const rpc = vi.fn(async () => {
      if (failure === "network") throw new Error("sensitive connection detail");
      return { data: failure === "missing" ? {} : { ACADEMY_POST_SCHEDULER_ENABLED: "true", ACADEMY_POST_SCHEDULER_SECRET: secret }, error: failure === "rejected" ? { message: "sensitive detail" } : null };
    });
    const response = await handleConfiguredPostScheduler(request(), () => undefined, () => { if (failure === "construction") throw new Error("sensitive config detail"); return { rpc }; });
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("sensitive");
    expect(rpc.mock.calls.map(([name]) => name)).not.toContain("publish_due_academy_posts");
  });
  it("rejects non-POST without inspecting protected configuration", async () => {
    const env = vi.fn(); const createAdmin = vi.fn();
    expect((await handleConfiguredPostScheduler(new Request("https://example.test"), env, createAdmin)).status).toBe(405);
    expect(env).not.toHaveBeenCalled(); expect(createAdmin).not.toHaveBeenCalled();
  });
});
