import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, stat, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { prepareMemberMigration } from "./member-migration-preparation.mjs";
import { parseMemberPreparationArgs } from "../prepare-member-migration.mjs";

const now = Date.parse("2026-10-20T12:00:00Z");
const scope = { locationId: "location-1", groupId: "group-1" };
const options = { now, scope, campaignId: "migration-draft-1" };
function inputs() {
  return [
    { schemaVersion: 1, source: "ghl-exact-community-roster", coverage: "complete", scope, groupSlug: "group-slug", capturedAt: "2026-10-20T11:30:00Z", members: [{ externalId: "source-1", contactId: "contact-1", email: "one@example.test", status: "active", role: "member" }] },
    { schemaVersion: 1, source: "dirty-turf-member-readonly-export", coverage: "complete", scope, capturedAt: "2026-10-20T11:40:00Z", academyCommunityId: "community-1",
      sourceMapping: { groupId: "group-1", groupSlug: "group-slug", databaseExternalGroupId: "group-slug", externalProvider: "highlevel", verificationReference: "proof-1", verifiedAt: "2026-10-20T11:30:00Z" },
      members: [{ id: "member-1", academy_community_id: "community-1", user_id: "user-1", role: "member", level: 1, status: "active" }],
      links: [{ academy_community_id: "community-1", academy_member_id: "member-1", external_provider: "highlevel", external_member_id: "source-1", external_contact_id: "contact-1" }],
      invites: [{ id: "invite-1", academy_community_id: "community-1", academy_member_id: "member-1", invited_user_id: "user-1", email: "one@example.test", status: "accepted" }],
      authUsers: [{ id: "user-1", email: "one@example.test", email_confirmed_at: "2026-09-20T00:00:00Z", banned_until: null, deleted_at: null, last_sign_in_at: "2026-10-20T11:50:00Z" }],
      courses: [{ id: "course-1", academy_community_id: "community-1", status: "published", access_type: "purchase", required_level: null }],
      accessGrants: [null, "course-1"].map((course_id, index) => ({ id: `grant-${index}`, academy_community_id: "community-1", academy_member_id: "member-1", course_id, status: "active", source_type: "import", starts_at: "2026-09-20T00:00:00Z", ends_at: null })),
      courseAccessDenials: [], billingPlans: [], billingSubscriptions: [],
    },
    { schemaVersion: 1, scope, approvedAt: "2026-10-03T10:00:00Z", approvedBy: "actual-approved-cohort-reference", freeMemberExternalIds: ["source-1"], currentAcademyCourseIds: ["course-1"] },
  ];
}

