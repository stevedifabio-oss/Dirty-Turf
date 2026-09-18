import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const manifest = JSON.parse(await readFile(path.join(dist, "vite-manifest.json"), "utf8"));
const serviceWorker = await readFile(path.join(dist, "sw.js"), "utf8");
const builtHtml = await readFile(path.join(dist, "index.html"), "utf8");
const failures = [];

const requiredEntries = [
  "index.html",
  "src/components/MapMeasurement.tsx",
  "src/components/Network.tsx",
];
for (const entry of requiredEntries) {
  if (!manifest[entry]) failures.push(`Vite manifest is missing ${entry}`);
}
for (const coreView of ["Academy", "Community", "Events"]) {
  if ((manifest["index.html"]?.dynamicImports ?? []).some((entry) => entry.includes(`/components/${coreView}.tsx`))) {
    failures.push(`${coreView} must remain in the offline startup bundle`);
  }
}

const files = new Set();
for (const entry of Object.values(manifest)) {
  for (const file of [entry.file, ...(entry.css ?? []), ...(entry.assets ?? [])]) {
    if (file) files.add(file);
  }
}
for (const file of files) {
  if (path.isAbsolute(file) || file.split("/").includes("..")) {
    failures.push(`Unsafe PWA asset path: ${file}`);
    continue;
  }
  try {
    await access(path.join(dist, file));
  } catch {
    failures.push(`PWA asset does not exist: ${file}`);
  }
}

if (!serviceWorker.includes('const MANIFEST_URL = "/vite-manifest.json";')) {
  failures.push("Service worker does not load the Vite asset manifest");
}
if (!serviceWorker.includes('const CACHE_NAME = "dirty-turf-shell-v2";')) {
  failures.push("Service worker cache version was not updated");
}
if (!serviceWorker.includes('event.data?.type === "PRECACHE_APP"')) {
  failures.push("Service worker cannot refresh the complete app cache after activation");
}
if (!builtHtml.includes('document.querySelector(".launch-gate")')) {
  failures.push("Startup watchdog does not recognize the authentication gate as a mounted app");
}

if (failures.length) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`PWA offline manifest covers ${files.size} production assets across ${Object.keys(manifest).length} entries.`);
