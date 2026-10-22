import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { createUnsubscribeToken } from "../_shared/notification-email";

const member = "10000000-0000-4000-8000-000000000001";
const user = "10000000-0000-4000-8000-000000000002";
const signingSecret = "synthetic-local-notification-signing";
function harness(provider: "ghl" | "mailgun" = "ghl", region = "us") {
  const state = { prepared: 0, contactReads: 0, providerWrites: 0, preferenceWrites: [] as unknown[], outboxUpdates: [] as Record<string, unknown>[], retryCalls: 0,
    cancelled: false, cancelDuringContactRead: false, finalDigestCount: 1, identityChanges: false, completeFails: false, providerUncertain: false, recipientDnd: false,
    providerEmailHtml: "", providerEmailTo: "", mailgunForm: null as FormData | null, enabled: true };
  const delivery = { id: "delivery-synthetic", recipient_member_id: member, recipient_id: user, recipient_email: "member@example.test", recipient_name: "Synthetic Member", template_key: "weekly_digest", title: "Your week in the Dirty Turf community", detail: "1 new discussion this week.", target_type: "community", target_id: "community-synthetic", payload: { postCount: 1 }, idempotency_key: "synthetic-digest" };
  let handler: (request: Request) => Promise<Response>;
  const settings: Record<string, string> = { ACADEMY_EMAIL_DELIVERY_ENABLED: "true", NOTIFICATION_DISPATCH_SECRET: "synthetic-dispatch", NOTIFICATION_SIGNING_SECRET: signingSecret, ACADEMY_EMAIL_PROVIDER: provider, GHL_PRIVATE_INTEGRATION_TOKEN: "synthetic-integration-token", GHL_LOCATION_ID: "location-synthetic", GHL_EMAIL_FROM: "hello@example.test", MAILGUN_API_KEY: "unused", MAILGUN_DOMAIN: "unused.example.test", MAILGUN_FROM_EMAIL: "hello@example.test", MAILGUN_FROM_NAME: "Dirty Turf Academy", MAILGUN_REGION: region };
  class Query {
    operation = "select";
    changes: Record<string, unknown> = {};
    constructor(readonly table: string) {}
    select() { return this; } eq() { return this; } in() { return this; }
    update(changes: Record<string, unknown>) { this.operation = "update"; this.changes = changes; return this; }
    upsert(changes: unknown) { this.operation = "upsert"; state.preferenceWrites.push(changes); return this; }
    maybeSingle() { return this; }
    then(resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) {
      if (this.operation === "update" && this.table === "academy_email_deliveries") state.outboxUpdates.push(this.changes);
      const data = this.table === "academy_member_links" ? { external_contact_id: "contact-synthetic" } : this.table === "academy_members" ? { user_id: user } : null;
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    }
  }
  const client = { from: (table: string) => new Query(table), rpc: async (name: string) => {
    if (name === "get_server_runtime_config") return { data: settings, error: null };
    if (name === "queue_academy_scheduled_notifications") return { data: { eventReminders: 0, weeklyDigests: 0 }, error: null };
    if (name === "claim_academy_email_deliveries") return { data: [{ ...delivery }], error: null };
    if (name === "prepare_academy_email_delivery") {
      state.prepared++;
      if (state.cancelled) return { data: [], error: null };
      return { data: [{ ...delivery, ...(state.prepared > 1 ? { detail: `${state.finalDigestCount} new discussions this week.`, payload: { postCount: state.finalDigestCount }, recipient_email: state.identityChanges ? "other@example.test" : delivery.recipient_email } : {}) }], error: null };
    }
    if (name === "complete_academy_email_delivery") return { data: !state.completeFails, error: state.completeFails ? new Error("Synthetic completion failure") : null };
    if (name === "fail_academy_email_delivery") { state.retryCalls++; return { data: true, error: null }; }
    throw new Error(`Unexpected synthetic RPC: ${name}`);
  } };
  const fakeFetch = async (url: URL | string, options: Record<string, unknown>) => {
    const target = new URL(String(url));
    if (provider === "mailgun" && target.origin === (region === "eu" ? "https://api.eu.mailgun.net" : "https://api.mailgun.net") &&
      target.pathname === "/v3/unused.example.test/messages" && options.method === "POST") {
      state.providerWrites++; state.mailgunForm = options.body as FormData;
      state.providerEmailHtml = String(state.mailgunForm.get("html")); state.providerEmailTo = String(state.mailgunForm.get("to"));
      return Response.json({ id: "synthetic-mailgun-1" });
    }
    if (target.origin !== "https://services.leadconnectorhq.com") throw new Error("Network disabled in worker test");
    if (options.method === "GET" && target.pathname === "/contacts/contact-synthetic") {
      state.contactReads++;
      if (state.cancelDuringContactRead) state.cancelled = true;
      return Response.json({ contact: { id: "contact-synthetic", locationId: "location-synthetic", email: "member@example.test", dndSettings: { email: { status: state.recipientDnd ? "active" : "inactive" } } } });
    }
    if (options.method === "POST" && target.pathname === "/conversations/messages") {
      state.providerWrites++;
      const body = JSON.parse(options.body as string);
      state.providerEmailHtml = body.html; state.providerEmailTo = body.emailTo;
      return state.providerUncertain ? Response.json({}, { status: 500 }) : Response.json({ messageId: "synthetic-message-1" });
    }
    throw new Error("Unexpected provider operation in worker test");
  };
  const cache = new Map<string, unknown>();
  const load = (filename: string): unknown => {
    if (cache.has(filename)) return cache.get(filename);
    const js = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const module = { exports: {} }; cache.set(filename, module.exports);
    runInContext(js, createContext({ module, exports: module.exports,
      require: (name: string) => {
        if (name.startsWith("jsr:")) return {};
        if (name.startsWith("npm:@supabase/")) return { createClient: () => client };
        if (name.startsWith(".")) return load(path.resolve(path.dirname(filename), name));
        throw new Error(`Unexpected worker test dependency: ${name}`);
      }, Deno: { serve: (callback: typeof handler) => { handler = callback; }, env: { get: (key: string) => key === "ACADEMY_EMAIL_DELIVERY_ENABLED" ? String(state.enabled) : ({ SUPABASE_URL: "https://example.test", SUPABASE_SERVICE_ROLE_KEY: "synthetic-server-key", APP_URL: "https://app.example.test", ...settings }[key]) } },
      crypto, TextEncoder, TextDecoder, Uint8Array, Date, Response, URL, FormData, AbortSignal, btoa, atob, fetch: fakeFetch, console }), { filename });
    return module.exports;
  };
  load(fileURLToPath(new URL("./index.ts", import.meta.url)));
  const dispatch = async (authorized = true) => {
    const response = await handler!(new Request("https://example.test/functions/v1/academy-notifications", { method: "POST", headers: authorized ? { "x-notification-secret": "synthetic-dispatch" } : {}, body: JSON.stringify({ limit: 1 }) }));
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };
  const unsubscribe = (token: string, method = "GET") => handler!(new Request(`https://example.test/functions/v1/academy-notifications/unsubscribe?token=${encodeURIComponent(token)}`, { method }));
  return { state, dispatch, unsubscribe };
}

