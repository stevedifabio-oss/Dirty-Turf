import { readFile, stat, lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writePrivateSnapshot } from "./capture-ghl-courses.mjs";

const id = value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
const uuid = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const usage = "Required: --action begin|renew|fail|apply|status --receipt output/private/<new-receipt.json>; begin uses --capture-id; apply uses --capture and --lease; renew/fail use --lease. Credentials come from GHL_COMMUNITY_SYNC_SECRET and SUPABASE_URL environment variables.";

export function parseCommunitySnapshotArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!["--action", "--capture-id", "--capture", "--lease", "--lease-seconds", "--error-code", "--receipt"].includes(args[index]) ||
        !args[index + 1] || Object.hasOwn(result, args[index])) throw new Error(usage);
    result[args[index]] = args[index + 1];
  }
  if (!["begin", "renew", "fail", "apply", "status"].includes(result["--action"]) || !result["--receipt"]) throw new Error(usage);
  const permitted = { begin: ["--capture-id", "--lease-seconds"], renew: ["--lease", "--lease-seconds"], fail: ["--lease", "--error-code"], apply: ["--capture", "--lease"], status: ["--capture-id"] }[result["--action"]];
  if (Object.keys(result).some(key => !["--action", "--receipt", ...permitted].includes(key))) throw new Error(usage);
  if (result["--capture-id"] !== undefined && !id(result["--capture-id"])) throw new Error("Invalid capture ID");
  if (result["--action"] === "begin" && !result["--capture-id"]) throw new Error(usage);
  if (["renew", "fail", "apply"].includes(result["--action"]) && !result["--lease"]) throw new Error(usage);
  if (result["--action"] === "apply" && !result["--capture"]) throw new Error(usage);
  if (result["--lease-seconds"] !== undefined && (!/^\d+$/.test(result["--lease-seconds"]) || Number(result["--lease-seconds"]) < 60 || Number(result["--lease-seconds"]) > 3600)) throw new Error("Lease duration must be 60-3600 seconds");
  if (result["--action"] === "fail" && !/^[a-z0-9_]{1,120}$/.test(result["--error-code"] ?? "")) throw new Error("A safe failure code is required");
  return result;
}

async function readPrivateJson(file) {
  const info = await stat(file);
  if (!info.isFile() || (info.mode & 0o077) !== 0 || info.size > 2 * 1024 * 1024) throw new Error("Input must be a private JSON file of at most 2 MiB");
  return JSON.parse(await readFile(file, "utf8"));
}

