import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as checkout from "./checkout";
import * as billing from "./billing";

// Execute the real Edge entrypoint with network/database boundaries replaced.
// No Stripe account or Supabase project is contacted by these tests.
const planId = "4b2fb554-266e-4e86-8c2e-1707be98b6a4";
const requestId = "4b2fb554-266e-4e86-8c2e-1707be98b6a5";
const plan = { id: planId, academy_community_id: "community", name: "Academy", description: "", stripe_price_id: "price_1", billing_type: "subscription", billing_interval: "month", amount_cents: 9900, currency: "usd", trial_days: 0 };
const price = { id: "price_1", active: true, livemode: false, unit_amount: 9900, currency: "usd", type: "recurring", billing_scheme: "per_unit", recurring: { interval: "month", interval_count: 1, usage_type: "licensed" } };
let env: Record<string, string>;
let rows: Record<string, unknown>;
let stripe: any;
let admin: any;
let event: any;
function query(table: string) {
  const result = () => Promise.resolve({ data: rows[table] ?? null, error: null });
  const listResult = () => Promise.resolve({ data: table === "academy_billing_plans" ? [rows[table]] : rows[table] ?? null, error: null });
  const builder: any = { then: (resolve: any, reject: any) => listResult().then(resolve, reject), maybeSingle: result, single: result };
  for (const name of ["select", "eq", "neq", "in", "or", "order", "limit", "insert", "update", "upsert"]) builder[name] = () => builder;
  return builder;
}
function handler(name: string) {
  const file = new URL(`../${name}/index.ts`, import.meta.url);
  const source = readFileSync(file, "utf8").replace(/^import[\s\S]*?;\s*/gm, "");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  let serve: (request: Request) => Promise<Response>;
  class FakeStripe {
    constructor() { return stripe; }
    static createSubtleCryptoProvider() { return {}; }
  }
  vm.runInNewContext(compiled, {
    Deno: { env: { get: (key: string) => env[key] }, serve: (value: typeof serve) => { serve = value; } },
    Stripe: FakeStripe, createClient: () => admin, ...checkout, ...billing,
    handlePreflight: () => null, jsonResponse: (_: Request, body: unknown, init: ResponseInit = {}) => Response.json(body, init),
    Request, Response, URL, console: { error: vi.fn() }, Date,
  });
  return (request: Request) => serve(request);
}
const checkoutRequest = (body: Record<string, unknown> = {}, headers: Record<string, string> = {}) => new Request("https://edge.test/create-checkout", { method: "POST", headers: { Origin: "https://app.dirtyturf.com", "Content-Type": "application/json", ...headers }, body: JSON.stringify({ planId, requestId, email: "buyer@example.com", ...body }) });
const webhookRequest = () => new Request("https://edge.test/stripe-webhook", { method: "POST", headers: { "stripe-signature": "signed-test-fixture" }, body: "fixture" });
beforeEach(() => {
  env = { STRIPE_CHECKOUT_ENABLED: "true", STRIPE_MODE: "test", STRIPE_SECRET_KEY: "rk_test_fixture", STRIPE_WEBHOOK_SECRET: "fixture", APP_URL: "https://app.dirtyturf.com", SUPABASE_URL: "https://db.test", SUPABASE_SERVICE_ROLE_KEY: "fixture" };
  rows = { academy_billing_plans: { ...plan }, academy_members: { id: "member", user_id: "user", status: "pending" }, academy_member_invites: { id: "invite" } };
  admin = { from: query, auth: { getUser: vi.fn(async () => ({ data: { user: { id: "user", email: "buyer@example.com" } }, error: null })), admin: { listUsers: vi.fn(async () => ({ data: { users: [{ id: "user", email: "buyer@example.com" }] }, error: null })) } }, rpc: vi.fn(async (name: string) => ({ data: name === "reserve_academy_checkout" ? { id: "reservation", expiresAt: 2000000000 } : null, error: null })) };
  stripe = {
    prices: { retrieve: vi.fn(async () => price) },
    customers: { list: vi.fn(async () => ({ data: [], has_more: false })), retrieve: vi.fn(async () => ({ id: "cus_1", email: "buyer@example.com" })) },
    subscriptions: { list: vi.fn(async () => ({ data: [], has_more: false })), retrieve: vi.fn(async () => ({ id: "sub_1", customer: "cus_1", status: "canceled", metadata: { plan_id: planId }, items: { data: [{ price: { id: "price_1" } }] }, cancel_at_period_end: false })) },
    checkout: { sessions: { create: vi.fn(async () => ({ url: "https://checkout.stripe.com/test", id: "cs_1" })), list: vi.fn(async () => ({ data: [], has_more: false })), retrieve: vi.fn() } },
    paymentIntents: { retrieve: vi.fn(async () => ({ latest_charge: { refunded: true } })) },
    webhooks: { constructEventAsync: vi.fn(async () => event) },
  };
  event = { id: "evt_1", livemode: false, type: "customer.subscription.updated", data: { object: { id: "sub_1", status: "active" } } };
});

