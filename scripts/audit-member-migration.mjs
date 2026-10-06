import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writePrivateSnapshot } from "./capture-ghl-courses.mjs";
import { preflightCommunitySnapshotReceipt } from "./sync-community-snapshot.mjs";
import { auditMemberMigration } from "./lib/member-migration-readiness.mjs";

const usage = "Required: --roster <private.json> --app-snapshot <private.json> --cohort <private.json> --location-id <id> --group-id <id> --report output/private/<new-report.json> [--max-age-hours 1-168]";

export function parseMemberMigrationArgs(args) {
  const options = {};
  const required = ["--roster", "--app-snapshot", "--cohort", "--location-id", "--group-id", "--report"];
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (![...required, "--max-age-hours"].includes(key) || !args[index + 1] || Object.hasOwn(options, key)) throw new Error(usage);
    options[key] = args[index + 1];
  }
  if (required.some(key => !options[key])) throw new Error(usage);
  if (options["--max-age-hours"] !== undefined && (!/^\d+$/.test(options["--max-age-hours"]) || Number(options["--max-age-hours"]) < 1 || Number(options["--max-age-hours"]) > 168)) throw new Error(usage);
  return options;
}

export async function readPrivateMigrationJson(file) {
  const info = await lstat(file);
  if (!info.isFile() || (info.mode & 0o077) !== 0 || info.size > 8 * 1024 * 1024) throw new Error("Migration input must be a private regular JSON file of at most 8 MiB");
  const body = await readFile(file, "utf8");
  return { value: JSON.parse(body), sha256: createHash("sha256").update(body).digest("hex") };
}

export async function runMemberMigrationAudit(options, dependencies = {}) {
  await (dependencies.preflightReport ?? preflightCommunitySnapshotReceipt)(options["--report"]);
  const inputs = await Promise.all(["--roster", "--app-snapshot", "--cohort"].map(key => (dependencies.readJson ?? readPrivateMigrationJson)(options[key])));
  const report = auditMemberMigration(...inputs.map(input => input.value), {
    scope: { locationId: options["--location-id"], groupId: options["--group-id"] },
    maxAgeHours: options["--max-age-hours"] ? Number(options["--max-age-hours"]) : 24,
    ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
  });
  report.inputSha256 = { roster: inputs[0].sha256, appSnapshot: inputs[1].sha256, cohort: inputs[2].sha256 };
  await (dependencies.writeReport ?? writePrivateSnapshot)(options["--report"], report);
  // Source IDs, email addresses and row-level exceptions are only in the private report.
  return { technicalReady: report.technicalReady, rolloutAcceptance: report.rolloutAcceptance, readOnly: true, counts: report.counts, reasonCounts: report.reasonCounts, reportSaved: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Promise.resolve().then(() => runMemberMigrationAudit(parseMemberMigrationArgs(process.argv.slice(2)))).then(result => {
    console.log(JSON.stringify(result, null, 2));
    if (!result.technicalReady) process.exitCode = 1;
  }).catch(error => {
    // Native parser/filesystem errors can contain private input. Never print them.
    console.error(error instanceof SyntaxError ? "Invalid local JSON input" : error?.code ? "Private file operation failed" :
      /^(Required:|Migration input|Receipt must|Receipt directory|Receipt file|Audit time|An explicit|Source roster|App snapshot|Approved cohort|Source and app|Source members|An empty source|App members|App member links|App invites|Auth identities|App courses|An included Academy|App access grants|App billing)/.test(error?.message ?? "") ? error.message : "Member migration audit failed");
    process.exitCode = 1;
  });
}
