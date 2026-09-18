import { createElement, Fragment, type ReactNode } from "react";

type Props = {
  html?: string;
  fallback?: string;
};

const containerTags = new Set([
  "article", "blockquote", "div", "figcaption", "figure", "li", "ol", "p", "pre", "span", "ul",
]);
const headingTags = new Set(["h1", "h2", "h3", "h4"]);
const inlineTags = new Set(["b", "code", "em", "i", "strong", "u"]);
const tableTags = new Set(["table", "tbody", "td", "th", "thead", "tr"]);
const discardedTags = new Set(["embed", "form", "input", "object", "script", "style"]);

export function SafeRichText({ html, fallback }: Props) {
  if (!html?.trim()) return fallback ? <p className="lesson-copy">{fallback}</p> : null;

  const documentNode = new DOMParser().parseFromString(html, "text/html");
  const content = Array.from(documentNode.body.childNodes).map((node, index) => renderNode(node, `root-${index}`));
  return <div className="lesson-rich-text">{content}</div>;
}

function renderNode(node: Node, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (!(node instanceof Element)) return null;

  const tag = node.tagName.toLowerCase();
  if (discardedTags.has(tag)) return null;
  const children = Array.from(node.childNodes).map((child, index) => renderNode(child, `${key}-${index}`));

  if (tag === "br" || tag === "hr") return createElement(tag, { key });
  if (tag === "a") {
    const href = safeRemoteUrl(node.getAttribute("href"));
    return href
      ? <a key={key} href={href} target="_blank" rel="noopener noreferrer">{children}</a>
      : <Fragment key={key}>{children}</Fragment>;
  }
  if (tag === "img") {
    const src = safeRemoteUrl(node.getAttribute("src"));
    if (!src) return null;
    return <img key={key} src={src} alt={node.getAttribute("alt") ?? "Lesson visual"} loading="lazy" />;
  }
  if (tag === "iframe" || tag === "video" || tag === "audio" || tag === "source") {
    const src = safeRemoteUrl(node.getAttribute("src"));
    return src ? <a className="lesson-embed-link" key={key} href={src} target="_blank" rel="noopener noreferrer">Open embedded lesson media</a> : null;
  }
  if (containerTags.has(tag) || headingTags.has(tag) || inlineTags.has(tag) || tableTags.has(tag)) {
    return createElement(tag, { key }, children);
  }
  return <Fragment key={key}>{children}</Fragment>;
}

function safeRemoteUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value, window.location.origin);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}
