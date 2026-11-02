import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LessonRichTextEditor } from "./LessonRichTextEditor";

describe("rich lesson description controls", () => {
  it("does not emit or mount untrusted original markup just by opening an editor", () => {
    const onChange = vi.fn();
    const html = renderToStaticMarkup(<LessonRichTextEditor html={'<img src="x" onerror="attack()"><script>attack()</script>'} label="Lesson description" onChange={onChange} />);
    expect(onChange).not.toHaveBeenCalled();
    expect(html).not.toContain("attack()");
    expect(html).toContain('role="textbox"');
    expect(html).toContain('aria-label="Lesson description"');
    for (const control of ["Bold", "Italic", "Underline", "Bulleted list", "Numbered list", "Undo text edit", "Redo text edit"]) expect(html).toContain(`aria-label="${control}"`);
    expect(html).toContain("Subheading"); expect(html).toContain("Add link");
  });

  it("prevents editing when saving or read-only", () => {
    const html = renderToStaticMarkup(<LessonRichTextEditor html="<p>Kept</p>" label="Description" disabled onChange={vi.fn()} />);
    expect(html).toContain('contentEditable="false"');
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toMatch(/<button(?![^>]*disabled)/);
  });
});
