import { describe, expect, it } from "vitest";
import { lessonHasContent } from "./academy-import-validation.mjs";

describe("Academy lesson import validation", () => {
  it("accepts each supported lesson content source", () => {
    expect(lessonHasContent({ body: { html: "<p>Lesson</p>" } })).toBe(true);
    expect(lessonHasContent({ body: { text: "Lesson" } })).toBe(true);
    expect(lessonHasContent({ videoUrl: "https://example.test/lesson.mp4" })).toBe(true);
    expect(lessonHasContent({ transcript: "Lesson transcript" })).toBe(true);
    expect(lessonHasContent({ resources: [{ url: "https://example.test/guide.pdf" }] })).toBe(true);
    expect(lessonHasContent({ body: { quiz: { questions: [{ prompt: "Question" }] } } })).toBe(true);
  });

  it("rejects empty lesson shells", () => {
    expect(lessonHasContent({ body: { html: "", text: "", sourceType: "video" }, resources: [] })).toBe(false);
    expect(lessonHasContent({})).toBe(false);
  });
});
