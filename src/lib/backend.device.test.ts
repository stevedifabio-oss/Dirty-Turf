import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "../domain";
const photos = vi.hoisted(() => ({ save: vi.fn(), load: vi.fn() }));
vi.mock("./localPropertyPhotos", () => ({ saveLocalPropertyPhotos: photos.save, loadLocalPropertyPhotos: photos.load }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));
let backend: typeof import("./backend");
const stored = new Map<string, string>();
const setItem = vi.fn((key: string, value: string) => { stored.set(key, value); });
const job: Job = { id: 18, address: "Example yard", area: 450, infill: 3, quote: 0, status: "Calculated", method: "manual", createdAt: "Just now", photos: 0, inspection: { condition: "fair", notes: "Patio seam" } };
const file = new File(["photo"], "yard.png", { type: "image/png" });
const photoItems = [{ url: "data:image/png;base64,cGhvdG8=", capturedAt: "2026-11-01T12:00:00Z", kind: "site" }];
beforeAll(async () => {
  vi.stubGlobal("window", {});
  vi.stubEnv("VITE_SUPABASE_URL", ""); vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", ""); vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
  backend = await import("./backend");
});
beforeEach(() => {
  stored.clear(); setItem.mockClear();
  vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null, setItem });
  photos.save.mockReset().mockResolvedValue(photoItems);
  photos.load.mockReset().mockResolvedValue(photoItems);
});
describe("disconnected property preview storage", () => {
  it("restores inspection and photo records without putting image data in localStorage", async () => {
    const saved = await backend.saveJob(job, [file]);
    expect(saved.photos).toBe(1);
    expect(saved.photoItems).toEqual(photoItems);
    const loaded = await backend.loadJobs([]);
    expect(loaded[0].inspection).toEqual(job.inspection);
    expect(loaded[0].photoItems).toEqual(photoItems);
    expect([...stored.values()].join("")).not.toContain("data:image");
  });
  it("keeps the saved inspection if local photo storage is unavailable", async () => {
    photos.save.mockRejectedValueOnce(new Error("Quota"));
    const saved = await backend.saveJob(job, [file]);
    expect(saved.photoUploadFailed).toBe(true);
    expect(saved.failedPhotoFiles).toEqual([file]);
    expect(JSON.parse([...stored.values()][0])[0].inspection).toEqual(job.inspection);
  });
  it("does not retry already-persisted photos if the metadata count update fails", async () => {
    setItem.mockImplementationOnce((key, value) => { stored.set(key, value); }).mockImplementationOnce(() => { throw new Error("Quota"); });
    const saved = await backend.saveJob(job, [file]);
    expect(saved.photos).toBe(1);
    expect(saved.failedPhotoFiles).toEqual([]);
    expect((await backend.loadJobs([]))[0].photos).toBe(1);
  });
});