describe("member migration preparation", () => {
  it("creates unmistakably blocked templates without invented member counts or cohort approval", () => {
    const result = prepareMemberMigration(undefined, undefined, undefined, options);
    expect(result).toMatchObject({ preparationState: "blocked_missing_inputs", technicalReadinessAssessed: false, technicalReady: false, executable: false, liveActionsAuthorized: false, counts: { sourceMembers: null, eligibleMembers: null } });
    expect(result.launchTracker).toMatchObject({ state: "template_only", members: [] });
    expect(result.provisioningPlan).toMatchObject({ state: "template_only", reviewCandidates: [], reviewBatches: [] });
    expect(result.approvalWorksheet).toMatchObject({ state: "unapproved_template_only", approvalReference: null, freeMemberSourceIds: null });
    expect(result).not.toHaveProperty("inputSha256");
    expect(result).not.toHaveProperty("coverage");
  });

  it("initializes a new campaign without treating previous sign-ins or accepted invites as onboarding", () => {
    const data = inputs(); const before = structuredClone(data);
    const result = prepareMemberMigration(...data, options);
    expect(result.technicalReady).toBe(true);
    expect(result.rolloutAcceptance).toBe("not_assessed");
    expect(result.launchTracker.campaign).toMatchObject({ state: "not_started", startedAt: null });
    expect(result.launchTracker.members[0]).toMatchObject({ accountReady: true, accessReady: true, announcementDelivery: { state: "not_assessed", recordedAt: null }, firstSuccessfulCampaignSignInAt: null });
    expect(result.provisioningPlan.reviewCandidates).toEqual([]);
    expect(data).toEqual(before);
  });

  it("prepares only unlinked new Auth identities for review and retains every execution gate", () => {
    const data = inputs(); const app = data[1];
    app.members[0].user_id = app.invites[0].invited_user_id = null;
    app.invites[0].status = "pending"; app.authUsers = [];
    const result = prepareMemberMigration(...data, options);
    expect(result.technicalReady).toBe(false);
    expect(result.counts.provisioningReviewCandidates).toBe(1);
    expect(result.provisioningPlan.reviewCandidates[0]).toMatchObject({ reviewOnly: true, approvedForExecution: false });
    expect(result.provisioningPlan.reviewBatches).toEqual([{ reviewBatch: 1, reviewOnly: true, approvedForExecution: false, sourceMemberIds: ["source-1"], academyMemberIds: ["member-1"] }]);
    expect(result.provisioningPlan.executionGates.join(" ")).toContain("no member-ID filter");
    expect(result.provisioningPlan.executable).toBe(false);
  });

  it("bounds review batches at 50 without turning the batches into execution authorization", () => {
    const [source, app, cohort] = inputs();
    source.members = []; app.members = []; app.links = []; app.invites = []; app.authUsers = []; app.accessGrants = []; cohort.freeMemberExternalIds = [];
    for (let index = 1; index <= 51; index++) {
      source.members.push({ externalId: `source-${index}`, contactId: `contact-${index}`, email: `member-${index}@example.test`, status: "active", role: "member" });
      app.members.push({ id: `member-${index}`, academy_community_id: "community-1", user_id: null, role: "member", level: 1, status: "active" });
      app.links.push({ academy_community_id: "community-1", academy_member_id: `member-${index}`, external_provider: "highlevel", external_member_id: `source-${index}`, external_contact_id: `contact-${index}` });
      app.invites.push({ id: `invite-${index}`, academy_community_id: "community-1", academy_member_id: `member-${index}`, invited_user_id: null, email: `member-${index}@example.test`, status: "pending" });
      for (const [target, course_id] of [null, "course-1"].entries()) app.accessGrants.push({ id: `grant-${index}-${target}`, academy_community_id: "community-1", academy_member_id: `member-${index}`, course_id, status: "active", source_type: "import", starts_at: "2026-09-20T00:00:00Z", ends_at: null });
      cohort.freeMemberExternalIds.push(`source-${index}`);
    }
    const result = prepareMemberMigration(source, app, cohort, options);
    expect(result.counts.provisioningReviewCandidates).toBe(51);
    expect(result.provisioningPlan.reviewBatches.map(batch => batch.sourceMemberIds.length)).toEqual([50, 1]);
    expect(result.provisioningPlan.reviewBatches.every(batch => batch.reviewOnly && !batch.approvedForExecution)).toBe(true);
    expect(result.executable).toBe(false);
  });

  it.each([
    ["dangling Auth link", data => { data[1].members[0].user_id = data[1].invites[0].invited_user_id = "missing-user"; }],
    ["email identity already exists", data => { data[1].authUsers.push({ id: "existing", email: "one@example.test", email_confirmed_at: "2026-10-19T00:00:00Z", banned_until: null, deleted_at: null }); }],
    ["missing access", data => { data[1].accessGrants = []; }],
    ["historical invite linkage", data => { data[1].invites[0].status = "accepted"; }],
    ["restricted source member", data => { data[0].members[0].status = "cancelled"; }],
  ])("never proposes provisioning for %s", (_label, mutate) => {
    const data = inputs(); data[1].members[0].user_id = data[1].invites[0].invited_user_id = null; data[1].invites[0].status = "pending"; data[1].authUsers = [];
    mutate(data);
    expect(prepareMemberMigration(...data, options).provisioningPlan.reviewCandidates).toEqual([]);
  });

  it.each([
    ["partial roster", data => { data[0].coverage = "visible_member_inventory_only"; }],
    ["stale evidence", data => { data[0].capturedAt = "2026-10-06T01:48:38Z"; }],
    ["wrong exact group", data => { data[0].scope = { ...scope, groupId: "wrong" }; }],
    ["unapproved cohort", data => { data[2].approvedBy = ""; }],
  ])("rejects %s before generating member rows", (_label, mutate) => {
    const data = inputs(); mutate(data);
    expect(() => prepareMemberMigration(...data, options)).toThrow();
  });

  it("cannot widen freshness past 24 hours or accept a partial input set", () => {
    expect(() => prepareMemberMigration(...inputs(), { ...options, maxAgeHours: 168 })).toThrow("1-24");
    expect(() => prepareMemberMigration(inputs()[0], undefined, undefined, options)).toThrow("all three");
  });
});

