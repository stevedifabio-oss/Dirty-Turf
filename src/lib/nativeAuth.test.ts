import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  addListener: vi.fn(),
  getLaunchUrl: vi.fn(),
  remove: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock("@capacitor/app", () => ({ App: mocks }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: mocks }) }));
let initializeNativeAuth: typeof import("./backend").initializeNativeAuth;
let signOut: typeof import("./backend").signOut;

beforeAll(async () => {
  vi.stubGlobal("window", {});
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "test-publishable-key");
  ({ initializeNativeAuth, signOut } = await import("./backend"));
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.addListener.mockResolvedValue({ remove: mocks.remove });
  mocks.getLaunchUrl.mockResolvedValue(undefined);
  mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
  mocks.signOut.mockResolvedValue({ error: null });
});

describe("current-device sign-out", () => {
  it("ends only the current session instead of revoking other devices", async () => {
    await signOut();
    expect(mocks.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
  });
  it("propagates SDK errors instead of claiming local-session removal succeeded", async () => {
    const error = new Error("Session restoration failed before sign-out");
    mocks.signOut.mockResolvedValue({ error });
    await expect(signOut()).rejects.toBe(error);
  });
});

describe("native email link session exchange", () => {
  it("handles a cold launch and ignores the same URL delivered again", async () => {
    const url = "com.dirtyturf.academy://auth/callback?code=one-use-code&sb_flow_id=test-flow";
    mocks.getLaunchUrl.mockResolvedValue({ url });
    const dispose = await initializeNativeAuth();
    mocks.addListener.mock.calls[0][1]({ url });
    expect(mocks.exchangeCodeForSession).toHaveBeenCalledExactlyOnceWith("one-use-code", { flowId: "test-flow" });
    dispose();
    expect(mocks.remove).toHaveBeenCalledOnce();
  });

  it("handles a warm launch and reports failed exchanges on the login screen", async () => {
    const onError = vi.fn();
    mocks.exchangeCodeForSession.mockResolvedValue({ error: new Error("Link expired") });
    await initializeNativeAuth(onError);
    mocks.addListener.mock.calls[0][1]({ url: "com.dirtyturf.academy://auth/callback?code=expired" });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith("Link expired"));
  });

  it("rejects callback errors without attempting a session exchange", async () => {
    const onError = vi.fn();
    mocks.getLaunchUrl.mockResolvedValue({ url: "com.dirtyturf.academy://auth/callback?error_description=Try%20again" });
    await initializeNativeAuth(onError);
    expect(onError).toHaveBeenCalledWith("Try again");
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
  });
  it("holds a cold-launch callback in memory until consent, then exchanges it once", async () => {
    let accepted = false, resume: (() => Promise<void>) | undefined;
    const url = "com.dirtyturf.academy://auth/callback?code=consent-fixture";
    mocks.getLaunchUrl.mockResolvedValue({ url });
    await initializeNativeAuth(vi.fn(), { canProcess: () => accepted, onRequired: callback => { resume = callback; } });
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
    await resume!(); expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
    accepted = true; await resume!();
    expect(mocks.exchangeCodeForSession).toHaveBeenCalledExactlyOnceWith("consent-fixture", undefined);
    mocks.addListener.mock.calls[0][1]({ url }); await Promise.resolve();
    expect(mocks.exchangeCodeForSession).toHaveBeenCalledOnce();
  });
  it("holds warm callbacks and discards them when their listener is disposed", async () => {
    let accepted = false, resume: (() => Promise<void>) | undefined;
    const dispose = await initializeNativeAuth(vi.fn(), { canProcess: () => accepted, onRequired: callback => { resume = callback; } });
    mocks.addListener.mock.calls[0][1]({ url: "com.dirtyturf.academy://auth/callback?code=warm-consent-fixture" });
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
    dispose(); accepted = true; await resume!();
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled(); expect(mocks.remove).toHaveBeenCalledOnce();
  });
});
