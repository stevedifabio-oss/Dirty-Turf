const API_ORIGIN = "https://services.leadconnectorhq.com";
const ID = /^[A-Za-z0-9_-]{1,128}$/;

function validId(value, label) {
  if (typeof value !== "string" || !ID.test(value)) throw new Error(`Invalid ${label} ID`);
  return value;
}

function records(body, key) {
  if (!body || typeof body !== "object" || !Array.isArray(body[key])) {
    throw new Error(`Invalid ${key} response shape`);
  }
  const ids = new Set();
  for (const record of body[key]) {
    validId(record?.id, key);
    if (ids.has(record.id)) throw new Error(`Duplicate ${key} ID`);
    if (typeof record.title !== "string") throw new Error(`Invalid ${key} title`);
    ids.add(record.id);
  }
  return body[key];
}

export function courseAllowlist(manifest) {
  if (!Array.isArray(manifest?.courses) || !manifest.courses.length) {
    throw new Error("Manifest must contain an explicit nonempty course allowlist");
  }
  const ids = manifest.courses.map((course) => validId(course.externalId, "manifest course"));
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate manifest course ID");
  return ids;
}

// Read-only Courses v3 endpoints. Never follow server-supplied URLs or redirects.
// This is a source snapshot, not an import manifest or a complete media/quiz mirror.
export async function captureGhlCourses({
  token, locationId, manifest, fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => new Date().toISOString(),
}) {
  validId(locationId, "location");
  if (typeof token !== "string" || !token.trim() || /[\r\n]/.test(token)) {
    throw new Error("Missing or invalid GHL token");
  }
  const allowed = new Set(courseAllowlist(manifest));
  const startedAt = now();

  async function get(path, query = {}) {
    const url = new URL(path, API_ORIGIN);
    url.search = new URLSearchParams({ locationId, ...query }).toString();
    for (let attempt = 0; attempt < 4; attempt++) {
      let response;
      try {
        response = await fetchImpl(url, {
          method: "GET", redirect: "error", signal: AbortSignal.timeout(20_000),
          headers: { Authorization: `Bearer ${token}`, Version: "v3", Accept: "application/json" },
        });
      } catch {
        throw new Error("GHL course request failed (network, timeout, or redirect)");
      }
      if (response.status === 429 || response.status >= 500) {
        if (attempt === 3) throw new Error(`GHL course request exhausted retries (HTTP ${response.status})`);
        const retryAfter = response.headers.get("retry-after");
        const seconds = retryAfter == null ? NaN : Number(retryAfter);
        const requestedDelay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
        // Respect long server cooldowns by failing; do not hammer or wait indefinitely.
        if (requestedDelay > 30_000) throw new Error("GHL cooldown exceeds retry window; rerun later");
        await sleep(Math.max(500 * 2 ** attempt, Number.isFinite(requestedDelay) ? requestedDelay : 0));
        continue;
      }
      if (!response.ok) throw new Error(`GHL course request failed (HTTP ${response.status})`);
      try { return await response.json(); } catch { throw new Error("GHL returned invalid JSON"); }
    }
  }

  const products = new Map();
  const allProductIds = new Set();
  const cursors = new Set();
  let cursor;
  let complete = false;
  for (let page = 0; page < 100; page++) {
    const body = await get("/courses/products", { limit: "50", ...(cursor ? { cursor } : {}) });
    const pageProducts = records(body, "products");
    for (const product of pageProducts) {
      if (allProductIds.has(product.id)) throw new Error("Duplicate course ID across pages");
      allProductIds.add(product.id);
      if (allowed.has(product.id)) products.set(product.id, product);
    }
    if (body.nextCursor === null) { complete = true; break; }
    if (typeof body.nextCursor !== "string" || !body.nextCursor || body.nextCursor.length > 4096) {
      throw new Error("Missing or invalid course pagination cursor");
    }
    if (!pageProducts.length || cursors.has(body.nextCursor)) throw new Error("Incomplete or looping course pagination");
    cursors.add(body.nextCursor);
    cursor = body.nextCursor;
  }
  if (!complete) throw new Error("Course pagination exceeded safety limit");
  if (products.size !== allowed.size) throw new Error("Capture incomplete: allowlisted course missing from GHL");

  const courses = [];
  for (const id of allowed) {
    const path = `/courses/products/${encodeURIComponent(id)}`;
    const categoryBody = await get(`${path}/categories`);
    const lessonBody = await get(`${path}/lessons`);
    const categories = records(categoryBody, "categories");
    const lessons = records(lessonBody, "lessons");
    for (const body of [categoryBody, lessonBody]) {
      if (body.nextCursor != null || body.hasMore === true) {
        throw new Error("Unexpected pagination on complete course collection");
      }
    }
    const categoryIds = new Set(categories.map((category) => category.id));
    for (const lesson of lessons) {
      validId(lesson.categoryId, "lesson category");
      if (!categoryIds.has(lesson.categoryId)) throw new Error("Capture incomplete: lesson category missing");
    }
    // A source deletion needs review; never quietly make a partial capture look complete.
    const previous = manifest.courses.find((course) => course.externalId === id);
    const lessonIds = new Set(lessons.map((lesson) => lesson.id));
    for (const module of previous.modules ?? []) {
      for (const lesson of module.lessons ?? []) {
        if (!lessonIds.has(validId(lesson.externalId, "manifest lesson"))) {
          throw new Error("Capture requires review: previously imported lesson missing");
        }
      }
    }
    courses.push({ product: products.get(id), categories, lessons });
  }
  return {
    schemaVersion: 1, source: "ghl-courses-v3", locationId, startedAt, capturedAt: now(),
    completeForRequestedEndpoints: true,
    limitations: [
      "Read-only snapshot; no content has been applied to the app.",
      "Only manifest-allowlisted courses and their category/lesson objects are included.",
      "Quiz questions, assignment content, video files, downloads, progress and enrollments are not captured.",
      "Community posts, comments and members are not covered by these course endpoints.",
      "Source objects remain untrusted; custom scripts/HTML must never be executed during mapping.",
    ],
    counts: { courses: courses.length, categories: courses.reduce((n, c) => n + c.categories.length, 0),
      lessons: courses.reduce((n, c) => n + c.lessons.length, 0) },
    courses,
  };
}
