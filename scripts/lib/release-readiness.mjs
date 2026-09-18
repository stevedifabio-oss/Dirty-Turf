const attributePattern = /([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

export function inspectAppHtml(html, expectedOrigin) {
  const canonical = findAttribute(html, "link", "rel", "canonical", "href");
  const ogUrl = findAttribute(html, "meta", "property", "og:url", "content");
  const manifest = findAttribute(html, "link", "rel", "manifest", "href");
  const expectedRoot = new URL("/", normalizeOrigin(expectedOrigin)).href;
  const failures = [];

  if (canonical !== expectedRoot) failures.push(`Canonical URL must be ${expectedRoot}, found ${canonical || "none"}`);
  if (ogUrl !== expectedRoot) failures.push(`Open Graph URL must be ${expectedRoot}, found ${ogUrl || "none"}`);
  if (manifest !== "/manifest.webmanifest") failures.push("App shell must link to /manifest.webmanifest");
  if (!/<title>\s*Dirty Turf Academy\s*<\/title>/i.test(html)) failures.push("App shell title is incorrect");
  if (!/name=["']viewport["']/i.test(html)) failures.push("App shell is missing a viewport meta tag");

  return { canonical, ogUrl, manifest, expectedRoot, failures };
}

export function inspectManifest(manifest) {
  const failures = [];
  if (manifest?.name !== "Dirty Turf Academy") failures.push("Manifest name must be Dirty Turf Academy");
  if (manifest?.short_name !== "Dirty Turf") failures.push("Manifest short_name must be Dirty Turf");
  if (manifest?.id !== "/") failures.push("Manifest id must be /");
  if (manifest?.start_url !== "/") failures.push("Manifest start_url must be /");
  if (manifest?.scope !== "/") failures.push("Manifest scope must be /");
  if (manifest?.display !== "standalone") failures.push("Manifest display must be standalone");

  const icons = Array.isArray(manifest?.icons) ? manifest.icons : [];
  for (const size of ["192x192", "512x512"]) {
    if (!icons.some((icon) => icon?.sizes?.split(/\s+/).includes(size) && icon?.type === "image/png")) {
      failures.push(`Manifest is missing a PNG ${size} icon`);
    }
  }

  return { failures };
}

export function inspectPublicPages(pages) {
  const privacy = pages.privacy ?? "";
  const support = pages.support ?? "";
  const deletion = pages.deletion ?? "";
  const failures = [];

  if (!/\bMailgun\b/i.test(privacy)) failures.push("Privacy policy must disclose Mailgun");
  if (/\bResend\b/i.test(privacy)) failures.push("Privacy policy still mentions Resend");
  if (!/\bSupabase\b/i.test(privacy)) failures.push("Privacy policy must disclose Supabase");
  if (!/\bStripe\b/i.test(privacy)) failures.push("Privacy policy must disclose Stripe");
  if (!/Magic Link/i.test(support)) failures.push("Support page must explain Magic Link sign-in");
  if (!/live point-to-point camera measurement/i.test(support)) {
    failures.push("Support page must distinguish live camera measurement");
  }
  if (!/Request account deletion/i.test(deletion)) failures.push("Account deletion instructions are incomplete");
  if (!/hello@dirtyturf\.com/i.test(deletion)) failures.push("Account deletion page is missing the support email");

  return { failures };
}

export function inspectSecurityHeaders(headers) {
  const failures = [];
  const expected = {
    "x-frame-options": "DENY",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
  };
  for (const [name, value] of Object.entries(expected)) {
    if (headers.get(name) !== value) failures.push(`${name} is missing or incorrect`);
  }
  const permissions = headers.get("permissions-policy") ?? "";
  for (const directive of ["camera=(self)", "geolocation=(self)", "microphone=()"] ) {
    if (!permissions.includes(directive)) failures.push(`permissions-policy is missing ${directive}`);
  }
  return { failures };
}

export function normalizeOrigin(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`Unsupported URL protocol: ${url.protocol}`);
  return url.origin;
}

function findAttribute(html, tagName, selectorName, selectorValue, resultName) {
  const tags = html.match(new RegExp(`<${tagName}\\b[^>]*>`, "gi")) ?? [];
  for (const tag of tags) {
    const attributes = parseAttributes(tag);
    if (attributes[selectorName]?.toLowerCase() === selectorValue.toLowerCase()) return attributes[resultName] ?? "";
  }
  return "";
}

function parseAttributes(tag) {
  const attributes = {};
  const source = tag.replace(/^<[^\s>]+|\/?\s*>$/g, "");
  for (const match of source.matchAll(attributePattern)) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attributes;
}