describe("private preparation CLI", () => {
  const script = fileURLToPath(new URL("../prepare-member-migration.mjs", import.meta.url));
  const requiredArgs = ["--location-id", "location-1", "--group-id", "group-1", "--campaign-id", "migration-draft-1", "--report", "output/private/preparation.json"];
  it("saves blocked templates at 0600, returns non-ready, and refuses overwriting", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dirty-turf-preparation-"));
    try {
      const first = spawnSync(process.execPath, [script, ...requiredArgs], { cwd: directory, encoding: "utf8" });
      expect(first.status).toBe(1);
      expect(JSON.parse(first.stdout)).toMatchObject({ preparationState: "blocked_missing_inputs", technicalReadinessAssessed: false, executable: false, reportSaved: true });
      const report = path.join(directory, "output/private/preparation.json");
      expect((await stat(report)).mode & 0o077).toBe(0);
      const original = await readFile(report, "utf8");
      const repeat = spawnSync(process.execPath, [script, ...requiredArgs], { cwd: directory, encoding: "utf8" });
      expect(repeat.status).toBe(1);
      expect(await readFile(report, "utf8")).toBe(original);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("prints only counts, hashes inputs privately, and rejects public or malformed member evidence", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dirty-turf-preparation-"));
    try {
      const privateRoot = path.join(directory, "output/private"); await mkdir(privateRoot, { recursive: true, mode: 0o700 });
      const data = inputs(); const fresh = new Date(Date.now() - 1000).toISOString();
      data[0].capturedAt = data[1].capturedAt = data[1].sourceMapping.verifiedAt = fresh;
      const names = ["source", "app", "cohort"];
      for (let index = 0; index < names.length; index++) await writeFile(path.join(privateRoot, `${names[index]}.json`), JSON.stringify(data[index]), { mode: 0o600 });
      const args = [script, ...requiredArgs, "--roster", "output/private/source.json", "--app-snapshot", "output/private/app.json", "--cohort", "output/private/cohort.json"];
      const result = spawnSync(process.execPath, args, { cwd: directory, encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).not.toMatch(/one@example|source-1|member-1|actual-approved/);
      const saved = JSON.parse(await readFile(path.join(privateRoot, "preparation.json"), "utf8"));
      expect(saved.inputSha256.roster).toMatch(/^[a-f0-9]{64}$/);
      expect(saved.launchTracker.members[0].email).toBe("one@example.test");
      args[args.indexOf("--report") + 1] = "output/private/rejected.json";
      await chmod(path.join(privateRoot, "source.json"), 0o644);
      expect(spawnSync(process.execPath, args, { cwd: directory, encoding: "utf8" }).stderr).toContain("Migration input must be a private regular JSON file");
      await chmod(path.join(privateRoot, "source.json"), 0o600);
      await writeFile(path.join(privateRoot, "source.json"), '{"privateEmail":"secret@example.test", BAD');
      const bad = spawnSync(process.execPath, args, { cwd: directory, encoding: "utf8" });
      expect(bad.stderr).toBe("Invalid local JSON input\n");
      expect(bad.stdout + bad.stderr).not.toContain("secret@example.test");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("rejects mutation flags, partial evidence, duplicate flags and archival freshness", () => {
    for (const extra of [["--send", "true"], ["--roster", "source"], ["--group-id", "again"], ["--max-age-hours", "168"]]) {
      expect(() => parseMemberPreparationArgs([...requiredArgs, ...extra])).toThrow("Required:");
    }
  });
});
