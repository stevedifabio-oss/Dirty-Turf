import { describe, expect, it } from "vitest";
import { auditMemberMigration } from "./member-migration-readiness.mjs";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseMemberMigrationArgs, runMemberMigrationAudit } from "../audit-member-migration.mjs";

const now = Date.parse("2026-10-05T15:00:00Z");
const scope = { locationId: "location-1", groupId: "group-1" };
function inputs() {
  return {
    source: { schemaVersion: 1, source: "ghl-exact-community-roster", scope: { ...scope }, groupSlug: "group-slug", capturedAt: "2026-10-05T14:30:00Z", coverage: "complete", members: [{ externalId: "source-1", contactId: "contact-1", status: "active", role: "member", email: " ONE@example.test " }] },
    app: {
      schemaVersion: 1, source: "dirty-turf-member-readonly-export", scope: { ...scope }, capturedAt: "2026-10-05T14:45:00Z", coverage: "complete", academyCommunityId: "community-1",
      sourceMapping: { groupId: "group-1", groupSlug: "group-slug", databaseExternalGroupId: "group-slug", externalProvider: "highlevel", verificationReference: "source-group-proof-1", verifiedAt: "2026-10-05T14:30:00Z" },
      members: [{ id: "member-1", academy_community_id: "community-1", status: "active", role: "member", user_id: "user-1" }],
      links: [{ academy_community_id: "community-1", academy_member_id: "member-1", external_provider: "highlevel", external_member_id: "source-1", external_contact_id: "contact-1" }],
      invites: [{ id: "invite-1", academy_community_id: "community-1", academy_member_id: "member-1", email: "one@example.test", status: "accepted", invited_user_id: "user-1" }],
      authUsers: [{ id: "user-1", email: "one@example.test", email_confirmed_at: "2026-09-18T00:00:00Z", banned_until: null, deleted_at: null, last_sign_in_at: "2026-09-20T00:00:00Z" }],
      courses: [{ id: "course-1", academy_community_id: "community-1", status: "published" }],
      accessGrants: [null, "course-1"].map((course_id, index) => ({ id: `grant-${index}`, academy_community_id: "community-1", academy_member_id: "member-1", course_id, status: "active", source_type: "import", starts_at: "2026-09-18T00:00:00Z", ends_at: null })),
      billingPlans: [], billingSubscriptions: [],
    },
    policy: { schemaVersion: 1, scope: { ...scope }, approvedAt: "2026-10-03T10:00:00Z", approvedBy: "owner-approved-cohort-1", freeMemberExternalIds: ["source-1"], currentAcademyCourseIds: ["course-1"] },
  };
}
const audit = input => auditMemberMigration(input.source, input.app, input.policy, { now, scope });
const codes = input => audit(input).members[0].reasons;

