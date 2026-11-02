import { afterEach, describe, expect, it, vi } from "vitest";
import { escapeLessonText, isLessonEditorLink, sanitizeLessonRichText } from "./lessonRichText";

class TextNode {
  nodeType = 3;
  constructor(public textContent: string) {}
  get html() { return this.textContent.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); }
}
class ElementNode {
  nodeType = 1;
  tagName: string;
  constructor(tag: string, public attrs: Record<string, string> = {}, public childNodes: Array<ElementNode | TextNode> = []) { this.tagName = tag.toUpperCase(); }
  getAttribute(name: string) { return this.attrs[name] ?? null; }
  setAttribute(name: string, value: string) { this.attrs[name] = value; }
  appendChild(node: ElementNode | TextNode) { this.childNodes.push(node); }
  get innerHTML(): string { return this.childNodes.map(node => node.html).join(""); }
  get html(): string { const tag = this.tagName.toLowerCase(); return `<${tag}${Object.entries(this.attrs).map(([key, value]) => ` ${key}="${value.replaceAll('"', "&quot;")}"`).join("")}>${this.innerHTML}</${tag}>`; }
}
function parsedSource(nodes: Array<ElementNode | TextNode>) {
  vi.stubGlobal("DOMParser", class {
    parseFromString() { return { body: new ElementNode("body", {}, nodes), implementation: { createHTMLDocument: () => ({ body: new ElementNode("body"), createElement: (tag: string) => new ElementNode(tag), createTextNode: (text: string) => new TextNode(text) }) } }; }
  });
}
afterEach(() => vi.unstubAllGlobals());

describe("lesson description authoring sanitizer", () => {
  it("keeps headings, lists, underline and supported media without copying active attributes", () => {
    parsedSource([
      new ElementNode("h2", { onclick: "attack()", style: "color:red" }, [new TextNode("Inspection")]),
      new ElementNode("ul", {}, [new ElementNode("li", {}, [new ElementNode("u", {}, [new TextNode("Check the turf")])])]),
      new ElementNode("img", { src: "https://example.test/photo.jpg", alt: "Turf", onerror: "attack()" }),
      new ElementNode("video", { autoplay: "", src: "https://example.test/video.mp4" }),
      new ElementNode("iframe", { src: "https://www.youtube.com/embed/123", allow: "camera", srcdoc: "<script>attack()</script>" }),
    ]);
    const html = sanitizeLessonRichText("source");
    expect(html).toContain("<h2>Inspection</h2>");
    expect(html).toContain("<ul><li><u>Check the turf</u></li></ul>");
    expect(html).toContain('src="https://example.test/photo.jpg" alt="Turf"');
    expect(html).toContain('src="https://example.test/video.mp4" controls=""');
    expect(html).toContain('sandbox=""');
    expect(html).not.toMatch(/onclick|onerror|style=|autoplay|srcdoc|allow=/);
  });

  it("drops executable subtrees and unsafe URLs, including encoded browser-decoded attributes", () => {
    parsedSource([
      new ElementNode("script", {}, [new TextNode("attack()")]), new ElementNode("svg", {}, [new ElementNode("a", { href: "https://evil.test" })]),
      new ElementNode("a", { href: "javascript:attack()" }, [new TextNode("Safe label")]),
      new ElementNode("img", { src: "data:image/svg+xml,attack" }),
      new ElementNode("a", { href: "java\nscript:attack()" }),
      new ElementNode("span", { contenteditable: "false", id: "untrusted" }, [new TextNode("Kept")]),
    ]);
    const html = sanitizeLessonRichText("source");
    expect(html).not.toMatch(/script|svg|data:|contenteditable|id=/);
    expect(html).toContain("Safe label"); expect(html).toContain("Kept");
  });

  it("keeps registered asset URLs so existing signed-asset renewal still works", () => {
    const reference = "academy-asset:11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/44444444-4444-4444-8444-444444444444-image.jpg";
    parsedSource([new ElementNode("img", { src: reference })]);
    expect(sanitizeLessonRichText("source")).toContain(reference);
    expect(isLessonEditorLink(reference)).toBe(false);
  });

  it("escapes pasted content and accepts only complete safe web links", () => {
    expect(escapeLessonText('<img onerror="x">\n&')).toBe("&lt;img onerror=&quot;x&quot;&gt;<br>&amp;");
    for (const invalid of ["javascript:alert(1)", "data:text/html,test", "//example.test", "https://user:password@example.test", "https://example.test/white space"]) expect(isLessonEditorLink(invalid)).toBe(false);
    expect(isLessonEditorLink("https://example.test/resource?q=1")).toBe(true);
  });
});
