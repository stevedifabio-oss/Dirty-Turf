import { describe, expect, it } from "vitest";
import { createMemberInvitePreviewToken, memberInviteStateHash, parseMemberInviteSelection, planMemberInvites, verifyMemberInvitePreviewToken, type MemberInviteRecord } from "./member-invite-plan";

const communityId = "00000000-0000-4000-8000-000000000001";
const memberId = "00000000-0000-4000-8000-000000000002";
const otherId = "00000000-0000-4000-8000-000000000003";
const now = Date.parse("2026-10-22T16:00:00Z");
function row(): MemberInviteRecord {
  return { id: "invite-1", academy_member_id: memberId, email: " ONE@Example.test ", status: "pending", invited_user_id: null, attempt_count: 0, delivery_count: 0, updated_at: "2026-10-21T00:00:00Z", member: { id: memberId, academy_community_id: communityId, display_name: "One", company_name: "Company", status: "active", user_id: null, updated_at: "2026-10-21T00:00:00Z" } };
}
const user = { id: "user-1", email: "one@example.test", email_confirmed_at: "2026-10-21T00:00:00Z", banned_until: null, deleted_at: null };
function inputs() { return { communityId, action: "provision" as const, rows: [row()], users: [] as typeof user[], academyMemberIds: [memberId], resend: false, now }; }

describe("exact member migration action planning", () => {
  it("returns a read-only inventory without implicitly selecting it", () => {
    const input = inputs(); input.academyMemberIds = null!;
    const result = planMemberInvites(input);
    expect(result.candidates).toEqual([{ academyMemberId: memberId, inviteId: "invite-1", email: "one@example.test", displayName: "One", inviteStatus: "pending" }]);
    expect(result.selected).toEqual([]);
  });
  it("rejects missing mutation selection, duplicate IDs and excess batches", () => {
    expect(parseMemberInviteSelection(undefined, "provision")).toBeNull();
    expect(() => parseMemberInviteSelection(undefined, "provision", true)).toThrow("exact members");
    expect(() => parseMemberInviteSelection([], "notify")).toThrow("1-25");
    expect(() => parseMemberInviteSelection([memberId, memberId.toUpperCase()], "provision")).toThrow("unique");
    expect(() => parseMemberInviteSelection(["not-an-id"], "provision")).toThrow("valid");
    expect(() => parseMemberInviteSelection(Array(26).fill(memberId), "notify")).toThrow("1-25");
    expect(parseMemberInviteSelection([otherId, memberId], "provision")).toEqual([memberId, otherId]);
  });
  it("uses the same provision predicate in preview including ready identities with a failed invite status", () => {
    const input = inputs(); input.rows[0].member!.user_id = input.rows[0].invited_user_id = user.id; input.rows[0].status = "failed"; input.users = [user];
    expect(planMemberInvites(input).selected).toHaveLength(1);
    input.rows[0].status = "accepted";
    expect(planMemberInvites(input).blocked[0].reason).toBe("account_already_prepared");
  });
  it.each([
    ["member_is_not_active", (data: ReturnType<typeof inputs>) => { data.rows[0].member!.status = "suspended"; }],
    ["invitation_is_cancelled", (data: ReturnType<typeof inputs>) => { data.rows[0].status = "cancelled"; }],
    ["invalid_member_email", (data: ReturnType<typeof inputs>) => { data.rows[0].email = "invalid"; }],
    ["linked_auth_identity_mismatch", (data: ReturnType<typeof inputs>) => { data.rows[0].member!.user_id = "different-user"; }],
    ["linked_auth_identity_mismatch", (data: ReturnType<typeof inputs>) => { data.rows[0].invited_user_id = "different-user"; }],
    ["auth_sign_in_restricted", (data: ReturnType<typeof inputs>) => { data.users = [{ ...user, email_confirmed_at: null! }]; }],
    ["auth_sign_in_restricted", (data: ReturnType<typeof inputs>) => { data.users = [{ ...user, banned_until: "2026-10-23T00:00:00Z" }]; }],
    ["auth_sign_in_restricted", (data: ReturnType<typeof inputs>) => { data.users = [{ ...user, deleted_at: "2026-10-21T00:00:00Z" }]; }],
    ["duplicate_auth_email", (data: ReturnType<typeof inputs>) => { data.users = [user, { ...user, id: "user-2" }]; }],
    ["member_identity_requires_review", (data: ReturnType<typeof inputs>) => { data.rows[0].member!.academy_community_id = otherId; }],
    ["member_identity_requires_review", (data: ReturnType<typeof inputs>) => { data.rows[0].member!.id = otherId; }],
  ])("holds %s without substituting another member", (reason, mutate) => {
    const input = inputs(); mutate(input); const before = structuredClone(input);
    expect(planMemberInvites(input)).toMatchObject({ candidates: [], selected: [], blocked: [{ academyMemberId: memberId, reason }] });
    expect(input).toEqual(before);
  });
  it("blocks duplicate normalized invite email instead of merging identities", () => {
    const input = inputs(); input.rows.push({ ...row(), id: "invite-2", academy_member_id: otherId, member: { ...row().member!, id: otherId } });
    expect(planMemberInvites(input).blocked[0].reason).toBe("duplicate_member_email");
  });
  it("detects shared Auth identity even on members without an invite", () => {
    const input = inputs(); input.users = [user]; input.rows[0].member!.user_id = input.rows[0].invited_user_id = user.id;
    const result = planMemberInvites({ ...input, memberIdentities: [{ id: memberId, user_id: user.id }, { id: otherId, user_id: user.id }] });
    expect(result.blocked[0].reason).toBe("shared_auth_identity");
  });
  it("reports exact unknown selections, never the next community-wide candidate", () => {
    const input = inputs(); input.academyMemberIds = [otherId];
    expect(planMemberInvites(input).blocked).toEqual([{ academyMemberId: otherId, reason: "member_not_in_community_invite_queue" }]);
    expect(planMemberInvites(input).selected).toEqual([]);
  });
  it("separates account preparation, unsent login emails and explicitly requested resends", () => {
    const input = inputs(); const notify = { ...input, action: "notify" as const };
    expect(planMemberInvites(notify).blocked[0].reason).toBe("account_must_be_prepared_first");
    input.rows[0].member!.user_id = input.rows[0].invited_user_id = user.id; input.users = [user]; input.rows[0].status = "provisioned";
    expect(planMemberInvites({ ...input, action: "notify" }).selected).toHaveLength(1);
    input.rows[0].status = "sent";
    expect(planMemberInvites({ ...input, action: "notify" }).blocked[0].reason).toBe("sign_in_email_already_sent");
    expect(planMemberInvites({ ...input, action: "notify", resend: true }).selected).toHaveLength(1);
    input.rows[0].status = "accepted";
    expect(planMemberInvites({ ...input, action: "notify", resend: true }).blocked[0].reason).toBe("member_already_signed_in");
  });
  it("does not clear an ambiguous delivery by preparing the account or generating a normal fresh send preview", () => {
    const input = inputs(); input.rows[0].member!.user_id = input.rows[0].invited_user_id = user.id;
    input.users = [user]; input.rows[0].status = "failed"; input.rows[0].last_action = "notify";
    input.rows[0].error_message = "Delivery outcome requires review. Synthetic network failure";
    expect(planMemberInvites(input).blocked[0].reason).toBe("email_delivery_outcome_requires_review");
    expect(planMemberInvites({ ...input, action: "notify" }).blocked[0].reason).toBe("email_delivery_outcome_requires_review");
    expect(planMemberInvites({ ...input, action: "notify", resend: true }).selected).toHaveLength(1);
  });
});

