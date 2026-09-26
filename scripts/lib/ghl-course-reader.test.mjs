import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, readFile, stat, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { captureGhlCourses, courseAllowlist } from "./ghl-course-reader.mjs";
import { writePrivateSnapshot } from "../capture-ghl-courses.mjs";

const product = { id: "course-1", title: "Course" };
const category = { id: "category-1", title: "Category" };
const lesson = { id: "lesson-1", title: "Lesson", categoryId: category.id };
const manifest = { courses: [{ externalId: product.id, modules: [{ lessons: [{ externalId: lesson.id }] }] }] };
const good = () => [{ products: [product], nextCursor: null }, { categories: [category] }, { lessons: [lesson] }];

function runner(responses = good(), extras = {}) {
  const requests = [];
  const waits = [];
  const capture = () => captureGhlCourses({ token: "test-token", locationId: "location-1", manifest,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response instanceof Response ? response : new Response(JSON.stringify(response));
    }, sleep: async (ms) => waits.push(ms), ...extras });
  return { capture, requests, waits };
}

describe("GHL read-only course capture", () => {
  it("captures only explicitly imported courses with GET requests on the fixed API host", async () => {
    const responses = good();
    responses[0].products.push({ id: "unrelated-course", title: "Do not capture" });
    const run = runner(responses);
    const result = await run.capture();
    expect(result.counts).toEqual({ courses: 1, categories: 1, lessons: 1 });
    expect(result.completeForRequestedEndpoints).toBe(true);
    expect(JSON.stringify(result)).not.toContain("Do not capture");
    expect(result.limitations.join(" ")).toContain("Quiz questions");
    expect(run.requests).toHaveLength(3);
    for (const { url, options } of run.requests) {
      expect(url.origin).toBe("https://services.leadconnectorhq.com");
      expect(url.searchParams.get("locationId")).toBe("location-1");
      expect(options).toMatchObject({ method: "GET", redirect: "error", headers: { Version: "v3" } });
    }
    expect(run.requests[2].url.searchParams.has("categoryId")).toBe(false);
  });

  it("treats pagination cursors as data, never as a destination URL", async () => {
    const run = runner([
      { products: [{ id: "other", title: "Other" }], nextCursor: "https://evil.invalid/?token=abc" },
      ...good(),
    ]);
    await run.capture();
    expect(run.requests[1].url.origin).toBe("https://services.leadconnectorhq.com");
    expect(run.requests[1].url.searchParams.get("cursor")).toBe("https://evil.invalid/?token=abc");
  });

  it("rejects duplicate IDs, invalid IDs, malformed shapes and missing pagination", async () => {
    for (const first of [
      { products: [product, product], nextCursor: null },
      { products: [{ ...product, id: "../path" }], nextCursor: null },
      { products: {}, nextCursor: null },
      { products: [product] },
    ]) await expect(runner([first]).capture()).rejects.toThrow(/Duplicate|Invalid|invalid/);
    expect(() => courseAllowlist({ courses: [] })).toThrow(/allowlist/);
    expect(() => courseAllowlist({ courses: [manifest.courses[0], manifest.courses[0]] })).toThrow(/Duplicate/);
  });

  it("rejects missing allowed courses and previously imported lessons", async () => {
    await expect(runner([{ products: [], nextCursor: null }]).capture()).rejects.toThrow(/allowlisted course missing/);
    const responses = good();
    responses[2] = { lessons: [] };
    await expect(runner(responses).capture()).rejects.toThrow(/previously imported lesson missing/);
  });

  it("rejects incomplete or duplicate course collections", async () => {
    const responses = good();
    responses[1] = { categories: [] };
    await expect(runner(responses).capture()).rejects.toThrow(/lesson category missing/);
    const paginated = good();
    paginated[2].nextCursor = "more";
    await expect(runner(paginated).capture()).rejects.toThrow(/Unexpected pagination/);
    const duplicate = good();
    duplicate[2].lessons.push(lesson);
    await expect(runner(duplicate).capture()).rejects.toThrow(/Duplicate/);
  });

  it("rejects pagination loops and duplicate IDs across pages", async () => {
    await expect(runner([
      { products: [product], nextCursor: "cursor" },
      { products: [{ id: "other", title: "Other" }], nextCursor: "cursor" },
    ]).capture()).rejects.toThrow(/looping/);
    await expect(runner([
      { products: [product], nextCursor: "cursor" },
      { products: [product], nextCursor: null },
    ]).capture()).rejects.toThrow(/across pages/);
  });

  it("retries 429 and server failures with bounded backoff", async () => {
    const run = runner([new Response("", { status: 429, headers: { "Retry-After": "2" } }),
      new Response("", { status: 503 }), ...good()]);
    await run.capture();
    expect(run.waits).toEqual([2000, 1000]);
    const exhausted = runner(Array.from({ length: 4 }, () => new Response("", { status: 500 })));
    await expect(exhausted.capture()).rejects.toThrow(/exhausted retries/);
    expect(exhausted.requests).toHaveLength(4);
    await expect(runner([new Response("", { status: 429, headers: { "Retry-After": "60" } })]).capture())
      .rejects.toThrow(/cooldown/);
  });

  it("does not retry authorization failures or leak private response/network content", async () => {
    const run = runner([new Response("private payload", { status: 403 })]);
    await expect(run.capture()).rejects.toThrow("GHL course request failed (HTTP 403)");
    expect(run.requests).toHaveLength(1);
    await expect(runner([new Error("private token")]).capture()).rejects.toThrow("GHL course request failed (network, timeout, or redirect)");
    await expect(runner([new Response("private non-JSON payload")]).capture()).rejects.toThrow("GHL returned invalid JSON");
  });
});

describe("private snapshot publication", () => {
  it("writes atomically with owner-only permissions, never overwrites, and removes temporary files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ghl-capture-test-"));
    try {
      const output = "output/private/capture.json";
      await writePrivateSnapshot(output, { safe: true }, root);
      expect((await stat(path.join(root, output))).mode & 0o777).toBe(0o600);
      await expect(writePrivateSnapshot(output, { safe: false }, root)).rejects.toThrow();
      expect(JSON.parse(await readFile(path.join(root, output), "utf8"))).toEqual({ safe: true });
      expect(await readdir(path.join(root, "output/private"))).toEqual(["capture.json"]);
      await expect(writePrivateSnapshot("output/public.json", {}, root)).rejects.toThrow(/directly inside/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("rejects a private directory redirected through a symlink", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ghl-capture-test-"));
    try {
      await mkdir(path.join(root, "output"));
      await mkdir(path.join(root, "elsewhere"));
      await symlink(path.join(root, "elsewhere"), path.join(root, "output/private"));
      await expect(writePrivateSnapshot("output/private/capture.json", {}, root)).rejects.toThrow(/symlinks/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
