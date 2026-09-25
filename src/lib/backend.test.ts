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
  const client = {
    auth: { getSession, getUser },
    rpc,
    from: vi.fn((table: string) => table === "estimates"
      ? { select: () => ({ eq: () => ({ single: estimateSingle }) }) }
      : { insert: photoInsert }),
    storage: { from: vi.fn(() => ({ upload, remove, createSignedUrl })) },
  };
  return { client, getSession, getUser, rpc, estimateSingle, photoInsert, upload, remove, createSignedUrl };
});

vi.mock("@supabase/supabase-js", () => ({ createClient: () => mocks.client }));
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

beforeAll(async () => {
  vi.stubGlobal("window", {});
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "test-publishable-key");
  ({ saveJob } = await import("./backend"));
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ data: { session: { user: { id: "user-1" } } }, error: null });
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  mocks.rpc.mockResolvedValue({ data: estimateId, error: null });
  mocks.estimateSingle.mockResolvedValue({ data: { organization_id: "org-1", property_id: "property-1" }, error: null });
  mocks.photoInsert.mockResolvedValue({ error: null });
  mocks.upload.mockResolvedValue({ error: null });
  mocks.remove.mockResolvedValue({ error: null });
  mocks.createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://example.test/photo" }, error: null });
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
    expect(result.photoUploadFailed).toBeUndefined();
  });

  it("does not claim a calculation was saved when the create request fails", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: new Error("Create failed") });

    await expect(saveJob(job)).rejects.toThrow("Create failed");
  });
});
