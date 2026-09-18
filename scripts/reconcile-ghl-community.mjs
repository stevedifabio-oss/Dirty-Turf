import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const defaults = {
  input: "output/private/ghl-community-import.json",
  output: "output/private/ghl-contact-reconciliation.json",
  env: ".env.supabase",
  concurrency: 4,
};

function parseArgs(argv) {
  const options = { ...defaults };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--input") options.input = argv[++index];
    else if (key === "--output") options.output = argv[++index];
    else if (key === "--env-file") options.env = argv[++index];
    else if (key === "--concurrency") options.concurrency = Number(argv[++index]);
    else throw new Error(`Unknown option: ${key}`);
  }
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 8) {
    throw new Error("--concurrency must be an integer from 1 to 8");
  }
  return options;
}

function parseEnv(source) {
  const values = {};
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

async function fetchContact(contactId, token, locationId) {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(`https://services.leadconnectorhq.com/contacts/${encodeURIComponent(contactId)}`, {
        headers: { Authorization: `Bearer ${token}`, Version: "v3", Accept: "application/json" },
        signal: controller.signal,
      });
      lastStatus = response.status;
      if (response.ok) {
        const payload = await response.json();
        const contact = payload.contact ?? payload;
        if (contact.locationId && contact.locationId !== locationId) throw new Error("location-mismatch");
        return {
          sourceId: contactId,
          locationId: contact.locationId ?? locationId,
          email: String(contact.email ?? "").trim().toLowerCase() || undefined,
          firstName: contact.firstName || undefined,
          lastName: contact.lastName || undefined,
          name: contact.name || undefined,
          companyName: contact.companyName || undefined,
          city: contact.city || undefined,
          state: contact.state || undefined,
          country: contact.country || undefined,
          postalCode: contact.postalCode || undefined,
          dateAdded: contact.dateAdded || undefined,
          dateUpdated: contact.dateUpdated || undefined,
        };
      }
      if (response.status !== 429 && response.status < 500) break;
    } catch (error) {
      if (error instanceof Error && error.message === "location-mismatch") throw error;
      lastStatus = error instanceof Error && error.name === "AbortError" ? 408 : lastStatus;
    } finally {
      clearTimeout(timeout);
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
  }
  throw new Error(`request-failed-${lastStatus || "network"}`);
}

async function mapConcurrent(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

const options = parseArgs(process.argv.slice(2));
const [archiveSource, envSource] = await Promise.all([
  readFile(path.resolve(options.input), "utf8"),
  readFile(path.resolve(options.env), "utf8").catch(() => ""),
]);
const archive = JSON.parse(archiveSource);
const fileEnv = parseEnv(envSource);
const locationId = process.env.GHL_LOCATION_ID || fileEnv.GHL_LOCATION_ID || archive?.source?.locationId;
const token = process.env.GHL_PRIVATE_INTEGRATION_TOKEN || process.env.GHL_API_TOKEN || fileEnv.GHL_PRIVATE_INTEGRATION_TOKEN || fileEnv.GHL_API_TOKEN;
if (!locationId || !token) throw new Error("GHL_LOCATION_ID and GHL_PRIVATE_INTEGRATION_TOKEN are required in the environment or env file");
if (archive?.source?.locationId && archive.source.locationId !== locationId) throw new Error("The archive and configured HighLevel location do not match");

const contactIds = [...new Set((archive.members ?? []).map((member) => String(member.sourceId ?? "").trim()).filter(Boolean))];
const failures = [];
const results = await mapConcurrent(contactIds, options.concurrency, async (contactId) => {
  try {
    return await fetchContact(contactId, token, locationId);
  } catch (error) {
    failures.push({ sourceId: contactId, reason: error instanceof Error ? error.message : "unknown-error" });
    return undefined;
  }
});
const contacts = results.filter(Boolean);
const output = {
  schemaVersion: "dirty-turf-ghl-contact-reconciliation-v1",
  capturedAt: new Date().toISOString(),
  locationId,
  sourceArchiveSha256: createHash("sha256").update(archiveSource).digest("hex"),
  requestedCount: contactIds.length,
  contacts,
  failures,
};
const outputSource = `${JSON.stringify(output, null, 2)}\n`;
const outputPath = path.resolve(options.output);
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, outputSource, { mode: 0o600 });
console.log(JSON.stringify({
  requested: contactIds.length,
  resolved: contacts.length,
  withEmail: contacts.filter((contact) => contact.email).length,
  failed: failures.length,
  output: outputPath,
  sha256: createHash("sha256").update(outputSource).digest("hex"),
}, null, 2));
if (failures.length) process.exitCode = 2;