export async function preflightCommunitySnapshotReceipt(file, cwd = process.cwd()) {
  const root = path.resolve(cwd, "output/private"), destination = path.resolve(cwd, file);
  if (path.dirname(destination) !== root || path.basename(destination).startsWith(".") || !destination.endsWith(".json")) throw new Error("Receipt must be a new JSON file directly inside output/private");
  await mkdir(root, { recursive: true, mode: 0o700 });
  if (await realpath(root) !== path.join(await realpath(cwd), "output/private")) throw new Error("Receipt directory must not use symlinks");
  try { await lstat(destination); throw new Error("Receipt file already exists; select a new private receipt name"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}

export async function buildCommunitySnapshotRequest(options, readJson = readPrivateJson) {
  const action = options["--action"], payload = {};
  if (options["--capture-id"]) payload.captureId = options["--capture-id"];
  if (options["--lease-seconds"]) payload.leaseSeconds = Number(options["--lease-seconds"]);
  if (options["--lease"]) {
    const lease = await readJson(options["--lease"]);
    if (lease.schemaVersion !== 1 || lease.action !== "begin" || !id(lease.captureId) || lease.result?.status !== "capturing" || !uuid(lease.result.leaseToken)) throw new Error("Invalid local lease receipt");
    payload.leaseToken = lease.result.leaseToken;
    if (action !== "apply") payload.captureId = lease.captureId;
    if (action === "apply") {
      payload.capture = await readJson(options["--capture"]);
      if (payload.capture?.captureId !== lease.captureId || payload.capture?.scope?.locationId !== lease.result.scope?.locationId || payload.capture?.scope?.groupId !== lease.result.scope?.groupId) throw new Error("Capture does not match the authorized lease scope");
    }
  }
  if (action === "fail") payload.errorCode = options["--error-code"];
  return payload;
}

export async function requestCommunitySnapshot(action, payload, env = process.env, fetcher = fetch) {
  const base = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL;
  let url;
  try { url = new URL(base); } catch { throw new Error("SUPABASE_URL is required"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !/^[a-z0-9]+\.supabase\.co$/.test(url.hostname) || (url.port && url.port !== "443") || !["", "/"].includes(url.pathname)) throw new Error("SUPABASE_URL must be the trusted project's HTTPS URL");
  if (typeof env.GHL_COMMUNITY_SYNC_SECRET !== "string" || !env.GHL_COMMUNITY_SYNC_SECRET.trim()) throw new Error("GHL_COMMUNITY_SYNC_SECRET is required in the private server environment");
  if (!["begin", "renew", "fail", "apply", "status"].includes(action)) throw new Error("Invalid snapshot action");
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body) > 2 * 1024 * 1024) throw new Error("Snapshot exceeds 2 MiB");
  const response = await fetcher(new URL(`/functions/v1/academy-community-sync/snapshot/${action}`, url), {
    method: "POST", headers: { "content-type": "application/json", "x-community-sync-secret": env.GHL_COMMUNITY_SYNC_SECRET },
    body, signal: AbortSignal.timeout(120_000), redirect: "error",
  });
  let result;
  try { result = await response.json(); } catch { throw new Error("Snapshot endpoint returned invalid JSON"); }
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Snapshot endpoint returned an invalid receipt");
  return { httpStatus: response.status, ok: response.ok, result };
}

export async function syncCommunitySnapshot(options, dependencies = {}) {
  // Validate durable receipt storage before any remote lease or content mutation.
  await (dependencies.preflightReceipt ?? preflightCommunitySnapshotReceipt)(options["--receipt"]);
  const payload = await buildCommunitySnapshotRequest(options, dependencies.readJson ?? readPrivateJson);
  const response = await requestCommunitySnapshot(options["--action"], payload, dependencies.env ?? process.env, dependencies.fetcher ?? fetch);
  const receipt = { schemaVersion: 1, action: options["--action"], ...(payload.captureId || payload.capture?.captureId ? { captureId: payload.captureId ?? payload.capture.captureId } : {}), receivedAt: new Date().toISOString(), httpStatus: response.httpStatus, result: response.result };
  await (dependencies.writeReceipt ?? writePrivateSnapshot)(options["--receipt"], receipt);
  return { action: options["--action"], httpStatus: response.httpStatus, status: response.result.status ?? (response.ok ? "accepted" : "failed"), receiptSaved: true, ok: response.ok };
}

async function main() {
  const result = await syncCommunitySnapshot(parseCommunitySnapshotArgs(process.argv.slice(2)));
  console.log(JSON.stringify({ action: result.action, httpStatus: result.httpStatus, status: result.status, receiptSaved: true }));
  if (!result.ok) process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    // Never print provider exceptions, response bodies, input contents, or credentials.
    console.error(error instanceof SyntaxError ? "Invalid local JSON input" : error?.code ? "Private file operation failed" :
      /^(Required:|Invalid capture ID|Lease duration|A safe failure code|Input must|Invalid local lease receipt|Capture does not|SUPABASE_URL|GHL_COMMUNITY_SYNC_SECRET|Invalid snapshot action|Snapshot exceeds|Snapshot endpoint|Receipt must|Receipt directory|Receipt file)/.test(error?.message ?? "") ? error.message : "Community snapshot request failed");
    process.exitCode = 1;
  });
}
