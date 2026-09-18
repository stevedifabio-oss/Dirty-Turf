import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { composeAcademyImport } from "./lib/academy-import.mjs";

const defaults = {
  course: "output/private/ghl-course-import.json",
  community: "output/private/ghl-community-import.json",
  contacts: "output/private/ghl-contact-reconciliation.json",
  output: "output/private/dirty-turf-academy-import.json",
  report: "output/private/dirty-turf-academy-import.report.json",
};

function parseArgs(argv) {
  const options = { ...defaults };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--course") options.course = argv[++index];
    else if (key === "--community") options.community = argv[++index];
    else if (key === "--contacts") options.contacts = argv[++index];
    else if (key === "--output") options.output = argv[++index];
    else if (key === "--report") options.report = argv[++index];
    else throw new Error(`Unknown option: ${key}`);
  }
  return options;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(path.resolve(filePath), "utf8"));
}

const options = parseArgs(process.argv.slice(2));
const [courseArchive, communityArchive, contactReconciliation] = await Promise.all([
  readJson(options.course),
  readJson(options.community),
  readJson(options.contacts),
]);
const { manifest, report } = composeAcademyImport({ courseArchive, communityArchive, contactReconciliation });
const manifestSource = `${JSON.stringify(manifest, null, 2)}\n`;
const reportSource = `${JSON.stringify(report, null, 2)}\n`;
const outputPath = path.resolve(options.output);
const reportPath = path.resolve(options.report);
await Promise.all([mkdir(path.dirname(outputPath), { recursive: true }), mkdir(path.dirname(reportPath), { recursive: true })]);
await Promise.all([
  writeFile(outputPath, manifestSource, { mode: 0o600 }),
  writeFile(reportPath, reportSource, { mode: 0o600 }),
]);
console.log(JSON.stringify({
  readyForDryRun: report.readyForDryRun,
  ownerOrganizationIdPresent: report.ownerOrganizationIdPresent,
  counts: report.counts,
  reconciliation: report.reconciliation,
  errors: report.errors.length,
  warnings: report.warnings.length,
  output: outputPath,
  report: reportPath,
  sha256: createHash("sha256").update(manifestSource).digest("hex"),
}, null, 2));
if (!report.readyForDryRun) process.exitCode = 2;
