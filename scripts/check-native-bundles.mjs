import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const options = parseArgs(process.argv.slice(2));
const files = [
  ["web build", resolve(root, "dist/index.html")],
  ["Android source", resolve(root, "android/app/src/main/assets/public/index.html")],
  ["iOS source", resolve(root, "ios/App/App/public/index.html")],
];

const results = files.map(([label, path]) => ({ label, path, sha256: hashFile(path) }));
const expectedHash = results[0].sha256;
const mismatches = results.filter(({ sha256 }) => sha256 !== expectedHash);

const androidArtifacts = [
  [
    "Android debug APK",
    resolve(root, "android/app/build/outputs/apk/debug/app-debug.apk"),
    "assets/public/index.html",
  ],
  [
    "Android release AAB",
    resolve(root, "android/app/build/outputs/bundle/release/app-release.aab"),
    "base/assets/public/index.html",
  ],
];

for (const [label, path, member] of androidArtifacts) {
  if (!existsSync(path)) {
    if (options.requireAndroidArtifacts) {
      throw new Error(`${label} is missing at ${path}`);
    }
    continue;
  }

  const sha256 = hashArchiveMember(path, member);
  const result = { label, path: `${path}:${member}`, sha256 };
  results.push(result);
  if (sha256 !== expectedHash) mismatches.push(result);
}

if (options.iosApp) {
  const path = resolve(options.iosApp, "public/index.html");
  const result = { label: "built iOS app", path, sha256: hashFile(path) };
  results.push(result);
  if (result.sha256 !== expectedHash) mismatches.push(result);
}

console.log(JSON.stringify({ valid: mismatches.length === 0, expectedHash, bundles: results }, null, 2));

if (mismatches.length > 0) {
  throw new Error(`Native bundle mismatch: ${mismatches.map(({ label }) => label).join(", ")}`);
}

function hashFile(path) {
  if (!existsSync(path)) throw new Error(`Required native bundle file is missing: ${path}`);
  return sha256(readFileSync(path));
}

function hashArchiveMember(path, member) {
  let contents;
  try {
    contents = execFileSync("unzip", ["-p", path, member], { encoding: "buffer" });
  } catch (error) {
    throw new Error(`Could not read ${member} from ${path}: ${error.message}`);
  }
  if (contents.length === 0) throw new Error(`${member} is empty or missing in ${path}`);
  return sha256(contents);
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function parseArgs(args) {
  const values = { iosApp: undefined, requireAndroidArtifacts: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--ios-app") values.iosApp = requiredValue(args[++index], argument);
    else if (argument === "--require-android-artifacts") values.requireAndroidArtifacts = true;
    else throw new Error(`Unknown option: ${argument}`);
  }
  return values;
}

function requiredValue(value, label) {
  if (!value || value.startsWith("--")) throw new Error(`${label} requires a value`);
  return value;
}
