import { spawn } from "node:child_process";

const options = parseArgs(process.argv.slice(2));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const steps = [
  [process.execPath, ["scripts/validate-academy-import.mjs", "output/private/dirty-turf-academy-import.json"]],
  [npm, ["run", "academy:access-audit"]],
  [npm, ["run", "check"]],
];

if (!options.skipNative) steps.push([npm, ["run", "native:copy"]]);
if (options.deployUrl) {
  steps.push([process.execPath, [
    "scripts/release-smoke.mjs",
    options.deployUrl,
    "--expected-origin",
    options.expectedOrigin,
    "--expect-security-headers",
  ]]);
}
if (options.checkDomain) {
  steps.push([process.execPath, ["scripts/check-domain-readiness.mjs"]]);
  steps.push([process.execPath, [
    "scripts/release-smoke.mjs",
    options.expectedOrigin,
    "--expected-origin",
    options.expectedOrigin,
    "--expect-security-headers",
  ]]);
}

for (const [command, args] of steps) await run(command, args);
console.log(`Release preflight passed ${steps.length} step${steps.length === 1 ? "" : "s"}.`);

function run(command, args) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: process.env });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}`));
    });
  });
}

function parseArgs(args) {
  const values = {
    deployUrl: undefined,
    expectedOrigin: "https://app.dirtyturf.com",
    checkDomain: false,
    skipNative: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--deploy") values.deployUrl = requiredValue(args[++index], argument);
    else if (argument === "--expected-origin") values.expectedOrigin = requiredValue(args[++index], argument);
    else if (argument === "--check-domain") values.checkDomain = true;
    else if (argument === "--skip-native") values.skipNative = true;
    else throw new Error(`Unknown option: ${argument}`);
  }
  return values;
}

function requiredValue(value, label) {
  if (!value || value.startsWith("--")) throw new Error(`${label} requires a value`);
  return value;
}
