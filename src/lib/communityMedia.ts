import type { CommunityMedia } from "../domain";
import { safeExternalUrl } from "./safeExternalUrl";

type ImportedMedia = Record<string, unknown>;

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
    const originalUrl = safeExternalUrl(typeof media.url === "string" ? media.url : undefined);
    const signedUrl = storagePath ? safeExternalUrl(signedByPath.get(storagePath)) : undefined;
    const url = signedUrl ?? originalUrl;
    if (!url) return [];

    const mimeType = typeof media.mime_type === "string" ? media.mime_type.toLowerCase() : "";
    const kind: CommunityMedia["kind"] = mimeType.startsWith("image/")
      ? "image"
      : mimeType.startsWith("video/")
        ? "video"
        : "link";
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
