export function mirrorCourseImages(admin: unknown, config: {
  academy_community_id: string; location_id: string; course_ids: string[];
}): Promise<Record<string, string | number>>;
