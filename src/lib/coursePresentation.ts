import type { Course } from "../domain";
import { combinedCourseProgress } from "./courseProgress";

export function academyDurationLabel(duration: string) {
  const label = duration.trim();
  return !label || /^(?:unknown|0\s*(?:min(?:utes?)?|h(?:ours?)?|hr|s(?:econds?)?|sec)?)$/i.test(label)
    ? "Self-paced"
    : label;
}

export function hasCarriedOverProgress(course: Pick<Course, "modules" | "importedProgress">) {
  const lessons = course.modules.flatMap((module) => module.lessons);
  const currentProgress = combinedCourseProgress(lessons.filter((lesson) => lesson.completed).length, lessons.length);
  return (course.importedProgress ?? 0) > currentProgress;
}
