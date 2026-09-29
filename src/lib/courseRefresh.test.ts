import { describe, expect, it, vi, afterEach } from "vitest";
import { createCourseRefresh, watchCourseRefresh } from "./courseRefresh";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("background Academy refresh", () => {
  it("coalesces overlapping reads and replaces content after a successful read", async () => {
    const read = deferred<string[]>();
    const load = vi.fn(() => read.promise);
    const apply = vi.fn();
    const refresh = createCourseRefresh({ load, apply, eligible: () => true, version: () => 1 });
    const first = refresh.refresh();
    await refresh.refresh();
    expect(load).toHaveBeenCalledTimes(1);
    read.resolve(["Updated lesson"]);
    await first;
    expect(apply).toHaveBeenCalledWith(["Updated lesson"]);
  });

  it.each(["account changed", "lesson progress saved", "workspace reloaded"])("discards a response when %s", async () => {
    const read = deferred<string[]>();
    let version = 1;
    const apply = vi.fn();
    const refresh = createCourseRefresh({ load: () => read.promise, apply, eligible: () => true, version: () => version });
    const pending = refresh.refresh();
    version += 1;
    read.resolve(["Old account or progress"]);
    await pending;
    expect(apply).not.toHaveBeenCalled();
  });

  it("retains loaded lessons on network failure and can recover", async () => {
    const apply = vi.fn();
    const onError = vi.fn();
    const onSuccess = vi.fn();
    const refresh = createCourseRefresh({
      load: vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce(["Fresh"]),
      apply, eligible: () => true, version: () => 1, onError, onSuccess,
    });
    await refresh.refresh();
    expect(apply).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
    await refresh.refresh();
    expect(apply).toHaveBeenCalledWith(["Fresh"]);
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it("does not load while hidden, signed out, writing progress or playing media", async () => {
    const load = vi.fn();
    const refresh = createCourseRefresh({ load, apply: vi.fn(), eligible: () => false, version: () => 1 });
    await refresh.refresh();
    expect(load).not.toHaveBeenCalled();
  });

  it("does not apply when media starts playing during a read or after disposal", async () => {
    for (const dispose of [false, true]) {
      const read = deferred<string[]>();
      let eligible = true;
      const apply = vi.fn();
      const refresh = createCourseRefresh({ load: () => read.promise, apply, eligible: () => eligible, version: () => 1 });
      const pending = refresh.refresh();
      if (dispose) refresh.dispose();
      else eligible = false;
      read.resolve(["New media"]);
      await pending;
      expect(apply).not.toHaveBeenCalled();
    }
  });
});

describe("web and native resume listeners", () => {
  afterEach(() => vi.useRealTimers());
  it("refreshes in the foreground and cleans up delayed native registration", async () => {
    vi.useFakeTimers();
    const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
    const win = Object.assign(new EventTarget(), { setInterval, clearInterval });
    const refresh = vi.fn();
    const native = deferred<{ remove: () => Promise<void> }>();
    let resume = () => {};
    const dispose = watchCourseRefresh({
      document: doc as unknown as Document, window: win as unknown as Window, refresh,
      nativeResume: async (onResume) => { resume = onResume; return native.promise; },
    });
    win.dispatchEvent(new Event("online"));
    resume();
    expect(refresh).toHaveBeenCalledTimes(2);
    doc.visibilityState = "hidden";
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(refresh).toHaveBeenCalledTimes(3);
    dispose();
    const remove = vi.fn(async () => undefined);
    native.resolve({ remove });
    await Promise.resolve(); await Promise.resolve();
    expect(remove).toHaveBeenCalledOnce();
    win.dispatchEvent(new Event("focus"));
    resume();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledTimes(3);
  });
});
