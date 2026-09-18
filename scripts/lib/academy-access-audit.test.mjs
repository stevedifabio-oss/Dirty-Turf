import { describe, expect, it } from "vitest";
import { auditAcademyAccess } from "./academy-access-audit.mjs";

const validManifest = {
  members: [
    { externalId: "member-1", email: "one@example.test", status: "active" },
    { externalId: "member-2", email: "two@example.test", status: "active" },
    { externalId: "historical", status: "cancelled" },
  ],
  enrollments: [
    { externalId: "enrollment-1", memberExternalId: "member-1", status: "active" },
    { externalId: "enrollment-2", memberExternalId: "member-2", status: "completed" },
  ],
};

describe("Academy access audit", () => {
  it("proves every enrolled member has a unique active login email", () => {
    expect(auditAcademyAccess(validManifest, { members: 2, enrolled: 2 })).toEqual({
      valid: true,
      counts: {
        sourceMembers: 3,
        uniqueLoginEmails: 2,
        activeEnrollments: 2,
        enrolledLoginReady: 2,
        duplicateEmailCount: 0,
      },
      allEnrolledCanLogin: true,
      failures: [],
    });
  });

  it("fails when an enrollment cannot map to a valid account email", () => {
    const manifest = structuredClone(validManifest);
    manifest.members[1].email = "not-an-email";
    const audit = auditAcademyAccess(manifest);
    expect(audit.valid).toBe(false);
    expect(audit.allEnrolledCanLogin).toBe(false);
    expect(audit.failures).toContain("Enrolled member member-2 has no valid login email");
  });

  it("fails duplicate normalized emails", () => {
    const manifest = structuredClone(validManifest);
    manifest.members[1].email = " ONE@example.test ";
    const audit = auditAcademyAccess(manifest);
    expect(audit.counts.duplicateEmailCount).toBe(1);
    expect(audit.valid).toBe(false);
  });
});
