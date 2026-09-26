import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  addListener: vi.fn(),
  getLaunchUrl: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock("@capacitor/app", () => ({ App: mocks }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: mocks }) }));
let initializeNativeAuth: typeof import("./backend").initializeNativeAuth;

beforeAll(async () => {
  vi.stubGlobal("window", {});
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "test-publishable-key");
  ({ initializeNativeAuth } = await import("./backend"));
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.addListener.mockResolvedValue({ remove: mocks.remove });
  mocks.getLaunchUrl.mockResolvedValue(undefined);
  mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
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
});
