const baseUrl = new URL(process.argv[2] || process.env.APP_URL || "http://127.0.0.1:4173");
const expectSecurityHeaders = process.argv.includes("--expect-security-headers");
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

for (const [pathname, marker, contentType] of pages) {
  const result = await request(pathname);
  if (result.response.status !== 200) failures.push(`${pathname} returned ${result.response.status}`);
  if (!result.body.includes(marker)) failures.push(`${pathname} is missing ${marker}`);
  if (!result.response.headers.get("content-type")?.includes(contentType)) {
    failures.push(`${pathname} returned the wrong content type`);
  }
  checks.push({ path: pathname, status: result.response.status });
}

const fallback = await request(`/release-smoke-${Date.now()}`);
if (fallback.response.status !== 200 || !fallback.body.includes("Dirty Turf Academy")) {
  failures.push("SPA fallback did not return the app shell");
}

if (expectSecurityHeaders) {
  const root = await fetch(baseUrl, { redirect: "follow" });
  const expectedHeaders = {
    "x-frame-options": "DENY",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
  };
  for (const [header, expected] of Object.entries(expectedHeaders)) {
    if (root.headers.get(header) !== expected) failures.push(`${header} is missing or incorrect`);
  }
  const permissions = root.headers.get("permissions-policy") ?? "";
  for (const directive of ["camera=(self)", "geolocation=(self)", "microphone=()"] ) {
    if (!permissions.includes(directive)) failures.push(`permissions-policy is missing ${directive}`);
  }
}

if (baseUrl.protocol === "https:") {
  const redirected = await fetch(new URL(baseUrl.href.replace(/^https:/, "http:")), { redirect: "follow" });
  if (new URL(redirected.url).protocol !== "https:") failures.push("HTTP did not redirect to HTTPS");
}

if (failures.length) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(JSON.stringify({ baseUrl: baseUrl.origin, checks, secureHeaders: expectSecurityHeaders, passed: true }, null, 2));

async function request(pathname) {
  const response = await fetch(new URL(pathname, baseUrl), { redirect: "follow" });
  return { response, body: await response.text() };
}