describe("member migration readiness", () => {
  it("proves exact account links and durable free access without claiming rollout acceptance", () => {
    const data = inputs();
    const before = structuredClone(data);
    const report = audit(data);
    expect(report.technicalReady).toBe(true);
    expect(report.counts).toMatchObject({ eligibleMembers: 1, accountReady: 1, accessReady: 1, technicallyReadyMembers: 1 });
    expect(report.rolloutAcceptance).toBe("not_assessed");
    expect(report.unassessed).toContain("migration_campaign_sign_ins");
    expect(report.readOnly).toBe(true);
    expect(data).toEqual(before);
  });

  it.each([
    ["CRM contacts", input => { input.source.source = "crm-contacts"; }],
    ["incomplete roster", input => { input.source.coverage = "partial"; }],
    ["incomplete app export", input => { input.app.coverage = "partial"; }],
    ["wrong group", input => { input.source.scope.groupId = "another-group"; }],
    ["unscoped policy", input => { delete input.policy.scope; }],
    ["unverified app group mapping", input => { delete input.app.sourceMapping; }],
    ["wrong app database slug", input => { input.app.sourceMapping.databaseExternalGroupId = "another-slug"; }],
    ["stale group mapping", input => { input.app.sourceMapping.verifiedAt = "2026-10-03T14:30:00Z"; }],
    ["old roster", input => { input.source.capturedAt = "2026-10-03T14:30:00Z"; }],
    ["future app export", input => { input.app.capturedAt = "2026-10-06T14:45:00Z"; }],
    ["unknown source membership", input => { delete input.source.members[0].status; }],
    ["snapshots too far apart", input => { input.app.capturedAt = "2026-10-05T13:00:00Z"; }],
    ["empty roster", input => { input.source.members = []; }],
    ["unconfirmed ban coverage", input => { delete input.app.authUsers[0].banned_until; }],
    ["missing collection", input => { delete input.app.accessGrants; }],
    ["cross-community grant", input => { input.app.accessGrants[0].academy_community_id = "another-community"; }],
    ["dangling member link", input => { input.app.links[0].academy_member_id = "missing-member"; }],
    ["unknown included course", input => { input.policy.currentAcademyCourseIds = ["unknown-course"]; }],
    ["unobserved course publication", input => { delete input.app.courses[0].status; }],
    ["duplicate cohort entry", input => { input.policy.freeMemberExternalIds.push("source-1"); }],
    ["grant without timezone", input => { input.app.accessGrants[0].starts_at = "2026-09-18T00:00:00"; }],
  ])("rejects %s rather than treating it as ready", (_label, mutate) => {
    const input = inputs(); mutate(input);
    expect(() => audit(input)).toThrow();
  });

  it("requires an independent exact group allowlist", () => {
    const input = inputs();
    expect(() => auditMemberMigration(input.source, input.app, input.policy, { now })).toThrow("explicit location");
  });

  it.each([
    ["missing_app_member", input => { input.app.links = []; }],
    ["auth_email_mismatch", input => { input.app.authUsers[0].email = "other@example.test"; }],
    ["invite_identity_mismatch", input => { input.app.invites[0].invited_user_id = "other-user"; }],
    ["missing_or_ambiguous_invite", input => { input.app.invites = []; }],
    ["auth_sign_in_restricted", input => { input.app.authUsers[0].email_confirmed_at = null; }],
    ["auth_sign_in_restricted", input => { input.app.authUsers[0].banned_until = "2026-10-06T00:00:00Z"; }],
    ["auth_sign_in_restricted", input => { input.app.authUsers[0].deleted_at = "2026-10-04T00:00:00Z"; }],
    ["member_status_mismatch", input => { input.app.members[0].status = "suspended"; }],
    ["member_role_mismatch", input => { input.app.members[0].role = "admin"; }],
    ["missing_community_access", input => { input.app.accessGrants[0].status = "revoked"; }],
    ["missing_current_academy_access", input => { input.app.accessGrants[1].ends_at = "2026-10-05T15:00:00Z"; }],
    ["missing_community_access", input => { input.app.accessGrants[0].starts_at = "2026-10-06T00:00:00Z"; }],
    ["free_access_not_durable", input => { input.app.accessGrants[1].ends_at = "2026-10-06T00:00:00Z"; }],
    ["free_access_outside_approved_cohort", input => { input.policy.freeMemberExternalIds = []; }],
    ["conflicting_source_identity", input => { input.app.links[0].external_contact_id = "other-contact"; }],
  ])("reports %s without changing records", (code, mutate) => {
    const input = inputs(); mutate(input);
    const original = structuredClone(input);
    expect(codes(input)).toContain(code);
    expect(audit(input).technicalReady).toBe(false);
    expect(input).toEqual(original);
  });

  it("holds duplicate exact source IDs and normalized emails", () => {
    const input = inputs();
    input.source.members.push({ ...input.source.members[0] });
    expect(codes(input)).toEqual(expect.arrayContaining(["duplicate_source_member_id", "duplicate_source_contact_id", "duplicate_source_email"]));
  });

  it("holds duplicate auth emails even if one exact user is linked", () => {
    const input = inputs();
    input.app.authUsers.push({ ...input.app.authUsers[0], id: "user-2", email: " ONE@EXAMPLE.TEST " });
    expect(codes(input)).toContain("duplicate_auth_email");
  });

  it("never matches a changed source identity by email", () => {
    const input = inputs();
    input.source.members[0].externalId = "new-source-id";
    input.source.members[0].contactId = null;
    expect(codes(input)).toContain("missing_app_member");
    expect(audit(input).members[0].appMemberId).toBeNull();
  });

  it("keeps missing active imported records review-only and app-only records preserved", () => {
    const input = inputs();
    input.app.members.push({ id: "native-member", academy_community_id: "community-1", status: "active", role: "member", user_id: null });
    input.app.members.push({ id: "missing-source-member", academy_community_id: "community-1", status: "active", role: "member", user_id: null });
    input.app.links.push({ ...input.app.links[0], academy_member_id: "missing-source-member", external_member_id: "source-2", external_contact_id: null });
    const report = audit(input);
    expect(report.counts.appOnlyMembersPreserved).toBe(1);
    expect(report.missingSourceReviewOnly).toEqual([{ appMemberId: "missing-source-member", reason: "active_imported_member_missing_from_roster", reviewOnly: true }]);
    expect(report.technicalReady).toBe(false);
  });

  it("accepts historical cancelled authors without a login but blocks active app membership", () => {
    const input = inputs();
    input.source.members.push({ externalId: "historical", contactId: null, email: "", role: "member", status: "cancelled" });
    expect(audit(input).technicalReady).toBe(true);
    input.app.members.push({ id: "historical-member", academy_community_id: "community-1", status: "active", role: "member", user_id: null });
    input.app.links.push({ ...input.app.links[0], academy_member_id: "historical-member", external_member_id: "historical", external_contact_id: null });
    expect(audit(input).members[1].reasons).toContain("restricted_source_member_active_in_app");
  });

  it("flags a membership charge for a free member while permitting a separate tool subscription", () => {
    const input = inputs();
    input.app.billingPlans.push({ id: "plan-1", academy_community_id: "community-1", offer_kind: "tool" });
    input.app.billingSubscriptions.push({ id: "subscription-1", academy_community_id: "community-1", academy_member_id: "member-1", plan_id: "plan-1", status: "active" });
    expect(audit(input).technicalReady).toBe(true);
    input.app.billingPlans[0].offer_kind = "membership";
    expect(codes(input)).toContain("free_member_membership_billing_review");
  });

  it("allows an explicitly non-free member with paid access, without making them grandfathered", () => {
    const input = inputs(); input.policy.freeMemberExternalIds = [];
    input.app.accessGrants.forEach(grant => { grant.source_type = "stripe_subscription"; grant.ends_at = "2026-11-05T00:00:00Z"; });
    const report = audit(input);
    expect(report.technicalReady).toBe(true);
    expect(report.members[0].approvedFree).toBe(false);
    expect(report.unassessed).toContain("source_billing_agreements");
  });

  it.each(["draft", "archived"])("holds included %s courses even with effective durable grants", status => {
    const input = inputs(); input.app.courses[0].status = status;
    const report = audit(input);
    expect(report.technicalReady).toBe(false);
    expect(report.members[0].accessReady).toBe(false);
    expect(report.members[0].reasons).toContain("included_course_not_published");
  });

  it.each(["pending", "cancelled", "suspended"])("does not count %s app membership as accessible despite active grants", status => {
    const input = inputs(); input.app.members[0].status = status;
    const report = audit(input);
    expect(report.technicalReady).toBe(false);
    expect(report.counts.accessReady).toBe(0);
    expect(report.members[0].accessReady).toBe(false);
    expect(report.members[0].reasons).toContain("member_status_mismatch");
  });
});

