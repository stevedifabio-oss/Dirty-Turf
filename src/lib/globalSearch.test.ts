import { describe, expect, it } from "vitest";
import { courses, initialComments, initialEvents, initialMembers, initialPosts } from "../appData";
import { rankSearchResults, searchContent, type SearchContent } from "./globalSearch";

const content: SearchContent = { courses, posts: initialPosts, comments: initialComments, events: initialEvents, members: initialMembers, jobs: [] };
describe("global content search", () => {
  it("finds actual lesson content and opens its exact course/lesson", () => {
    const course = { ...courses[0], modules: [{ title: "Field work", lessons: [{ id: "target", title: "Infill basics", duration: "2 min", type: "guide" as const, completed: false, body: "Measure the installation depth before adding infill" }] }] };
    const rows = searchContent({ ...content, courses: [course] }, "installation depth");
    expect(rows).toHaveLength(1);
    expect(rows[0].target).toEqual({ kind: "course", courseId: course.cloudId ?? course.id, lessonId: "target" });
  });
  it("excludes locked lesson text and searches only supplied accessible courses", () => {
    const course = { ...courses[0], modules: [{ title: "Private", lessons: [{ id: "locked", title: "Confidential", duration: "1 min", type: "guide" as const, completed: false, locked: true, body: "Secret instruction" }] }] };
    expect(searchContent({ ...content, courses: [course] }, "Secret instruction")).toEqual([]);
    expect(searchContent({ ...content, courses: [] }, courses[0].title).some(row => row.type === "Course")).toBe(false);
  });
  it("opens an older comment's parent even when the post is outside the feed window", () => {
    const comment = { ...initialComments[0], postCloudId: "older-post", cloudId: "exact-comment", body: "Rare recovery advice" };
    const rows = searchContent({ ...content, courses: [], posts: [], comments: [comment] }, "recovery");
    expect(rows[0].target).toEqual({ kind: "post", postId: "older-post", localId: comment.postId, commentId: "exact-comment" });
  });
  it("deduplicates remote/local rows, ranks exact titles first and bounds results", () => {
    const target = { kind: "destination" as const, view: "learn" as const };
    const exact = { key: "exact", type: "Lesson", title: "Infill", detail: "", text: "", target };
    const other = Array.from({ length: 50 }, (_, n) => ({ ...exact, key: `other-${n}`, title: `Infill guide ${n}` }));
    const rows = rankSearchResults([...other, exact, exact], "INFILL");
    expect(rows).toHaveLength(40); expect(rows[0]).toEqual(exact);
  });
  it("treats markup as plain search text and preserves case-insensitive multiword matching", () => {
    const post = { ...initialPosts[0], name: "Turf advice", body: "<p>Learn to clean GROUT safely</p>" };
    const rows = searchContent({ ...content, courses: [], posts: [post], comments: [] }, "grout turf");
    expect(rows[0].type).toBe("Post"); expect(rows[0].detail).not.toContain("<p>");
  });
});
