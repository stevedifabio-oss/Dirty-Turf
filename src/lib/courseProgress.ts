export function clampProgress(value: number | null | undefined) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value ?? 0)));
}

export function combinedCourseProgress(completedLessons: number, lessonCount: number, importedProgress?: number | null) {
  const nativeProgress = lessonCount > 0 ? Math.round(Math.max(0, completedLessons) / lessonCount * 100) : 0;
  return Math.max(clampProgress(nativeProgress), clampProgress(importedProgress));
}
