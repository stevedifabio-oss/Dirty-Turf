import { describe, expect, it } from "vitest";
import { normalizeInspection, validatePropertyPhotos } from "./turfInspection";

describe("inspection validation", () => {
  it("keeps unanswered fields distinct from no issue and trims optional notes", () => {
    expect(normalizeInspection({ condition: "", seams: null, debris: "none", infill: "unsure", notes: "  Patio seam  " })).toEqual({ debris: "none", infill: "unsure", notes: "Patio seam" });
  });
  it.each([[], "poor", { condition: "bad" }, { notes: 4 }, { notes: "a".repeat(2001) }, { organization_id: "other" }])("rejects malformed inspection %j", value => {
    expect(() => normalizeInspection(value)).toThrow();
  });
  it("allows a complete inspection and the maximum notes length", () => {
    expect(normalizeInspection({ condition: "excellent", seams: "none", debris: "light", infill: "adequate", notes: "a".repeat(2000) }).notes).toHaveLength(2000);
  });
  it("rejects excess, empty, oversized, and unsupported photo files before upload", () => {
    const photo = new File(["photo"], "yard.jpg", { type: "image/jpeg" });
    expect(() => validatePropertyPhotos([photo], 6)).toThrow("six");
    expect(() => validatePropertyPhotos([new File([], "empty.png", { type: "image/png" })])).toThrow("20 MB");
    expect(() => validatePropertyPhotos([{ type: "image/jpeg", size: 20 * 1024 * 1024 + 1 } as File])).toThrow("20 MB");
    expect(() => validatePropertyPhotos([new File(["svg"], "yard.svg", { type: "image/svg+xml" })])).toThrow("JPEG");
    expect(() => validatePropertyPhotos([photo], 5)).not.toThrow();
  });
});
