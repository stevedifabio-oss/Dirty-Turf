import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { InlineLessonVideo } from "./InlineLessonVideo";

const hooks = vi.hoisted(() => ({ active: null as null | { slots: any[]; cursor: number } }));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useRef: (initial: any) => {
    if (!hooks.active) throw new Error("Render the inline player through its hook harness");
    const index = hooks.active.cursor++;
    return hooks.active.slots[index] ??= { current: initial };
  },
}));
type VideoElement = ReactElement<Record<string, any>>;
const originalSrc = "https://example.test/storage/v1/object/sign/academy-assets/lesson/video.mp4?token=old";
const freshSrc = originalSrc.replace("token=old", "token=fresh");
function player() {
  const state = { slots: [] as any[], cursor: 0 };
  return (src = originalSrc, contentKey = "lesson-one") => {
    state.cursor = 0; hooks.active = state;
    try { return InlineLessonVideo({ src, contentKey, title: "Demonstration" }) as VideoElement; } finally { hooks.active = null; }
  };
}
function video(src: string) {
  const media = { src, currentSrc: src, currentTime: 0, duration: 120, paused: true, playbackRate: 1, volume: 1, muted: false, readyState: 1, error: null as null | object,
    play: vi.fn(() => { media.paused = false; return Promise.resolve(); }), pause: vi.fn(() => { media.paused = true; }) };
  return media;
}
function fire(element: VideoElement, event: string, media: ReturnType<typeof video>) { element.props[event]({ currentTarget: media }); }

describe("inline lesson video renewal", () => {
  it("restores time and playback preferences across a same-file signed token change", () => {
    const render = player();
    let element = render(); const media = video(originalSrc);
    fire(element, "onLoadedMetadata", media);
    media.currentTime = 47; media.paused = false; fire(element, "onPlay", media);
    media.playbackRate = 1.5; fire(element, "onRateChange", media);
    media.volume = .35; media.muted = true; fire(element, "onVolumeChange", media);
    fire(element, "onTimeUpdate", media);
    const priorKey = element.key;
    element = render(freshSrc);
    expect(element.key).toBe(priorKey);
    // Browser source replacement pauses/resets media before fresh metadata.
    media.src = freshSrc; media.currentSrc = freshSrc; media.currentTime = 0; media.paused = true; media.readyState = 0;
    fire(element, "onPause", media); fire(element, "onTimeUpdate", media);
    media.readyState = 1; media.playbackRate = 1; media.volume = 1; media.muted = false;
    fire(element, "onLoadedMetadata", media);
    expect(media).toMatchObject({ currentTime: 47, paused: false, playbackRate: 1.5, volume: .35, muted: true });
    expect(media.play).toHaveBeenCalledOnce();
    expect(element.props).toMatchObject({ controls: true, playsInline: true, preload: "metadata" });
  });

  it("retains a deliberately paused player without restarting it automatically", () => {
    const render = player(); const media = video(originalSrc);
    const original = render(); fire(original, "onLoadedMetadata", media);
    media.currentTime = 22; fire(original, "onPause", media);
    const renewed = render(freshSrc);
    media.src = freshSrc; media.currentSrc = freshSrc; media.currentTime = 0;
    fire(renewed, "onLoadedMetadata", media);
    expect(media.currentTime).toBe(22);
    expect(media.paused).toBe(true);
    expect(media.pause).toHaveBeenCalledOnce();
    expect(media.play).not.toHaveBeenCalled();
  });

  it("ignores late events from the previous source until the desired URL loads", () => {
    const render = player(); const previous = video(originalSrc);
    const original = render(); fire(original, "onLoadedMetadata", previous);
    previous.currentTime = 34; previous.paused = false; fire(original, "onTimeUpdate", previous);
    const renewed = render(freshSrc);
    previous.currentTime = 0; previous.paused = true;
    fire(original, "onPause", previous); fire(renewed, "onLoadedMetadata", previous);
    const current = video(freshSrc); fire(renewed, "onLoadedMetadata", current);
    expect(current.currentTime).toBe(34);
    expect(current.paused).toBe(false);
    expect(previous.play).not.toHaveBeenCalled();
  });

  it.each([
    [originalSrc.replace("video.mp4", "another.mp4"), "lesson-one"],
    [originalSrc, "lesson-two"],
    [originalSrc + "&quality=different", "lesson-one"],
  ])("resets playback for another file, lesson or non-token content selector", (nextSrc, nextLesson) => {
    const render = player(); const previous = video(originalSrc);
    const original = render(); fire(original, "onLoadedMetadata", previous);
    previous.currentTime = 61; previous.paused = false; fire(original, "onTimeUpdate", previous);
    const next = render(nextSrc, nextLesson); const current = video(nextSrc);
    expect(next.key).not.toBe(original.key);
    fire(next, "onLoadedMetadata", current);
    expect(current.currentTime).toBe(0);
    expect(current.playbackRate).toBe(1);
    expect(current.paused).toBe(true);
    expect(current.play).not.toHaveBeenCalled();
  });
});
