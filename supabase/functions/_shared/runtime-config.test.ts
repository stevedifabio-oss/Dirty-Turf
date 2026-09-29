import { describe, expect, it, vi } from "vitest";
import { loadRuntimeConfig } from "./runtime-config";

describe("server runtime configuration", () => {
  it("keeps explicit environment overrides, including disabled flags", async () => {
    const rpc = vi.fn();
    const config = await loadRuntimeConfig({ rpc }, ["STRIPE_CHECKOUT_ENABLED"], () => "false");
    expect(config.STRIPE_CHECKOUT_ENABLED).toBe("false");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("requests only missing allowlisted settings and rejects unsolicited values", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { STRIPE_SECRET_KEY: "test-secret", GHL_LOCATION_ID: "unsolicited", SUPABASE_SERVICE_ROLE_KEY: "forbidden" }, error: null });
    const config = await loadRuntimeConfig({ rpc }, ["STRIPE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "__proto__"], () => undefined);
    expect(rpc).toHaveBeenCalledWith("get_server_runtime_config", { p_names: ["STRIPE_SECRET_KEY"] });
    expect(Object.keys(config)).toEqual(["STRIPE_SECRET_KEY"]);
    expect(config.STRIPE_SECRET_KEY).toBe("test-secret");
  });
  it("preserves malformed nonblank environment values for strict consumer validation", async () => {
    const rpc = vi.fn();
    const config = await loadRuntimeConfig({ rpc }, ["STRIPE_PORTAL_CONFIGURATION_ID"], () => "bpc_config\n");
    expect(config.STRIPE_PORTAL_CONFIGURATION_ID).toBe("bpc_config\n");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("preserves malformed Vault values and uses fallback for whitespace-only environment values", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { STRIPE_PORTAL_CONFIGURATION_ID: "bpc_config\n" }, error: null });
    const config = await loadRuntimeConfig({ rpc }, ["STRIPE_PORTAL_CONFIGURATION_ID"], () => " \t\n");
    expect(config.STRIPE_PORTAL_CONFIGURATION_ID).toBe("bpc_config\n");
    expect(rpc).toHaveBeenCalledOnce();
  });
  it.each([{ data: { STRIPE_SECRET_KEY: "do-not-use" }, error: {} }, { data: ["invalid"], error: null }])("fails closed on RPC errors or invalid data", async result => {
    const rpc = vi.fn().mockResolvedValue(result);
    expect((await loadRuntimeConfig({ rpc }, ["STRIPE_SECRET_KEY"], () => undefined)).STRIPE_SECRET_KEY).toBeUndefined();
  });
  it("fails closed on network failure without discarding configured env values", async () => {
    const rpc = vi.fn().mockRejectedValue(new Error("network failed"));
    const config = await loadRuntimeConfig({ rpc }, ["STRIPE_SECRET_KEY", "STRIPE_MODE"], name => name === "STRIPE_MODE" ? "live" : undefined);
    expect(config.STRIPE_MODE).toBe("live");
    expect(config.STRIPE_SECRET_KEY).toBeUndefined();
  });
});
