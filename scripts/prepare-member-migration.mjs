import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPrivateMigrationJson } from "./audit-member-migration.mjs";
import { writePrivateSnapshot } from "./capture-ghl-courses.mjs";
import { preflightCommunitySnapshotReceipt } from "./sync-community-snapshot.mjs";
import { prepareMemberMigration } from "./lib/member-migration-preparation.mjs";

const usage = "Required: --location-id <id> --group-id <id> --campaign-id <draft-reference> --report output/private/<new-preparation.json> [--roster <private.json> --app-snapshot <private.json> --cohort <private.json>] [--max-age-hours 1-24]. Omit all three inputs for blocked templates only. No live actions are performed.";

export function parseMemberPreparationArgs(args) {
  const options = {};
  const required = ["--location-id", "--group-id", "--campaign-id", "--report"];
  const inputs = ["--roster", "--app-snapshot", "--cohort"];
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (![...required, ...inputs, "--max-age-hours"].includes(key) || !args[index + 1] || Object.hasOwn(options, key)) throw new Error(usage);
    options[key] = args[index + 1];
  }
  const supplied = inputs.filter(key => options[key]).length;
  if (required.some(key => !options[key]) || (supplied !== 0 && supplied !== 3)) throw new Error(usage);
  if (options["--max-age-hours"] !== undefined && (!/^\d+$/.test(options["--max-age-hours"]) || Number(options["--max-age-hours"]) < 1 || Number(options["--max-age-hours"]) > 24)) throw new Error(usage);
  return options;
}

export async function runMemberPreparation(options, dependencies = {}) {
  await (dependencies.preflightReport ?? preflightCommunitySnapshotReceipt)(options["--report"]);
  const inputs = options["--roster"] ? await Promise.all(["--roster", "--app-snapshot", "--cohort"].map(key => (dependencies.readJson ?? readPrivateMigrationJson)(options[key]))) : [];
  const report = prepareMemberMigration(inputs[0]?.value, inputs[1]?.value, inputs[2]?.value, {
    scope: { locationId: options["--location-id"], groupId: options["--group-id"] },
    campaignId: options["--campaign-id"],
    maxAgeHours: options["--max-age-hours"] ? Number(options["--max-age-hours"]) : 24,
    ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
  });
  if (inputs.length) report.inputSha256 = { roster: inputs[0].sha256, appSnapshot: inputs[1].sha256, cohort: inputs[2].sha256 };
  await (dependencies.writeReport ?? writePrivateSnapshot)(options["--report"], report);
  // The private package contains identities. Console output deliberately contains none.
  return { preparationState: report.preparationState, technicalReadinessAssessed: report.technicalReadinessAssessed, technicalReady: report.technicalReady, rolloutAcceptance: report.rolloutAcceptance, readOnly: true, executable: false, counts: report.counts, ...(report.reasonCounts ? { reasonCounts: report.reasonCounts } : {}), reportSaved: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Promise.resolve().then(() => runMemberPreparation(parseMemberPreparationArgs(process.argv.slice(2)))).then(result => {
    console.log(JSON.stringify(result, null, 2));
    if (!result.technicalReady) process.exitCode = 1;
  }).catch(error => {
    // Validation/parser errors can contain private input. Never print arbitrary exceptions.
    console.error(error instanceof SyntaxError ? "Invalid local JSON input" : error?.code ? "Private file operation failed" :
      /^(Required:|Preparation requires|Migration input must|Receipt must|Receipt directory|Receipt file)/.test(error?.message ?? "") ? error.message : "Member preparation evidence failed validation; refresh and review the required private inputs");
    process.exitCode = 1;
  });
}
