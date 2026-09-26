import { describe, expect, it } from "vitest";
import type { Course } from "../domain";
import { academyDurationLabel, hasCarriedOverProgress } from "./coursePresentation";

describe("Academy duration presentation", () => {
  it.each(["", "0 min", " 0 minutes ", "Unknown"])("shows %j as self-paced without inventing a duration", (duration) => {
    expect(academyDurationLabel(duration)).toBe("Self-paced");
  });
  it.each(["15 min", "1 hr 20 min"])("preserves known duration %j", (duration) => {
    expect(academyDurationLabel(duration)).toBe(duration);
  });
});

describe("Carried-over course progress", () => {
  const course = (completed: boolean[], importedProgress?: number): Pick<Course, "modules" | "importedProgress"> => ({
    importedProgress,
    modules: [{ title: "Module", lessons: completed.map((done, index) => ({ id: String(index), title: "Lesson", type: "guide", duration: "0 min", completed: done })) }],
  });
  it("explains imported progress that exceeds this app's lesson completions", () => {
    expect(hasCarriedOverProgress(course([false, false], 55))).toBe(true);
  });
  it("stops showing the note once lesson completions catch up", () => {
    expect(hasCarriedOverProgress(course([true, true], 55))).toBe(false);
    expect(hasCarriedOverProgress(course([true, false], 50))).toBe(false);
    expect(hasCarriedOverProgress(course([false]))).toBe(false);
  });
});
