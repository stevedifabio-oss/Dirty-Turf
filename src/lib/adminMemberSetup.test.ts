import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("./backend", () => ({ supabase: { functions: { invoke: mocks.invoke }, rpc: mocks.rpc, from: mocks.from } }));
import { previewMemberInviteAction, runMemberInviteAction } from "./adminBackend";
const first = "11111111-1111-4111-8111-111111111111";
const second = "22222222-2222-4222-8222-222222222222";
const candidate = (id = first) => ({ academyMemberId: id, inviteId: `invite-${id}`, email: "member@example.invalid", displayName: "Demo Member", inviteStatus: "pending" });
const review = (selected = [candidate()]) => ({ dryRun: true, action: "preview", previewAction: "provision", candidates: [candidate()], selected, blocked: [], previewToken: "opaque-preview", previewExpiresAt: new Date(Date.now() + 600000).toISOString() });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: { canManage: true, communityId: "community" }, error: null });
  const query = { select: () => query, eq: () => query, single: async () => ({ data: { id: "community", name: "Academy", owner_organization_id: "organization" }, error: null }) };
  mocks.from.mockReturnValue(query);
  mocks.invoke.mockResolvedValue({ data: review(), error: null });
});
describe("exact reviewed member actions", () => {
  it("loads an inventory without changing accounts or sending an empty selection", async () => {
    mocks.invoke.mockResolvedValue({ data: { ...review([]), previewToken: null, previewExpiresAt: null }, error: null });
    await previewMemberInviteAction("provision");
    expect(mocks.invoke).toHaveBeenCalledWith("academy-invite-members", { body: { academyCommunityId: "community", action: "preview", previewAction: "provision" } });
  });
  it("sends sorted exact IDs for a fresh preview", async () => {
    mocks.invoke.mockResolvedValue({ data: { ...review([candidate(second), candidate()]), candidates: [candidate(second), candidate()] }, error: null });
    await previewMemberInviteAction("provision", [second, first]);
    expect(mocks.invoke.mock.calls[0][1].body.academyMemberIds).toEqual([first, second]);
  });
  it.each([{ memberIds: [] }, { memberIds: [first, first] }, { memberIds: ["not-a-member-id"] }])("rejects unsafe mutations before the provider call: $memberIds", async ({ memberIds }) => {
    await expect(runMemberInviteAction("provision", { memberIds, inviteIds: ["invite-first"], previewToken: "token", previewExpiresAt: new Date(Date.now() + 60000).toISOString() })).rejects.toThrow();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("rejects too many email recipients and expired approvals", async () => {
    await expect(previewMemberInviteAction("notify", Array.from({ length: 26 }, (_, i) => `${String(i).padStart(8,"0")}-1111-4111-8111-111111111111`))).rejects.toThrow("25");
    await expect(runMemberInviteAction("notify", { memberIds: [first], inviteIds: ["invite-first"], previewToken: "token", previewExpiresAt: "2020-01-01T00:00:00Z" })).rejects.toThrow("fresh preview");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("holds a response from the old whole-community endpoint", async () => {
    mocks.invoke.mockResolvedValue({ data: { summary: { readyToProcess: 10 } }, error: null });
    await expect(previewMemberInviteAction("provision", [first])).rejects.toThrow("Deploy the reviewed account-setup update");
  });
  it("rejects a server preview that silently adds another member", async () => {
    mocks.invoke.mockResolvedValue({ data: review([candidate(second)]), error: null });
    await expect(previewMemberInviteAction("provision", [first])).rejects.toThrow("does not match");
  });
  it("never proceeds when blocked members are accompanied by an approval token", async () => {
    mocks.invoke.mockResolvedValue({ data: { ...review(), blocked: [{ academyMemberId: first, reason: "Status changed" }] }, error: null });
    await expect(previewMemberInviteAction("provision", [first])).rejects.toThrow("does not match");
  });
  it("passes only reviewed IDs and the approval token to a mutation", async () => {
    mocks.invoke.mockResolvedValue({ data: { action: "notify", processed: 1, failed: 0, results: [{inviteId:"invite-first",status:"sent"}] }, error: null });
    await runMemberInviteAction("notify", { memberIds: [first], inviteIds: ["invite-first"], previewToken: "signed-token", previewExpiresAt: new Date(Date.now() + 60000).toISOString() });
    expect(mocks.invoke).toHaveBeenCalledWith("academy-invite-members", { body: { academyCommunityId: "community", action: "notify", academyMemberIds: [first], previewToken: "signed-token", limit: 1 } });
  });
  it.each([
    {},
    { action: "notify", processed: 0, failed: 0, results: [] },
    { action: "notify", processed: 1, failed: 0, results: [{ inviteId: "someone-else", status: "sent" }] },
    { action: "notify", processed: 1, failed: 0, results: [{ inviteId: "invite-first", status: "provisioned" }] },
  ])("does not claim success from incomplete or mismatched results: %j", async result => {
    mocks.invoke.mockResolvedValue({data:result,error:null});
    await expect(runMemberInviteAction("notify",{memberIds:[first],inviteIds:["invite-first"],previewToken:"token",previewExpiresAt:new Date(Date.now()+60000).toISOString()})).rejects.toThrow(/could not be confirmed|incomplete/);
  });
  it("retains a safe server validation message for a changed member", async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify({ error: "Member status changed. Review a new preview." })) } });
    await expect(previewMemberInviteAction("provision", [first])).rejects.toThrow("Member status changed");
  });
});
