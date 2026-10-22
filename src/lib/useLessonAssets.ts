import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import type { Lesson } from "../domain";
import { applyLessonAssetPatch, createLessonAssetRenewal, lessonAssetExpiry, type LessonAssetPatch, type LessonAssetRenewalReason } from "./lessonMedia";

export function useLessonAssets(lesson: Lesson | undefined, renew: ((lessonId: string) => Promise<LessonAssetPatch>) | undefined, enabled: boolean, beforeApply: () => void) {
  const [state, setState] = useState<{ lessonId?: string; patch?: LessonAssetPatch; status?: "refreshing" | "ready" | "error" }>({});
  const controller = useRef<ReturnType<typeof createLessonAssetRenewal> | null>(null);
  const beforeApplyRef = useRef(beforeApply);
  beforeApplyRef.current = beforeApply;
  const hasAssets = Boolean(lesson?.videoUrl || lesson?.resources?.length || lesson?.bodyHtml?.match(/<(img|video|audio|iframe)\b/i) || lesson?.bodyHtml?.includes("/storage/v1/object/sign/academy-assets/"));
  const lessonId = lesson?.cloudId ?? lesson?.id;
  const currentState = state.lessonId === lessonId ? state : {};
  const latest = useRef({ lesson, patch: currentState.patch, enabled });
  latest.current = { lesson, patch: currentState.patch, enabled };

  useEffect(() => {
    if (!lessonId || !hasAssets || !renew || !enabled) return;
    let removed = false;
    let removeNative: (() => Promise<void>) | undefined;
    const current = createLessonAssetRenewal({
      lessonId,
      expiresAt: latest.current.patch?.expiresAt ?? (latest.current.lesson ? lessonAssetExpiry(latest.current.lesson) : undefined),
      renew,
      eligible: () => latest.current.enabled && document.visibilityState !== "hidden" && navigator.onLine !== false,
      apply: patch => { beforeApplyRef.current(); setState({ lessonId, patch, status: "ready" }); },
      status: status => setState(previous => ({ ...((previous.lessonId === lessonId) ? previous : {}), lessonId, status })),
    });
    controller.current = current;
    const resume = () => { if (!removed) void current.request("resume"); };
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    if (Capacitor.isNativePlatform()) {
      void import("@capacitor/app").then(async ({ App }) => {
        if (removed) return;
        const handle = await App.addListener("appStateChange", ({ isActive }) => { if (isActive) resume(); });
        if (removed) await handle.remove();
        else removeNative = () => handle.remove();
      }).catch(() => undefined);
    }
    // Freshly opened lessons can contain links minted before a long suspension.
    resume();
    return () => {
      removed = true;
      current.dispose();
      if (controller.current === current) controller.current = null;
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
      void removeNative?.();
    };
  }, [lessonId, hasAssets, renew, enabled]);

  return {
    lesson: lesson && currentState.patch ? applyLessonAssetPatch(lesson, currentState.patch) : lesson,
    status: currentState.status,
    request: (reason: LessonAssetRenewalReason) => controller.current?.request(reason) ?? Promise.resolve(false),
  };
}