describe("public Checkout handler", () => {
  it("is closed by default without touching Stripe", async () => {
    delete env.STRIPE_CHECKOUT_ENABLED;
    expect((await handler("create-checkout")(checkoutRequest())).status).toBe(503);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
  it("allows a new public buyer and only charges the server mapped price", async () => {
    const response = await handler("create-checkout")(checkoutRequest({ stripe_price_id: "price_attacker", amount: 1 }));
    expect(response.status).toBe(200);
    expect(admin.auth.getUser).not.toHaveBeenCalled();
    const [params, options] = stripe.checkout.sessions.create.mock.calls[0];
    expect(params.line_items).toEqual([{ price: "price_1", quantity: 1 }]);
    expect(params.expires_at).toBe(2000000000);
    expect(options.idempotencyKey).toBe("academy-public:reservation");
    expect(params.success_url).toBe("https://app.dirtyturf.com/checkout/return?checkout=success");
  });
  it("rejects native or forged origins", async () => {
    expect((await handler("create-checkout")(checkoutRequest({}, { Origin: "capacitor://localhost" }))).status).toBe(403);
  });
  it("does not downgrade an invalid authenticated session to anonymous", async () => {
    admin.auth.getUser.mockResolvedValue({ data: { user: null }, error: new Error("Expired") });
    expect((await handler("create-checkout")(checkoutRequest({}, { Authorization: "Bearer expired" }))).status).toBe(401);
  });
  it("protects imported access and fails closed on a concurrent reservation", async () => {
    admin.rpc.mockResolvedValue({ data: { blocked: true }, error: null });
    expect((await handler("create-checkout")(checkoutRequest())).status).toBe(409);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
  it("does not block an unrelated subscription in the same Stripe account", async () => {
    stripe.customers.list.mockResolvedValue({ data: [{ id: "cus_other" }], has_more: false });
    stripe.subscriptions.list.mockResolvedValue({ data: [{ status: "active", metadata: {}, items: { data: [{ price: { id: "price_other_product" } }] } }], has_more: false });
    expect((await handler("create-checkout")(checkoutRequest())).status).toBe(200);
  });
  it("blocks an active Academy subscription before its webhook arrives", async () => {
    stripe.customers.list.mockResolvedValue({ data: [{ id: "cus_1" }], has_more: false });
    stripe.subscriptions.list.mockResolvedValue({ data: [{ status: "active", metadata: {}, items: { data: [{ price: { id: "price_1" } }] } }], has_more: false });
    expect((await handler("create-checkout")(checkoutRequest())).status).toBe(409);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
  it("allows repurchase after a full one-time refund", async () => {
    stripe.customers.list.mockResolvedValue({ data: [{ id: "cus_1" }], has_more: false });
    stripe.checkout.sessions.list.mockResolvedValue({ data: [{ mode: "payment", status: "complete", metadata: { academy_community_id: "community" }, payment_status: "paid", payment_intent: "pi_old" }], has_more: false });
    expect((await handler("create-checkout")(checkoutRequest())).status).toBe(200);
    expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith("pi_old", { expand: ["latest_charge"] });
  });
  it("requires a real Stripe Customer for one-time fulfillment", async () => {
    rows.academy_billing_plans = { ...plan, billing_type: "one_time", billing_interval: "one_time" };
    stripe.prices.retrieve.mockResolvedValue({ ...price, type: "one_time", recurring: null });
    expect((await handler("create-checkout")(checkoutRequest())).status).toBe(200);
    expect(stripe.checkout.sessions.create.mock.calls[0][0].customer_creation).toBe("always");
  });
});

describe("Stripe webhook handler", () => {
  it("rejects invalid signatures without processing any database event", async () => {
    stripe.webhooks.constructEventAsync.mockRejectedValue(new Error("Invalid signature"));
    expect((await handler("stripe-webhook")(webhookRequest())).status).toBe(400);
    expect(admin.rpc).not.toHaveBeenCalled();
  });
  it("rejects test events against live mode", async () => {
    env.STRIPE_MODE = "live";
    env.STRIPE_SECRET_KEY = "rk_live_fixture";
    expect((await handler("stripe-webhook")(webhookRequest())).status).toBe(400);
  });
  it("uses latest canceled subscription when an older active event arrives", async () => {
    const response = await handler("stripe-webhook")(webhookRequest());
    expect(response.status).toBe(200);
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith("sub_1");
    const apply = admin.rpc.mock.calls.find(([name]: [string]) => name === "apply_academy_billing_event");
    expect(apply?.[1].p_status).toBe("cancelled");
  });
  it("does not regrant a refunded payment on delayed checkout completion", async () => {
    rows.academy_billing_plans = { ...plan, billing_type: "one_time" };
    event = { ...event, type: "checkout.session.completed", data: { object: { id: "cs_1" } } };
    stripe.checkout.sessions.retrieve.mockResolvedValue({ id: "cs_1", mode: "payment", payment_status: "paid", payment_intent: "pi_1", customer: "cus_1", customer_details: { email: "buyer@example.com" }, metadata: { plan_id: planId, buyer_email: "buyer@example.com" }, line_items: { data: [{ price: { id: "price_1" } }] } });
    expect((await handler("stripe-webhook")(webhookRequest())).status).toBe(200);
    const apply = admin.rpc.mock.calls.find(([name]: [string]) => name === "apply_academy_billing_event");
    expect(apply?.[1].p_status).toBe("cancelled");
    expect(apply?.[1].p_source_type).toBe("stripe_payment");
    expect(apply?.[1].p_email).toBe("buyer@example.com");
  });
});
