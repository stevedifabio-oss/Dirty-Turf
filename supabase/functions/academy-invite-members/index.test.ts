import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const communityId = "10000000-0000-4000-8000-000000000001";
const memberId = "10000000-0000-4000-8000-000000000002";
const otherId = "10000000-0000-4000-8000-000000000003";
const userId = "10000000-0000-4000-8000-000000000004";
const adminId = "10000000-0000-4000-8000-000000000005";
const updated = "2026-10-21T00:00:00Z";

// Run the actual entry point with an in-memory Supabase boundary. No network,
// persisted users, email, credentials or hosted database is available here.
function harness(prepared = false) {
  const members = [{ id: memberId, academy_community_id: communityId, display_name: "Synthetic Member", company_name: "Demo", status: "active", user_id: prepared ? userId : null, role: "member", updated_at: updated }];
  const invites = [{ id: "10000000-0000-4000-8000-000000000006", email: "member@example.test", academy_member_id: memberId, academy_community_id: communityId, status: prepared ? "provisioned" : "pending", invited_user_id: prepared ? userId : null, attempt_count: 0, delivery_count: 0, updated_at: updated }];
  const users: Record<string, unknown>[] = prepared ? [{ id: userId, email: "member@example.test", email_confirmed_at: updated, banned_until: null, deleted_at: null }] : [];
  let actorId = adminId, sequence = 0, created = 0, emailed = 0;
  let handler: (request: Request) => Promise<Response>;
  const state = { members, invites, users, get created() { return created; }, get emailed() { return emailed; }, set actor(value: string) { actorId = value; }, failEmail: false, failSuccessReceipt: false, failFailureReceipt: false, cancelAfterEmail: false, isAdmin: true, validSession: true, configured: true };
  const tick = () => new Date(Date.now() + ++sequence).toISOString();
  class Query implements PromiseLike<{ data: unknown; error: null }> {
    filters: ((row: Record<string, unknown>) => boolean)[] = [];
    changes: Record<string, unknown> | null = null;
    offset = 0; end = Infinity; isSingle = false; projected = "";
    constructor(readonly table: string) {}
    select(columns = "") { this.projected = columns; return this; }
    update(changes: Record<string, unknown>) { this.changes = changes; return this; }
    eq(key: string, value: unknown) { this.filters.push(row => row[key] === value); return this; }
    neq(key: string, value: unknown) { this.filters.push(row => row[key] !== value); return this; }
    in(key: string, values: unknown[]) { this.filters.push(row => values.includes(row[key])); return this; }
    or() { return this; }
    order() { return this; }
    range(offset: number, end: number) { this.offset = offset; this.end = end; return this; }
    limit() { return this; }
    maybeSingle() { this.isSingle = true; return this; }
    single() { this.isSingle = true; return this; }
    then<TResult1 = { data: unknown; error: null }, TResult2 = never>(onfulfilled?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2> {
      let rows: Record<string, unknown>[] = [];
      if (this.table === "academy_members") rows = [...members, { id: actorId, academy_community_id: communityId, user_id: actorId, role: state.isAdmin ? "owner" : "member", status: "active", updated_at: updated }];
      if (this.table === "academy_member_invites") rows = invites;
      if (this.table === "academy_communities") rows = [{ id: communityId, owner_organization_id: null }];
      if (this.table === "course_enrollments") rows = [];
      const selected = rows.filter(row => this.filters.every(filter => filter(row))).slice(this.offset, this.end + 1);
      if (this.table === "academy_member_invites" &&
        ((state.failSuccessReceipt && this.changes?.status === "sent") ||
          (state.failFailureReceipt && this.changes?.status === "failed"))) {
        return Promise.reject(new Error("Synthetic receipt persistence failure")).then(onfulfilled, onrejected);
      }
      if (this.changes) for (const row of selected) Object.assign(row, this.changes, { updated_at: tick() });
      const result = selected.map(row => this.table === "academy_member_invites" ? { ...row, academy_members: { ...members.find(member => member.id === row.academy_member_id)! } } : { ...row });
      return Promise.resolve({ data: this.isSingle ? result[0] ?? null : result, error: null }).then(onfulfilled, onrejected);
    }
  }
  const client = {
    from: (table: string) => new Query(table),
    rpc: async () => ({ data: "workspace-1", error: null }),
    auth: {
      getUser: async () => ({ data: { user: state.validSession ? { id: actorId } : null }, error: state.validSession ? null : new Error("Synthetic expired session") }),
      admin: {
        listUsers: async () => ({ data: { users: structuredClone(users) }, error: null }),
        getUserById: async (id: string) => ({ data: { user: structuredClone(users.find(user => user.id === id) ?? null) }, error: null }),
        createUser: async ({ email }: { email: string }) => {
          created++; const user = { id: userId, email, email_confirmed_at: tick(), banned_until: null, deleted_at: null }; users.push(user);
          return { data: { user: { ...user } }, error: null };
        },
      },
      signInWithOtp: async () => {
        emailed++;
        if (state.cancelAfterEmail) Object.assign(invites[0], { status: "cancelled", updated_at: tick() });
        return { error: state.failEmail ? new Error("Synthetic delivery failure") : null };
      },
    },
  };
  const cache = new Map<string, unknown>();
  const entry = fileURLToPath(new URL("./index.ts", import.meta.url));
  const load = (filename: string): unknown => {
    if (cache.has(filename)) return cache.get(filename);
    const source = readFileSync(filename, "utf8");
    const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const module = { exports: {} };
    cache.set(filename, module.exports);
    const context = createContext({ module, exports: module.exports, require: (name: string) => {
      if (name.startsWith("jsr:")) return {};
      if (name.startsWith("npm:@supabase/")) return { createClient: () => client };
      if (name.startsWith(".")) return load(path.resolve(path.dirname(filename), name));
      throw new Error(`Unexpected test dependency: ${name}`);
    }, Deno: { serve: (callback: typeof handler) => { handler = callback; }, env: { get: (key: string) => state.configured ? ({ SUPABASE_URL: "https://example.test", SUPABASE_SERVICE_ROLE_KEY: "synthetic-local-server-secret", APP_URL: "https://app.example.test/" }[key]) : undefined } }, crypto, TextEncoder, Uint8Array, Date, Response, URL, console });
    runInContext(js, context, { filename });
    return module.exports;
  };
  load(entry);
  const call = async (body: Record<string, unknown>, options: { authorized?: boolean; method?: string; rawBody?: string } = {}) => {
    const method = options.method ?? "POST";
    const response = await handler!(new Request("https://example.test/functions/v1/academy-invite-members", { method, headers: { ...(options.authorized === false ? {} : { authorization: "Bearer synthetic-session" }), "content-type": "application/json" }, ...(method === "POST" ? { body: options.rawBody ?? JSON.stringify({ academyCommunityId: communityId, ...body }) } : {}) }));
    return { status: response.status, body: await response.json() as Record<string, any> };
  };
  return { state, call };
}

describe("member invitation endpoint safe migration execution", () => {
  it("requires configured server credentials, a valid session and Academy administration", async () => {
    const { call, state } = harness();
    expect((await call({}, { method: "GET" })).status).toBe(405);
    expect((await call({}, { authorized: false })).status).toBe(401);
    state.validSession = false;
    expect((await call({ action: "preview" })).status).toBe(401);
    state.validSession = true; state.isAdmin = false;
    expect((await call({ action: "preview" })).status).toBe(403);
    state.configured = false;
    expect((await call({ action: "preview" })).status).toBe(503);
    expect(state.created).toBe(0); expect(state.emailed).toBe(0);
  });
  it.each(["null", "[]", '"invalid"', "{"])("rejects malformed/non-object input %s without effects", async rawBody => {
    const { call, state } = harness();
    expect((await call({}, { rawBody })).status).toBe(400);
    expect(state.created).toBe(0); expect(state.emailed).toBe(0);
  });
  it("rejects legacy whole-queue sends and unapproved redirect/resend inputs", async () => {
    const { call, state } = harness(true);
    expect((await call({ send: true })).status).toBe(422);
    expect((await call({ action: "preview", previewAction: "notify", redirectTo: "https://unapproved.example.test/" })).status).toBe(422);
    expect((await call({ action: "preview", resend: "true" })).status).toBe(422);
    expect((await call({ action: "preview", academyCommunityId: "invalid" })).status).toBe(422);
    expect(state.created).toBe(0); expect(state.emailed).toBe(0);
  });
  it("makes inventory preview read-only and requires exact selection before any mutation", async () => {
    const { call, state } = harness();
    const inventory = await call({ action: "preview" });
    expect(inventory.status).toBe(200);
    expect(inventory.body.candidates.map((item: any) => item.academyMemberId)).toEqual([memberId]);
    expect(inventory.body.previewToken).toBeNull();
    expect(inventory.body.selected).toEqual([]);
    const unsafe = await call({ action: "provision", limit: 50 });
    expect(unsafe.status).toBe(422);
    expect(state.created).toBe(0); expect(state.emailed).toBe(0);
  });
  it("rejects a limit that does not match the reviewed exact batch", async () => {
    const { call, state } = harness();
    const preview = await call({ action: "preview", academyMemberIds: [memberId] });
    const response = await call({ action: "provision", academyMemberIds: [memberId], previewToken: preview.body.previewToken, limit: 50 });
    expect(response.status).toBe(422); expect(state.created).toBe(0);
  });
  it("prepares only a selected reviewed account, then rejects a replayed token", async () => {
    const { call, state } = harness();
    const preview = await call({ action: "preview", previewAction: "provision", academyMemberIds: [memberId] });
    const payload = { action: "provision", academyMemberIds: [memberId], previewToken: preview.body.previewToken };
    const response = await call(payload);
    expect(response.status).toBe(200); expect(response.body.processed).toBe(1); expect(response.body.provisioned).toBe(1);
    expect(state.created).toBe(1); expect(state.emailed).toBe(0);
    expect(state.members[0].user_id).toBe(userId); expect(state.invites[0].invited_user_id).toBe(userId);
    expect((await call(payload)).status).toBe(409); expect(state.created).toBe(1);
  });
  it("binds previews to the exact selection and acting administrator", async () => {
    const { call, state } = harness();
    const preview = await call({ action: "preview", academyMemberIds: [memberId] });
    expect((await call({ action: "provision", academyMemberIds: [otherId], previewToken: preview.body.previewToken })).status).toBe(409);
    state.actor = otherId;
    expect((await call({ action: "provision", academyMemberIds: [memberId], previewToken: preview.body.previewToken })).status).toBe(409);
    expect(state.created).toBe(0);
  });
  it("rejects changed source member status or email after preview", async () => {
    const { call, state } = harness();
    const preview = await call({ action: "preview", academyMemberIds: [memberId] });
    state.invites[0].email = "changed@example.test";
    expect((await call({ action: "provision", academyMemberIds: [memberId], previewToken: preview.body.previewToken })).status).toBe(409);
    state.members[0].status = "suspended";
    const blocked = await call({ action: "preview", academyMemberIds: [memberId] });
    expect(blocked.body.previewToken).toBeNull(); expect(blocked.body.blocked[0].reason).toBe("member_is_not_active");
    expect(state.created).toBe(0);
  });
  it("sends a sign-in email only for the selected prepared identity", async () => {
    const { call, state } = harness(true);
    const preview = await call({ action: "preview", previewAction: "notify", academyMemberIds: [memberId] });
    const response = await call({ action: "notify", academyMemberIds: [memberId], previewToken: preview.body.previewToken });
    expect(response.status).toBe(200); expect(response.body.sent).toBe(1);
    expect(state.created).toBe(0); expect(state.emailed).toBe(1);
    expect(state.invites[0].status).toBe("sent"); expect(state.invites[0].attempt_count).toBe(1);
  });
  it("consumes a preview before mail so concurrent requests cannot send twice", async () => {
    const { call, state } = harness(true);
    const preview = await call({ action: "preview", previewAction: "notify", academyMemberIds: [memberId] });
    const payload = { action: "notify", academyMemberIds: [memberId], previewToken: preview.body.previewToken };
    const responses = await Promise.all([call(payload), call(payload)]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    expect(state.emailed).toBe(1);
  });
  it("does not overwrite a cancellation occurring during mail delivery or claim success", async () => {
    const { call, state } = harness(true); state.cancelAfterEmail = true;
    const preview = await call({ action: "preview", previewAction: "notify", academyMemberIds: [memberId] });
    const response = await call({ action: "notify", academyMemberIds: [memberId], previewToken: preview.body.previewToken });
    expect(response.status).toBe(200); expect(response.body.failed).toBe(1); expect(response.body.sent).toBe(0);
    expect(state.invites[0].status).toBe("cancelled"); expect(state.emailed).toBe(1);
  });
  it("reports a failed email attempt instead of a false sent confirmation", async () => {
    const { call, state } = harness(true); state.failEmail = true;
    const preview = await call({ action: "preview", previewAction: "notify", academyMemberIds: [memberId] });
    const response = await call({ action: "notify", academyMemberIds: [memberId], previewToken: preview.body.previewToken });
    expect(response.body.failed).toBe(1); expect(response.body.sent).toBe(0); expect(state.invites[0].status).toBe("failed");
    const review = await call({ action: "preview", previewAction: "notify", academyMemberIds: [memberId] });
    expect(review.body.previewToken).toBeNull(); expect(review.body.blocked[0].reason).toBe("email_delivery_outcome_requires_review");
  });
  it("holds a provider-accepted email when saving its success receipt fails, including after a fresh preview", async () => {
    const { call, state } = harness(true); state.failSuccessReceipt = true;
    const preview = await call({ action: "preview", previewAction: "notify", academyMemberIds: [memberId] });
    const response = await call({ action: "notify", academyMemberIds: [memberId], previewToken: preview.body.previewToken });
    expect(response.body.sent).toBe(0); expect(response.body.failed).toBe(1); expect(state.emailed).toBe(1);
    for (const action of ["notify", "provision"]) {
      const review = await call({ action: "preview", previewAction: action, academyMemberIds: [memberId] });
      expect(review.body.previewToken).toBeNull(); expect(review.body.blocked[0].reason).toBe("email_delivery_outcome_requires_review");
    }
    expect((await call({ action: "notify", academyMemberIds: [memberId], previewToken: preview.body.previewToken })).status).toBe(409);
    expect(state.emailed).toBe(1);
    const resend = await call({ action: "preview", previewAction: "notify", academyMemberIds: [memberId], resend: true });
    expect(typeof resend.body.previewToken).toBe("string");
  });
  it("persists the delivery review hold before provider I/O even when neither final receipt can be saved", async () => {
    const { call, state } = harness(true); state.failSuccessReceipt = state.failFailureReceipt = true;
    const preview = await call({ action: "preview", previewAction: "notify", academyMemberIds: [memberId] });
    await expect(call({ action: "notify", academyMemberIds: [memberId], previewToken: preview.body.previewToken })).rejects.toThrow("receipt persistence failure");
    expect(state.emailed).toBe(1);
    const review = await call({ action: "preview", previewAction: "notify", academyMemberIds: [memberId] });
    expect(review.body.previewToken).toBeNull(); expect(review.body.blocked[0].reason).toBe("email_delivery_outcome_requires_review");
    expect(state.emailed).toBe(1);
  });
  it("withholds a send token and account-ready summary for banned Auth users", async () => {
    const { call, state } = harness(true); state.users[0].banned_until = "2099-01-01T00:00:00Z";
    const preview = await call({ action: "preview", previewAction: "notify", academyMemberIds: [memberId] });
    expect(preview.status).toBe(200); expect(preview.body.previewToken).toBeNull();
    expect(preview.body.blocked[0].reason).toBe("auth_sign_in_restricted");
    expect(preview.body.summary.provisionedMembers).toBe(0); expect(state.emailed).toBe(0);
  });
});
