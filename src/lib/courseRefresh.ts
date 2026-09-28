/** Refresh course content without resetting the member's workspace or login. */
export function createCourseRefresh<T>(options: {
  load: () => Promise<T>;
  apply: (value: T) => void;
  eligible: () => boolean;
  version: () => number;
  onError?: () => void;
  onSuccess?: () => void;
}) {
  let disposed = false;
  let pending = false;
  return {
    async refresh() {
      if (disposed || pending || !options.eligible()) return;
      pending = true;
      const version = options.version();
      try {
        const value = await options.load();
        // Account changes, progress saves and a full reload invalidate older reads.
        if (!disposed && options.eligible() && options.version() === version) {
          options.apply(value);
          options.onSuccess?.();
        }
      } catch {
        if (!disposed && options.eligible() && options.version() === version) options.onError?.();
      } finally {
        pending = false;
      }
    },
    dispose() { disposed = true; },
  };
}

/** Each registration is removed even when native setup resolves after unmount. */
export function watchCourseRefresh(options: {
  refresh: () => void;
  document: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">;
  window: Pick<Window, "addEventListener" | "removeEventListener" | "setInterval" | "clearInterval">;
  nativeResume?: (onResume: () => void) => Promise<{ remove: () => Promise<void> }>;
}) {
  let disposed = false;
  let removeNative: (() => Promise<void>) | undefined;
  const refresh = () => {
    if (!disposed && options.document.visibilityState === "visible") options.refresh();
  };
  options.document.addEventListener("visibilitychange", refresh);
  options.window.addEventListener("online", refresh);
  options.window.addEventListener("focus", refresh);
  const timer = options.window.setInterval(refresh, 60_000);
  void options.nativeResume?.(refresh).then((listener) => {
    if (disposed) void listener.remove();
    else removeNative = () => listener.remove();
  }).catch(() => undefined);
  return () => {
    disposed = true;
    options.document.removeEventListener("visibilitychange", refresh);
    options.window.removeEventListener("online", refresh);
    options.window.removeEventListener("focus", refresh);
    options.window.clearInterval(timer);
    void removeNative?.();
  };
}
