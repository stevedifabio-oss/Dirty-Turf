/** Read our fixed public legal documents as inert, accessible React content. */
export type LegalReaderTag = "p" | "h3" | "h4" | "h5" | "h6" | "section" | "div" | "span" | "strong" | "em" | "ul" | "ol" | "li" | "br";
export type LegalReaderNode = string | { tag: LegalReaderTag; className?: string; children: LegalReaderNode[] };

const TAGS = new Set(["p", "section", "div", "span", "strong", "em", "ul", "ol", "li", "br"]);
const DISCARD = new Set(["script", "style", "iframe", "object", "embed", "template", "svg", "math", "link", "meta", "img", "video", "audio", "source"]);
const CLASSES = new Set(["eyebrow", "lede", "updated", "document", "callout", "contact-actions"]);

export function legalReaderNodes(html: string, parser: Pick<DOMParser, "parseFromString"> = new DOMParser()): LegalReaderNode[] {
  const parsed = parser.parseFromString(html, "text/html");
  const mains = parsed.getElementsByTagName("main");
  if (mains.length !== 1) throw new Error("Document is unavailable.");
  const read = (node: Node): LegalReaderNode[] => {
    if (node.nodeType === 3) return [node.textContent ?? ""];
    if (node.nodeType !== 1) return [];
    const element = node as Element;
    const originalTag = element.tagName.toLowerCase();
    if (DISCARD.has(originalTag)) return [];
    const children = Array.from(element.childNodes).flatMap(read);
    // The modal has its own h2. Preserve a logical heading outline inside it.
    const heading = /^h[1-6]$/.test(originalTag) ? `h${Math.min(6, Number(originalTag[1]) + 2)}` : undefined;
    if (!heading && !TAGS.has(originalTag)) return children;
    const className = (element.getAttribute("class") ?? "").split(/\s+/).filter(value => CLASSES.has(value)).join(" ");
    return [{ tag: (heading ?? originalTag) as LegalReaderTag, ...(className ? { className } : {}), children }];
  };
  return Array.from(mains[0].childNodes).flatMap(read);
}
