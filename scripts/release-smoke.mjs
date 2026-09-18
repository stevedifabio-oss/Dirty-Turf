import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  inspectAppHtml,
  inspectManifest,
  inspectPublicPages,
  inspectSecurityHeaders,
  normalizeOrigin,
} from "./lib/release-readiness.mjs";

const options = parseArgs(process.argv.slice(2));
const baseUrl = new URL(options.baseUrl);
const expectedOrigin = normalizeOrigin(options.expectedOrigin ?? baseUrl.origin);
const failures = [];
const checks = [];

const pages = [
  ["/", "Dirty Turf Academy", "text/html"],
  ["/privacy.html", "Privacy policy", "text/html"],
  ["/support.html", "Academy support", "text/html"],
  ["/delete-account.html", "Delete your account", "text/html"],
  ["/manifest.webmanifest", "Dirty Turf Academy", "application/manifest+json"],
  ["/sw.js", "CACHE_NAME", "javascript"],
];

const responses = new Map();
for (const [pathname, marker, contentType] of pages) {
  try {
    const result = await request(pathname);
    responses.set(pathname, result);
    if (result.response.status !== 200) failures.push(`${pathname} returned ${result.response.status}`);
    if (!result.body.includes(marker)) failures.push(`${pathname} is missing ${marker}`);
    if (!result.response.headers.get("content-type")?.includes(contentType)) {
      failures.push(`${pathname} returned the wrong content type`);
    }
    checks.push({ path: pathname, status: result.response.status, finalUrl: result.response.url });
  } catch (error) {
    failures.push(`${pathname} could not be loaded: ${message(error)}`);
    checks.push({ path: pathname, status: null, error: message(error) });
  }
}

const root = responses.get("/");
if (root?.response.ok) failures.push(...inspectAppHtml(root.body, expectedOrigin).failures);

const manifestResponse = responses.get("/manifest.webmanifest");
if (manifestResponse?.response.ok) {
  try {
    failures.push(...inspectManifest(JSON.parse(manifestResponse.body)).failures);
  } catch (error) {
    failures.push(`Manifest is not valid JSON: ${message(error)}`);
  }
}

const privacy = responses.get("/privacy.html");
const support = responses.get("/support.html");
const deletion = responses.get("/delete-account.html");
if (privacy?.response.ok && support?.response.ok && deletion?.response.ok) {
  failures.push(...inspectPublicPages({
    privacy: privacy.body,
    support: support.body,
    deletion: deletion.body,
  }).failures);
}

try {
  const fallback = await request(`/release-smoke-${Date.now()}`);
  if (fallback.response.status !== 200 || !fallback.body.includes("Dirty Turf Academy")) {
    failures.push("SPA fallback did not return the app shell");
  }
  checks.push({ path: "SPA fallback", status: fallback.response.status, finalUrl: fallback.response.url });
} catch (error) {
  failures.push(`SPA fallback could not be loaded: ${message(error)}`);
}

if (options.expectSecurityHeaders && root?.response.ok) {
  failures.push(...inspectSecurityHeaders(root.response.headers).failures);
}

if (baseUrl.protocol === "https:") {
  try {
    const redirected = await fetch(new URL(baseUrl.href.replace(/^https:/, "http:")), {
      redirect: "follow",
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    if (new URL(redirected.url).protocol !== "https:") failures.push("HTTP did not redirect to HTTPS");
    checks.push({ path: "HTTP redirect", status: redirected.status, finalUrl: redirected.url });
  } catch (error) {
    failures.push(`HTTP redirect could not be verified: ${message(error)}`);
  }
}

const report = {
  checkedAt: new Date().toISOString(),
  baseUrl: baseUrl.origin,
  expectedOrigin,
  checks,
  secureHeaders: options.expectSecurityHeaders,
  passed: failures.length === 0,
  failures,
};

if (options.report) {
  const reportPath = path.resolve(options.report);
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;

async function request(pathname) {
  const response = await fetch(new URL(pathname, baseUrl), {
    redirect: "follow",
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  return { response, body: await response.text() };
}

function parseArgs(args) {
  const values = {
    baseUrl: process.env.APP_URL || "http://127.0.0.1:4173",
    expectedOrigin: process.env.EXPECTED_APP_ORIGIN,
    expectSecurityHeaders: false,
    report: undefined,
    timeoutMs: 15_000,
  };
  let positionalUrlSeen = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--expect-security-headers") values.expectSecurityHeaders = true;
    else if (argument === "--expected-origin") values.expectedOrigin = requiredValue(args[++index], argument);
    else if (argument === "--report") values.report = requiredValue(args[++index], argument);
    else if (argument === "--timeout-ms") values.timeoutMs = positiveInteger(args[++index], argument);
    else if (argument.startsWith("--")) throw new Error(`Unknown option: ${argument}`);
    else if (!positionalUrlSeen) {
      values.baseUrl = argument;
      positionalUrlSeen = true;
    } else throw new Error(`Unexpected argument: ${argument}`);
  }
  return values;
}

function requiredValue(value, label) {
  if (!value || value.startsWith("--")) throw new Error(`${label} requires a value`);
  return value;
}

function positiveInteger(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} requires a positive integer`);
  return parsed;
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}
