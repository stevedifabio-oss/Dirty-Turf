import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Capacitor } from "@capacitor/core";
import { ExternalLink, FileText, PlayCircle } from "lucide-react";
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
  if (item.kind === "video") return <CommunityVideoAttachment item={item} label={label} />;
  return <div className={`community-media-preview ${previewState}`} aria-busy={previewState === "loading"}>
    {previewState === "loading" && <span className="community-media-loading" role="status">Loading {item.kind}…</span>}
    {previewState !== "error" && <a className="community-media-image" href={item.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${label}`}>
        <img src={item.url} alt={label} loading="lazy" onLoad={() => setPreviewState("ready")} onError={() => setPreviewState("error")} />
      </a>}
    {previewState === "error" && <div className="community-media-error"><span>Preview unavailable</span><AttachmentLink item={item} label={label} /></div>}
  </div>;
}

let activeCommunityVideo: HTMLVideoElement | null = null;

/** A feed must not fetch every video's metadata before the member chooses one. */
export function CommunityVideoAttachment({ item, label }: { item: CommunityMedia; label: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [requested, setRequested] = useState(false);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");

  useEffect(() => {
    let disposed = false;
    let removeNative: (() => Promise<void>) | undefined;
    const video = videoRef.current;
    const pause = () => { video?.pause(); };
    const visibility = () => { if (document.visibilityState === "hidden") pause(); };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", pause);
    if (Capacitor.isNativePlatform()) {
      void import("@capacitor/app").then(async ({ App }) => {
        if (disposed) return;
        const handle = await App.addListener("appStateChange", ({ isActive }) => { if (!isActive) pause(); });
        if (disposed) await handle.remove();
        else removeNative = () => handle.remove();
      }).catch(() => undefined);
    }
    return () => {
      disposed = true;
      pause();
      if (activeCommunityVideo === video) activeCommunityVideo = null;
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", pause);
      void removeNative?.().catch(() => undefined);
    };
  }, []);

  const play = (event: MouseEvent<HTMLButtonElement>) => {
    const video = videoRef.current;
    if (!video) return;
    setRequested(true);
    setState("loading");
    // This retained DOM node owns src. A React src update after play() can reload
    // even the same URL and abort the gesture's playback request on mobile.
    video.hidden = false;
    video.preload = "metadata";
    video.src = item.url;
    video.load();
    // The start/retry button disappears. Keep keyboard users at the player;
    // pointer taps retain the platform's normal video focus behavior.
    if (event.detail === 0) video.focus({ preventScroll: true });
    void video.play().catch(() => {
      // If the platform requires another tap, expose its controls. Network and
      // codec failures still use onError and the explicit retry/link fallback.
      setState(video.error ? "error" : "ready");
    });
  };
  const playing = (video: HTMLVideoElement) => {
    if (activeCommunityVideo && activeCommunityVideo !== video) activeCommunityVideo.pause();
    activeCommunityVideo = video;
    setState("ready");
  };

  return <div className={`community-media-preview community-video-preview ${state}`} aria-busy={state === "loading"}>
    {!requested && <button type="button" className="community-media-video community-media-video-start" aria-label={`Play ${label}`} onClick={play}>
      <PlayCircle size={34} aria-hidden="true" /><strong>Play video</strong><span>{label}</span>
    </button>}
    {state === "loading" && <span className="community-media-loading" role="status">Loading video…</span>}
    <video ref={videoRef} className="community-media-video" hidden={!requested || state === "error"}
      controls playsInline tabIndex={0} preload={requested ? "metadata" : "none"} aria-label={label}
      onPlay={event => playing(event.currentTarget)} onLoadedMetadata={() => setState("ready")} onError={() => setState("error")} />
    {state === "error" && <div className="community-media-error"><span>Video unavailable</span><button type="button" onClick={play}>Try video again</button><AttachmentLink item={item} label={label} /></div>}
  </div>;
}

function AttachmentLink({ item, label }: { item: CommunityMedia; label: string }) {
  return <a className="community-media-link" href={item.url} target="_blank" rel="noopener noreferrer">
    {item.kind === "file" ? <FileText size={17} aria-hidden="true" /> : <ExternalLink size={17} aria-hidden="true" />}
    <span><strong>{label}</strong><small>{item.kind === "file" ? "Open attachment" : "Open shared resource"}</small></span>
  </a>;
}
