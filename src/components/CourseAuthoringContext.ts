import { createContext } from "react";
import { loadAdminLessonBlockMedia, saveAdminCourse, saveAdminLesson, saveAdminModule, uploadAdminLessonAsset, uploadAdminLessonBlockAsset } from "../lib/adminBackend";
import type { CourseOrderModule } from "../lib/courseOrder";

const saveAdminCourseOrder = async (courseId: string, original: CourseOrderModule[], next: CourseOrderModule[]) => {
  const api = await import("../lib/adminCourseOrder");
  return api.saveAdminCourseOrder(courseId, original, next);
};

export const courseAuthoring = { saveAdminCourse, saveAdminLesson, saveAdminModule, uploadAdminLessonAsset, uploadAdminLessonBlockAsset, loadAdminLessonBlockMedia, saveAdminCourseOrder };
export const CourseAuthoringContext = createContext(courseAuthoring);
