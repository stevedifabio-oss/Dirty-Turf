import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ids = {
  community: "00000000-0000-4000-8000-000000000001",
  course: "00000000-0000-4000-8000-000000000002",
  module: "00000000-0000-4000-8000-000000000003",
  lesson: "00000000-0000-4000-8000-000000000004",
  asset: "00000000-0000-4000-8000-000000000005",
};
type Query = { table: string; selected?: string; values?: Record<string, unknown>; filters: [string, unknown][] };
const mocks = vi.hoisted(() => {
  const queries: Query[] = [];
  const state = {
    canManage: true,
    courseVisible: true,
    lessonVisible: true,
    moduleMatches: true,
    readError: null as Error | null,
    registrationError: null as Error | null,
    assetReadError: null as Error | null,
    assets: [] as { storage_path: string | null; original_url: string | null }[],
  };
  const upload = vi.fn(); const remove = vi.fn(); const sign = vi.fn(); const signMany = vi.fn();
  const client = {
    rpc: vi.fn(async (name: string) => {
      if (name !== "get_academy_access_state") throw new Error(`Unexpected RPC ${name}`);
      return { data: { canManage: state.canManage, communityId: "00000000-0000-4000-8000-000000000001" }, error: null };
    }),
    storage: { from: vi.fn(() => ({ upload, remove, createSignedUrl: sign, createSignedUrls: signMany })) },
    from: vi.fn((table: string) => {
      const query: Query = { table, filters: [] }; queries.push(query);
      const response = () => {
        if (query.values) return { data: null, error: state.registrationError };
        if (table === "academy_communities") return { data: { id: "00000000-0000-4000-8000-000000000001", owner_organization_id: "organization-a", name: "Academy" }, error: null };
        if (table === "academy_assets") return { data: state.assets, error: state.assetReadError };
        if (state.readError) return { data: null, error: state.readError };
        if (table === "courses") return { data: state.courseVisible ? { id: "00000000-0000-4000-8000-000000000002" } : null, error: null };
        if (table === "course_lessons") return { data: state.lessonVisible ? { id: "00000000-0000-4000-8000-000000000004", module_id: "00000000-0000-4000-8000-000000000003" } : null, error: null };
        if (table === "course_modules") return { data: state.moduleMatches ? { id: "00000000-0000-4000-8000-000000000003" } : null, error: null };
        throw new Error(`Unexpected table read ${table}`);
      };
      const builder = {
        select: vi.fn((columns: string) => { query.selected = columns; return builder; }),
        eq: vi.fn((column: string, value: unknown) => { query.filters.push([column, value]); return builder; }),
        insert: vi.fn((values: Record<string, unknown>) => { query.values = values; return builder; }),
        single: vi.fn(async () => response()),
        then: (resolve: (result: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(response()).then(resolve, reject),
      };
      return builder;
    }),
  };
  return { state, client, queries, upload, remove, sign, signMany };
});
vi.mock("./backend", () => ({ supabase: mocks.client }));
import { ADMIN_LESSON_BLOCK_IMAGE_LIMIT_BYTES, ADMIN_LESSON_BLOCK_VIDEO_LIMIT_BYTES, loadAdminLessonBlockMedia, uploadAdminLessonBlockAsset } from "./adminBackend";

function file(type = "image/jpeg", size = 1024, name = "Before cleaning.jpg") { return { name, type, size } as File; }
const expectedPath = `${ids.community}/${ids.course}/${ids.lesson}/${ids.asset}-before-cleaning.jpg`;

beforeEach(() => {
  vi.clearAllMocks(); mocks.queries.length = 0;
  Object.assign(mocks.state, { canManage: true, courseVisible: true, lessonVisible: true, moduleMatches: true, readError: null, registrationError: null, assetReadError: null, assets: [] });
  mocks.upload.mockReset().mockResolvedValue({ data: { path: expectedPath }, error: null });
  mocks.remove.mockReset().mockResolvedValue({ data: [], error: null });
  mocks.sign.mockReset().mockResolvedValue({ data: { signedUrl: "https://project.supabase.co/private-preview" }, error: null });
  mocks.signMany.mockReset().mockImplementation(async (paths: string[]) => ({ data: paths.map(path => ({ path, signedUrl: `https://project.supabase.co/preview/${path}` })), error: null }));
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => ids.asset) });
});

