function chunks(values, size) {
  const output = [];
  for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size));
  return output;
}

function uniqueBy(values, key) {
  return [...new Map(values.filter(Boolean).map((value) => [value[key], value])).values()];
}

function emptyBatch(manifest, label) {
  return {
    ...manifest,
    commit: false,
    archivePath: `${manifest.archivePath ?? "highlevel"}#${label}`,
    categories: [],
    members: [],
    courses: [],
    enrollments: [],
    progress: [],
    posts: [],
    comments: [],
    reactions: [],
    events: [],
    rsvps: [],
    assets: [],
  };
}

function courseShell(course, modules = []) {
  return { ...course, modules };
}

export function buildAcademyImportBatches(manifest, options = {}) {
  if (!manifest?.community?.externalId) throw new Error("Academy import manifest is required");
  if ((manifest.reactions ?? []).length) {
    throw new Error("Identified reactions require an explicit relationship-preserving batch strategy");
  }

  const lessonBatchSize = options.lessonBatchSize ?? 20;
  const recordBatchSize = options.recordBatchSize ?? 20;
  const postBatchSize = options.postBatchSize ?? 15;
  const commentPostBatchSize = options.commentPostBatchSize ?? 8;
  const assetBatchSize = options.assetBatchSize ?? 20;
  for (const [label, value] of Object.entries({ lessonBatchSize, recordBatchSize, postBatchSize, commentPostBatchSize, assetBatchSize })) {
    if (!Number.isInteger(value) || value < 1 || value > 50) throw new Error(`${label} must be an integer from 1 to 50`);
  }

  const members = manifest.members ?? [];
  const categories = manifest.categories ?? [];
  const courses = manifest.courses ?? [];
  const memberById = new Map(members.map((member) => [member.externalId, member]));
  const categoryById = new Map(categories.map((category) => [category.externalId, category]));
  const courseById = new Map(courses.map((course) => [course.externalId, course]));
  const moduleEntries = courses.flatMap((course) => (course.modules ?? []).map((module) => ({ course, module })));
  const moduleById = new Map(moduleEntries.map(({ module }) => [module.externalId, module]));
  const lessonEntries = moduleEntries.flatMap(({ course, module }) => (module.lessons ?? []).map((lesson) => ({ course, module, lesson })));
  const lessonById = new Map(lessonEntries.map((entry) => [entry.lesson.externalId, entry]));
  const postById = new Map((manifest.posts ?? []).map((post) => [post.externalId, post]));
  const eventById = new Map((manifest.events ?? []).map((event) => [event.externalId, event]));

  const buildCourseSubset = (entries, courseIds = []) => {
    const byCourse = new Map();
    for (const courseId of courseIds) byCourse.set(courseId, new Map());
    for (const entry of entries) {
      if (!byCourse.has(entry.course.externalId)) byCourse.set(entry.course.externalId, new Map());
      const modules = byCourse.get(entry.course.externalId);
      if (!modules.has(entry.module.externalId)) modules.set(entry.module.externalId, []);
      modules.get(entry.module.externalId).push(entry.lesson);
    }
    return [...byCourse.entries()].map(([courseId, modules]) => {
      const course = courseById.get(courseId);
      if (!course) throw new Error(`Unknown course ${courseId}`);
      return courseShell(course, [...modules.entries()].map(([moduleId, lessons]) => {
        const module = moduleById.get(moduleId);
        if (!module) throw new Error(`Unknown module ${moduleId}`);
        return { ...module, lessons };
      }));
    });
  };

  const output = [];
  const add = (label, values) => output.push({ label, manifest: { ...emptyBatch(manifest, label), ...values } });
  add("foundation", { categories, members });
  add("course-shells", {
    courses: courses.map((course) => courseShell(course, (course.modules ?? []).map((module) => ({ ...module, lessons: [] })))),
  });

  chunks(lessonEntries, lessonBatchSize).forEach((entries, index) => {
    add(`lessons-${index + 1}`, { courses: buildCourseSubset(entries) });
  });
  chunks(manifest.enrollments ?? [], recordBatchSize).forEach((enrollments, index) => {
    add(`enrollments-${index + 1}`, {
      members: uniqueBy(enrollments.map((item) => memberById.get(item.memberExternalId)), "externalId"),
      courses: uniqueBy(enrollments.map((item) => courseById.get(item.courseExternalId)), "externalId").map((course) => courseShell(course, [])),
      enrollments,
    });
  });
  chunks(manifest.progress ?? [], recordBatchSize).forEach((progress, index) => {
    const entries = [...new Map(
      progress.map((item) => lessonById.get(item.lessonExternalId)).filter(Boolean)
        .map((entry) => [entry.lesson.externalId, entry]),
    ).values()];
    add(`progress-${index + 1}`, {
      members: uniqueBy(progress.map((item) => memberById.get(item.memberExternalId)), "externalId"),
      courses: buildCourseSubset(entries),
      progress,
    });
  });
  chunks(manifest.posts ?? [], postBatchSize).forEach((posts, index) => {
    add(`posts-${index + 1}`, {
      categories: uniqueBy(posts.map((post) => categoryById.get(post.categoryExternalId)), "externalId"),
      members: uniqueBy(posts.map((post) => memberById.get(post.authorExternalId)), "externalId"),
      posts,
    });
  });

  const commentsByPost = new Map();
  for (const comment of manifest.comments ?? []) {
    if (!commentsByPost.has(comment.postExternalId)) commentsByPost.set(comment.postExternalId, []);
    commentsByPost.get(comment.postExternalId).push(comment);
  }
  chunks([...commentsByPost.entries()], commentPostBatchSize).forEach((postGroups, index) => {
    const posts = postGroups.map(([postId]) => postById.get(postId)).filter(Boolean);
    const comments = postGroups.flatMap(([, values]) => values);
    add(`comments-${index + 1}`, {
      categories: uniqueBy(posts.map((post) => categoryById.get(post.categoryExternalId)), "externalId"),
      members: uniqueBy([
        ...posts.map((post) => memberById.get(post.authorExternalId)),
        ...comments.map((comment) => memberById.get(comment.authorExternalId)),
      ], "externalId"),
      posts,
      comments,
    });
  });

  chunks(manifest.events ?? [], recordBatchSize).forEach((events, index) => add(`events-${index + 1}`, { events }));
  chunks(manifest.rsvps ?? [], recordBatchSize).forEach((rsvps, index) => {
    add(`rsvps-${index + 1}`, {
      members: uniqueBy(rsvps.map((item) => memberById.get(item.memberExternalId)), "externalId"),
      events: uniqueBy(rsvps.map((item) => eventById.get(item.eventExternalId)), "externalId"),
      rsvps,
    });
  });
  chunks(manifest.assets ?? [], assetBatchSize).forEach((assets, index) => {
    const referencedLessons = [...new Map(
      assets.map((asset) => lessonById.get(asset.lessonExternalId)).filter(Boolean)
        .map((entry) => [entry.lesson.externalId, entry]),
    ).values()];
    const courseIds = uniqueBy(assets.map((asset) => courseById.get(asset.courseExternalId)), "externalId").map((course) => course.externalId);
    add(`assets-${index + 1}`, { courses: buildCourseSubset(referencedLessons, courseIds), assets });
  });

  return output;
}