describe("private migration audit CLI", () => {
  it("writes an atomic private report and prints no member identity", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dirty-turf-migration-test-"));
    try {
      const data = inputs();
      const observed = new Date(Date.now() - 1000).toISOString();
      data.source.capturedAt = data.app.capturedAt = data.policy.approvedAt = observed;
      data.app.sourceMapping.verifiedAt = observed;
      data.app.authUsers[0].email_confirmed_at = observed;
      data.app.accessGrants.forEach(grant => { grant.starts_at = observed; });
      const privateRoot = path.join(directory, "output/private");
      await mkdir(privateRoot, { recursive: true, mode: 0o700 });
      for (const [name, value] of Object.entries(data)) await writeFile(path.join(privateRoot, `${name}.json`), JSON.stringify(value), { mode: 0o600 });
      const args = [fileURLToPath(new URL("../audit-member-migration.mjs", import.meta.url)), "--roster", "output/private/source.json", "--app-snapshot", "output/private/app.json", "--cohort", "output/private/policy.json", "--location-id", "location-1", "--group-id", "group-1", "--report", "output/private/report.json"];
      const first = spawnSync(process.execPath, args, { cwd: directory, encoding: "utf8" });
      expect(first.status, first.stderr).toBe(0);
      expect(JSON.parse(first.stdout)).toMatchObject({ technicalReady: true, rolloutAcceptance: "not_assessed", readOnly: true, reportSaved: true });
      expect(first.stdout).not.toContain("one@example.test");
      expect(first.stdout).not.toContain("source-1");
      const outputFile = path.join(privateRoot, "report.json");
      const saved = await readFile(outputFile, "utf8");
      expect((await stat(outputFile)).mode & 0o077).toBe(0);
      expect(JSON.parse(saved).members[0].sourceMemberId).toBe("source-1");
      expect(JSON.parse(saved).inputSha256.roster).toMatch(/^[a-f0-9]{64}$/);
      const repeated = spawnSync(process.execPath, args, { cwd: directory, encoding: "utf8" });
      expect(repeated.status).toBe(1);
      expect(await readFile(outputFile, "utf8")).toBe(saved);
      await writeFile(path.join(privateRoot, "source.json"), '{"private_member_email": "secret@example.test", BROKEN');
      args[args.length - 1] = "output/private/invalid-report.json";
      const invalid = spawnSync(process.execPath, args, { cwd: directory, encoding: "utf8" });
      expect(invalid.status).toBe(1);
      expect(invalid.stderr).toBe("Invalid local JSON input\n");
      expect(invalid.stderr + invalid.stdout).not.toContain("secret@example.test");
      await writeFile(path.join(privateRoot, "source.json"), JSON.stringify(data.source), { mode: 0o600 });
      const { chmod } = await import("node:fs/promises");
      await chmod(path.join(privateRoot, "source.json"), 0o644);
      const publicInput = spawnSync(process.execPath, args, { cwd: directory, encoding: "utf8" });
      expect(publicInput.status).toBe(1);
      expect(publicInput.stderr).toContain("Migration input must be a private regular JSON file");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("saves exceptions privately, emits only counts and leaves account preparation distinct", async () => {
    const input = inputs(); input.app.accessGrants = [];
    const values = [input.source, input.app, input.policy];
    let report;
    const output = await runMemberMigrationAudit(parseMemberMigrationArgs(["--roster", "source", "--app-snapshot", "app", "--cohort", "policy", "--location-id", scope.locationId, "--group-id", scope.groupId, "--report", "output/private/report.json"]), {
      now, preflightReport: async () => {},
      readJson: async file => ({ value: values[["source", "app", "policy"].indexOf(file)], sha256: "a".repeat(64) }),
      writeReport: async (_file, value) => { report = value; },
    });
    expect(output.technicalReady).toBe(false);
    expect(output.counts).toMatchObject({ accountReady: 1, accessReady: 0, technicallyReadyMembers: 0 });
    expect(report.members[0].reasons).toContain("missing_community_access");
    expect(JSON.stringify(output)).not.toContain("source-1");
    expect(JSON.stringify(output)).not.toContain("one@example.test");
  });

  it("rejects missing, repeated and unknown options", () => {
    expect(() => parseMemberMigrationArgs([])).toThrow("Required:");
    expect(() => parseMemberMigrationArgs(["--roster", "one", "--roster", "two"])).toThrow("Required:");
    expect(() => parseMemberMigrationArgs(["--send", "true"])).toThrow("Required:");
  });
});
