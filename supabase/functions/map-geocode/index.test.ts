import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

// Run the real entrypoint; denied callers must not reach even the cached addresses.
function setup(access: unknown, rpcError: unknown = null, cached = true) {
  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8").replace(/^import[\s\S]*?;\s*/gm, "");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const from = vi.fn(() => {
    const chain: any = { delete: () => chain, lt: async () => ({ error: null }), select: () => chain, eq: () => chain, gt: () => chain,
      maybeSingle: async () => ({ data: cached ? { results: [{ formattedAddress: "Fixture address", latitude: 33, longitude: -112 }] } : null, error: null }),
      insert: async () => ({ error: null }), upsert: async () => ({ error: null }) };
    return chain;
  });
  const client = { auth: { getUser: async () => ({ data: { user: { id: "fixture-user" } }, error: null }) }, rpc: async () => ({ data: access, error: rpcError }), from };
  const fetch = vi.fn();
  let handler!: (request: Request) => Promise<Response>;
  vm.runInNewContext(compiled, {
    Deno: { env: { get: () => "test-fixture" }, serve: (value: typeof handler) => { handler = value; } },
    createClient: () => client, handlePreflight: () => null,
    jsonResponse: (_: Request, body: unknown, init: ResponseInit = {}) => Response.json(body, init),
    Request, Response, URLSearchParams, Date, crypto, TextEncoder, fetch, AbortController, setTimeout, clearTimeout,
    console: { error: vi.fn() },
  });
  return { from, fetch, run: () => handler(new Request("https://edge.test/map-geocode", { method: "POST", headers: { Authorization: "Bearer fixture", "Content-Type": "application/json" }, body: JSON.stringify({ query: "123 Fixture Lane" }) })) };
}

describe("measuring-tool server gate", () => {
  it.each([
    { hasAccess: true, features: [] },
    { hasAccess: true, features: ["seo_tools"] },
    { hasAccess: false, features: ["measuring_tool"] },
    { hasAccess: true },
    { hasAccess: true, features: "measuring_tool" },
  ])("denies missing, expired or malformed tool access before cache/provider work: %j", async (access) => {
    const fixture = setup(access);
    expect((await fixture.run()).status).toBe(403);
    expect(fixture.from).not.toHaveBeenCalled();
    expect(fixture.fetch).not.toHaveBeenCalled();
  });
  it("reports an access-check outage without returning cached addresses", async () => {
    const fixture = setup(null, new Error("Unavailable"));
    expect((await fixture.run()).status).toBe(503);
    expect(fixture.from).not.toHaveBeenCalled();
  });
  it("allows an entitled member to use their cached result", async () => {
    const fixture = setup({ hasAccess: true, features: ["measuring_tool"] });
    const response = await fixture.run();
    expect(response.status).toBe(200);
    expect((await response.json()).cached).toBe(true);
    expect(fixture.fetch).not.toHaveBeenCalled();
  });
  it("resolves a structure address through Census without contacting the blocked provider", async () => {
    const fixture = setup({ hasAccess: true, features: ["measuring_tool"] }, null, false);
    fixture.fetch.mockResolvedValue(Response.json({ result: { addressMatches: [{ matchedAddress: "123 FIXTURE LN, TEST CITY, AZ, 85000", coordinates: { x: -112.1, y: 33.5 } }] } }));
    const response = await fixture.run();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ provider: "census", results: [{ latitude: 33.5, longitude: -112.1, approximate: true }] });
    expect(fixture.fetch).toHaveBeenCalledTimes(1);
    expect(fixture.fetch.mock.calls[0][0]).toContain("geocoding.geo.census.gov/geocoder/locations/onelineaddress?");
    expect(fixture.from.mock.calls.map(call => call[0])).not.toContain(undefined);
  });
  it("retains the existing provider fallback when Census has no match", async () => {
    const fixture = setup({ hasAccess: true, features: ["measuring_tool"] }, null, false);
    fixture.fetch.mockResolvedValueOnce(Response.json({ result: { addressMatches: [] } })).mockResolvedValueOnce(Response.json([{ display_name: "Fixture road", lat: "33.4", lon: "-112.1" }]));
    const response = await fixture.run();
    expect(response.status).toBe(200);
    expect((await response.json()).results).toEqual([{ formattedAddress: "Fixture road", latitude: 33.4, longitude: -112.1 }]);
  });
  it("does not invent zero coordinates from malformed Census results and reports provider outages", async () => {
    const fixture = setup({ hasAccess: true, features: ["measuring_tool"] }, null, false);
    fixture.fetch.mockResolvedValueOnce(Response.json({ result: { addressMatches: [{ matchedAddress: "Bad result", coordinates: { x: null, y: null } }] } })).mockResolvedValueOnce(new Response("Blocked", { status: 403 }));
    expect((await fixture.run()).status).toBe(502);
  });
});
