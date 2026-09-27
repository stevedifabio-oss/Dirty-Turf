import { readFile, realpath, mkdir, open, link, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { captureGhlCourses } from "./lib/ghl-course-reader.mjs";

export async function writePrivateSnapshot(file, snapshot, cwd = process.cwd()) {
  const root = path.resolve(cwd, "output/private");
  await mkdir(root, { recursive: true, mode: 0o700 });
  if (await realpath(root) !== path.join(await realpath(cwd), "output/private")) {
    throw new Error("Private output directory must not use symlinks");
  }
  const destination = path.resolve(cwd, file);
  if (path.dirname(destination) !== root || path.basename(destination).startsWith(".") || !destination.endsWith(".json")) {
    throw new Error("Output must be a new JSON file directly inside output/private");
  }
  const temporary = path.join(root, `.ghl-capture-${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(snapshot, null, 2) + "\n");
    await handle.sync();
    await handle.close();
    // Atomic publication without replacing any previous capture, even in a race.
    await link(temporary, destination);
  } finally {
    await handle.close();
    await unlink(temporary).catch(() => {});
  }
}

async function main() {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!["--env-file", "--manifest", "--output"].includes(args[i]) || !args[i + 1] || options[args[i]]) {
      throw new Error("Usage: node scripts/capture-ghl-courses.mjs --env-file <file> --manifest <import.json> --output output/private/<new-capture.json>");
    }
    options[args[i]] = args[i + 1];
  }
  if (Object.keys(options).length !== 3) throw new Error("Required: --env-file, --manifest, --output");
  const values = {};
  for (const line of (await readFile(options["--env-file"], "utf8")).split(/\r?\n/)) {
    const match = line.match(/^\s*(GHL_LOCATION_ID|GHL_PRIVATE_INTEGRATION_TOKEN)\s*=\s*(.*?)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  const manifest = JSON.parse(await readFile(options["--manifest"], "utf8"));
  const snapshot = await captureGhlCourses({
    token: values.GHL_PRIVATE_INTEGRATION_TOKEN, locationId: values.GHL_LOCATION_ID, manifest,
  });
  await writePrivateSnapshot(options["--output"], snapshot);
  console.log(JSON.stringify({ captured: snapshot.counts, applied: false }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // Parser/filesystem exceptions can include private paths or content; keep CLI failures scoped.
    console.error(error instanceof SyntaxError ? "Invalid local JSON input" :
      error?.code ? `Local file operation failed (${error.code})` : error.message);
    process.exitCode = 1;
  });
}
