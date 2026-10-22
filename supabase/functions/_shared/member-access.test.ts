import { describe, expect, it } from "vitest";
import {
  type MemberAccessRow,
  normalizeMemberEmail,
  resolveMemberAccessAction,
  summarizeMemberAccess,
} from "./member-access";

const rows: MemberAccessRow[] = [
  {
    academyMemberId: "member-1",
    inviteStatus: "provisioned",
    invitedUserId: "user-1",
    memberStatus: "active",
    memberUserId: "user-1",
    email: " First@Example.com ",
  },
  {
    academyMemberId: "member-2",
    inviteStatus: "pending",
    invitedUserId: null,
    memberStatus: "active",
    memberUserId: null,
    email: "second@example.com",
        email_confirmed_at: "2026-09-01T00:00:00Z",
  },
  {
    academyMemberId: "member-3",
    inviteStatus: "cancelled",
    invitedUserId: null,
    memberStatus: "cancelled",
    memberUserId: null,
    email: "former@example.com",
  },
];

describe("Academy member access", () => {
  it("keeps legacy dry-run and send requests compatible", () => {
    expect(resolveMemberAccessAction(undefined, false)).toBe("preview");
    expect(resolveMemberAccessAction(undefined, true)).toBe("notify");
    expect(resolveMemberAccessAction("provision", false)).toBe("provision");
    expect(() => resolveMemberAccessAction("delete", false)).toThrow(
      /preview, provision, or notify/,
    );
  });

  it("normalizes member email without changing the source rows", () => {
    expect(normalizeMemberEmail("  Member@Example.COM ")).toBe(
      "member@example.com",
    );
  });

  it("requires both the auth user and database links before declaring access ready", () => {
    const summary = summarizeMemberAccess(
      rows,
      ["member-1", "member-2", "member-missing"],
      [{ id: "user-1", email: "first@example.com", email_confirmed_at: "2026-09-01T00:00:00Z" }, {
        id: "user-2",
        email: "second@example.com",
        email_confirmed_at: "2026-09-01T00:00:00Z",
      }],
    );

    expect(summary).toMatchObject({
      eligibleMembers: 2,
      provisionedMembers: 1,
      allEligibleReady: false,
      enrolledMembers: 3,
      enrolledReady: 1,
      enrolledNotReady: 2,
      enrolledMissingInvite: 1,
      allEnrolledReady: false,
      statusCounts: { provisioned: 1, pending: 1, cancelled: 1 },
    });
  });

  it("reports a fully provisioned enrolled roster", () => {
    const readyRows = rows.slice(0, 2).map((row, index) => ({
      ...row,
      invitedUserId: `user-${index + 1}`,
      memberUserId: `user-${index + 1}`,
      inviteStatus: "provisioned",
    }));
    const summary = summarizeMemberAccess(
      readyRows,
      ["member-1", "member-2"],
      [{ id: "user-1", email: "first@example.com", email_confirmed_at: "2026-09-01T00:00:00Z" }, {
        id: "user-2",
        email: "second@example.com",
        email_confirmed_at: "2026-09-01T00:00:00Z",
      }],
    );
    expect(summary.allEnrolledReady).toBe(true);
    expect(summary.allEligibleReady).toBe(true);
    expect(summary.enrolledNotReady).toBe(0);
  });

  it.each([
    { email_confirmed_at: null },
    { banned_until: "2099-01-01T00:00:00Z" },
    { banned_until: "invalid-date" },
    { deleted_at: "2026-10-01T00:00:00Z" },
  ])("does not call a restricted linked identity account-ready: %s", restriction => {
    const user = { id: "user-1", email: "first@example.com", email_confirmed_at: "2026-09-01T00:00:00Z", ...restriction };
    expect(summarizeMemberAccess(rows.slice(0, 1), ["member-1"], [user]).provisionedMembers).toBe(0);
  });

  it("holds duplicate normalized Auth emails and shared linked users", () => {
    const users = [{ id: "user-1", email: "first@example.com", email_confirmed_at: "2026-09-01T00:00:00Z" }];
    expect(summarizeMemberAccess(rows.slice(0, 1), ["member-1"], [...users, { ...users[0], id: "user-2", email: " FIRST@EXAMPLE.COM " }]).provisionedMembers).toBe(0);
    expect(summarizeMemberAccess([rows[0], { ...rows[0], academyMemberId: "different-member" }], ["member-1"], users).provisionedMembers).toBe(0);
    expect(summarizeMemberAccess([rows[0]], ["member-1"], users, [{ id: "member-1", user_id: "user-1" }, { id: "app-only-no-invite", user_id: "user-1" }]).provisionedMembers).toBe(0);
  });
});