describe("saved lesson block media previews", () => {
  const asset = (path = expectedPath) => ({ storage_path: path, original_url: `academy-asset:${path}` });

  it("signs only this exact Academy/course/lesson's registered stable references and performs no writes", async () => {
    mocks.state.assets = [asset(), asset()];
    expect(await loadAdminLessonBlockMedia(ids.course, ids.lesson)).toEqual({ [`academy-asset:${expectedPath}`]: `https://project.supabase.co/preview/${expectedPath}` });
    expect(mocks.queries.find(query => query.table === "academy_assets")?.filters).toEqual([
      ["academy_community_id", ids.community], ["course_id", ids.course], ["lesson_id", ids.lesson], ["storage_bucket", "academy-assets"],
    ]);
    expect(mocks.signMany).toHaveBeenCalledOnce(); expect(mocks.signMany).toHaveBeenCalledWith([expectedPath], 3600);
    expect(mocks.queries.some(query => query.values)).toBe(false); expect(mocks.upload).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("does not sign foreign paths, path traversal, external originals or missing paths", async () => {
    mocks.state.assets = [
      asset(`other-community/${ids.course}/${ids.lesson}/photo.jpg`),
      asset(`${ids.community}/${ids.course}/${ids.lesson}/../other/photo.jpg`),
      asset(`${expectedPath}?other-path`),
      { storage_path: expectedPath, original_url: "https://external.example/source.jpg" },
      { storage_path: null, original_url: "academy-asset:" },
    ];
    expect(await loadAdminLessonBlockMedia(ids.course, ids.lesson)).toEqual({});
    expect(mocks.signMany).not.toHaveBeenCalled();
  });

  it("signs a large registered collection in bounded batches", async () => {
    mocks.state.assets = Array.from({ length: 201 }, (_, index) => asset(`${ids.community}/${ids.course}/${ids.lesson}/photo-${index}.jpg`));
    expect(Object.keys(await loadAdminLessonBlockMedia(ids.course, ids.lesson))).toHaveLength(201);
    expect(mocks.signMany.mock.calls.map(([paths]) => paths.length)).toEqual([100, 100, 1]);
  });

  it.each(["courseVisible", "lessonVisible", "moduleMatches"] as const)("does not read/sign media without %s ownership proof", async (key) => {
    mocks.state[key] = false;
    await expect(loadAdminLessonBlockMedia(ids.course, ids.lesson)).rejects.toThrow(/no longer available|does not belong/);
    expect(mocks.queries.some(query => query.table === "academy_assets")).toBe(false); expect(mocks.signMany).not.toHaveBeenCalled();
  });

  it("requires a saved lesson and an administrator session before reading media", async () => {
    await expect(loadAdminLessonBlockMedia(ids.course, "new")).rejects.toThrow("Save the lesson draft");
    expect(mocks.client.rpc).not.toHaveBeenCalled();
    mocks.state.canManage = false;
    await expect(loadAdminLessonBlockMedia(ids.course, ids.lesson)).rejects.toThrow("administrator access required");
    expect(mocks.queries.some(query => query.table === "academy_assets")).toBe(false); expect(mocks.signMany).not.toHaveBeenCalled();
  });

  it("surfaces metadata access failures before requesting signatures", async () => {
    mocks.state.assetReadError = new Error("Media access denied");
    await expect(loadAdminLessonBlockMedia(ids.course, ids.lesson)).rejects.toBe(mocks.state.assetReadError);
    expect(mocks.signMany).not.toHaveBeenCalled();
  });

  it("surfaces a signing service failure without changing or re-uploading the media", async () => {
    mocks.state.assets = [asset()]; const error = new Error("Signing unavailable");
    mocks.signMany.mockResolvedValueOnce({ data: null, error });
    await expect(loadAdminLessonBlockMedia(ids.course, ids.lesson)).rejects.toBe(error);
    expect(mocks.upload).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("omits failed or unrequested signatures and retains available previews", async () => {
    const second = `${ids.community}/${ids.course}/${ids.lesson}/second.jpg`;
    mocks.state.assets = [asset(), asset(second)];
    mocks.signMany.mockResolvedValueOnce({ data: [
      { path: expectedPath, signedUrl: "https://project.supabase.co/available" },
      { path: second, signedUrl: "https://project.supabase.co/invalid", error: "Not available" },
      { path: "foreign/path", signedUrl: "https://project.supabase.co/unrequested" },
    ], error: null });
    expect(await loadAdminLessonBlockMedia(ids.course, ids.lesson)).toEqual({ [`academy-asset:${expectedPath}`]: "https://project.supabase.co/available" });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("draft lesson block uploads", () => {
  it("checks exact Academy/course/lesson ownership, registers private media and leaves lesson content untouched", async () => {
    const image = file();
    await expect(uploadAdminLessonBlockAsset(image, ids.course, ids.lesson)).resolves.toEqual({ path: expectedPath, previewUrl: "https://project.supabase.co/private-preview" });
    expect(mocks.queries.find(query => query.table === "courses")?.filters).toEqual([["id", ids.course], ["academy_community_id", ids.community]]);
    expect(mocks.queries.find(query => query.table === "course_lessons")?.filters).toEqual([["id", ids.lesson]]);
    expect(mocks.queries.find(query => query.table === "course_modules")?.filters).toEqual([["id", ids.module], ["course_id", ids.course]]);
    expect(mocks.client.storage.from).toHaveBeenCalledWith("academy-assets");
    expect(mocks.upload).toHaveBeenCalledWith(expectedPath, image, { contentType: "image/jpeg", upsert: false });
    const writes = mocks.queries.filter(query => query.values);
    expect(writes).toHaveLength(1);
    expect(writes[0].table).toBe("academy_assets");
    expect(writes[0].selected).toBeUndefined();
    expect(writes[0].values).toEqual({ id: ids.asset, academy_community_id: ids.community, course_id: ids.course, lesson_id: ids.lesson, title: image.name, asset_type: "image", storage_bucket: "academy-assets", storage_path: expectedPath, original_url: `academy-asset:${expectedPath}`, mime_type: "image/jpeg", byte_size: image.size, source_provider: "native" });
    expect(mocks.client.rpc.mock.calls.every(([name]) => name === "get_academy_access_state")).toBe(true);
    expect(mocks.sign).toHaveBeenCalledWith(expectedPath, 3600);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it.each(["image/png", "image/webp", "image/gif", "image/avif", "video/mp4", "video/webm", "video/quicktime"])("registers supported %s media using its explicit type", async (type) => {
    await uploadAdminLessonBlockAsset(file(type), ids.course, ids.lesson);
    expect(mocks.queries.find(query => query.values)?.values).toMatchObject({ asset_type: type.startsWith("image/") ? "image" : "video", mime_type: type });
  });

  it.each(["image/svg+xml", "text/html", "application/javascript", "application/pdf", "application/octet-stream", ""])("rejects unsupported MIME %s before account/storage calls", async (type) => {
    await expect(uploadAdminLessonBlockAsset(file(type), ids.course, ids.lesson)).rejects.toThrow("Choose a JPG");
    expect(mocks.client.rpc).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5])("rejects invalid file size %s", async (size) => {
    await expect(uploadAdminLessonBlockAsset(file("image/png", size), ids.course, ids.lesson)).rejects.toThrow("not empty");
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it.each([["image/png", ADMIN_LESSON_BLOCK_IMAGE_LIMIT_BYTES, "20"], ["video/mp4", ADMIN_LESSON_BLOCK_VIDEO_LIMIT_BYTES, "500"]] as const)("bounds %s size before starting upload", async (type, limit, label) => {
    await expect(uploadAdminLessonBlockAsset(file(type, limit + 1), ids.course, ids.lesson)).rejects.toThrow(`${label} MB`);
    expect(mocks.upload).not.toHaveBeenCalled();
    await expect(uploadAdminLessonBlockAsset(file(type, limit), ids.course, ids.lesson)).resolves.toHaveProperty("path");
  });

  it("rejects path-like/nonpersisted identities and blank filenames before upload", async () => {
    await expect(uploadAdminLessonBlockAsset(file(), "../another-course", ids.lesson)).rejects.toThrow("Save the lesson draft");
    await expect(uploadAdminLessonBlockAsset(file(), ids.course, "new")).rejects.toThrow("Save the lesson draft");
    await expect(uploadAdminLessonBlockAsset(file("image/png", 10, " "), ids.course, ids.lesson)).rejects.toThrow("no name");
    expect(mocks.client.rpc).not.toHaveBeenCalled(); expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("does not upload for a non-admin account", async () => {
    mocks.state.canManage = false;
    await expect(uploadAdminLessonBlockAsset(file(), ids.course, ids.lesson)).rejects.toThrow("administrator access required");
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it.each(["courseVisible", "lessonVisible", "moduleMatches"] as const)("does not upload when %s ownership proof is missing", async (key) => {
    mocks.state[key] = false;
    await expect(uploadAdminLessonBlockAsset(file(), ids.course, ids.lesson)).rejects.toThrow(/no longer available|does not belong/);
    expect(mocks.upload).not.toHaveBeenCalled(); expect(mocks.queries.some(query => query.values)).toBe(false);
  });

  it("does not upload after a denied ownership read", async () => {
    mocks.state.readError = new Error("Read denied");
    await expect(uploadAdminLessonBlockAsset(file(), ids.course, ids.lesson)).rejects.toBe(mocks.state.readError);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("does not register or remove an object after its upload fails", async () => {
    const failure = new Error("Storage unavailable"); mocks.upload.mockResolvedValueOnce({ data: null, error: failure });
    await expect(uploadAdminLessonBlockAsset(file(), ids.course, ids.lesson)).rejects.toBe(failure);
    expect(mocks.queries.some(query => query.values)).toBe(false); expect(mocks.remove).not.toHaveBeenCalled(); expect(mocks.sign).not.toHaveBeenCalled();
  });

  it("removes only the new object when metadata registration fails, retaining the original error", async () => {
    mocks.state.registrationError = new Error("Insert denied"); mocks.remove.mockRejectedValueOnce(new Error("Cleanup unavailable"));
    await expect(uploadAdminLessonBlockAsset(file(), ids.course, ids.lesson)).rejects.toBe(mocks.state.registrationError);
    expect(mocks.remove).toHaveBeenCalledOnce(); expect(mocks.remove).toHaveBeenCalledWith([expectedPath]); expect(mocks.sign).not.toHaveBeenCalled();
  });

  it.each(["result", "exception"])("keeps the registered asset and returns its path after a signing %s failure", async (kind) => {
    if (kind === "result") mocks.sign.mockResolvedValueOnce({ data: null, error: new Error("Signing unavailable") });
    else mocks.sign.mockRejectedValueOnce(new Error("Signing unavailable"));
    await expect(uploadAdminLessonBlockAsset(file(), ids.course, ids.lesson)).resolves.toEqual({ path: expectedPath, previewUrl: "" });
    expect(mocks.upload).toHaveBeenCalledOnce(); expect(mocks.queries.filter(query => query.values)).toHaveLength(1); expect(mocks.remove).not.toHaveBeenCalled();
  });
});