describe("actual notification worker boundary", () => {
  it.each(["us", "eu"])("uses the already-built %s direct transport without a GHL contact requirement", async region => {
    const { state, dispatch } = harness("mailgun", region);
    const result = await dispatch();
    expect(result.body.sent).toBe(1); expect(state.providerWrites).toBe(1); expect(state.contactReads).toBe(0); expect(state.prepared).toBe(2);
    expect(state.providerEmailTo).toBe("member@example.test"); expect(state.providerEmailHtml).toContain("Dirty Turf");
    expect(state.mailgunForm?.get("o:tracking-clicks")).toBe("no");
    expect(state.mailgunForm?.get("h:List-Unsubscribe")).toMatch(/^<https:\/\/app\.example\.test\/email\/unsubscribe\?token=/);
    expect(state.mailgunForm?.get("h:List-Unsubscribe-Post")).toBe("List-Unsubscribe=One-Click");
  });
  it("rechecks after contact lookup and renders the final canonical digest", async () => {
    const { state, dispatch } = harness(); state.finalDigestCount = 2;
    const result = await dispatch();
    expect(result.status).toBe(200); expect(result.body.sent).toBe(1);
    expect(state.prepared).toBe(2); expect(state.contactReads).toBe(1); expect(state.providerWrites).toBe(1);
    expect(state.providerEmailHtml).toContain("2 new discussions this week.");
    expect(state.providerEmailTo).toBe("member@example.test");
  });
  it("cancels an unsubscribe/access change during contact verification before any provider write", async () => {
    const { state, dispatch } = harness(); state.cancelDuringContactRead = true;
    const result = await dispatch();
    expect(result.body.cancelled).toBe(1); expect(result.body.sent).toBe(0);
    expect(state.prepared).toBe(2); expect(state.providerWrites).toBe(0);
  });
  it("never substitutes another recipient after contact verification", async () => {
    const { state, dispatch } = harness(); state.identityChanges = true;
    const result = await dispatch();
    expect(result.body.sent).toBe(0); expect(state.providerWrites).toBe(0); expect(state.retryCalls).toBe(1);
  });
  it("honors lowercase v3 DND and holds the recipient without a provider write", async () => {
    const { state, dispatch } = harness(); state.recipientDnd = true;
    const result = await dispatch();
    expect(result.body.reviewRequired).toBe(1); expect(state.providerWrites).toBe(0); expect(state.retryCalls).toBe(0);
  });
  it.each(["completeFails", "providerUncertain"] as const)("holds ambiguous %s without an automatic resend", async failure => {
    const { state, dispatch } = harness(); state[failure] = true;
    const result = await dispatch();
    expect(result.body.reviewRequired).toBe(1); expect(result.body.sent).toBe(0); expect(state.providerWrites).toBe(1); expect(state.retryCalls).toBe(0);
    expect(state.outboxUpdates[0]).toMatchObject({ status: "failed", last_error: "Provider result uncertain; review before retry" });
  });
  it("requires the dispatch credential and keeps the delivery switch effective", async () => {
    const { state, dispatch } = harness();
    expect((await dispatch(false)).status).toBe(401); expect(state.providerWrites).toBe(0);
    state.enabled = false;
    expect((await dispatch()).body).toEqual({ enabled: false, sent: 0 }); expect(state.prepared).toBe(0);
  });
  it("previews signed unsubscribe links with GET, applies only POST and works while dispatch is off", async () => {
    const { state, unsubscribe } = harness(); state.enabled = false;
    const token = await createUnsubscribeToken(member, "replies", signingSecret);
    const preview = await unsubscribe(token);
    expect(preview.status).toBe(200); expect(await preview.text()).toContain('form method="post"'); expect(state.preferenceWrites).toEqual([]);
    const updated = await unsubscribe(token, "POST");
    expect(updated.status).toBe(200); expect(state.preferenceWrites).toEqual([{ user_id: user, replies: false, updated_at: expect.any(String) }]);
    expect(state.outboxUpdates[0]).toMatchObject({ status: "cancelled", last_error: "Recipient unsubscribed" }); expect(state.providerWrites).toBe(0);
  });
  it("rejects invalid unsubscribe signatures without a preference write", async () => {
    const { state, unsubscribe } = harness();
    expect((await unsubscribe("invalid.signature", "POST")).status).toBe(400);
    expect(state.preferenceWrites).toEqual([]); expect(state.providerWrites).toBe(0);
  });
});
