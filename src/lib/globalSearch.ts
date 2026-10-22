import type { AcademyEvent, CommunityComment, CommunityPost, Course, Job, Member } from "../domain";

export type SearchTarget =
  | { kind: "job"; id: number }
  | { kind: "course"; courseId: string; lessonId?: string }
  | { kind: "post"; postId?: string; localId: number; commentId?: string }
  | { kind: "event"; id?: string }
  | { kind: "member"; id: string }
  | { kind: "destination"; view: "learn" | "community" | "events" };
export type GlobalSearchResult = { key: string; type: string; title: string; detail: string; text: string; target: SearchTarget };
export type SearchContent = { jobs: Job[]; courses: Course[]; posts: CommunityPost[]; comments: CommunityComment[]; events: AcademyEvent[]; members: Member[] };

export function searchableText(value: string | undefined): string {
  return (value ?? "").replace(/<[^>]*>/g, " ").replace(/&(?:nbsp|amp|lt|gt|quot);/g, " ").replace(/\s+/g, " ").trim();
}
export function postSearchResult(post: CommunityPost): GlobalSearchResult {
  return { key: `post-${post.cloudId ?? post.id}`, type: "Post", title: post.name, detail: `${post.author} · ${searchableText(post.body).slice(0, 170)}`,
    text: `${post.author} ${post.category ?? ""} ${searchableText(post.body)}`, target: { kind: "post", postId: post.cloudId, localId: post.id } };
}
export function searchContent(content: SearchContent, query: string): GlobalSearchResult[] {
  const rows: GlobalSearchResult[] = [
    ...content.jobs.map(job => ({ key: `job-${job.id}`, type: "Property", title: job.address, detail: `${job.area} sq ft · saved calculation`, text: job.address, target: { kind: "job" as const, id: job.id } })),
    ...content.courses.flatMap(course => [
      { key: `course-${course.id}`, type: "Course", title: course.title, detail: searchableText(course.description).slice(0, 170), text: `${course.category} ${course.instructor} ${searchableText(course.description)}`, target: { kind: "course" as const, courseId: course.cloudId ?? course.id } },
      ...course.modules.flatMap(module => module.lessons.filter(lesson => !lesson.locked).map(lesson => ({ key: `lesson-${lesson.id}`, type: "Lesson", title: lesson.title, detail: `${course.title} · ${module.title}`, text: `${course.title} ${module.title} ${searchableText(lesson.body)} ${searchableText(lesson.bodyHtml)} ${lesson.transcript ?? ""} ${(lesson.resources ?? []).map(resource => resource.title).join(" ")}`, target: { kind: "course" as const, courseId: course.cloudId ?? course.id, lessonId: lesson.id } }))),
    ]),
    ...content.posts.map(postSearchResult),
    ...content.comments.flatMap(comment => {
      const post = content.posts.find(row => row.id === comment.postId);
      const postId = comment.postCloudId ?? post?.cloudId;
      if (!postId && !post) return [];
      return [{ key: `comment-${comment.cloudId ?? comment.id}`, type: "Comment", title: post?.name ?? `Reply by ${comment.author}`, detail: `${comment.author} · ${searchableText(comment.body).slice(0, 170)}`, text: `${comment.author} ${searchableText(comment.body)}`, target: { kind: "post" as const, postId, localId: comment.postId, commentId: comment.cloudId } }];
    }),
    ...content.events.map(event => ({ key: `event-${event.id}`, type: "Event", title: event.title, detail: `${event.date} · ${event.time} · ${event.host}`, text: `${event.host} ${searchableText(event.description)}`, target: { kind: "event" as const, id: event.cloudId } })),
    ...content.members.map(member => ({ key: `member-${member.cloudId ?? member.id}`, type: "Member", title: member.name, detail: [member.company, member.location].filter(Boolean).join(" · ") || "Academy member", text: `${member.location ?? ""} ${member.company ?? ""} ${member.role}`, target: { kind: "member" as const, id: member.cloudId ?? String(member.id) } })),
  ];
  if (!query.trim()) return rows.filter(row => row.type !== "Lesson" && row.type !== "Comment" && row.type !== "Member").slice(0, 12);
  return rankSearchResults(rows, query);
}
export function rankSearchResults(rows: GlobalSearchResult[], query: string): GlobalSearchResult[] {
  const normalized = query.trim().toLocaleLowerCase().slice(0, 120);
  const terms = normalized.split(/\s+/);
  const unique = [...new Map(rows.map(row => [row.key, row])).values()];
  const rank = (row: GlobalSearchResult) => row.title.toLocaleLowerCase() === normalized ? 0 : row.title.toLocaleLowerCase().startsWith(normalized) ? 1 : row.title.toLocaleLowerCase().includes(normalized) ? 2 : 3;
  return unique.filter(row => terms.every(term => `${row.title} ${row.type} ${row.detail} ${row.text}`.toLocaleLowerCase().includes(term)))
    .sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title)).slice(0, 40);
}
