import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LessonContentBlock } from "../lib/lessonContent";
import { LessonContent } from "./LessonContent";

type Element = ReactElement<Record<string, any>>;
const nativePlayer = (row: Element) => typeof row.type === "function" && row.type.name === "InlineLessonVideo";
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
const asset = "academy-asset:11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/44444444-4444-4444-8444-444444444444-lesson.mp4";
afterEach(() => vi.unstubAllGlobals());

describe("mixed lesson member rendering", () => {
  it("renders ordered text, photographs, playable videos, captions and resource links", () => {
    const blocks: LessonContentBlock[] = [
      { id: "intro", type: "text", text: "Inspect before cleaning." },
      { id: "photo", type: "image", url: "https://example.test/before.jpg", alt: "Turf surface", caption: "Before cleaning" },
      { id: "demo", type: "video", url: "https://example.test/demo.mp4", caption: "Safe technique" },
      { id: "wrap", type: "text", text: "Now review the checklist." },
      { id: "guide", type: "link", url: "https://example.test/checklist.pdf", label: "Open checklist" },
    ];
    const tree = LessonContent({ blocks });
    const rows = elements(tree);
    const video = rows.find(nativePlayer)!;
    expect(video.props).toMatchObject({ src: "https://example.test/demo.mp4" });
    expect(rows.find(row => row.type === "img")?.props).toMatchObject({ alt: "Turf surface", loading: "lazy" });
    expect(rows.filter(row => row.type === "figcaption").map(row => row.props.children)).toEqual(["Before cleaning", "Safe technique"]);
    const html = renderToStaticMarkup(tree);
    expect(html).toMatch(/<video[^>]*controls=""[^>]*playsInline=""[^>]*preload="metadata"/);
    expect(html.indexOf("Inspect before")).toBeLessThan(html.indexOf("before.jpg"));
    expect(html.indexOf("before.jpg")).toBeLessThan(html.indexOf("demo.mp4"));
    expect(html.indexOf("demo.mp4")).toBeLessThan(html.indexOf("Now review"));
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("escapes authored text and never mounts unsupported URL schemes", () => {
    const attack = '<img src=x onerror="alert(1)"><script>alert(1)</script>';
    const tree = LessonContent({ blocks: [
      { id: "text", type: "text", text: attack },
      { id: "image", type: "image", url: "javascript:alert(1)", alt: attack, caption: attack },
      { id: "video", type: "video", url: "data:text/html,<script>alert(1)</script>", caption: attack },
      { id: "link", type: "link", url: "//example.test/relative", label: attack },
    ] });
    const html = renderToStaticMarkup(tree);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:text");
    expect(elements(tree).filter(row => row.props.role === "status")).toHaveLength(3);
    expect(html).toContain("&lt;script&gt;");
  });

  it("holds unresolved registered assets and permits object URLs only from an explicit UI preview map", () => {
    const block: LessonContentBlock = { id: "video", type: "video", url: asset, caption: "Pending demonstration" };
    const held = LessonContent({ blocks: [block] });
    expect(elements(held).some(nativePlayer)).toBe(false);
    expect(elements(held).find(row => row.props.role === "status")?.props.children).toContain("unavailable");
    const local = "blob:https://app.example/11111111-1111-4111-8111-111111111111";
    const preview = LessonContent({ blocks: [block], localMedia: { video: local } });
    expect(elements(preview).find(nativePlayer)?.props.src).toBe(local);
    expect(elements(LessonContent({ blocks: [{ ...block, url: local }] })).some(nativePlayer)).toBe(false);
    const signed = "https://example.test/storage/v1/object/sign/academy-assets/video.mp4?token=signed";
    expect(elements(LessonContent({ blocks: [block], localMedia: { video: signed } })).find(nativePlayer)?.props.src).toBe(signed);
    expect(elements(LessonContent({ blocks: [block], localMedia: { video: "data:video/mp4,unsafe" } })).some(nativePlayer)).toBe(false);
  });

  it.each([
    ["https://youtu.be/dQw4w9WgXcQ?t=10", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0"],
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0"],
    ["https://player.vimeo.com/video/12345678?h=abc123", "https://player.vimeo.com/video/12345678?h=abc123"],
  ])("embeds only canonical supported video providers: %s", (url, expected) => {
    const iframe = elements(LessonContent({ blocks: [{ id: "video", type: "video", url, caption: "Demonstration" }] })).find(row => row.type === "iframe")!;
    expect(iframe.props.src).toBe(expected);
    expect(iframe.props).toMatchObject({ title: "Demonstration", allowFullScreen: true, loading: "lazy", sandbox: "allow-scripts allow-same-origin allow-presentation" });
    expect(iframe.props.allow).not.toContain("autoplay");
  });

  it("does not embed lookalike provider hosts", () => {
    const tree = LessonContent({ blocks: [{ id: "video", type: "video", url: "https://www.youtube.com.evil.example/embed/dQw4w9WgXcQ", caption: "Demo" }] });
    expect(elements(tree).some(row => row.type === "iframe")).toBe(false);
    expect(elements(tree).some(nativePlayer)).toBe(true);
    expect(renderToStaticMarkup(tree)).toMatch(/<video[^>]*controls=""/);
  });

  it("strips dangerous attributes from parsed legacy HTML while keeping formatting and playable media", () => {
    // DOMParser itself is browser-owned. Supply adversarial parsed DOM nodes to
    // exercise the real sanitizer branches without another DOM dependency.
    class ParsedText { nodeType = 3; constructor(public textContent: string) {} }
    class ParsedElement {
      nodeType = 1;
      tagName: string;
      constructor(tag: string, public attrs: Record<string, string> = {}, public childNodes: Array<ParsedElement | ParsedText> = []) { this.tagName = tag.toUpperCase(); }
      getAttribute(name: string) { return this.attrs[name] ?? null; }
      querySelector(selector: string) { return this.childNodes.find(node => node instanceof ParsedElement && node.tagName.toLowerCase() === selector) as ParsedElement | undefined; }
    }
    const parsed = [
      new ParsedElement("p", { onclick: "alert(1)", style: "color:red" }, [new ParsedElement("strong", {}, [new ParsedText("Imported safety instructions")])]),
      new ParsedElement("script", {}, [new ParsedText("alert(1)")]),
      new ParsedElement("img", { src: "https://example.test/photo.jpg", alt: "Original photo", onerror: "alert(1)" }),
      new ParsedElement("video", { autoplay: "", onplay: "alert(1)" }, [new ParsedElement("source", { src: "https://example.test/demo.mp4" })]),
      new ParsedElement("a", { href: "javascript:alert(1)" }, [new ParsedText("Unsafe link text remains readable")]),
      new ParsedElement("iframe", { src: "https://www.youtube.com/embed/dQw4w9WgXcQ", srcdoc: "<script>alert(1)</script>", onload: "alert(1)" }),
    ];
    vi.stubGlobal("Node", class { static TEXT_NODE = 3; });
    vi.stubGlobal("Element", ParsedElement);
    vi.stubGlobal("DOMParser", class { parseFromString() { return { body: { childNodes: parsed } }; } });
    const html = renderToStaticMarkup(LessonContent({ html: "<p>Imported source</p>" }));
    expect(html).toContain("<strong>Imported safety instructions</strong>");
    expect(html).toContain('alt="Original photo"');
    expect(html).toMatch(/<video[^>]*controls=""[^>]*playsInline=""[^>]*preload="metadata"[^>]*src="https:\/\/example.test\/demo.mp4"/);
    expect(html).toContain("youtube-nocookie.com/embed/dQw4w9WgXcQ");
    for (const unsafe of ["onclick", "onerror", "onplay", "onload", "srcdoc", "javascript:", "<script", "autoplay"]) expect(html).not.toContain(unsafe);
  });
});
