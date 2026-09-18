import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildAcademyImportBatches } from "./lib/academy-import-batches.mjs";

const input = path.resolve(process.argv[2] ?? "output/private/dirty-turf-academy-import.json");
const outputDirectory = path.resolve(process.argv[3] ?? "output/private/academy-import-batches");
const manifest = JSON.parse(await readFile(input, "utf8"));
const batches = buildAcademyImportBatches(manifest);
await mkdir(outputDirectory, { recursive: true });
await Promise.all(batches.map(({ label, manifest: batch }, index) => writeFile(
  path.join(outputDirectory, `${String(index + 1).padStart(2, "0")}-${label}.json`),
  `${JSON.stringify(batch, null, 2)}\n`,
  { mode: 0o600 },
)));
console.log(JSON.stringify({ input, outputDirectory, batches: batches.length, labels: batches.map((batch) => batch.label) }, null, 2));
