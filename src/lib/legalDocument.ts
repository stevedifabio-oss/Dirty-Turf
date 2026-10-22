export type LegalDocumentName = "terms" | "privacy";

/** Display-only adaptation of our fixed generated documents, not an HTML sanitizer. */
export function legalDocumentForReader(html: string) {
  return html.replace(/<a(?=[\s>])(?:[^>"']|"[^"]*"|'[^']*')*>/gi, tag => {
    // Keep branding without copying href, target, event or other navigation
    // attributes into the sandbox. Anchor children and wording remain intact.
    const match = /\sclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const classes = (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").split(/\s+/)
      .filter(value => /^[a-z0-9_-]+$/i.test(value) && !["button", "secondary"].includes(value));
    return classes.length ? `<span class="${classes.join(" ")}">` : "<span>";
  }).replace(/<\/a\s*>/gi, "</span>");
}

/** Fetch fixed public documents as text so DENY framing headers stay intact. */
export async function loadLegalDocument(name: LegalDocumentName, signal?: AbortSignal, fetcher = fetch) {
  if (name !== "terms" && name !== "privacy") throw new Error("Document is unavailable.");
  const response = await fetcher(`/${name}.html`, { credentials: "omit", redirect: "error", signal });
  if (!response.ok) throw new Error("Document could not load.");
  const html = await response.text();
  if (html.length > 256 * 1024 || !/<main\b/i.test(html) || !/<title\b/i.test(html)) throw new Error("Document is unavailable.");
  return legalDocumentForReader(html);
}
