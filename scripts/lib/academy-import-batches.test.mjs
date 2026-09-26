import { describe, expect, it } from "vitest";
import { buildAcademyImportBatches } from "./academy-import-batches.mjs";
import { importSortOrder } from "../../supabase/functions/_shared/import-order.ts";

function fixture() {
  const lessons = Array.from({ length: 5 }, (_, index) => ({ externalId: `lesson-${index + 1}`, title: `Lesson ${index + 1}` }));
  return {
    commit: false,
    ownerOrganizationId: "00000000-0000-4000-8000-000000000000",
    archivePath: "private/archive.json",
    community: { externalId: "community-1", name: "Academy", slug: "academy" },
    categories: [{ externalId: "general", name: "General" }],
    members: [
      { externalId: "member-1", email: "one@example.test", displayName: "One" },
      { externalId: "member-2", email: "two@example.test", displayName: "Two" },
    ],
    courses: [{ externalId: "course-1", title: "Course", modules: [{ externalId: "module-1", title: "Module", lessons }] }],
    enrollments: [{ externalId: "enrollment-1", memberExternalId: "member-1", courseExternalId: "course-1" }],
    progress: [],
    posts: [{ externalId: "post-1", authorExternalId: "member-1", categoryExternalId: "general", title: "Post", body: "Body" }],
    comments: [{ externalId: "comment-1", postExternalId: "post-1", authorExternalId: "member-2", body: "Reply" }],
    reactions: [],
    events: [{ externalId: "event-1", title: "Event", startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-10-01T01:00:00Z" }],
    rsvps: [{ externalId: "rsvp-1", memberExternalId: "member-1", eventExternalId: "event-1" }],
    assets: lessons.map((lesson) => ({ externalId: `asset-${lesson.externalId}`, lessonExternalId: lesson.externalId, courseExternalId: "course-1", title: lesson.title, type: "image", originalUrl: `https://example.test/${lesson.externalId}.png` })),
  };
}

describe("Academy import batching", () => {
  it("splits dependency-aware records into bounded requests", () => {
    const batches = buildAcademyImportBatches(fixture(), { lessonBatchSize: 2, assetBatchSize: 2 });
    expect(batches[0].label).toBe("foundation");
    expect(batches[1].label).toBe("course-shells");
    expect(batches.filter((batch) => batch.label.startsWith("lessons-"))).toHaveLength(3);
    expect(batches.filter((batch) => batch.label.startsWith("assets-"))).toHaveLength(3);
    expect(batches.every((batch) => batch.manifest.commit === false)).toBe(true);
    expect(batches.every((batch) => batch.manifest.ownerOrganizationId)).toBe(true);
    expect(batches.find((batch) => batch.label === "comments-1")?.manifest.members).toHaveLength(2);
    expect(batches.find((batch) => batch.label === "rsvps-1")?.manifest.events).toHaveLength(1);
  });

  it("fails closed instead of dropping identified reactions", () => {
    const manifest = fixture();
    manifest.reactions = [{ externalId: "reaction-1" }];
    expect(() => buildAcademyImportBatches(manifest)).toThrow(/relationship-preserving/);
  });
});


describe("source ordering across Academy transport batches", () => {
  it("keeps all source positions after lesson, enrollment, progress, and asset subsets are applied", () => {
    const manifest = fixture();
    manifest.courses = Array.from({ length: 2 }, (_, courseIndex) => ({
      externalId: `course-${courseIndex + 1}`,
      title: "Course",
      modules: Array.from({ length: 2 }, (_, moduleIndex) => ({
        externalId: `module-${courseIndex}-${moduleIndex}`,
        title: "Module",
        lessons: Array.from({ length: 3 }, (_, lessonIndex) => ({
          externalId: `lesson-${courseIndex}-${moduleIndex}-${lessonIndex}`,
          title: "Lesson",
        })),
      })),
    }));
    manifest.enrollments[0].courseExternalId = "course-2";
    manifest.progress = [{ externalId: "progress-1", memberExternalId: "member-1", lessonExternalId: "lesson-1-1-2" }];
    manifest.assets = [{ externalId: "asset-1", courseExternalId: "course-2", lessonExternalId: "lesson-1-1-2", title: "Asset", type: "image" }];
    const original = structuredClone(manifest);
    const stored = new Map();
    const apply = (record, batchIndex) => stored.set(record.externalId,
      importSortOrder(record.sortOrder, stored.get(record.externalId), batchIndex));
    for (const { manifest: batch } of buildAcademyImportBatches(manifest, { lessonBatchSize: 2 })) {
      batch.courses.forEach((course, courseIndex) => {
        apply(course, courseIndex);
        course.modules.forEach((module, moduleIndex) => {
          apply(module, moduleIndex);
          module.lessons.forEach(apply);
        });
      });
    }
    original.courses.forEach((course, courseIndex) => {
      expect(stored.get(course.externalId)).toBe(courseIndex);
      course.modules.forEach((module, moduleIndex) => {
        expect(stored.get(module.externalId)).toBe(moduleIndex);
        module.lessons.forEach((lesson, lessonIndex) => expect(stored.get(lesson.externalId)).toBe(lessonIndex));
      });
    });
    expect(manifest).toEqual(original);
  });

  it("preserves explicit source positions in every derived batch, including zero", () => {
    const manifest = fixture();
    manifest.courses[0].sortOrder = 7;
    manifest.courses[0].modules[0].sortOrder = 3;
    manifest.courses[0].modules[0].lessons.forEach((lesson, index) => { lesson.sortOrder = 4 - index; });
    for (const { manifest: batch } of buildAcademyImportBatches(manifest, { lessonBatchSize: 1, assetBatchSize: 1 })) {
      for (const course of batch.courses) {
        expect(course.sortOrder).toBe(7);
        for (const module of course.modules) {
          expect(module.sortOrder).toBe(3);
          for (const lesson of module.lessons) {
            expect(lesson.sortOrder).toBe(5 - Number(lesson.externalId.split("-")[1]));
          }
        }
      }
    }
  });

  it.each([-1, 0.5, null, "1", NaN, Infinity, 2147483648])("rejects invalid source position %s before batching", (value) => {
    for (const level of ["course", "module", "lesson"]) {
      const manifest = fixture();
      const course = manifest.courses[0];
      const record = level === "course" ? course : level === "module" ? course.modules[0] : course.modules[0].lessons[0];
      record.sortOrder = value;
      expect(() => buildAcademyImportBatches(manifest)).toThrow(/sortOrder/);
    }
  });
});
