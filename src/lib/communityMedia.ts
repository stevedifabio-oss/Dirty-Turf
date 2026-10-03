import type { CommunityMedia } from "../domain";

type ImportedMedia = Record<string, unknown>;

/** Source attachments and signed private objects must have a public HTTPS destination. */
export function safeCommunityMediaUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 4096 || /[\u0000-\u0020\\]/.test(value)) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")
        || !url.hostname.includes(".") || /^(?:\d+\.){3}\d+$/.test(url.hostname) || url.hostname.includes(":")
        || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(url.hostname)) return undefined;
    return url.href;
  } catch { return undefined; }
}

export function communityMediaStoragePaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const storagePath = (item as ImportedMedia).storage_path;
    return typeof storagePath === "string" && storagePath.trim() ? [storagePath] : [];
  });
}

export function normalizeCommunityMediaItems(
  value: unknown,
  signedByPath: ReadonlyMap<string, string>,
): CommunityMedia[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const media = item as ImportedMedia;
    const storagePath = typeof media.storage_path === "string" ? media.storage_path : undefined;
    const originalUrl = safeCommunityMediaUrl(media.url);
    const signedUrl = storagePath ? safeCommunityMediaUrl(signedByPath.get(storagePath)) : undefined;
    const url = signedUrl ?? originalUrl;
    if (!url) return [];

    const mimeType = typeof media.mime_type === "string" ? media.mime_type.toLowerCase() : "";
    const kind: CommunityMedia["kind"] = mimeType.startsWith("image/")
      ? "image"
      : mimeType.startsWith("video/")
        ? "video"
        : mimeType ? (mimeType === "text/html" ? "link" : "file")
          : media.type === "image" || media.type === "video" || media.type === "file" ? media.type : "link";
    const providedLabel = [media.label, media.title, media.name]
      .find((candidate): candidate is string => typeof candidate === "string" && Boolean(candidate.trim()));
    const label = providedLabel?.trim() || hostnameLabel(originalUrl ?? url);

    return [{ kind, url, originalUrl: signedUrl ? originalUrl : undefined, label }];
  });
}

function hostnameLabel(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "") || "Attachment";
  } catch {
    return "Attachment";
  }
}
