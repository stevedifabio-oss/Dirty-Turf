export type LessonContentBlock =
  | { id: string; type: "text"; text: string }
  | { id: string; type: "image"; url: string; alt: string; caption: string }
  | { id: string; type: "video"; url: string; caption: string }
  | { id: string; type: "link"; url: string; label: string }
  | { id: string; type: "legacy"; html: string };

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
// This recognizes the reference written by the registered lesson upload RPC.
// Registration/ownership still comes from academy_assets and its signing RLS.
const assetReference = new RegExp(`^academy-asset:${uuid}/${uuid}/${uuid}/${uuid}-[a-z0-9._-]+$`);

export function isLessonContentUrl(value: string): boolean {
  if (typeof value !== "string" || value !== value.trim() || /[\u0000-\u0020\u007f]/.test(value)) return false;
  if (assetReference.test(value)) return true;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
  } catch { return false; }
}

/** Reject malformed structured content instead of silently losing imported data. */
export function validateLessonContentBlocks(value: unknown): string[] {
  if (!Array.isArray(value)) return ["Lesson content must be a list of blocks."];
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const [index, block] of value.entries()) {
    const label = `Block ${index + 1}`;
    if (!isRecord(block)) { errors.push(`${label} is invalid.`); continue; }
    if (typeof block.id !== "string" || !block.id.trim() || ids.has(block.id)) errors.push(`${label} needs a unique ID.`);
    if (typeof block.id === "string") ids.add(block.id);
    switch (block.type) {
      case "text": if (typeof block.text !== "string") errors.push(`${label} needs text.`); break;
      case "legacy": if (typeof block.html !== "string") errors.push(`${label} needs its original content.`); break;
      case "image":
        if (typeof block.alt !== "string" || typeof block.caption !== "string") errors.push(`${label} needs image descriptions.`);
        if (typeof block.url !== "string" || !isLessonContentUrl(block.url)) errors.push(`${label} needs a valid image URL or registered lesson file.`);
        break;
      case "video":
        if (typeof block.caption !== "string") errors.push(`${label} needs a video caption.`);
        if (typeof block.url !== "string" || !isLessonContentUrl(block.url)) errors.push(`${label} needs a valid video URL or registered lesson file.`);
        break;
      case "link":
        if (typeof block.label !== "string") errors.push(`${label} needs a link label.`);
        if (typeof block.url !== "string" || !isLessonContentUrl(block.url)) errors.push(`${label} needs a valid link URL or registered lesson file.`);
        break;
      default: errors.push(`${label} has an unsupported content type.`);
    }
  }
  return errors;
}

export function lessonContentBlocks(body: unknown): LessonContentBlock[] {
  if (isRecord(body) && "contentBlocks" in body) {
    const errors = validateLessonContentBlocks(body.contentBlocks);
    if (errors.length) throw new Error(errors.join(" "));
    return (body.contentBlocks as LessonContentBlock[]).map(block => ({ ...block }));
  }
  if (isRecord(body) && typeof body.html === "string" && body.html.trim()) return [{ id: "legacy-content", type: "legacy", html: body.html }];
  if (typeof body === "string") return body ? [{ id: "legacy-text", type: "text", text: body }] : [];
  if (isRecord(body)) {
    for (const key of ["text", "content", "description"] as const) {
      if (typeof body[key] === "string" && body[key]) return [{ id: "legacy-text", type: "text", text: body[key] }];
    }
  }
  return [];
}

/** Preserve quiz/provider fields; HTML stays compatible with existing app builds. */
export function lessonContentBody(body: unknown, blocks: LessonContentBlock[]): Record<string, unknown> {
  const errors = validateLessonContentBlocks(blocks);
  if (errors.length) throw new Error(errors.join(" "));
  const saved = { ...(isRecord(body) ? body : {}) };
  // Content aliases must not keep stale text above the new authored content.
  delete saved.content;
  delete saved.description;
  saved.contentBlocks = blocks.map(block => ({ ...block }));
  saved.html = blocksHtml(blocks);
  saved.text = blocks.map(block => block.type === "text" ? block.text : block.type === "legacy" ? plainText(block.html) : block.type === "image" ? block.caption || block.alt : block.type === "video" ? block.caption : block.label || block.url).filter(Boolean).join("\n\n");
  return saved;
}

/** Use the existing bodyHtml renewal path for every inline image/video/link. */
export function lessonContentMarkup(body: unknown, assetUrls?: Map<string, string>): string | undefined {
  if (!isRecord(body)) return undefined;
  if (!("contentBlocks" in body)) return typeof body.html === "string" && body.html.trim() ? body.html : undefined;
  let parsed: LessonContentBlock[];
  try { parsed = lessonContentBlocks(body); } catch {
    // Preserve readable compatibility content if a stored structured payload is
    // malformed. Authoring parse/save remains strict and must hold that payload.
    return typeof body.html === "string" && body.html.trim() ? body.html : undefined;
  }
  const blocks = parsed.map(block => {
    if (!("url" in block)) return block;
    const signed = assetUrls?.get(block.url);
    return signed && isLessonContentUrl(signed) && !signed.startsWith("academy-asset:") ? { ...block, url: signed } : block;
  });
  return blocksHtml(blocks) || undefined;
}

function blocksHtml(blocks: LessonContentBlock[]): string {
  return blocks.map(block => {
    switch (block.type) {
      case "legacy": return block.html;
      case "text": return `<p>${escapeHtml(block.text).replace(/\r\n?|\n/g, "<br />")}</p>`;
      case "image": return `<figure><img src="${escapeHtml(block.url)}" alt="${escapeHtml(block.alt)}" />${block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : ""}</figure>`;
      case "video": return `<figure><video src="${escapeHtml(block.url)}" controls playsinline preload="metadata"></video>${block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : ""}</figure>`;
      case "link": return `<p><a href="${escapeHtml(block.url)}">${escapeHtml(block.label || block.url)}</a></p>`;
    }
  }).join("\n");
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function plainText(html: string): string {
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "").replace(/<br\s*\/?\s*>|<\/(?:p|div|li|h[1-6])\s*>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/[ \t]+/g, " ").trim();
}
function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
