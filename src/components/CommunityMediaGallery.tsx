import { useState } from "react";
import { ExternalLink, FileText } from "lucide-react";
import type { CommunityMedia } from "../domain";
import { safeCommunityMediaUrl } from "../lib/communityMedia";

export function CommunityMediaGallery({ items, context = "Post" }: { items: CommunityMedia[]; context?: "Post" | "Comment" }) {
  const safeItems = items.filter(item => safeCommunityMediaUrl(item.url));
  if (!safeItems.length) return null;
  return <div className={`community-media-grid${safeItems.length === 1 ? " single" : ""}`} aria-label={`${context} attachments`}>
    {safeItems.map((item, index) => <MediaAttachment item={item} context={context} key={`${item.url}-${index}`} />)}
  </div>;
}

function MediaAttachment({ item, context }: { item: CommunityMedia; context: string }) {
  const [previewState, setPreviewState] = useState<"loading" | "ready" | "error">("loading");
  const label = item.label || `${context} attachment`;
  if (item.kind === "link" || item.kind === "file") return <AttachmentLink item={item} label={label} />;
  return <div className={`community-media-preview ${previewState}`} aria-busy={previewState === "loading"}>
    {previewState === "loading" && <span className="community-media-loading" role="status">Loading {item.kind}…</span>}
    {previewState !== "error" && (item.kind === "image"
      ? <a className="community-media-image" href={item.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${label}`}>
        <img src={item.url} alt={label} loading="lazy" onLoad={() => setPreviewState("ready")} onError={() => setPreviewState("error")} />
      </a>
      : <video className="community-media-video" src={item.url} controls playsInline preload="metadata" aria-label={label}
        onLoadedMetadata={() => setPreviewState("ready")} onError={() => setPreviewState("error")} />)}
    {previewState === "error" && <div className="community-media-error"><span>Preview unavailable</span><AttachmentLink item={item} label={label} /></div>}
  </div>;
}

function AttachmentLink({ item, label }: { item: CommunityMedia; label: string }) {
  return <a className="community-media-link" href={item.url} target="_blank" rel="noopener noreferrer">
    {item.kind === "file" ? <FileText size={17} aria-hidden="true" /> : <ExternalLink size={17} aria-hidden="true" />}
    <span><strong>{label}</strong><small>{item.kind === "file" ? "Open attachment" : "Open shared resource"}</small></span>
  </a>;
}
