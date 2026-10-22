import { createElement, Fragment, type ReactNode } from "react";
import { isLessonContentUrl, type LessonContentBlock } from "../lib/lessonContent";
import { InlineLessonVideo } from "./InlineLessonVideo";

type Props = {
  blocks?: LessonContentBlock[];
  html?: string;
  fallback?: string;
  /** UI-owned file previews only; object URLs are never read from lesson data. */
  localMedia?: Record<string, string>;
  contentKey?: string;
};

const containers = new Set(["article", "blockquote", "div", "figcaption", "figure", "li", "ol", "p", "pre", "span", "ul"]);
const headings = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const inline = new Set(["b", "code", "em", "i", "strong", "u"]);
const tables = new Set(["table", "tbody", "td", "th", "thead", "tr"]);
const discarded = new Set(["embed", "form", "input", "math", "object", "script", "style", "svg"]);
const figureStyle = { margin: "16px 0", minWidth: 0 } as const;

/** Render mixed lesson content without trusting imported HTML attributes. */
export function LessonContent({ blocks, html, fallback, localMedia, contentKey }: Props) {
  if (blocks) {
    return <div className="lesson-rich-text lesson-content-blocks">{blocks.map(block => {
      const url = "url" in block ? previewMedia(localMedia?.[block.id]) || remoteMedia(block.url) : null;
      switch (block.type) {
        case "text": return <p className="lesson-copy" key={block.id}>{block.text}</p>;
        case "legacy": return <LessonContent key={block.id} html={block.html} contentKey={`${contentKey || ""}:${block.id}`} />;
        case "image": return <figure key={block.id} style={figureStyle}>{url ? <img src={url} alt={block.alt} loading="lazy" /> : unavailableMedia()}{block.caption && <figcaption>{block.caption}</figcaption>}</figure>;
        case "video": return <figure key={block.id} style={figureStyle}>{url ? video(url, block.caption || "Lesson video", block.id, contentKey) : unavailableMedia()}{block.caption && <figcaption>{block.caption}</figcaption>}</figure>;
        case "link": return <p key={block.id}>{url ? <a href={url} target="_blank" rel="noopener noreferrer">{block.label || "Open lesson resource"}</a> : unavailableMedia()}</p>;
      }
    })}</div>;
  }
  if (!html?.trim()) return fallback ? <p className="lesson-copy">{fallback}</p> : null;
  // The browser supplies DOMParser. SSR still displays safe text, never raw HTML.
  if (typeof DOMParser === "undefined") return <p className="lesson-copy">{fallback || html.replace(/<[^>]+>/g, " ")}</p>;
  const documentNode = new DOMParser().parseFromString(html, "text/html");
  return <div className="lesson-rich-text">{Array.from(documentNode.body.childNodes).map((node, index) => renderNode(node, `content-${index}`, contentKey))}</div>;
}

function renderNode(node: Node, key: string, contentKey?: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (!(node instanceof Element)) return null;
  const tag = node.tagName.toLowerCase();
  if (discarded.has(tag)) return null;
  const children = Array.from(node.childNodes).map((child, index) => renderNode(child, `${key}-${index}`, contentKey));
  if (tag === "br" || tag === "hr") return createElement(tag, { key });
  if (tag === "a") {
    const href = remoteMedia(node.getAttribute("href"));
    return href ? <a key={key} href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <Fragment key={key}>{children}</Fragment>;
  }
  if (tag === "img") {
    const src = remoteMedia(node.getAttribute("src"));
    return src ? <img key={key} src={src} alt={node.getAttribute("alt") || "Lesson visual"} loading="lazy" /> : unavailableMedia(key);
  }
  if (tag === "video") {
    const src = remoteMedia(node.getAttribute("src") || node.querySelector("source")?.getAttribute("src") || null);
    return src ? video(src, "Lesson video", key, contentKey) : unavailableMedia(key);
  }
  if (tag === "iframe") {
    const src = remoteMedia(node.getAttribute("src"));
    if (!src) return unavailableMedia(key);
    const embed = embedVideo(src);
    return embed ? player(embed, node.getAttribute("title") || "Lesson video", key) : <a className="lesson-embed-link" key={key} href={src} target="_blank" rel="noopener noreferrer">Open embedded lesson media</a>;
  }
  if (tag === "audio") {
    const src = remoteMedia(node.getAttribute("src") || node.querySelector("source")?.getAttribute("src") || null);
    return src ? <audio key={key} controls preload="metadata" src={src}>Your browser does not support this audio. <a href={src} target="_blank" rel="noopener noreferrer">Open audio</a></audio> : unavailableMedia(key);
  }
  if (tag === "source") return null;
  if (containers.has(tag) || headings.has(tag) || inline.has(tag) || tables.has(tag)) return createElement(tag, { key, ...(tag === "figure" ? { style: figureStyle } : {}) }, children);
  return <Fragment key={key}>{children}</Fragment>;
}

function remoteMedia(value: string | null): string | null {
  return value && isLessonContentUrl(value) && !value.startsWith("academy-asset:") ? value : null;
}
function previewMedia(value: string | undefined): string | null {
  if (!value) return null;
  return remoteMedia(value) || (/^blob:(?:https?:\/\/[^/\s]+|null)\/[a-zA-Z0-9-]+$/.test(value) ? value : null);
}
function unavailableMedia(key?: string) {
  return <span key={key} className="lesson-media-unavailable" role="status">Lesson file is unavailable. Refresh the lesson to reconnect.</span>;
}
function video(src: string, title: string, key: string, contentKey?: string): ReactNode {
  const embed = embedVideo(src);
  return embed ? player(embed, title, key) : <InlineLessonVideo key={`${contentKey || ""}:${key}`} src={src} title={title} contentKey={contentKey} />;
}
function player(src: string, title: string, key: string): ReactNode {
  return <iframe className="lesson-video" key={key} src={src} title={title} loading="lazy" allow="encrypted-media; fullscreen; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-presentation" style={{ border: 0 }} />;
}
function embedVideo(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const path = url.pathname.split("/").filter(Boolean);
    if (["youtube.com", "www.youtube.com", "m.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com", "youtu.be", "www.youtu.be"].includes(url.hostname)) {
      const id = url.hostname.endsWith("youtu.be") ? path[0] : path[0] === "watch" ? url.searchParams.get("v") : ["embed", "shorts"].includes(path[0]) ? path[1] : null;
      return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? `https://www.youtube-nocookie.com/embed/${id}?rel=0` : null;
    }
    if (["vimeo.com", "www.vimeo.com", "player.vimeo.com"].includes(url.hostname)) {
      const id = url.hostname === "player.vimeo.com" && path[0] === "video" ? path[1] : path[0];
      const privacyHash = url.searchParams.get("h") || (url.hostname !== "player.vimeo.com" ? path[1] : null);
      if (!id || !/^\d+$/.test(id)) return null;
      return `https://player.vimeo.com/video/${id}${privacyHash && /^[a-zA-Z0-9]+$/.test(privacyHash) ? `?h=${privacyHash}` : ""}`;
    }
    return null;
  } catch { return null; }
}
