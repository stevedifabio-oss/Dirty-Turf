import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";
const delivery = { id: "11111111-1111-4111-8111-111111111111", platform: "ios", environment: "production", token: "synthetic-token-not-used-on-network", notification_id: "22222222-2222-4222-8222-222222222222", target_type: "post", target_id: "33333333-3333-4333-8333-333333333333", comment_id: null };
function harness() {
  const state = { enabled: true, remaining: 1, now: 1_000_000, sendCostMs: 0, claims: 0, prepared: 0, authPreparations: 0, providerWrites: 0, cancelAfterAuth: false, mutateAfterAuth: false, completionFailure: false, outcome: "sent", finishes: [] as string[] };
  const settings = { ACADEMY_PUSH_ENABLED: "true", ACADEMY_PUSH_DISPATCH_SECRET: "synthetic-dispatch-secret-at-least-32-characters" };
  const client = { rpc: async (name: string, args: any) => {
    if (name === "claim_academy_push_deliveries") { state.claims++; expect(args.p_limit).toBe(1); if (state.remaining <= 0) return { data: [], error: null }; state.remaining--; return { data: [{ id: delivery.id }], error: null }; }
    if (name === "prepare_academy_push_delivery") { state.prepared++; return { data: state.authPreparations && state.cancelAfterAuth ? [] : [{ ...delivery, ...(state.authPreparations && state.mutateAfterAuth ? { target_id: "44444444-4444-4444-8444-444444444444" } : {}) }], error: null }; }
    if (name === "finish_academy_push_delivery") { state.finishes.push(args.p_result); return { data: !(state.completionFailure && args.p_result === "sent"), error: null }; }
    throw new Error("Unexpected RPC");
  } };
  const module = { exports: {} as Record<string, any> };
  const code = ts.transpileModule(readFileSync(new URL("./index.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports: module.exports, module, require: (name: string) => {
    if (name.startsWith("jsr:")) return {};
    if (name.startsWith("npm:@supabase/")) return { createClient: () => client };
    if (name.endsWith("runtime-config.ts")) return { loadRuntimeConfig: async () => ({ ...settings, ACADEMY_PUSH_ENABLED: String(state.enabled) }) };
    if (name.endsWith("native-push.ts")) return { PUSH_CONFIG_NAMES: [], configuredPushEnvironment: () => "production", preparePushSender: async () => { state.authPreparations++; return async () => { state.providerWrites++; state.now += state.sendCostMs; return { result: state.outcome, providerId: "synthetic-acceptance" }; }; } };
    throw new Error(`Unexpected import ${path.basename(name)}`);
  }, Deno: { serve: () => undefined, env: { get: (key: string) => ({ SUPABASE_URL: "https://example.test", SUPABASE_SERVICE_ROLE_KEY: "synthetic-server-key" }[key]) } }, crypto, Request, Response, Map, JSON, Date: { now: () => state.now } });
  const dispatch = async (authorized = true) => {
    const response = await module.exports.handlePushDispatch(new Request("https://example.test/functions/v1/academy-push-notifications", { method: "POST", headers: authorized ? { "x-push-dispatch-secret": settings.ACADEMY_PUSH_DISPATCH_SECRET } : {} }));
    return { status: response.status, body: await response.json() as any };
  };
  return { state, dispatch };
}
describe("actual native push dispatcher orchestration", () => {
  it("stays off by default and requires the exact dispatcher credential", async () => { const { state, dispatch } = harness(); expect((await dispatch(false)).status).toBe(401); expect(state.claims).toBe(0); state.enabled = false; expect((await dispatch()).body).toEqual({ enabled: false, sent: 0 }); expect(state.providerWrites).toBe(0); });
  it("claims only the next device and rechecks after provider authentication", async () => { const { state, dispatch } = harness(); expect((await dispatch()).body.sent).toBe(1); expect(state.prepared).toBe(2); expect(state.authPreparations).toBe(1); expect(state.providerWrites).toBe(1); expect(state.finishes).toEqual(["sent"]); });
  it("cancels an opt-out/moderation change during authentication before sending", async () => { const { state, dispatch } = harness(); state.cancelAfterAuth = true; expect((await dispatch()).body.cancelled).toBe(1); expect(state.providerWrites).toBe(0); });
  it("refuses a changed canonical recipient/target rather than using stale prepared data", async () => { const { state, dispatch } = harness(); state.mutateAfterAuth = true; expect((await dispatch()).body.retrying).toBe(1); expect(state.providerWrites).toBe(0); });
  it("holds acceptance followed by DB completion failure for manual review", async () => { const { state, dispatch } = harness(); state.completionFailure = true; expect((await dispatch()).body.reviewRequired).toBe(1); expect(state.providerWrites).toBe(1); expect(state.finishes).toEqual(["sent", "uncertain"]); });
  it("retains uncertain provider outcomes instead of resending", async () => { const { state, dispatch } = harness(); state.outcome = "uncertain"; expect((await dispatch()).body.reviewRequired).toBe(1); expect(state.finishes).toEqual(["uncertain"]); });
  it("drains fast providers up to the bounded device cap", async () => { const { state, dispatch } = harness(); state.remaining = 60; expect((await dispatch()).body.sent).toBe(25); expect(state.claims).toBe(25); expect(state.authPreparations).toBe(1); });
  it("does not claim more unattempted devices once the admission deadline expires", async () => { const { state, dispatch } = harness(); state.remaining = 60; state.sendCostMs = 46_000; expect((await dispatch()).body.sent).toBe(1); expect(state.claims).toBe(1); expect(state.remaining).toBe(59); });
});
