import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppUpdateNotice, requestAppUpdateNotice } from "./AppUpdateNotice";
import { APP_RELEASE_CHECK_INTERVAL } from "../lib/appUpdates";

const mock = vi.hoisted(() => ({
  native: true, platform: "ios", active: null as null | { slots: any[]; cursor: number; effects: (() => void)[] },
  resume: undefined as undefined | ((state: { isActive: boolean }) => void),
  remove: vi.fn(), info: vi.fn(), resolveNotice: vi.fn(),
}));
vi.mock("../lib/nativePush", () => ({ resolveAppUpdateNotice: mock.resolveNotice }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => mock.native, getPlatform: () => mock.platform } }));
vi.mock("@capacitor/app", () => ({ App: { getInfo: mock.info, addListener: vi.fn(async (_name: string, callback: typeof mock.resume) => { mock.resume = callback; return { remove: mock.remove }; }) } }));
vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  const next = () => {
    if (!mock.active) throw new Error("Render through the notice harness");
    return { state: mock.active, index: mock.active.cursor++ };
  };
  return { ...actual,
    useState: (initial: any) => { const { state, index } = next(); if (!(index in state.slots)) state.slots[index] = initial; return [state.slots[index], (value: any) => { state.slots[index] = typeof value === "function" ? value(state.slots[index]) : value; }]; },
    useRef: (initial: any) => { const { state, index } = next(); return state.slots[index] ??= { current: initial }; },
    useEffect: (effect: () => (() => void) | void) => { const { state, index } = next(); if (index in state.slots) return; state.slots[index] = {}; state.effects.push(() => { state.slots[index].cleanup = effect(); }); },
  };
});
const now = Date.parse("2026-11-01T12:00:00Z");
const release = { availableVersion: "1.0.1", availableBuild: "18", publishedAt: "2026-10-31T12:00:00Z", expiresAt: "2026-12-01T12:00:00Z", releaseNotes: "Improved lessons." };
function harness() {
  const state = { slots: [] as any[], cursor: 0, effects: [] as (() => void)[] };
  return {
    render: () => { state.cursor = 0; mock.active = state; let value; try { value = AppUpdateNotice(); } finally { mock.active = null; } for (const effect of state.effects.splice(0)) effect(); return value; },
    unmount: () => { for (const slot of state.slots) slot?.cleanup?.(); },
  };
}
type Element = ReactElement<Record<string, any>>;
function find(node: ReactNode, type: string): Element | undefined {
  if (Array.isArray(node)) return node.map(child => find(child, type)).find(Boolean);
  if (!node || typeof node !== "object" || !("props" in node)) return;
  const element = node as Element;
  return element.type === type ? element : find(element.props.children, type);
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now); mock.native = true; mock.platform = "ios"; mock.resume = undefined; mock.remove.mockReset(); mock.remove.mockResolvedValue(undefined);
  mock.info.mockReset(); mock.info.mockResolvedValue({ id: "com.dirtyturf.academy", version: "1.0", build: "17" });
  fetcher = vi.fn(async () => new Response(JSON.stringify({ schemaVersion: 1, ios: release, android: null }), { headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetcher);
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  vi.stubGlobal("window", new EventTarget());
  mock.resolveNotice.mockReset(); mock.resolveNotice.mockResolvedValue(null);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("native app update notice", () => {
  it("opens a server-resolved release after tapping its notification, only for this platform", async () => {
    fetcher.mockResolvedValue(new Response(JSON.stringify({ schemaVersion: 1, ios: null, android: null }), { headers: { "content-type": "application/json" } }));
    const view = harness(); view.render(); await flush(); expect(view.render()).toBeNull();
    mock.resolveNotice.mockResolvedValue({ platform: "android", release });
    requestAppUpdateNotice("notice"); await flush(); expect(view.render()).toBeNull();
    mock.resolveNotice.mockResolvedValue({ platform: "ios", release });
    requestAppUpdateNotice("notice"); await flush();
    expect(find(view.render(), "a")?.props.href).toBe("https://apps.apple.com/app/id6813588770"); view.unmount();
  });
  it("does not fetch or show native releases on the website", async () => {
    mock.native = false;
    const view = harness(); expect(view.render()).toBeNull(); await flush();
    expect(fetcher).not.toHaveBeenCalled(); expect(mock.info).not.toHaveBeenCalled(); view.unmount();
  });
  it("can open an authenticated release notification on the website without native APIs", async () => {
    mock.native = false;
    const view = harness(); view.render(); await flush();
    mock.resolveNotice.mockResolvedValue({ platform: "android", release });
    requestAppUpdateNotice("notice"); await flush();
    expect(find(view.render(), "a")?.props.href).toBe("https://play.google.com/store/apps/details?id=com.dirtyturf.academy");
    expect(mock.info).not.toHaveBeenCalled(); view.unmount();
  });
  it("checks on launch/resume with a TTL and remembers dismissal across resume and remount", async () => {
    const view = harness(); view.render(); await flush();
    expect(find(view.render(), "a")?.props.href).toBe("https://apps.apple.com/app/id6813588770");
    mock.resume?.({ isActive: true }); await flush(); expect(fetcher).toHaveBeenCalledTimes(1);
    find(view.render(), "button")!.props.onClick(); expect(view.render()).toBeNull();
    vi.setSystemTime(now + APP_RELEASE_CHECK_INTERVAL); mock.resume?.({ isActive: true }); await flush();
    expect(fetcher).toHaveBeenCalledTimes(2); expect(view.render()).toBeNull(); view.unmount(); await flush(); expect(mock.remove).toHaveBeenCalledTimes(1);
    const reopened = harness(); reopened.render(); await flush(); expect(reopened.render()).toBeNull(); reopened.unmount();
  });
  it("does not offer an Apple-only release to Android devices", async () => {
    mock.platform = "android";
    const view = harness(); view.render(); await flush(); expect(view.render()).toBeNull(); view.unmount();
  });
  it("stays silent for offline checks and mismatched app IDs", async () => {
    fetcher.mockRejectedValue(new Error("offline"));
    const view = harness(); view.render(); await flush(); expect(view.render()).toBeNull(); view.unmount();
    mock.info.mockResolvedValue({ id: "another.app", version: "1.0", build: "17" }); fetcher.mockClear();
    const other = harness(); other.render(); await flush(); expect(fetcher).not.toHaveBeenCalled(); expect(other.render()).toBeNull(); other.unmount();
  });
});
