import { describe, expect, it } from "vitest";
import { memberAccessPresentation } from "./memberPresentation";

describe("member access review", () => {
  const active = { status: "active" as const, userId: null, inviteEmail: "member@example.com", inviteStatus: "pending" };
  it("flags a saved invitation waiting for provisioning", () => {
    expect(memberAccessPresentation(active)).toEqual({ needsReview: true, label: "Account setup pending" });
  });
  it("does not treat historical or suspended members as provisioning failures", () => {
    expect(memberAccessPresentation({ ...active, status: "cancelled", inviteEmail: null }).needsReview).toBe(false);
    expect(memberAccessPresentation({ ...active, status: "suspended" }).needsReview).toBe(false);
  });
  it("recognizes provisioned accounts before their first sign-in and accounts without invites", () => {
    for (const inviteStatus of ["provisioned", "sent", "accepted", null]) {
      expect(memberAccessPresentation({ ...active, userId: "existing-user", inviteStatus }).needsReview).toBe(false);
    }
  });
  it("keeps missing email and failed delivery visible", () => {
    expect(memberAccessPresentation({ ...active, inviteEmail: null }).label).toBe("Sign-in email needed");
    expect(memberAccessPresentation({ ...active, userId: "existing-user", inviteStatus: "failed" }).needsReview).toBe(true);
  });
});
