import type { Course, Lesson } from "../domain";

// Only asset presentation may change during renewal. Progress, quiz answers and
// course structure stay in their existing owners.
export type LessonAssetPatch = Pick<Lesson, "bodyHtml" | "videoUrl" | "resources"> & { expiresAt: number };
export type LessonAssetRenewalReason = "expiry" | "resume" | "error" | "manual";

export function applyLessonAssetPatch(lesson: Lesson, patch: LessonAssetPatch): Lesson {
  return { ...lesson, bodyHtml: patch.bodyHtml, videoUrl: patch.videoUrl, resources: patch.resources };
}

export function lessonAssetExpiry(lesson: Pick<Lesson, "videoUrl" | "resources" | "bodyHtml">): number | undefined {
  const urls = [lesson.videoUrl, ...(lesson.resources ?? []).map(resource => resource.url),
    ...(lesson.bodyHtml?.match(/https?:[^\s"'<>]+/g) ?? [])];
  const expiries = urls.flatMap(value => {
    if (!value) return [];
    try {
      const url = new URL(value.replaceAll("&amp;", "&"));
      if (!url.pathname.includes("/storage/v1/object/sign/academy-assets/")) return [];
      const payload = url.searchParams.get("token")?.split(".")[1];
      if (!payload) return [];
      const normalized = payload.replaceAll("-", "+").replaceAll("_", "/");
      const claims = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")));
      // This is a timing hint only, never an authorization decision.
      return typeof claims.exp === "number" && Number.isFinite(claims.exp) ? [claims.exp * 1000] : [];
    } catch { return []; }
  });
  return expiries.length ? Math.min(...expiries) : undefined;
}

export function requestedAcademyLesson(courses: Course[], courseId?: string, lessonId?: string) {
  const course = courses.find(item => courseId
    ? (item.cloudId ?? item.id) === courseId
    : Boolean(lessonId && item.modules.some(module => module.lessons.some(lesson => (lesson.cloudId ?? lesson.id) === lessonId))));
  const lesson = lessonId ? course?.modules.flatMap(module => module.lessons).find(item => (item.cloudId ?? item.id) === lessonId) : undefined;
  return { course, lesson: lesson?.locked ? undefined : lesson };
}

type Options = {
  lessonId: string;
  expiresAt?: number;
  renew: (lessonId: string) => Promise<LessonAssetPatch>;
  apply: (patch: LessonAssetPatch) => void;
  status: (status: "refreshing" | "ready" | "error") => void;
  eligible?: () => boolean;
  now?: () => number;
  schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
};

export function createLessonAssetRenewal(options: Options) {
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? setTimeout;
  const cancel = options.cancel ?? clearTimeout;
  let disposed = false;
  let pending = false;
  let errorAttempted = false;
  let expiresAt = options.expiresAt;
  let retryAfter = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const arm = () => {
    if (timer !== undefined) cancel(timer);
    timer = undefined;
    if (disposed || !expiresAt) return;
    timer = schedule(() => { timer = undefined; void request("expiry"); },
      Math.min(2_147_483_647, Math.max(0, expiresAt - now() - 60_000)));
  };
  const request = async (reason: LessonAssetRenewalReason): Promise<boolean> => {
    if (disposed || pending || options.eligible?.() === false) return false;
    if (reason === "resume" && expiresAt && expiresAt > now() + 60_000) return false;
    if (reason !== "manual" && retryAfter > now()) return false;
    // A broken asset must not create an endless error/sign/reload loop.
    if (reason === "error" && errorAttempted) return false;
    if (reason === "error") errorAttempted = true;
    pending = true;
    options.status("refreshing");
    try {
      const patch = await options.renew(options.lessonId);
      if (disposed || options.eligible?.() === false) return false;
      if (!Number.isFinite(patch.expiresAt) || patch.expiresAt <= now() + 60_000) throw new Error("Fresh media links were not returned.");
      expiresAt = patch.expiresAt;
      retryAfter = 0;
      options.apply(patch);
      options.status("ready");
      arm();
      return true;
    } catch {
      if (!disposed) {
        retryAfter = now() + 30_000;
        options.status("error");
      }
      return false;
    } finally { pending = false; }
  };
  arm();
  return {
    request,
    dispose: () => { disposed = true; if (timer !== undefined) cancel(timer); timer = undefined; },
  };
}

export type LessonPlayback = { currentTime: number; paused: boolean; playbackRate: number; volume: number; muted: boolean };
export function captureLessonPlayback(video: HTMLVideoElement | null): LessonPlayback | null {
  if (!video) return null;
  return { currentTime: video.currentTime, paused: video.paused, playbackRate: video.playbackRate, volume: video.volume, muted: video.muted };
}
export function restoreLessonPlayback(video: HTMLVideoElement, snapshot: LessonPlayback | null) {
  if (!snapshot) return;
  const duration = video.duration;
  video.currentTime = Number.isFinite(duration) ? Math.min(snapshot.currentTime, Math.max(0, duration - 0.01)) : snapshot.currentTime;
  video.playbackRate = snapshot.playbackRate;
  video.volume = snapshot.volume;
  video.muted = snapshot.muted;
  if (!snapshot.paused) void video.play().catch(() => undefined);
}
