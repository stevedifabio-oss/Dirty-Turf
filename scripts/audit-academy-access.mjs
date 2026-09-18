import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { auditAcademyAccess } from "./lib/academy-access-audit.mjs";

const options = parseArgs(process.argv.slice(2));
const manifestPath = path.resolve(options.manifest);
const source = await readFile(manifestPath, "utf8");
const manifest = JSON.parse(source);
const audit = auditAcademyAccess(manifest, {
  members: options.expectMembers,
  enrolled: options.expectEnrolled,
});

console.log(JSON.stringify({
  ...audit,
  file: manifestPath,
  sha256: createHash("sha256").update(source).digest("hex"),
}, null, 2));

if (!audit.valid || !audit.allEnrolledCanLogin) process.exitCode = 1;

function parseArgs(args) {
  const values = {
    manifest: "output/private/dirty-turf-academy-import.json",
    expectMembers: undefined,
    expectEnrolled: undefined,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--manifest") values.manifest = args[++index];
    else if (argument === "--expect-members") values.expectMembers = positiveInteger(args[++index], argument);
    else if (argument === "--expect-enrolled") values.expectEnrolled = positiveInteger(args[++index], argument);
    else throw new Error(`Unknown option: ${argument}`);
  }
  return values;
}

function positiveInteger(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} requires a positive integer`);
  return parsed;
}
