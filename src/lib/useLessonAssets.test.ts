import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Lesson } from "../domain";
import type { LessonAssetPatch } from "./lessonMedia";
import { useLessonAssets } from "./useLessonAssets";

// Exercise the actual hook effects and rerenders without adding a DOM runtime.
const hooks = vi.hoisted(() => ({ active: null as null | { slots: any[]; cursor: number; effects: (() => void)[] } }));
vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  const next = () => {
    if (!hooks.active) throw new Error("Render using the hook harness");
    return { state: hooks.active, index: hooks.active.cursor++ };
  };
  return {
    ...actual,
    useState: (initial: any) => {
      const { state, index } = next();
      if (!(index in state.slots)) state.slots[index] = typeof initial === "function" ? initial() : initial;
      return [state.slots[index], (value: any) => { state.slots[index] = typeof value === "function" ? value(state.slots[index]) : value; }];
    },
    useRef: (initial: any) => { const { state, index } = next(); return state.slots[index] ??= { current: initial }; },
    useEffect: (effect: () => (() => void) | void, dependencies: any[]) => {
      const { state, index } = next();
      const prior = state.slots[index];
      if (prior && dependencies.length === prior.dependencies.length && dependencies.every((value, item) => Object.is(value, prior.dependencies[item]))) return;
      state.effects.push(() => { prior?.cleanup?.(); state.slots[index] = { dependencies, cleanup: effect() }; });
    },
  };
});
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));

const now = 1_800_000_000_000;
const fresh: LessonAssetPatch = { videoUrl: "https://example.invalid/fresh.mp4", bodyHtml: "<p>Lesson</p>", resources: [{ title: "Guide", url: "https://example.invalid/fresh.pdf" }], expiresAt: now + 3_600_000 };
function lesson(id = "a"): Lesson {
  return { id, cloudId: `cloud-${id}`, title: "Lesson", duration: "1m", completed: false, type: "quiz", videoUrl: "https://example.invalid/old.mp4", bodyHtml: "<p>Lesson</p>", quiz: { name: "Quiz", requiresPassing: true, questions: [] } };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
const listeners = new Map<string, () => void>();
function harness(renew: (id: string) => Promise<LessonAssetPatch>, beforeApply = vi.fn()) {
  const state = { slots: [] as any[], cursor: 0, effects: [] as (() => void)[] };
  return {
    beforeApply,
    render: (value: Lesson, enabled = true) => {
      state.cursor = 0; hooks.active = state;
      let result;
      try { result = useLessonAssets(value, renew, enabled, beforeApply); } finally { hooks.active = null; }
      for (const effect of state.effects.splice(0)) effect();
      return result;
    },
    unmount: () => { for (const slot of state.slots) slot?.cleanup?.(); },
  };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now); listeners.clear();
  vi.stubGlobal("window", { addEventListener: (name: string, listener: () => void) => listeners.set(name, listener), removeEventListener: (name: string) => listeners.delete(name) });
  vi.stubGlobal("document", { visibilityState: "visible", addEventListener: (name: string, listener: () => void) => listeners.set(name, listener), removeEventListener: (name: string) => listeners.delete(name) });
  vi.stubGlobal("navigator", { onLine: true });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("useLessonAssets lifecycle", () => {
  it("renews a lesson containing only a signed inline file link", async () => {
    const signed = `https://example.invalid/storage/v1/object/sign/academy-assets/guide.pdf?token=header.${btoa(JSON.stringify({ exp: now / 1000 - 30 }))}.signature`;
    const freshHtml = '<p><a href="https://example.invalid/storage/v1/object/sign/academy-assets/guide.pdf?token=fresh">Guide</a></p>';
    const renew = vi.fn().mockResolvedValue({ bodyHtml: freshHtml, expiresAt: now + 3_600_000 });
    const view = harness(renew);
    const original: Lesson = { id: "link-only", cloudId: "cloud-link-only", title: "Handbook", duration: "1m", completed: true, type: "guide", bodyHtml: `<p><a href="${signed}">Guide</a></p>` };
    view.render(original); await flush();
    const current = view.render(original);
    expect(renew).toHaveBeenCalledExactlyOnceWith("cloud-link-only");
    expect(current.lesson?.bodyHtml).toBe(freshHtml);
    expect(current.lesson?.completed).toBe(true);
    expect(current.status).toBe("ready");
    view.unmount();
    expect(listeners.size).toBe(0);
  });

  it("applies only URLs across real hook rerenders while retaining quiz identity and latest progress", async () => {
    const wait = deferred<LessonAssetPatch>();
    const renew = vi.fn(() => wait.promise);
    const view = harness(renew);
    const original = lesson();
    expect(view.render(original).lesson?.videoUrl).toBe(original.videoUrl);
    expect(renew).toHaveBeenCalledExactlyOnceWith("cloud-a");
    wait.resolve(fresh); await flush();
    const current = view.render({ ...original, completed: true });
    expect(current.lesson?.videoUrl).toBe(fresh.videoUrl);
    expect(current.lesson?.quiz).toBe(original.quiz);
    expect(current.lesson?.completed).toBe(true);
    expect(view.beforeApply).toHaveBeenCalledTimes(1);
    expect(view.render({ ...original, completed: true }, false).lesson?.quiz).toBe(original.quiz);
    expect(view.render({ ...original, completed: true }, true).lesson?.videoUrl).toBe(fresh.videoUrl);
    expect(renew).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it("resumes with fresh links after long suspension and retains content on failed renewal", async () => {
    const renew = vi.fn().mockResolvedValueOnce(fresh).mockRejectedValueOnce(new Error("Network unavailable"));
    const view = harness(renew);
    const original = lesson();
    view.render(original); await flush(); view.render(original);
    // Hidden expiry is deferred until the app becomes visible, matching suspension.
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(renew).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    listeners.get("visibilitychange")?.(); await flush();
    const result = view.render(original);
    expect(renew).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("error");
    expect(result.lesson?.videoUrl).toBe(fresh.videoUrl);
    expect(result.lesson?.quiz).toBe(original.quiz);
    view.unmount();
  });

  it("disposes prior lesson work and listeners so late responses cannot replace the new lesson", async () => {
    const wait = deferred<LessonAssetPatch>();
    const renew = vi.fn().mockImplementationOnce(() => wait.promise).mockResolvedValueOnce({ ...fresh, videoUrl: "https://example.invalid/b.mp4" });
    const view = harness(renew);
    view.render(lesson("a"));
    view.render(lesson("b")); await flush();
    wait.resolve(fresh); await flush();
    expect(view.render(lesson("b")).lesson?.videoUrl).toBe("https://example.invalid/b.mp4");
    expect(view.beforeApply).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(listeners.size).toBe(0);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(renew).toHaveBeenCalledTimes(2);
  });
});
