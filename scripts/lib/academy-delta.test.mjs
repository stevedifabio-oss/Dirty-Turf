import { describe, expect, it } from "vitest";
import { planAcademyDelta } from "./academy-delta.mjs";

const baseline = () => ({
  sourceExportedAt: "2026-09-18T12:00:00Z",
  community: { externalId: "group-1", name: "Academy", slug: "academy" },
  members: [{ externalId: "member-1", displayName: "Member One", email: "member@example.com" }],
  courses: [{ externalId: "course-1", title: "Course", modules: [{
    externalId: "module-1", title: "Module", lessons: [{ externalId: "lesson-1", title: "Lesson", body: { text: "Old" } }],
  }] }],
  posts: [{ externalId: "post-1", authorExternalId: "member-1", title: "Welcome", body: "Hello" }],
});

function recapture() {
  return { ...baseline(), sourceExportedAt: "2026-09-23T12:00:00Z" };
}

describe("Academy capture delta planning", () => {
  it("does not mistake object key order or a new capture timestamp for content changes", () => {
    const current = recapture();
    current.community = { slug: "academy", name: "Academy", externalId: "group-1" };
    expect(planAcademyDelta(baseline(), current).counts).toEqual({ added: 0, updated: 0, missing: 0 });
  });

  it("identifies changed lessons and added posts without exposing payloads", () => {
    const current = recapture();
    current.courses[0].modules[0].lessons[0].body.text = "Revised";
    current.posts.push({ externalId: "post-2", authorExternalId: "member-1", title: "News", body: "Update" });
    const plan = planAcademyDelta(baseline(), current);
    expect(plan.counts).toEqual({ added: 1, updated: 1, missing: 0 });
    expect(plan.changes.updated).toEqual([{ type: "lesson", externalId: "lesson-1" }]);
    expect(JSON.stringify(plan)).not.toContain("Revised");
  });

  it("treats disappearing members and content as review items, not deletions", () => {
    const current = recapture();
    current.members = [];
    current.posts = [];
    const plan = planAcademyDelta(baseline(), current);
    expect(plan.changes.missing).toEqual([
      { type: "member", externalId: "member-1" },
      { type: "post", externalId: "post-1" },
    ]);
  });

  it("detects a lesson move or reorder", () => {
    const current = recapture();
    current.courses[0].modules.push({ externalId: "module-2", title: "Second", lessons: [] });
    current.courses[0].modules[1].lessons = current.courses[0].modules[0].lessons;
    current.courses[0].modules[0].lessons = [];
    const plan = planAcademyDelta(baseline(), current);
    expect(plan.changes.updated).toContainEqual({ type: "lesson", externalId: "lesson-1" });
    expect(plan.changes.added).toContainEqual({ type: "module", externalId: "module-2" });
  });

  it("rejects stale, cross-community, and duplicate captures", () => {
    expect(() => planAcademyDelta(recapture(), baseline())).toThrow(/newer/);
    const other = recapture();
    other.community.externalId = "other-group";
    expect(() => planAcademyDelta(baseline(), other)).toThrow(/different/);
    const duplicate = recapture();
    duplicate.posts.push({ ...duplicate.posts[0] });
    expect(() => planAcademyDelta(baseline(), duplicate)).toThrow(/Duplicate post/);
  });
});