describe("server-signed member preview", () => {
  it("binds exact scope/action/actor/member state and expires after ten minutes", async () => {
    const state = { actorId: "admin-1", communityId, action: "notify", academyMemberIds: [memberId], rows: planMemberInvites(inputs()).fingerprints };
    const hash = await memberInviteStateHash(state);
    const proof = await createMemberInvitePreviewToken("synthetic-local-signing-secret", hash, now);
    await expect(verifyMemberInvitePreviewToken("synthetic-local-signing-secret", proof.token, hash, now + 1)).resolves.toBeUndefined();
    expect(proof.expiresAt).toBe("2026-10-22T16:10:00.000Z");
    for (const modified of [{ ...state, actorId: "admin-2" }, { ...state, action: "provision" }, { ...state, academyMemberIds: [otherId] }, { ...state, rows: [] }]) {
      await expect(verifyMemberInvitePreviewToken("synthetic-local-signing-secret", proof.token, await memberInviteStateHash(modified), now + 1)).rejects.toThrow("fresh preview");
    }
    await expect(verifyMemberInvitePreviewToken("synthetic-local-signing-secret", proof.token, hash, now + 600000)).rejects.toThrow("expired");
    await expect(verifyMemberInvitePreviewToken("synthetic-local-signing-secret", proof.token, hash, now - 1)).rejects.toThrow();
    await expect(verifyMemberInvitePreviewToken("different-secret", proof.token, hash, now)).rejects.toThrow();
    expect(proof.token).not.toContain("example.test");
  });
  it.each([undefined, null, "", "0.600000.bad.signature", "x".repeat(401)])("rejects malformed or absent proof %s", async token => {
    await expect(verifyMemberInvitePreviewToken("secret", token, "a".repeat(64), now)).rejects.toThrow("fresh preview");
  });
  it("changes the state hash after an attempt claim, email change or member edit", async () => {
    const input = inputs(); const before = await memberInviteStateHash(planMemberInvites(input).fingerprints);
    input.rows[0].updated_at = "2026-10-22T16:00:00Z"; input.rows[0].attempt_count = 1;
    expect(await memberInviteStateHash(planMemberInvites(input).fingerprints)).not.toBe(before);
    input.rows[0].member!.updated_at = "2026-10-22T16:00:01Z";
    expect(await memberInviteStateHash(planMemberInvites(input).fingerprints)).not.toBe(before);
  });
});
