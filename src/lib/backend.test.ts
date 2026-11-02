import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "../domain";

const mocks = vi.hoisted(() => {
  const getSession = vi.fn();
  const getUser = vi.fn();
  const rpc = vi.fn();
  const estimateSingle = vi.fn();
  const photoInsert = vi.fn();
  const upload = vi.fn();
  const remove = vi.fn();
  const createSignedUrl = vi.fn();
  const cards = vi.fn();
  const inspections = vi.fn();
  const estimates = vi.fn();
  const photos = vi.fn();
  const clients = vi.fn();
  const client = {
    auth: { getSession, getUser },
    rpc,
    from: vi.fn((table: string) => table === "estimates"
      ? { select: () => ({ eq: () => ({ single: estimateSingle }), in: estimates }) }
      : table === "job_cards" ? { select: () => ({ order: cards }) }
      : table === "property_inspections" ? { select: () => ({ in: inspections }) }
      : { insert: photoInsert, select: () => ({ in: () => ({ order: photos }) }) }),
    storage: { from: vi.fn(() => ({ upload, remove, createSignedUrl })) },
  };
  return { client, getSession, getUser, rpc, estimateSingle, photoInsert, upload, remove, createSignedUrl, cards, inspections, estimates, photos, clients };
});

vi.mock("@supabase/supabase-js", () => ({ createClient: (...args: unknown[]) => { mocks.clients(...args); return mocks.client; } }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));

const job: Job = {
  id: 1,
  address: "Test yard",
  area: 100,
  infill: 1,
  quote: 100,
  status: "Calculated",
  method: "manual",
  createdAt: "Today",
  photos: 1,
};
const estimateId = "2e1d6c9e-bab0-4a0a-a979-2c7a3cc653ad";
let saveJob: typeof import("./backend").saveJob;
let retryJobPhotos: typeof import("./backend").retryJobPhotos;
let loadJobs: typeof import("./backend").loadJobs;

beforeAll(async () => {
  vi.stubGlobal("window", {});
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "test-publishable-key");
  ({ saveJob, retryJobPhotos, loadJobs } = await import("./backend"));
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ data: { session: { user: { id: "user-1" }, access_token: "member-one-token" } }, error: null });
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  mocks.rpc.mockResolvedValue({ data: estimateId, error: null });
  mocks.estimateSingle.mockResolvedValue({ data: { organization_id: "org-1", property_id: "property-1" }, error: null });
  mocks.photoInsert.mockResolvedValue({ error: null });
  mocks.upload.mockResolvedValue({ error: null });
  mocks.remove.mockResolvedValue({ error: null });
  mocks.createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://example.test/photo" }, error: null });
  mocks.cards.mockResolvedValue({ data: [], error: null });
  mocks.inspections.mockResolvedValue({ data: [], error: null });
  mocks.estimates.mockResolvedValue({ data: [], error: null });
  mocks.photos.mockResolvedValue({ data: [], error: null });
});

describe("saving a calculation with a photo", () => {
  it("keeps the saved calculation when photo upload fails", async () => {
    mocks.upload.mockResolvedValue({ error: new Error("Upload failed") });

    const result = await saveJob(job, new File(["photo"], "yard.jpg", { type: "image/jpeg" }));

    expect(result.cloudId).toBe(estimateId);
    expect(result.photos).toBe(0);
    expect(result.photoUploadFailed).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("reports an unavailable preview when the photo metadata was saved", async () => {
    mocks.createSignedUrl.mockResolvedValue({ data: null, error: new Error("Preview failed") });

    const result = await saveJob(job, new File(["photo"], "yard.jpg", { type: "image/jpeg" }));

    expect(result.cloudId).toBe(estimateId);
    expect(result.photos).toBe(1);
    expect(result.photoPreviewUnavailable).toBe(true);
    expect(result.photoUploadFailed).toBe(false);
  });

  it("does not claim a calculation was saved when the create request fails", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: new Error("Create failed") });

    await expect(saveJob(job)).rejects.toThrow("Create failed");
  });
});


describe("property inspections and attachment recovery", () => {
  it("loads inspection choices onto the correct saved measurement", async () => {
    mocks.cards.mockResolvedValue({ data: [{ id: estimateId, property_name: "Test yard", square_feet: 450, bag_count: 3, total: 0, status: "ready_to_quote", measurement_method: "manual", created_at: "2026-11-01T12:00:00Z", photo_count: 0 }], error: null });
    mocks.inspections.mockResolvedValue({ data: [{ estimate_id: estimateId, turf_condition: "fair", visible_seams: "visible", debris_level: null, infill_level: "low", notes: "Patio seam" }], error: null });
    const loaded = await loadJobs([]);
    expect(loaded[0].inspection).toEqual({ condition: "fair", seams: "visible", infill: "low", notes: "Patio seam" });
    expect(loaded[0].area).toBe(450);
  });
  it("binds all save requests to the account observed before the operation", async () => {
    await saveJob(job);
    const options = mocks.clients.mock.calls[0][2];
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: "user-2" }, access_token: "member-two-token" } }, error: null });
    expect(await options.accessToken()).toBe("member-one-token");
  });
  it("saves all inspection fields through the atomic RPC", async () => {
    const result = await saveJob({ ...job, inspection: { condition: "fair", seams: "visible", debris: "heavy", infill: "low", notes: "Dog run" } });
    expect(mocks.rpc).toHaveBeenCalledWith("create_infill_inspection", expect.objectContaining({ p_inspection: {
      turf_condition: "fair", visible_seams: "visible", debris_level: "heavy", infill_level: "low", notes: "Dog run",
    } }));
    expect(result.inspection?.condition).toBe("fair");
  });
  it("rejects invalid inspection and photo inputs before creating anything", async () => {
    await expect(saveJob({ ...job, inspection: { condition: "bad" as any } })).rejects.toThrow("valid");
    await expect(saveJob(job, new File(["svg"], "yard.svg", { type: "image/svg+xml" }))).rejects.toThrow("JPEG");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("saves successful photos and retries only the failed one without duplicating the measurement", async () => {
    const first = new File(["1"], "one.jpg", { type: "image/jpeg" });
    const second = new File(["2"], "two.png", { type: "image/png" });
    mocks.upload.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: new Error("Network") });
    const partial = await saveJob(job, [first, second]);
    expect(partial.photos).toBe(1);
    expect(partial.failedPhotoFiles).toEqual([second]);
    const complete = await retryJobPhotos(partial, partial.failedPhotoFiles!);
    expect(complete.photos).toBe(2);
    expect(complete.failedPhotoFiles).toEqual([]);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.photoInsert).toHaveBeenCalledTimes(2);
  });
  it("removes an uploaded object whose metadata insert failed", async () => {
    mocks.photoInsert.mockResolvedValueOnce({ error: new Error("Denied") });
    const file = new File(["photo"], "yard.jpg", { type: "image/jpeg" });
    const result = await saveJob(job, [file]);
    expect(result.photos).toBe(0);
    expect(result.failedPhotoFiles).toEqual([file]);
    expect(mocks.remove).toHaveBeenCalledOnce();
  });
  it("never falls back to device storage when a configured app loses its session", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(saveJob(job)).rejects.toThrow("Sign in again");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
