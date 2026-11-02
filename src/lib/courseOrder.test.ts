import { describe, expect, it } from "vitest";
import { hasCourseOrderChanges, moveCourseLesson, moveCourseModule, snapshotCourseOrder } from "./courseOrder";

const outline = () => [
  { id: "a", sortOrder: 10, lessons: [{ id: "one", sortOrder: 5 }, { id: "two", sortOrder: 9 }] },
  { id: "b", sortOrder: 20, lessons: [{ id: "three", sortOrder: 8 }] },
  { id: "empty", sortOrder: 30, lessons: [] },
];

describe("course ordering drafts", () => {
  it("keeps originals intact and reorders modules without changing lesson identities", () => {
    const original = outline();
    const copy = snapshotCourseOrder(original);
    const next = moveCourseModule(original, "b", 0);
    expect(original).toEqual(copy);
    expect(next.map(module => module.id)).toEqual(["b", "a", "empty"]);
    expect(next[1].lessons.map(lesson => lesson.id)).toEqual(["one", "two"]);
    expect(hasCourseOrderChanges(original, next)).toBe(true);
  });
  it("moves lessons into empty modules and preserves every lesson once", () => {
    const next = moveCourseLesson(outline(), "two", "empty", 0);
    expect(next[0].lessons.map(lesson => lesson.id)).toEqual(["one"]);
    expect(next[2].lessons).toEqual([{ id: "two", sortOrder: 0 }]);
    expect(next.flatMap(module => module.lessons.map(lesson => lesson.id)).sort()).toEqual(["one", "three", "two"]);
  });
  it("uses final indexes for same-module moves in both directions", () => {
    const first = moveCourseLesson(outline(), "one", "a", 1);
    expect(first[0].lessons.map(lesson => lesson.id)).toEqual(["two", "one"]);
    expect(moveCourseLesson(first, "one", "a", 0)[0].lessons.map(lesson => lesson.id)).toEqual(["one", "two"]);
  });
  it("ignores missing IDs, invalid indexes and no-op moves", () => {
    for (const next of [moveCourseModule(outline(), "missing", 0), moveCourseModule(outline(), "a", 0), moveCourseLesson(outline(), "one", "other-course", 0), moveCourseLesson(outline(), "one", "b", 99)]) {
      expect(hasCourseOrderChanges(outline(), next)).toBe(false);
    }
  });
});
