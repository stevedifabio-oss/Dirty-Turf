import { describe, expect, it } from "vitest";
import type { Course } from "../domain";
import { academyDurationLabel, academyResourcePresentation, hasCarriedOverProgress } from "./coursePresentation";

describe("Academy duration presentation", () => {
  it.each(["", "0 min", " 0 minutes ", "Unknown"])("shows %j as self-paced without inventing a duration", (duration) => {
    expect(academyDurationLabel(duration)).toBe("Self-paced");
  });
  it.each(["15 min", "1 hr 20 min"])("preserves known duration %j", (duration) => {
    expect(academyDurationLabel(duration)).toBe(duration);
  });
});

describe("Carried-over course progress", () => {
  const course = (completed: boolean[], importedProgress?: number): Pick<Course, "modules" | "importedProgress"> => ({
    importedProgress,
    modules: [{ title: "Module", lessons: completed.map((done, index) => ({ id: String(index), title: "Lesson", type: "guide", duration: "0 min", completed: done })) }],
  });
  it("explains imported progress that exceeds this app's lesson completions", () => {
    expect(hasCarriedOverProgress(course([false, false], 55))).toBe(true);
  });
  it("stops showing the note once lesson completions catch up", () => {
    expect(hasCarriedOverProgress(course([true, true], 55))).toBe(false);
    expect(hasCarriedOverProgress(course([true, false], 50))).toBe(false);
    expect(hasCarriedOverProgress(course([false]))).toBe(false);
  });
});

describe("Lesson resource presentation", () => {
  it("preserves authored titles and treats a product page as a website", () => {
    expect(academyResourcePresentation({ title: "Recommended pressure washer", url: "https://www.example.com/products/123", type: "link" }))
      .toEqual({ title: "Recommended pressure washer", type: "Website", isDownload: false });
  });

  it.each([
    ["", "https://www.example.com/products/123", "example.com"],
    ["https://www.example.com/products/123", "https://www.example.com/products/123", "example.com"],
    ["4gB0pp9", "https://amzn.to/4gB0pp9", "amzn.to"],
    ["pressure-washer-quick-connect-set-70629.html", "https://www.example.com/pressure-washer-quick-connect-set-70629.html", "example.com"],
  ])("replaces an imported URL label %j with its hostname", (title, url, expected) => {
    expect(academyResourcePresentation({ title, url }).title).toBe(expected);
  });

  it("keeps readable names and filenames even when they match the URL", () => {
    expect(academyResourcePresentation({ title: "Setup guide", url: "https://example.com/Setup%20guide" }).title).toBe("Setup guide");
    expect(academyResourcePresentation({ title: "Checklist", url: "https://example.com/Checklist" }).title).toBe("Checklist");
    expect(academyResourcePresentation({ title: "Setup.pdf", url: "https://example.com/Setup.pdf?token=temporary", type: "link" }))
      .toEqual({ title: "Setup.pdf", type: "PDF", isDownload: true });
  });

  it("uses known file metadata when a storage URL has no extension", () => {
    expect(academyResourcePresentation({ title: "Equipment checklist", url: "https://example.com/storage/123", type: "document" }))
      .toEqual({ title: "Equipment checklist", type: "Document", isDownload: true });
  });

  it("does not infer a download from query text or an unknown type", () => {
    expect(academyResourcePresentation({ title: "Supplier", url: "https://example.com/product?ref=guide.pdf", type: "download" }))
      .toEqual({ title: "Supplier", type: "Website", isDownload: false });
  });

  it("handles invalid URLs and malformed escapes without losing an authored title", () => {
    expect(academyResourcePresentation({ title: "Supplier contact", url: "not a URL" }))
      .toEqual({ title: "Supplier contact", type: "Resource", isDownload: false });
    expect(academyResourcePresentation({ title: "", url: "https://example.com/%invalid" }).title).toBe("example.com");
  });
});
