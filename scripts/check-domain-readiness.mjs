import { resolveCname, resolveTxt } from "node:dns/promises";

const options = parseArgs(process.argv.slice(2));
const checks = [];

await runCheck("ownership TXT", async () => {
  const values = (await resolveTxt(options.ownershipHost)).map((parts) => parts.join(""));
  if (!values.includes(options.ownershipValue)) {
    throw new Error(`${options.ownershipHost} does not contain the current Netlify ownership value`);
  }
  return values;
});

await runCheck("app CNAME", async () => {
  const values = (await resolveCname(options.domain)).map(normalizeHostname);
  if (!values.includes(normalizeHostname(options.expectedCname))) {
    throw new Error(`${options.domain} does not point to ${options.expectedCname}`);
  }
  return values;
});

await runCheck("HTTPS and TLS", async () => {
  const response = await fetch(`https://${options.domain}/`, {
    redirect: "follow",
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTPS returned ${response.status}`);
  if (new URL(response.url).hostname !== options.domain) {
    throw new Error(`HTTPS redirected to ${new URL(response.url).hostname}`);
  }
  return { status: response.status, finalUrl: response.url };
});

await runCheck("HTTP redirect", async () => {
  const response = await fetch(`http://${options.domain}/`, {
    redirect: "follow",
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  if (new URL(response.url).protocol !== "https:") throw new Error("HTTP did not redirect to HTTPS");
  return { status: response.status, finalUrl: response.url };
});

const failed = checks.filter((check) => !check.passed);
console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  domain: options.domain,
  expectedCname: options.expectedCname,
  ownershipHost: options.ownershipHost,
  passed: failed.length === 0,
  checks,
}, null, 2));
if (failed.length) process.exitCode = 1;

async function runCheck(name, operation) {
  try {
    checks.push({ name, passed: true, evidence: await operation() });
  } catch (error) {
    checks.push({ name, passed: false, error: message(error) });
  }
}

function parseArgs(args) {
  const values = {
    domain: "app.dirtyturf.com",
    expectedCname: "bright-brigadeiros-df8b48.netlify.app",
    ownershipHost: "subdomain-owner-verification.dirtyturf.com",
    ownershipValue: "a274de0c635882497aea3cc2e0df6f49",
    timeoutMs: 15_000,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--domain") values.domain = hostname(args[++index], argument);
    else if (argument === "--expected-cname") values.expectedCname = hostname(args[++index], argument);
    else if (argument === "--ownership-host") values.ownershipHost = hostname(args[++index], argument);
    else if (argument === "--ownership-value") values.ownershipValue = requiredValue(args[++index], argument);
    else if (argument === "--timeout-ms") values.timeoutMs = positiveInteger(args[++index], argument);
    else throw new Error(`Unknown option: ${argument}`);
  }
  return values;
}

function hostname(value, label) {
  const parsed = requiredValue(value, label).trim().toLowerCase().replace(/\.$/, "");
  if (!/^[a-z0-9.-]+$/.test(parsed) || !parsed.includes(".")) throw new Error(`${label} requires a hostname`);
  return parsed;
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

function normalizeHostname(value) {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}
