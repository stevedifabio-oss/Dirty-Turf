import { isLessonContentUrl } from "./lessonContent";

const allowed = new Set(["article", "blockquote", "div", "figcaption", "figure", "li", "ol", "p", "pre", "span", "ul", "h1", "h2", "h3", "h4", "h5", "h6", "b", "code", "em", "i", "strong", "u", "table", "tbody", "td", "th", "thead", "tr", "br", "hr", "a", "img", "video", "audio", "source", "iframe"]);
const discarded = new Set(["embed", "form", "input", "math", "object", "script", "style", "svg", "template"]);

/** Build fresh allowlisted DOM before mounting imported content in an editor. */
export function sanitizeLessonRichText(html: string): string {
  if (typeof DOMParser === "undefined") return escapeLessonText(html);
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const output = parsed.implementation.createHTMLDocument("");
  const copy = (node: Node, parent: Node) => {
    if (node.nodeType === 3) { parent.appendChild(output.createTextNode(node.textContent || "")); return; }
    if (node.nodeType !== 1) return;
    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    if (discarded.has(tag)) return;
    if (!allowed.has(tag)) { Array.from(node.childNodes).forEach(child => copy(child, parent)); return; }
    const clean = output.createElement(tag);
    if (["a", "img", "video", "audio", "source", "iframe"].includes(tag)) {
      const attribute = tag === "a" ? "href" : "src";
      const url = element.getAttribute(attribute);
      if (url && isLessonContentUrl(url)) clean.setAttribute(attribute, url);
      if (tag === "a") { clean.setAttribute("target", "_blank"); clean.setAttribute("rel", "noopener noreferrer"); }
      if (tag === "img") clean.setAttribute("alt", element.getAttribute("alt") || "");
      if (tag === "video" || tag === "audio") { clean.setAttribute("controls", ""); clean.setAttribute("preload", "none"); }
      if (tag === "video") clean.setAttribute("playsinline", "");
      // Imported frames remain visible but cannot execute scripts in the editor.
      // The member renderer retains its separate supported-provider policy.
      if (tag === "iframe") { clean.setAttribute("sandbox", ""); clean.setAttribute("title", element.getAttribute("title") || "Embedded lesson media"); }
    }
    Array.from(node.childNodes).forEach(child => copy(child, clean));
    parent.appendChild(clean);
  };
  Array.from(parsed.body.childNodes).forEach(node => copy(node, output.body));
  return output.body.innerHTML;
}

export function escapeLessonText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;").replace(/\r\n?|\n/g, "<br>");
}

export function isLessonEditorLink(value: string): boolean {
  return isLessonContentUrl(value) && !value.startsWith("academy-asset:");
}
