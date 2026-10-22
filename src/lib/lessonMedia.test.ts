import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Course, Lesson } from "../domain";
import { applyLessonAssetPatch, captureLessonPlayback, createLessonAssetRenewal, lessonAssetExpiry, requestedAcademyLesson, restoreLessonPlayback, type LessonAssetPatch } from "./lessonMedia";

const now = 1_800_000_000_000;
function signed(exp: number) {
  const payload = btoa(JSON.stringify({ exp })).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  return `https://example.supabase.co/storage/v1/object/sign/academy-assets/lesson/video.mp4?token=header.${payload}.signature`;
}
function fresh(): LessonAssetPatch {
  return { bodyHtml: "<p>Same lesson</p>", videoUrl: signed((now + 3_600_000) / 1000), resources: [], expiresAt: now + 3_600_000 };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => vi.useRealTimers());

describe("lesson media renewal", () => {
  it("reads the earliest private media expiry without trusting malformed or external tokens", () => {
    expect(lessonAssetExpiry({ videoUrl: signed((now + 90_000) / 1000), resources: [{ title: "Guide", url: signed((now + 30_000) / 1000) }] })).toBe(now + 30_000);
    expect(lessonAssetExpiry({ videoUrl: "https://external.invalid/video.mp4?token=bad.payload.signature" })).toBeUndefined();
    expect(lessonAssetExpiry({ bodyHtml: '<img src="https://example.supabase.co/storage/v1/object/sign/academy-assets/a?token=bad">' })).toBeUndefined();
  });

  it("renews a long-open lesson one minute before expiration without loading the workspace", async () => {
    const renew = vi.fn().mockResolvedValue(fresh());
    const apply = vi.fn();
    const status = vi.fn();
    const controller = createLessonAssetRenewal({ lessonId: "lesson-a", expiresAt: now + 120_000, renew, apply, status });
    await vi.advanceTimersByTimeAsync(59_999);
    expect(renew).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(renew).toHaveBeenCalledExactlyOnceWith("lesson-a");
    expect(apply).toHaveBeenCalledWith(fresh());
    expect(status).toHaveBeenLastCalledWith("ready");
    controller.dispose();
  });

  it("skips fresh resume checks and coalesces overlapping resume/error requests", async () => {
    const wait = deferred<LessonAssetPatch>();
    const renew = vi.fn(() => wait.promise);
    const controller = createLessonAssetRenewal({ lessonId: "lesson-a", expiresAt: now + 120_000, renew, apply: vi.fn(), status: vi.fn() });
    expect(await controller.request("resume")).toBe(false);
    const first = controller.request("manual");
    expect(await controller.request("resume")).toBe(false);
    expect(await controller.request("error")).toBe(false);
    wait.resolve(fresh());
    expect(await first).toBe(true);
    expect(renew).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it("bounds automatic media errors even when new signed links return another broken asset", async () => {
    const renew = vi.fn().mockResolvedValue(fresh());
    const controller = createLessonAssetRenewal({ lessonId: "lesson-a", renew, apply: vi.fn(), status: vi.fn() });
    expect(await controller.request("error")).toBe(true);
    expect(await controller.request("error")).toBe(false);
    expect(await controller.request("manual")).toBe(true);
    expect(await controller.request("error")).toBe(false);
    expect(renew).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it("preserves loaded lesson content on signing failure and offers a deliberate retry", async () => {
    const renew = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValue(fresh());
    const apply = vi.fn();
    const status = vi.fn();
    const controller = createLessonAssetRenewal({ lessonId: "lesson-a", renew, apply, status });
    expect(await controller.request("resume")).toBe(false);
    expect(apply).not.toHaveBeenCalled();
    expect(status).toHaveBeenLastCalledWith("error");
    expect(await controller.request("resume")).toBe(false);
    expect(await controller.request("manual")).toBe(true);
    expect(apply).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it("discards a delayed renewal after changing lessons/account or going offline", async () => {
    const wait = deferred<LessonAssetPatch>();
    const apply = vi.fn();
    const status = vi.fn();
    const controller = createLessonAssetRenewal({ lessonId: "lesson-a", renew: () => wait.promise, apply, status });
    const attempt = controller.request("manual");
    controller.dispose();
    wait.resolve(fresh());
    expect(await attempt).toBe(false);
    expect(apply).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledExactlyOnceWith("refreshing");
    let eligible = false;
    const renew = vi.fn().mockResolvedValue(fresh());
    const offline = createLessonAssetRenewal({ lessonId: "lesson-b", renew, apply, status, eligible: () => eligible });
    expect(await offline.request("resume")).toBe(false);
    expect(renew).not.toHaveBeenCalled();
    eligible = true;
    expect(await offline.request("resume")).toBe(true);
    offline.dispose();
  });

  it("changes URLs only while keeping the same lesson, progress, transcript and quiz state", () => {
    const lesson: Lesson = { id: "a", title: "Training", type: "quiz", duration: "5m", completed: true, body: "Lesson text", transcript: "Transcript", quiz: { name: "Quiz", requiresPassing: true, questions: [] } };
    const quiz = lesson.quiz;
    const patch = { ...fresh(), completed: false, quiz: undefined };
    const updated = applyLessonAssetPatch(lesson, patch);
    expect(updated.id).toBe(lesson.id);
    expect(updated.completed).toBe(true);
    expect(updated.body).toBe(lesson.body);
    expect(updated.transcript).toBe(lesson.transcript);
    expect(updated.quiz).toBe(quiz);
    expect(updated.videoUrl).toBe(fresh().videoUrl);
  });

  it("restores playing video position and controls after metadata reload, retaining paused videos", () => {
    const video = { currentTime: 384, paused: false, playbackRate: 1.5, volume: 0.4, muted: true, duration: 900, play: vi.fn().mockResolvedValue(undefined) };
    const snapshot = captureLessonPlayback(video as unknown as HTMLVideoElement);
    video.currentTime = 0; video.playbackRate = 1; video.volume = 1; video.muted = false;
    restoreLessonPlayback(video as unknown as HTMLVideoElement, snapshot);
    expect(video).toMatchObject({ currentTime: 384, playbackRate: 1.5, volume: 0.4, muted: true });
    expect(video.play).toHaveBeenCalledTimes(1);
    video.play.mockClear(); video.paused = true; video.currentTime = 1000;
    restoreLessonPlayback(video as unknown as HTMLVideoElement, captureLessonPlayback(video as unknown as HTMLVideoElement));
    expect(video.currentTime).toBeCloseTo(899.99);
    expect(video.play).not.toHaveBeenCalled();
  });

  it("opens search-targeted lessons only inside their accessible course and refuses locked lessons", () => {
    const lesson: Lesson = { id: "lesson", cloudId: "lesson-cloud", title: "Lesson", duration: "1m", completed: false, type: "guide" };
    const course = { id: "course", cloudId: "course-cloud", modules: [{ title: "Module", lessons: [lesson] }] } as Course;
    expect(requestedAcademyLesson([course], "course-cloud", "lesson-cloud")).toEqual({ course, lesson });
    expect(requestedAcademyLesson([course], undefined, "lesson-cloud")).toEqual({ course, lesson });
    expect(requestedAcademyLesson([course], "different-course", "lesson-cloud").lesson).toBeUndefined();
    expect(requestedAcademyLesson([{ ...course, modules: [{ title: "Module", lessons: [{ ...lesson, locked: true }] }] }], "course-cloud", "lesson-cloud").lesson).toBeUndefined();
  });
});
