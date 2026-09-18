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
      [{ id: "user-1", email: "first@example.com" }, {
        id: "user-2",
        email: "second@example.com",
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
      [{ id: "user-1", email: "first@example.com" }, {
        id: "user-2",
        email: "second@example.com",
      }],
    );
    expect(summary.allEnrolledReady).toBe(true);
    expect(summary.allEligibleReady).toBe(true);
    expect(summary.enrolledNotReady).toBe(0);
  });
});
