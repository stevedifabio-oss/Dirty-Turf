type RefreshAuth = {
  startAutoRefresh: () => Promise<void>;
  stopAutoRefresh: () => Promise<void>;
};
type NativeState = {
  getState: () => Promise<{ isActive: boolean }>;
  addListener: (event: "appStateChange", callback: (state: { isActive: boolean }) => void) => Promise<{ remove: () => Promise<void> }>;
};

/** Keep the saved session; only the refresh timer follows the native lifecycle. */
export async function watchNativeSessionRefresh(auth: RefreshAuth, app: NativeState, onError: () => void = () => undefined) {
  let disposed = false;
  let revision = 0;
  let work = Promise.resolve();
  const update = (active: boolean) => {
    const current = ++revision;
    // Serialize SDK timer changes: a slow foreground start must not outlive a
    // later background stop or restart refresh after this watcher is removed.
    work = work.then(async () => {
      if (disposed || current !== revision) return;
      if (active) await auth.startAutoRefresh();
      else await auth.stopAutoRefresh();
    }).catch(() => { if (!disposed) onError(); });
  };
  const listener = await app.addListener("appStateChange", ({ isActive }) => update(isActive));
  try {
    const initial = await app.getState();
    // A foreground/background event is newer than the startup snapshot.
    if (revision === 0) update(initial.isActive);
  } catch { onError(); }
  return () => {
    if (disposed) return;
    disposed = true;
    revision += 1;
    void listener.remove().catch(() => undefined);
    work = work.then(() => auth.stopAutoRefresh()).catch(() => undefined);
  };
}
