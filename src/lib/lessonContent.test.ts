import { describe, expect, it } from "vitest";
import { isLessonContentUrl, lessonContentBlocks, lessonContentBody, lessonContentMarkup, validateLessonContentBlocks, type LessonContentBlock } from "./lessonContent";
import { applyLessonAssetPatch, lessonAssetExpiry } from "./lessonMedia";

const asset = "academy-asset:11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/44444444-4444-4444-8444-444444444444-lesson.mp4";
const blocks: LessonContentBlock[] = [
  { id: "intro", type: "text", text: "First inspect the surface.\nThen prepare equipment." },
  { id: "photo", type: "image", url: "https://example.test/photo.jpg", alt: "Surface before cleaning", caption: "Look for damage" },
  { id: "demo", type: "video", url: asset, caption: "Technique demonstration" },
  { id: "guide", type: "link", url: "https://example.test/guide.pdf", label: "Download the guide" },
];

describe("mixed lesson content model", () => {
  it("round-trips ordered mixed blocks while preserving quiz and provider metadata", () => {
    const quiz = { requiresPassing: true, questions: [{ prompt: "Inspect first?", options: ["Yes", "No"], correctOptionIndex: 0 }] };
    const original = { quiz, providerData: { id: "ghl-lesson" }, text: "Old text", content: "Old alias", html: "<p>Old content</p>" };
    const saved = lessonContentBody(original, blocks);
    expect(lessonContentBlocks(saved)).toEqual(blocks);
    expect(saved.quiz).toBe(quiz);
    expect(saved.providerData).toBe(original.providerData);
    expect(saved.content).toBeUndefined();
    expect(saved.text).toContain("First inspect the surface.");
    expect(saved.html).toContain('<video src="academy-asset:');
    const html = String(saved.html);
    expect(html.indexOf("First inspect")).toBeLessThan(html.indexOf("<img"));
    expect(html.indexOf("<img")).toBeLessThan(html.indexOf("<video"));
    expect(html.indexOf("<video")).toBeLessThan(html.indexOf("<a"));
    expect(original.html).toBe("<p>Old content</p>");
    expect(saved.contentBlocks).not.toBe(blocks);
  });

  it("preserves imported rich HTML byte-for-byte as a legacy block", () => {
    const html = '<h2>Setup &amp; safety</h2><p><strong>Keep this formatting.</strong></p><table><tr><td>Details</td></tr></table>';
    const body = { html, text: "Fallback", quiz: { questions: [] }, sourceVideoUrl: "https://example.test/source.mp4" };
    const parsed = lessonContentBlocks(body);
    expect(parsed).toEqual([{ id: "legacy-content", type: "legacy", html }]);
    expect(lessonContentBody(body, parsed)).toMatchObject({ html, quiz: body.quiz, sourceVideoUrl: body.sourceVideoUrl });
    expect(lessonContentMarkup(body)).toBe(html);
  });

  it("supports legacy text aliases without inventing formatting or content", () => {
    for (const body of ["Original text", { text: "Original text" }, { content: "Original text" }, { description: "Original text" }]) {
      expect(lessonContentBlocks(body)).toEqual([{ id: "legacy-text", type: "text", text: "Original text" }]);
    }
    expect(lessonContentBlocks(undefined)).toEqual([]);
    expect(lessonContentBlocks({ quiz: { questions: [] } })).toEqual([]);
    expect(lessonContentBody({ text: "Remove", html: "<p>Remove</p>", quiz: { name: "Keep" } }, [])).toMatchObject({ text: "", html: "", contentBlocks: [], quiz: { name: "Keep" } });
  });

  it("does not silently discard malformed structured blocks or duplicate identities", () => {
    const invalid = [{ id: "one", type: "unknown", text: "Must not disappear" }];
    expect(() => lessonContentBlocks({ contentBlocks: invalid, html: "<p>Old compatibility copy</p>" })).toThrow("unsupported content type");
    expect(lessonContentMarkup({ contentBlocks: invalid, html: "<p>Old compatibility copy</p>" })).toBe("<p>Old compatibility copy</p>");
    expect(lessonContentMarkup({ contentBlocks: invalid })).toBeUndefined();
    expect(() => lessonContentBody({}, [...blocks, { ...blocks[0] }])).toThrow("unique ID");
    expect(validateLessonContentBlocks([{ id: "missing", type: "image", url: "https://example.test/img.jpg" }])).toContain("Block 1 needs image descriptions.");
  });

  it("escapes authored text, labels, descriptions and URL attributes", () => {
    const attack = '"><script>alert("xss")</script><img src=x onerror=alert(1)>';
    const saved = lessonContentBody({}, [
      { id: "text", type: "text", text: attack },
      { id: "photo", type: "image", url: "https://example.test/image.jpg?title=%22&size=2", alt: attack, caption: attack },
      { id: "link", type: "link", url: "https://example.test/guide.pdf", label: attack },
    ]);
    expect(saved.html).not.toContain("<script>");
    expect(saved.html).not.toContain("<img src=x");
    expect(saved.html).toContain("&lt;script&gt;");
    expect(saved.html).toContain("&amp;size=2");
    expect(saved.html).toContain("alt=\"&quot;&gt;&lt;script&gt;");
  });

  it.each(["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:image/svg+xml,<svg/>", "blob:https://example.test/private", "//example.test/path", "/relative/path", "https://user:password@example.test/file", " https://example.test/file", "https://example.test/a\nb", `${asset}/../escape`, asset.replace("academy-asset:", "academy-asset:/")])("rejects unsupported or ambiguous media URL %s", value => {
    expect(isLessonContentUrl(value)).toBe(false);
    expect(() => lessonContentBody({}, [{ id: "video", type: "video", url: value, caption: "" }])).toThrow("valid video URL");
  });

  it("accepts only HTTP(S) and the canonical registered upload reference shape", () => {
    expect(isLessonContentUrl("https://example.test/video.mp4?token=a.b.c")).toBe(true);
    expect(isLessonContentUrl("http://example.test/video.webm")).toBe(true);
    expect(isLessonContentUrl(asset)).toBe(true);
    expect(isLessonContentUrl("academy-asset:some/path/file.mp4")).toBe(false);
    expect(isLessonContentUrl("academy-asset:" + asset.split(":")[1].replace("lesson.mp4", "../lesson.mp4"))).toBe(false);
  });

  it("resolves registered inline image, video and link references without mutating stored data", () => {
    const inline = [
      { id: "photo", type: "image", url: asset.replace("lesson.mp4", "lesson.jpg"), alt: "Before", caption: "" },
      { id: "video", type: "video", url: asset, caption: "Demo" },
      { id: "link", type: "link", url: asset.replace("lesson.mp4", "guide.pdf"), label: "Handbook" },
    ] as LessonContentBlock[];
    const body = lessonContentBody({}, inline);
    const mappings = new Map(inline.map(block => ["url" in block ? block.url : "", `https://example.test/storage/v1/object/sign/academy-assets/${block.id}?token=fresh&download=1`]));
    const html = lessonContentMarkup(body, mappings);
    expect(html).toContain('src="https://example.test/storage/v1/object/sign/academy-assets/photo?token=fresh&amp;download=1"');
    expect(html).toContain('src="https://example.test/storage/v1/object/sign/academy-assets/video?token=fresh&amp;download=1"');
    expect(html).toContain('href="https://example.test/storage/v1/object/sign/academy-assets/link?token=fresh&amp;download=1"');
    expect(html).not.toContain("academy-asset:");
    expect(lessonContentBlocks(body)).toEqual(inline);
    expect(lessonContentMarkup(body, new Map([[asset, "javascript:alert(1)"]]))).toContain(asset);
    expect(lessonContentMarkup(body, new Map())).toContain(asset);
  });

  it("renews a signed inline block through bodyHtml without replacing quiz or progress", () => {
    const signed = (exp: number) => `https://example.test/storage/v1/object/sign/academy-assets/video.mp4?token=header.${btoa(JSON.stringify({ exp }))}.signature`;
    const body = lessonContentBody({}, [{ id: "video", type: "video", url: asset, caption: "Demo" }]);
    const lesson = { id: "lesson", title: "Training", type: "quiz" as const, duration: "3m", completed: true, quiz: { name: "Quiz", requiresPassing: true, questions: [] }, bodyHtml: lessonContentMarkup(body, new Map([[asset, signed(1_800_000_000)]])) };
    expect(lessonAssetExpiry(lesson)).toBe(1_800_000_000_000);
    const updated = applyLessonAssetPatch(lesson, { bodyHtml: lessonContentMarkup(body, new Map([[asset, signed(1_800_003_600)]])), expiresAt: 1_800_003_600_000 });
    expect(lessonAssetExpiry(updated)).toBe(1_800_003_600_000);
    expect(updated.quiz).toBe(lesson.quiz);
    expect(updated.completed).toBe(true);
    expect(updated.bodyHtml).not.toBe(lesson.bodyHtml);
  });
});
