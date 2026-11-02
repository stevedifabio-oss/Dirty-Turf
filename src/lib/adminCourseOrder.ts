import { supabase } from "./backend";
import { hasCourseOrderChanges, type CourseOrderModule } from "./courseOrder";

/** One transaction; never resave lesson content or replace lesson identities. */
export async function saveAdminCourseOrder(courseId: string, originalModules: CourseOrderModule[], nextModules: CourseOrderModule[]): Promise<void> {
  if (!supabase) throw new Error("Cloud course ordering is unavailable in device preview.");
  if (!hasCourseOrderChanges(originalModules, nextModules)) return;
  const { error } = await supabase.rpc("save_academy_course_order", {
    p_course_id: courseId,
    p_original: originalModules,
    p_next: nextModules,
  });
  if (error?.code === "40001") throw new Error("This course changed while you were arranging it. Reload the course and try again.");
  if (error?.code === "42883" || error?.code === "PGRST202") throw new Error("Course arrangement needs its backend update before it can be saved.");
  if (error) throw new Error(error.message);
}
