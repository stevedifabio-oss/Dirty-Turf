import { useRef } from "react";
import { captureLessonPlayback, restoreLessonPlayback, type LessonPlayback } from "../lib/lessonMedia";

type Props = { src: string; title: string; contentKey?: string };

/** Keep playback only when a signed query token changes for the same file. */
export function InlineLessonVideo({ src, title, contentKey = "" }: Props) {
  const identity = `${contentKey}|${fileIdentity(src)}`;
  const record = useRef<{ identity: string; loadedSrc: string | null; playback: LessonPlayback | null }>({ identity, loadedSrc: null, playback: null });
  const desired = useRef({ identity, src });
  desired.current = { identity, src };
  if (record.current.identity !== identity) record.current = { identity, loadedSrc: null, playback: null };

  const remember = (video: HTMLVideoElement) => {
    // Source replacement can dispatch pause/time events with a zeroed position.
    // Ignore all such events until the desired file's metadata has loaded.
    if (record.current.loadedSrc !== desired.current.src || video.readyState < 1 || video.error || !isDesiredSource(video, desired.current.src)) return;
    record.current.playback = captureLessonPlayback(video);
  };
  const loaded = (video: HTMLVideoElement) => {
    if (!isDesiredSource(video, desired.current.src)) return;
    const saved = record.current.playback;
    record.current.loadedSrc = desired.current.src;
    if (saved) {
      restoreLessonPlayback(video, saved);
      if (saved.paused) video.pause();
    } else record.current.playback = captureLessonPlayback(video);
  };

  return <video key={identity} className="lesson-video" aria-label={title} controls playsInline preload="metadata" src={src}
    onTimeUpdate={event => remember(event.currentTarget)} onPlay={event => remember(event.currentTarget)} onPause={event => remember(event.currentTarget)}
    onRateChange={event => remember(event.currentTarget)} onVolumeChange={event => remember(event.currentTarget)} onLoadedMetadata={event => loaded(event.currentTarget)}>
    Your browser does not support this video. <a href={src} target="_blank" rel="noopener noreferrer">Open lesson video</a>
  </video>;
}

function fileIdentity(value: string): string {
  try {
    const url = new URL(value);
    url.searchParams.delete("token");
    url.searchParams.sort();
    url.hash = "";
    return url.href;
  } catch { return value; }
}
function isDesiredSource(video: HTMLVideoElement, desired: string): boolean {
  try { return new URL(video.currentSrc || video.src).href === new URL(desired).href; } catch { return false; }
}
