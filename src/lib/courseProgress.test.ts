import { describe, expect, it } from "vitest";
import { clampProgress, combinedCourseProgress } from "./courseProgress";

describe("course progress", () => {
  it("preserves imported GHL progress until native lesson completion passes it", () => {
    expect(combinedCourseProgress(10, 100, 77)).toBe(77);
    expect(combinedCourseProgress(80, 100, 77)).toBe(80);
  });

  it("uses native lesson completion when no imported aggregate exists", () => {
    expect(combinedCourseProgress(3, 4)).toBe(75);
    expect(combinedCourseProgress(0, 0)).toBe(0);
  });

  it("clamps malformed source percentages", () => {
    expect(clampProgress(140)).toBe(100);
    expect(clampProgress(-4)).toBe(0);
    expect(clampProgress(Number.NaN)).toBe(0);
  });
});
