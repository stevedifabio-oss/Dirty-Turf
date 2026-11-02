export type CourseOrderModule = {
  id: string;
  sortOrder: number;
  lessons: { id: string; sortOrder: number }[];
};

/** Keep database sort values for conflict detection, without retaining mutable content. */
export function snapshotCourseOrder(modules: readonly CourseOrderModule[]): CourseOrderModule[] {
  return modules.map(module => ({ id: module.id, sortOrder: module.sortOrder, lessons: module.lessons.map(lesson => ({ id: lesson.id, sortOrder: lesson.sortOrder })) }));
}

export function moveCourseModule(modules: readonly CourseOrderModule[], moduleId: string, targetIndex: number): CourseOrderModule[] {
  const draft = snapshotCourseOrder(modules);
  const index = draft.findIndex(module => module.id === moduleId);
  if (index < 0 || !Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= draft.length || index === targetIndex) return draft;
  const [module] = draft.splice(index, 1);
  draft.splice(targetIndex, 0, module);
  // Reuse existing positions so untouched modules (including hidden ones) retain
  // their sort value. Ties are resolved by normalizing only when necessary.
  const positions = modules.map(item => item.sortOrder);
  const unique = new Set(positions).size === positions.length;
  return draft.map((item, position) => ({ ...item, sortOrder: unique ? positions[position] : position }));
}

/** targetIndex is the final index after removing the lesson from its old position. */
export function moveCourseLesson(modules: readonly CourseOrderModule[], lessonId: string, targetModuleId: string, targetIndex: number): CourseOrderModule[] {
  const draft = snapshotCourseOrder(modules);
  const source = draft.find(module => module.lessons.some(lesson => lesson.id === lessonId));
  const target = draft.find(module => module.id === targetModuleId);
  if (!source || !target || !Number.isInteger(targetIndex)) return draft;
  const index = source.lessons.findIndex(lesson => lesson.id === lessonId);
  const maxIndex = target.lessons.length - (source === target ? 1 : 0);
  if (targetIndex < 0 || targetIndex > maxIndex || (source === target && index === targetIndex)) return draft;
  const [lesson] = source.lessons.splice(index, 1);
  target.lessons.splice(targetIndex, 0, lesson);
  for (const module of new Set([source, target])) {
    module.lessons = module.lessons.map((item, position) => ({ ...item, sortOrder: position }));
  }
  return draft;
}

export function hasCourseOrderChanges(original: readonly CourseOrderModule[], draft: readonly CourseOrderModule[]): boolean {
  return JSON.stringify(snapshotCourseOrder(original)) !== JSON.stringify(snapshotCourseOrder(draft));
}
