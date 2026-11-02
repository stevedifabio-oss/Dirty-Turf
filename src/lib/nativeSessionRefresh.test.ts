import { describe, expect, it, vi } from "vitest";
import { watchNativeSessionRefresh } from "./nativeSessionRefresh";

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function fixture() {
  let changed: (state: { isActive: boolean }) => void = () => undefined;
  const auth = { startAutoRefresh: vi.fn(async (): Promise<void> => undefined), stopAutoRefresh: vi.fn(async (): Promise<void> => undefined) };
  const remove = vi.fn(async () => undefined);
  const app = {
    getState: vi.fn(async () => ({ isActive: true })),
    addListener: vi.fn(async (_event: "appStateChange", callback: typeof changed) => { changed = callback; return { remove }; }),
  };
  return { auth, app, remove, change: (isActive: boolean) => changed({ isActive }) };
}

describe("native saved-session refresh", () => {
  it("refreshes on foreground and pauses the timer, rather than signing out, in background", async () => {
    const f = fixture(); const dispose = await watchNativeSessionRefresh(f.auth, f.app); await flush();
    expect(f.auth.startAutoRefresh).toHaveBeenCalledOnce();
    f.change(false); await flush(); expect(f.auth.stopAutoRefresh).toHaveBeenCalledOnce();
    f.change(true); await flush(); expect(f.auth.startAutoRefresh).toHaveBeenCalledTimes(2);
    dispose(); await flush(); expect(f.remove).toHaveBeenCalledOnce();
  });
  it("does not start a timer when the app initially opens in the background", async () => {
    const f = fixture(); f.app.getState.mockResolvedValue({ isActive: false });
    const dispose = await watchNativeSessionRefresh(f.auth, f.app); await flush();
    expect(f.auth.startAutoRefresh).not.toHaveBeenCalled(); expect(f.auth.stopAutoRefresh).toHaveBeenCalledOnce(); dispose();
  });
  it("does not let a late initial snapshot override a newer background event", async () => {
    const f = fixture(); let resolve!: (state: { isActive: boolean }) => void;
    f.app.getState.mockReturnValue(new Promise(done => { resolve = done; }));
    const pending = watchNativeSessionRefresh(f.auth, f.app); await flush();
    f.change(false); resolve({ isActive: true }); const dispose = await pending; await flush();
    expect(f.auth.startAutoRefresh).not.toHaveBeenCalled(); expect(f.auth.stopAutoRefresh).toHaveBeenCalledOnce(); dispose();
  });
  it("stops after a slow pending start and ignores events after disposal", async () => {
    const f = fixture(); let finish!: () => void;
    f.auth.startAutoRefresh.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
    const dispose = await watchNativeSessionRefresh(f.auth, f.app); await flush();
    f.change(false); dispose(); dispose(); f.change(true); finish(); await flush();
    expect(f.auth.startAutoRefresh).toHaveBeenCalledOnce(); expect(f.auth.stopAutoRefresh).toHaveBeenCalledOnce(); expect(f.remove).toHaveBeenCalledOnce();
    expect(f.auth.startAutoRefresh.mock.invocationCallOrder[0]).toBeLessThan(f.auth.stopAutoRefresh.mock.invocationCallOrder[0]);
  });
  it("recovers on a later resume when a timer operation fails", async () => {
    const f = fixture(); const onError = vi.fn(); f.auth.startAutoRefresh.mockRejectedValueOnce(new Error("synthetic failure"));
    const dispose = await watchNativeSessionRefresh(f.auth, f.app, onError); await flush();
    expect(onError).toHaveBeenCalledOnce(); f.change(true); await flush();
    expect(f.auth.startAutoRefresh).toHaveBeenCalledTimes(2); dispose();
  });
});
