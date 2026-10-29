import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ native: true, permission: "granted", ready: true, session: { user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, access_token: "account-a-token" }, afterSession: undefined as (() => void) | undefined, prefs: { push_enabled: false }, calls: [] as { name: string; args: any; header?: string }[], listeners: {} as Record<string, (value: any) => void>, remoteFailure: false, unregisterFailure: false, permissionSwap: false, deferRegistration: undefined as Promise<any> | undefined, deferReadiness: undefined as Promise<any> | undefined }));
function query(name: string, args?: any) {
  const record = { name, args, header: undefined as string | undefined }; mock.calls.push(record);
  const deferred = name === "register_academy_push_device" ? mock.deferRegistration : name === "academy_push_readiness" ? mock.deferReadiness : undefined;
  const builder: any = {
    setHeader: (_name: string, value: string) => { record.header = value; return builder; },
    select: () => builder, eq: () => builder, maybeSingle: () => builder,
    upsert: (values: any) => { record.args = values; mock.prefs = { ...mock.prefs, ...values }; return builder; },
    then: (resolve: (value: any) => void) => deferred ? deferred.then(resolve) : Promise.resolve().then(() => resolve({ data: name === "academy_push_readiness" ? [{ ready: mock.ready, environment: "production" }] : name === "resolve_academy_push_notification" ? [{ target_type: "post", target_id: "33333333-3333-4333-8333-333333333333", comment_id: null }] : name === "notification_preferences" ? mock.prefs : null, error: null })),
  };
  return builder;
}
vi.mock("./backend", () => ({ supabase: { auth: { getSession: vi.fn(async () => { const session = { ...mock.session, user: { ...mock.session.user } }; mock.afterSession?.(); return { data: { session }, error: null }; }) }, rpc: (name: string, args?: any) => query(name, args), from: (name: string) => query(name) } }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc: async (name: string, args: any) => { mock.calls.push({ name, args }); return { error: mock.remoteFailure ? new Error("synthetic offline") : null }; } }) }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => mock.native, getPlatform: () => "ios", isPluginAvailable: () => mock.native } }));
const plugin = vi.hoisted(() => ({
  checkPermissions: vi.fn(async () => ({ receive: mock.permission })),
  requestPermissions: vi.fn(async () => { if (mock.permissionSwap) mock.session = { user: { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }, access_token: "account-b-token" }; mock.permission = "granted"; return { receive: "granted" }; }),
  addListener: vi.fn(async (name: string, callback: (value: any) => void) => { mock.listeners[name] = callback; return { remove: vi.fn() }; }),
  register: vi.fn(async () => { mock.listeners.registration?.({ value: "ab".repeat(32) }); }),
  unregister: vi.fn(async () => { if (mock.unregisterFailure) throw new Error("synthetic OS failure"); }),
  removeAllDeliveredNotifications: vi.fn(async () => undefined), createChannel: vi.fn(async () => undefined),
}));
vi.mock("@capacitor/push-notifications", () => ({ PushNotifications: plugin }));
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  mock.native = true; mock.permission = "granted"; mock.ready = true; mock.session = { user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, access_token: "account-a-token" }; mock.afterSession = undefined; mock.prefs = { push_enabled: false }; mock.calls = []; mock.listeners = {}; mock.remoteFailure = false; mock.unregisterFailure = false; mock.permissionSwap = false; mock.deferRegistration = undefined; mock.deferReadiness = undefined;
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  vi.stubEnv("VITE_PUSH_ENVIRONMENT", "production"); vi.stubEnv("VITE_SUPABASE_URL", "https://example.test"); vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "synthetic-public-key");
});
describe("native phone push consent and identity", () => {
  it("never prompts on mount, resume, unsupported web or default-off state", async () => {
    const push = await import("./nativePush"); await push.startNativePush(vi.fn()); await push.refreshNativePush();
    expect(plugin.requestPermissions).not.toHaveBeenCalled(); expect(plugin.register).not.toHaveBeenCalled();
    mock.native = false; await push.clearNativePushForSignOut();
    expect(mock.calls).toEqual([]); expect(localStorage.getItem("dirty-turf-native-push-installation-v1")).toBeNull();
  });
  it("does not request OS permission until provider readiness and an explicit enable", async () => {
    const push = await import("./nativePush"); await push.startNativePush(vi.fn()); mock.permission = "prompt"; mock.ready = false;
    await expect(push.enableNativePush()).rejects.toThrow("not available yet"); expect(plugin.requestPermissions).not.toHaveBeenCalled();
    mock.ready = true; await push.enableNativePush();
    expect(plugin.requestPermissions).toHaveBeenCalledTimes(1);
    const call = mock.calls.find(call => call.name === "register_academy_push_device")!;
    expect(call.args.p_enable).toBe(true); expect(call.header).toBe("Bearer account-a-token");
    expect(localStorage.getItem("dirty-turf-native-push-installation-v1")).not.toContain("abab"); // No device token cache.
  });
  it("uses the observed account token for preference writes even if the shared client switches", async () => {
    const push = await import("./nativePush");
    mock.afterSession = () => { mock.afterSession = undefined; mock.session = { user: { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }, access_token: "account-b-token" }; };
    const preferences = { push_replies: true, push_mentions: true, push_reactions: false, push_new_posts: false, push_admin_announcements: true, push_event_reminders: true, push_course_updates: true };
    await push.saveNativePushPreferences(preferences);
    expect(mock.calls[0]).toMatchObject({ header: "Bearer account-a-token", args: { user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } });
  });
  it("rejects an account swap while the permission dialog is open", async () => {
    const push = await import("./nativePush"); await push.startNativePush(vi.fn()); mock.permission = "prompt"; mock.permissionSwap = true;
    await expect(push.enableNativePush()).rejects.toThrow("account changed"); expect(plugin.register).not.toHaveBeenCalled();
  });
  it("refreshes tokens without enabling the master preference or prompting", async () => {
    const push = await import("./nativePush"); await push.startNativePush(vi.fn()); await push.enableNativePush(); mock.prefs.push_enabled = true;
    await push.refreshNativePush(); await new Promise(resolve => setTimeout(resolve, 0));
    const calls = mock.calls.filter(call => call.name === "register_academy_push_device"); expect(calls).toHaveLength(2); expect(calls[1].args.p_enable).toBe(false); expect(plugin.requestPermissions).not.toHaveBeenCalled();
  });
  it.each(["promise", "event"])("invalidates a failed registration %s before a late OS token, then revokes before retry", async failure => {
    const push = await import("./nativePush"); await push.startNativePush(vi.fn());
    mock.prefs.push_enabled = true;
    plugin.register.mockImplementationOnce(async () => {
      if (failure === "promise") throw new Error("synthetic registration failure");
      mock.listeners.registrationError({ error: "synthetic registration failure" });
    });
    await expect(push.enableNativePush()).rejects.toThrow(/register|registration/);
    const failed = localStorage.getItem("dirty-turf-native-push-installation-v1");
    expect(JSON.parse(failed!)).toMatchObject({ enabled: false, revokePending: true, revision: 2 });
    expect((await push.readNativePushStatus()).enabled).toBe(false);
    mock.listeners.registration({ value: "ab".repeat(32) });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mock.calls.some(call => call.name === "register_academy_push_device")).toBe(false);
    expect(localStorage.getItem("dirty-turf-native-push-installation-v1")).toBe(failed);
    mock.calls = [];
    await push.enableNativePush();
    const revoke = mock.calls.findIndex(call => call.name === "unregister_academy_push_device");
    const register = mock.calls.findIndex(call => call.name === "register_academy_push_device");
    expect(revoke).toBeGreaterThanOrEqual(0); expect(register).toBeGreaterThan(revoke);
    expect(JSON.parse(localStorage.getItem("dirty-turf-native-push-installation-v1")!)).toMatchObject({ enabled: true, revokePending: false, revision: 3 });
  });
  it("invalidates an automatic refresh rejection without accepting a late token", async () => {
    const push = await import("./nativePush"); await push.startNativePush(vi.fn()); await push.enableNativePush(); mock.prefs.push_enabled = true; mock.calls = [];
    plugin.register.mockRejectedValueOnce(new Error("synthetic registration failure"));
    await expect(push.refreshNativePush()).rejects.toThrow("registration failed");
    const failed = localStorage.getItem("dirty-turf-native-push-installation-v1");
    expect(JSON.parse(failed!)).toMatchObject({ enabled: false, revokePending: true, revision: 3 });
    mock.listeners.registration({ value: "ab".repeat(32) });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mock.calls.some(call => call.name === "register_academy_push_device")).toBe(false);
    expect(localStorage.getItem("dirty-turf-native-push-installation-v1")).toBe(failed);
  });
  it("does not invalidate a settled successful registration when the OS promise rejects late", async () => {
    const push = await import("./nativePush"); await push.startNativePush(vi.fn());
    let rejectRegistration!: (error: Error) => void;
    plugin.register.mockImplementationOnce(() => {
      mock.listeners.registration({ value: "ab".repeat(32) });
      return new Promise<void>((_resolve, reject) => { rejectRegistration = reject; });
    });
    await push.enableNativePush();
    const success = localStorage.getItem("dirty-turf-native-push-installation-v1");
    rejectRegistration(new Error("synthetic late OS failure"));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(localStorage.getItem("dirty-turf-native-push-installation-v1")).toBe(success);
    expect(JSON.parse(success!).enabled).toBe(true);
  });
  it("invalidates a timed-out attempt and ignores its late token", async () => {
    vi.useFakeTimers();
    try {
      const push = await import("./nativePush"); await push.startNativePush(vi.fn());
      plugin.register.mockResolvedValueOnce(undefined);
      const pending = push.enableNativePush().catch(error => error);
      await vi.waitFor(() => expect(plugin.register).toHaveBeenCalledOnce());
      await vi.advanceTimersByTimeAsync(20_000);
      expect((await pending).message).toContain("timed out");
      const failed = localStorage.getItem("dirty-turf-native-push-installation-v1");
      expect(JSON.parse(failed!)).toMatchObject({ enabled: false, revokePending: true, revision: 2 });
      mock.listeners.registration({ value: "ab".repeat(32) });
      await vi.advanceTimersByTimeAsync(0);
      expect(mock.calls.some(call => call.name === "register_academy_push_device")).toBe(false);
      expect(localStorage.getItem("dirty-turf-native-push-installation-v1")).toBe(failed);
    } finally { vi.useRealTimers(); }
  });
  it("performs remote revocation even when OS cleanup fails, without changing global preferences", async () => {
    const push = await import("./nativePush"); await push.startNativePush(vi.fn()); await push.enableNativePush(); mock.calls = []; mock.unregisterFailure = true;
    await expect(push.clearNativePushForSignOut()).rejects.toThrow("cleanup");
    expect(mock.calls.map(call => call.name)).toEqual(["unregister_academy_push_device"]);
    expect(plugin.removeAllDeliveredNotifications).toHaveBeenCalled();
  });
  it("retains offline revocation and retries anonymously on next resume", async () => {
    const push = await import("./nativePush"); await push.startNativePush(vi.fn()); await push.enableNativePush(); mock.remoteFailure = true;
    await expect(push.clearNativePushForSignOut()).rejects.toThrow("retry");
    expect(JSON.parse(localStorage.getItem("dirty-turf-native-push-installation-v1")!).revokePending).toBe(true);
    mock.remoteFailure = false; await push.refreshNativePush();
    expect(JSON.parse(localStorage.getItem("dirty-turf-native-push-installation-v1")!).revokePending).toBe(false);
  });
  it("resolves OS data through the authenticated notification owner instead of trusting payload targets", async () => {
    const push = await import("./nativePush");
    expect(push.parseNativePushTarget({ notificationId: "https://evil.test", targetType: "post", targetId: "bad" })).toBeNull();
    const target = await push.resolveNativePushTarget("22222222-2222-4222-8222-222222222222");
    expect(target?.targetId).toBe("33333333-3333-4333-8333-333333333333"); expect(mock.calls[0].header).toBe("Bearer account-a-token");
    expect(mock.calls[0].args).toEqual({ p_notification_id: "22222222-2222-4222-8222-222222222222" });
  });
  it.each([true, false])("a late prior-account registration completion (%s failure) cannot overwrite a newer opt-in", async fail => {
    const push = await import("./nativePush"); await push.startNativePush(vi.fn());
    let release!: (value: any) => void; mock.deferRegistration = new Promise(resolve => { release = resolve; });
    const old = push.enableNativePush().catch(error => error);
    for (let tick = 0; tick < 20 && !mock.calls.some(call => call.name === "register_academy_push_device"); tick++) await new Promise(resolve => setTimeout(resolve, 0));
    await push.clearNativePushForSignOut(); await old;
    mock.session = { user: { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }, access_token: "account-b-token" }; mock.deferRegistration = undefined;
    await push.enableNativePush();
    const before = localStorage.getItem("dirty-turf-native-push-installation-v1");
    release({ data: null, error: fail ? new Error("synthetic late failure") : null }); await new Promise(resolve => setTimeout(resolve, 0));
    expect(localStorage.getItem("dirty-turf-native-push-installation-v1")).toBe(before);
    expect(JSON.parse(before!).userId).toBe(mock.session.user.id);
    expect(mock.calls.filter(call => call.name === "unregister_academy_push_device")).toHaveLength(1);
  });
  it.each([true, false])("a delayed readiness read cannot overwrite logout or pending revocation (offline %s)", async offline => {
    const push = await import("./nativePush"); await push.startNativePush(vi.fn()); await push.enableNativePush();
    mock.calls = []; plugin.register.mockClear(); plugin.requestPermissions.mockClear();
    let release!: (value: any) => void; mock.deferReadiness = new Promise(resolve => { release = resolve; });
    const old = push.enableNativePush().catch(error => error);
    for (let tick = 0; tick < 20 && !mock.calls.some(call => call.name === "academy_push_readiness"); tick++) await new Promise(resolve => setTimeout(resolve, 0));
    expect(mock.calls.some(call => call.name === "academy_push_readiness")).toBe(true);
    mock.remoteFailure = offline;
    if (offline) await expect(push.clearNativePushForSignOut()).rejects.toThrow("retry"); else await push.clearNativePushForSignOut();
    const disabled = localStorage.getItem("dirty-turf-native-push-installation-v1");
    expect(JSON.parse(disabled!).enabled).toBe(false); expect(JSON.parse(disabled!).revokePending).toBe(offline);
    release({ data: [{ ready: true, environment: "production" }], error: null });
    expect((await old).message).toContain("account changed");
    expect(localStorage.getItem("dirty-turf-native-push-installation-v1")).toBe(disabled);
    expect(mock.calls.some(call => call.name === "begin_academy_push_registration")).toBe(false);
    expect(plugin.requestPermissions).not.toHaveBeenCalled(); expect(plugin.register).not.toHaveBeenCalled();
  });
});
