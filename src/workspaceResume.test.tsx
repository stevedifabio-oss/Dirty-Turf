import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { COMMUNITY_TERMS_VERSION } from "./lib/termsConsent";

const mock = vi.hoisted(() => ({
  render: vi.fn(), auth: undefined as undefined | ((event: string, session: any) => void),
  mode: vi.fn(), access: vi.fn(), loadCourses: vi.fn(), saveJob: vi.fn(), signOut: vi.fn(), nativeAuth: vi.fn(), requestMagicLink: vi.fn(), passwordSignIn: vi.fn(),
  native: false, nativeStateChanged: undefined as undefined | ((state: { isActive: boolean }) => void),
  hooks: null as null | { slots: any[]; cursor: number; effects: (() => void | (() => void))[]; cleanups: (() => void)[] },
}));
vi.mock("react", async original => {
  const actual = await original<typeof import("react")>();
  const next = () => { const state = mock.hooks!; return { state, index: state.cursor++ }; };
  const same = (a: any[], b: any[]) => a?.length === b?.length && a.every((value, n) => Object.is(value, b[n]));
  return { ...actual,
    useState: (initial: any) => { const { state, index } = next(); if (!(index in state.slots)) state.slots[index] = typeof initial === "function" ? initial() : initial;
      return [state.slots[index], (value: any) => { state.slots[index] = typeof value === "function" ? value(state.slots[index]) : value; }]; },
    useRef: (initial: any) => { const { state, index } = next(); return state.slots[index] ??= { current: initial }; },
    useCallback: (callback: any, deps: any[]) => { const { state, index } = next(); if (!same(state.slots[index]?.deps, deps)) state.slots[index] = { deps, callback }; return state.slots[index].callback; },
    useEffect: (effect: any, deps: any[]) => { const { state, index } = next(); if (!same(state.slots[index]?.deps, deps)) {
      const previous = state.slots[index]; state.slots[index] = { deps };
      state.effects.push(() => { previous?.cleanup?.(); const cleanup = effect(); state.slots[index].cleanup = cleanup; if (cleanup) state.cleanups.push(cleanup); });
    } },
  };
});
vi.mock("react-dom/client", () => ({ createRoot: () => ({ render: mock.render }) }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => mock.native }, registerPlugin: () => ({}) }));
vi.mock("@capacitor/app", () => ({ App: { addListener: vi.fn(async (event: string, callback: (state: { isActive: boolean }) => void) => {
  if (event === "appStateChange") mock.nativeStateChanged = callback;
  return { remove: vi.fn(async () => undefined) };
}) } }));
vi.mock("./lib/backend", async original => ({
  ...await original<typeof import("./lib/backend")>(),
  supabase: { auth: { onAuthStateChange: (callback: any) => { mock.auth = callback; return { data: { subscription: { unsubscribe: vi.fn() } } }; } } },
  getDataMode: mock.mode, claimAcademyMemberships: async () => ({}), getWorkspaceAccessState: mock.access,
  loadJobs: async () => [], loadCourses: mock.loadCourses,
  saveJob: mock.saveJob, signOut: mock.signOut,
  requestMagicLink: mock.requestMagicLink, signInWithPassword: mock.passwordSignIn,
  loadPosts: async () => ({ posts: [], hasMore: false }), loadComments: async () => [], loadEvents: async () => [], loadMembers: async () => [], loadNotifications: async () => [], loadAcademyCertificates: async () => [],
  initializeNativeAuth: mock.nativeAuth, subscribeToNotifications: () => () => undefined, subscribeToCommunityChanges: () => () => undefined,
}));

type Element = ReactElement<Record<string, any>>;
function elements(node: ReactNode): Element[] { if (Array.isArray(node)) return node.flatMap(elements); if (!node || typeof node !== "object" || !("props" in node)) return []; const e = node as Element; return [e, ...elements(e.props.children)]; }
function component(tree: ReactNode, name: string) { return elements(tree).find(e => typeof e.type === "function" && e.type.name === name); }
const memberAccess = { status: "member", canManage: false, pricingGatesEnabled: false, communityAccess: true, courseIds: [], features: [] };
const course = { id: "course", title: "Training", category: "Academy", description: "", instructor: "Instructor", progress: 0, duration: "1 min", access: "open", modules: [] };
let App: () => Element;
let environment: EventTarget;
let online = true;
let state: NonNullable<typeof mock.hooks>;
let consentStorage: Map<string, string>;
const flush = async () => { for (let n = 0; n < 25; n++) await Promise.resolve(); };
function render() {
  state.cursor = 0; mock.hooks = state;
  const tree = App(); mock.hooks = null;
  state.effects.splice(0).forEach(effect => effect());
  return tree;
}
beforeAll(async () => {
  vi.stubGlobal("window", { location: { href: "https://example.invalid/?view=learn", search: "?view=learn", pathname: "/" } });
  vi.stubGlobal("document", { getElementById: () => ({}) });
  vi.stubGlobal("navigator", {});
  await import("./main");
  App = component(mock.render.mock.calls[0][0], "App")!.type as () => Element;
});
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-08T12:00:00Z"));
  online = true; environment = new EventTarget();
  consentStorage = new Map([["dirty-turf-community-terms-v1", JSON.stringify({ version: COMMUNITY_TERMS_VERSION, acceptedAt: "2026-10-18T12:00:00Z", userId: null })]]);
  vi.stubGlobal("window", {
    localStorage: { getItem: (key: string) => consentStorage.get(key) ?? null, setItem: (key: string, value: string) => consentStorage.set(key, value), removeItem: (key: string) => consentStorage.delete(key) },
    location: { href: "https://example.invalid/?view=learn", search: "?view=learn", pathname: "/" },
    history: { state: null, replaceState: vi.fn() }, scrollTo: vi.fn(),
    addEventListener: environment.addEventListener.bind(environment), removeEventListener: environment.removeEventListener.bind(environment),
    setTimeout, clearTimeout, setInterval, clearInterval,
  });
  vi.stubGlobal("document", { visibilityState: "visible", querySelector: () => null, querySelectorAll: () => [], addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("navigator", { get onLine() { return online; } });
  mock.mode.mockReset().mockResolvedValue("cloud"); mock.access.mockReset().mockResolvedValue(memberAccess); mock.loadCourses.mockReset().mockResolvedValue([course]);
  mock.saveJob.mockReset().mockImplementation(async job => job);
  mock.signOut.mockReset().mockResolvedValue(undefined);
  mock.nativeAuth.mockReset().mockResolvedValue(() => undefined);
  mock.requestMagicLink.mockReset().mockResolvedValue({ error: null });
  mock.passwordSignIn.mockReset().mockResolvedValue({ error: null });
  mock.native = false; mock.nativeStateChanged = undefined;
  state = { slots: [], cursor: 0, effects: [], cleanups: [] };
});
afterEach(() => { state.cleanups.forEach(cleanup => cleanup()); vi.useRealTimers(); });
async function signIn() {
  render(); mock.auth!("INITIAL_SESSION", { user: { id: "member-one" }, expires_at: Date.now() / 1000 + 3600 });
  await vi.advanceTimersByTimeAsync(0); await flush(); return render();
}
function openQuote() {
  component(render(), "PrimaryNavigation")!.props.onNavigate("home");
  component(render(), "HomeView")!.props.openQuote("manual");
  return component(render(), "QuoteSheet")!;
}
function editPrivateQuote() {
  const quote = openQuote();
  const file = new File(["private photo"], "visit.jpg", { type: "image/jpeg" });
  quote.props.setDraft((current: any) => ({ ...current, address: "Private member-one property", length: 79, width: 31 }));
  quote.props.setPhotoFile(file); quote.props.setPhotoUrl("blob:member-one-photo");
  component(render(), "HomeView")!.props.setChecks([true, false, true, false]);
  return { oldQuote: component(render(), "QuoteSheet")!, file };
}
function signOutFromSettings() {
  component(render(), "PrimaryNavigation")!.props.onOpenSettings();
  return elements(render()).find(e => typeof e.props.onSignOut === "function" && "notifications" in e.props)!.props.onSignOut() as Promise<void>;
}
async function agreeForFixture() {
  component(render(), "CommunityTermsGate")?.props.onAccept();
  await vi.advanceTimersByTimeAsync(0); await flush();
}
function renderGate(element: Element) {
  const local: NonNullable<typeof mock.hooks> = { slots: [], cursor: 0, effects: [], cleanups: [] };
  return () => {
    local.cursor = 0; mock.hooks = local;
    const tree = (element.type as (props: any) => ReactNode)(element.props);
    mock.hooks = null; local.effects.splice(0).forEach(effect => effect()); return tree;
  };
}
describe("community terms entry consent", () => {
  it("does not send a link or password login without agreement, then enables the explicit unchecked choice", async () => {
    consentStorage.clear(); mock.mode.mockResolvedValue("device"); mock.access.mockResolvedValue({ status: "signed_out" });
    render(); mock.auth!("INITIAL_SESSION", null); await vi.advanceTimersByTimeAsync(0); await flush();
    const gate = component(render(), "LaunchAccessGate")!;
    await expect(gate.props.onRequestMagicLink("member@example.com")).rejects.toThrow("terms");
    await expect(gate.props.onPasswordSignIn("member@example.com", "fixture-password")).rejects.toThrow("terms");
    expect(mock.requestMagicLink).not.toHaveBeenCalled(); expect(mock.passwordSignIn).not.toHaveBeenCalled();
    const draw = renderGate(gate); let tree = draw();
    expect(component(tree, "TermsChoice")!.props.checked).toBe(false);
    elements(tree).find(e => e.type === "input" && e.props.type === "email")!.props.onChange({ target: { value: "member@example.com" } });
    tree = draw(); expect(elements(tree).find(e => e.type === "button" && e.props.className === "primary-button wide")!.props.disabled).toBe(true);
    await elements(tree).find(e => e.type === "form")!.props.onSubmit({ preventDefault: vi.fn() });
    expect(mock.requestMagicLink).not.toHaveBeenCalled();
    component(tree, "TermsChoice")!.props.onChange(true); tree = draw();
    expect(elements(tree).find(e => e.type === "button" && e.props.className === "primary-button wide")!.props.disabled).toBe(false);
    await elements(tree).find(e => e.type === "form")!.props.onSubmit({ preventDefault: vi.fn() });
    expect(mock.requestMagicLink).toHaveBeenCalledExactlyOnceWith("member@example.com");
    await gate.props.onPasswordSignIn("member@example.com", "fixture-password");
    expect(mock.passwordSignIn).toHaveBeenCalledExactlyOnceWith("member@example.com", "fixture-password");
  });
  it("holds a returning member before protected reads until explicit current-version agreement", async () => {
    consentStorage.clear(); await signIn();
    const gate = component(render(), "CommunityTermsGate")!;
    expect(gate).toBeDefined(); expect(component(render(), "AcademyView")).toBeUndefined();
    expect(mock.access).not.toHaveBeenCalled(); expect(mock.loadCourses).not.toHaveBeenCalled();
    const draw = renderGate(gate); let tree = draw();
    expect(component(tree, "TermsChoice")!.props.checked).toBe(false);
    const button = elements(tree).find(e => e.type === "button" && e.props.className === "primary-button wide")!;
    expect(button.props.disabled).toBe(true); button.props.onClick();
    expect(mock.access).not.toHaveBeenCalled();
    component(tree, "TermsChoice")!.props.onChange(true); tree = draw();
    elements(tree).find(e => e.type === "button" && e.props.className === "primary-button wide")!.props.onClick();
    await flush();
    expect(component(render(), "AcademyView")?.props.courses).toEqual([course]);
    const receipt = JSON.parse([...consentStorage.values()][0]);
    expect(receipt.version).toBe(COMMUNITY_TERMS_VERSION); expect(receipt.userId).toBe("member-one");
  });
  it("resumes a held native callback only after agreement and does not ask the resulting account twice", async () => {
    consentStorage.clear(); mock.native = true; render();
    const consent = mock.nativeAuth.mock.calls[0][1]; expect(consent.canProcess()).toBe(false);
    const resume = vi.fn(async () => { mock.auth!("SIGNED_IN", { user: { id: "member-one" }, expires_at: Date.now() / 1000 + 3600 }); });
    consent.onRequired(resume);
    expect(component(render(), "CommunityTermsGate")?.props.pendingLink).toBe(true); expect(resume).not.toHaveBeenCalled();
    await agreeForFixture();
    expect(resume).toHaveBeenCalledOnce(); expect(consent.canProcess()).toBe(true);
    expect(component(render(), "CommunityTermsGate")).toBeUndefined();
    expect(component(render(), "AcademyView")?.props.courses).toEqual([course]);
  });
});
describe("actual workspace resume and offline flow", () => {
  it("restores a cold-start session when token recovery follows an initially unavailable session", async () => {
    mock.native = true;
    mock.mode.mockRejectedValueOnce(new Error("Session refresh is temporarily unavailable"));
    render();
    mock.auth!("INITIAL_SESSION", null);
    expect(component(render(), "LaunchAccessGate")?.props.status).toBe("loading");
    await vi.advanceTimersByTimeAsync(0); await flush();
    expect(component(render(), "LaunchAccessGate")?.props.status).toBe("error");
    expect(mock.access).not.toHaveBeenCalled();
    // Supabase can retain the refresh token after an interrupted cold restore,
    // then emit TOKEN_REFRESHED when the connection recovers.
    mock.auth!("TOKEN_REFRESHED", { user: { id: "member-one" }, expires_at: Date.now() / 1000 + 3600 });
    await vi.advanceTimersByTimeAsync(0); await flush();
    const recoveredTree = render(), recovered = component(recoveredTree, "AcademyView")!;
    expect(component(recoveredTree, "LaunchAccessGate")).toBeUndefined();
    expect(recovered.props.courses).toEqual([course]);
    expect(recovered.props.readOnly).toBe(false);
    expect(mock.access).toHaveBeenCalledOnce();
    expect(mock.loadCourses).toHaveBeenCalledOnce();
    mock.auth!("TOKEN_REFRESHED", { user: { id: "member-one" }, expires_at: Date.now() / 1000 + 7200 });
    await vi.advanceTimersByTimeAsync(0); await flush();
    expect(component(render(), "AcademyView")?.key).toBe(recovered.key);
    expect(mock.access).toHaveBeenCalledOnce();
    expect(mock.loadCourses).toHaveBeenCalledOnce();
  });
  it("shows the email form only after the empty initial session is confirmed", async () => {
    mock.mode.mockResolvedValue("device"); mock.access.mockResolvedValue({ status: "signed_out" });
    render(); mock.auth!("INITIAL_SESSION", null);
    expect(component(render(), "LaunchAccessGate")?.props.status).toBe("loading");
    await vi.advanceTimersByTimeAsync(0); await flush();
    expect(component(render(), "LaunchAccessGate")?.props.status).toBe("signed_out");
    expect(mock.mode).toHaveBeenCalledOnce(); expect(mock.access).toHaveBeenCalledOnce();
    expect(mock.loadCourses).not.toHaveBeenCalled();
  });
  it("ignores a late empty initial callback after restoring the current member", async () => {
    const before = component(await signIn(), "AcademyView")!;
    mock.auth!("INITIAL_SESSION", null); await vi.advanceTimersByTimeAsync(0); await flush();
    const retained = component(render(), "AcademyView")!;
    expect(retained.key).toBe(before.key); expect(retained.props.courses).toEqual([course]);
    online = false; environment.dispatchEvent(new Event("offline"));
    await vi.advanceTimersByTimeAsync(1000); await flush();
    expect(component(render(), "AcademyView")?.key).toBe(before.key);
    expect(mock.access).toHaveBeenCalledOnce();
  });
  it("never reapplies a cold restore after explicit sign-out while verification is pending", async () => {
    let finishRestore: ((value: string) => void) | undefined;
    mock.mode.mockImplementationOnce(() => new Promise(resolve => { finishRestore = resolve; }));
    render(); mock.auth!("INITIAL_SESSION", null);
    await vi.advanceTimersByTimeAsync(0); await flush();
    mock.auth!("SIGNED_OUT", null);
    expect(component(render(), "LaunchAccessGate")?.props.status).toBe("signed_out");
    finishRestore!("cloud"); await flush();
    expect(component(render(), "LaunchAccessGate")?.props.status).toBe("signed_out");
    expect(mock.loadCourses).not.toHaveBeenCalled();
  });
  it("discards the old cold restore after another account signs in", async () => {
    let finishRestore: ((value: string) => void) | undefined;
    mock.mode.mockImplementationOnce(() => new Promise(resolve => { finishRestore = resolve; }));
    render(); mock.auth!("INITIAL_SESSION", null);
    await vi.advanceTimersByTimeAsync(0); await flush();
    mock.auth!("SIGNED_IN", { user: { id: "member-two" }, expires_at: Date.now() / 1000 + 3600 });
    await vi.advanceTimersByTimeAsync(0); await flush();
    await agreeForFixture();
    const active = component(render(), "AcademyView")!;
    expect(active.props.courses).toEqual([course]);
    finishRestore!("cloud"); await flush();
    expect(component(render(), "AcademyView")?.key).toBe(active.key);
    expect(mock.loadCourses).toHaveBeenCalledOnce();
  });
  it.each(["signed_out", "switch", "revoked", "sign_out_button"] as const)("clears private quote state at the %s account boundary and rejects old setters", async boundary => {
    await signIn(); const { oldQuote, file } = editPrivateQuote();
    if (boundary === "switch") {
      mock.auth!("SIGNED_IN", { user: { id: "member-two" }, expires_at: Date.now() / 1000 + 3600 });
    } else if (boundary === "revoked") {
      mock.access.mockResolvedValueOnce({ status: "no_access" }).mockResolvedValueOnce({ status: "no_access" });
      environment.dispatchEvent(new Event("focus"));
    } else if (boundary === "sign_out_button") {
      oldQuote.props.onClose();
      component(render(), "PrimaryNavigation")!.props.onOpenSettings();
      const settings = elements(render()).find(e => typeof e.props.onSignOut === "function" && "notifications" in e.props)!;
      await settings.props.onSignOut();
    } else mock.auth!("SIGNED_OUT", null);
    await vi.advanceTimersByTimeAsync(0); await flush();
    if (boundary !== "switch") {
      mock.auth!("SIGNED_IN", { user: { id: "member-two" }, expires_at: Date.now() / 1000 + 3600 });
      await vi.advanceTimersByTimeAsync(0); await flush();
    }
    await agreeForFixture();
    expect(component(render(), "QuoteSheet")).toBeUndefined();
    let freshQuote = openQuote();
    expect(freshQuote.props.draft).toMatchObject({ address: "", length: 38, width: 18 });
    expect(freshQuote.props.photoUrl).toBe("");
    oldQuote.props.setDraft((current: any) => ({ ...current, address: "Late private address" }));
    oldQuote.props.setPhotoFile(file); oldQuote.props.setPhotoUrl("blob:late-private-photo");
    await oldQuote.props.onSave(); await flush();
    expect(mock.saveJob).not.toHaveBeenCalled();
    freshQuote = component(render(), "QuoteSheet")!;
    expect(freshQuote.props.draft).toMatchObject({ address: "", length: 38, width: 18 });
    expect(freshQuote.props.photoUrl).toBe("");
    expect(component(render(), "HomeView")!.props.checks).toEqual([false, false, false, false]);
    await freshQuote.props.onSave(); await flush();
    expect(mock.saveJob).toHaveBeenCalledOnce();
    expect(mock.saveJob.mock.calls[0][1]).toBeUndefined();
    expect(mock.saveJob.mock.calls[0][0].address).not.toContain("Private");
  });
  it("preserves the same member's quote and photo through a transient failed resume and recovery", async () => {
    await signIn(); editPrivateQuote();
    mock.access.mockRejectedValueOnce(new Error("Temporary resume failure"));
    environment.dispatchEvent(new Event("focus")); await flush();
    expect(component(render(), "QuoteSheet")?.props.draft.address).toBe("Private member-one property");
    expect(component(render(), "QuoteSheet")?.props.photoUrl).toBe("blob:member-one-photo");
    mock.auth!("SIGNED_IN", { user: { id: "member-one" }, expires_at: Date.now() / 1000 + 3600 });
    mock.auth!("TOKEN_REFRESHED", { user: { id: "member-one" }, expires_at: Date.now() / 1000 + 7200 });
    environment.dispatchEvent(new Event("focus")); await flush();
    const retainedQuote = component(render(), "QuoteSheet")!;
    expect(retainedQuote.props.draft).toMatchObject({ address: "Private member-one property", length: 79, width: 31 });
    expect(retainedQuote.props.photoUrl).toBe("blob:member-one-photo");
    expect(component(render(), "HomeView")!.props.checks).toEqual([true, false, true, false]);
    await retainedQuote.props.onSave(); await flush();
    expect(mock.saveJob.mock.calls[0][1]?.name).toBe("visit.jpg");
  });
  it.each(["access", "content"] as const)("invalidates delayed %s results immediately when explicit sign-out starts", async pendingStage => {
    await signIn();
    let finishRead: ((value: any) => void) | undefined;
    let finishSignOut: (() => void) | undefined;
    mock.signOut.mockImplementationOnce(() => new Promise<void>(resolve => { finishSignOut = resolve; }));
    if (pendingStage === "access") {
      mock.access.mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
      environment.dispatchEvent(new Event("focus"));
    } else {
      mock.loadCourses.mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
      mock.auth!("USER_UPDATED", { user: { id: "member-one" }, expires_at: Date.now() / 1000 + 3600 });
      await vi.advanceTimersByTimeAsync(0);
    }
    await flush(); expect(finishRead).toBeTypeOf("function");
    const signingOut = signOutFromSettings();
    expect(component(render(), "LaunchAccessGate")?.props.status).toBe("signed_out");
    const accessChecks = mock.access.mock.calls.length;
    environment.dispatchEvent(new Event("focus"));
    mock.auth!("TOKEN_REFRESHED", { user: { id: "member-one" }, expires_at: Date.now() / 1000 + 7200 });
    mock.auth!("SIGNED_IN", { user: { id: "member-one" }, expires_at: Date.now() / 1000 + 7200 });
    await vi.advanceTimersByTimeAsync(0); await flush();
    expect(mock.access).toHaveBeenCalledTimes(accessChecks);
    finishRead!(pendingStage === "access" ? memberAccess : [course]); await flush();
    expect(component(render(), "LaunchAccessGate")?.props.status).toBe("signed_out");
    expect(component(render(), "AcademyView")).toBeUndefined();
    finishSignOut!(); await signingOut; await flush();
    mock.auth!("SIGNED_IN", { user: { id: "member-one" }, expires_at: Date.now() / 1000 + 7200 });
    await vi.advanceTimersByTimeAsync(0); await flush();
    component(render(), "PrimaryNavigation")!.props.onNavigate("learn");
    expect(component(render(), "AcademyView")?.props.courses).toEqual([course]);
  });
  it("does not let completion of an older explicit sign-out overwrite a new account sign-in", async () => {
    await signIn(); let finishSignOut: (() => void) | undefined;
    mock.signOut.mockImplementationOnce(() => new Promise<void>(resolve => { finishSignOut = resolve; }));
    const signingOut = signOutFromSettings();
    mock.auth!("SIGNED_IN", { user: { id: "member-two" }, expires_at: Date.now() / 1000 + 3600 });
    await vi.advanceTimersByTimeAsync(0); await flush();
    await agreeForFixture();
    component(render(), "PrimaryNavigation")!.props.onNavigate("learn");
    const active = component(render(), "AcademyView")!; expect(active.props.courses).toEqual([course]);
    finishSignOut!(); await signingOut; await flush();
    expect(component(render(), "AcademyView")?.key).toBe(active.key);
    expect(component(render(), "LaunchAccessGate")).toBeUndefined();
  });
  it("keeps the current Academy and loaded course through a failed resume, then recovers without remounting", async () => {
    const before = component(await signIn(), "AcademyView")!;
    expect(before.props.courses).toEqual([course]);
    mock.access.mockRejectedValueOnce(new Error("Network unavailable"));
    environment.dispatchEvent(new Event("focus")); await flush();
    const offline = component(render(), "AcademyView")!;
    expect(offline.key).toBe(before.key); expect(offline.props.courses).toEqual([course]); expect(offline.props.readOnly).toBe(true);
    environment.dispatchEvent(new Event("focus")); await flush();
    const recovered = component(render(), "AcademyView")!;
    expect(recovered.key).toBe(before.key); expect(recovered.props.readOnly).toBe(false);
  });
  it("keeps a reading session through repeated native resume and timer failures without treating same-user auth events as a new login", async () => {
    mock.native = true;
    await signIn();
    elements(render()).find(e => e.props["aria-label"] === "Search")!.props.onClick();
    component(render(), "GlobalSearch")!.props.onOpen({ kind: "course", courseId: "course", lessonId: "current-lesson" });
    const before = component(render(), "AcademyView")!;
    // An open lesson suppresses background course replacement as in the real UI.
    document.querySelector = vi.fn(selector => selector === ".lesson-content" ? {} as Element : null) as typeof document.querySelector;
    expect(before.props.requestedLessonId).toBe("current-lesson");
    expect(mock.nativeStateChanged).toBeTypeOf("function");
    const accessChecks = mock.access.mock.calls.length;
    mock.nativeStateChanged!({ isActive: false }); await flush();
    expect(mock.access).toHaveBeenCalledTimes(accessChecks);
    mock.access.mockRejectedValueOnce(new Error("Resume request interrupted"))
      .mockRejectedValueOnce(new Error("Temporary connection failure"))
      .mockRejectedValueOnce(new Error("Timer access request interrupted"));
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt < 2) mock.nativeStateChanged!({ isActive: true });
      else await vi.advanceTimersByTimeAsync(60_000);
      await flush();
      const tree = render(), retained = component(tree, "AcademyView")!;
      expect(component(tree, "LaunchAccessGate")).toBeUndefined();
      expect(retained.key).toBe(before.key);
      expect(retained.props.courses).toEqual(before.props.courses);
      expect(retained.props.requestedLessonId).toBe("current-lesson");
      expect(retained.props.readOnly).toBe(true);
      mock.auth!("SIGNED_IN", { user: { id: "member-one" }, expires_at: Date.now() / 1000 + 3600 });
      mock.auth!("TOKEN_REFRESHED", { user: { id: "member-one" }, expires_at: Date.now() / 1000 + 3600 });
      await vi.advanceTimersByTimeAsync(0); await flush();
      expect(component(render(), "AcademyView")?.key).toBe(before.key);
    }
    expect(mock.access).toHaveBeenCalledTimes(accessChecks + 3);
    expect(mock.loadCourses).toHaveBeenCalledOnce();
    mock.nativeStateChanged!({ isActive: true }); await flush();
    const recoveredTree = render(), recovered = component(recoveredTree, "AcademyView")!;
    expect(component(recoveredTree, "LaunchAccessGate")).toBeUndefined();
    expect(recovered.key).toBe(before.key);
    expect(recovered.props.requestedLessonId).toBe("current-lesson");
    expect(recovered.props.courses).toEqual(before.props.courses);
    expect(recovered.props.readOnly).toBe(false);
    expect(mock.loadCourses).toHaveBeenCalledOnce();
  });
  it("never falls back to a member workspace when initial access cannot be verified", async () => {
    mock.access.mockRejectedValue(new Error("Network unavailable"));
    const tree = await signIn();
    expect(component(tree, "LaunchAccessGate")?.props.status).toBe("error");
    expect(component(tree, "AcademyView")).toBeUndefined();
  });
  it("disables saves immediately offline and clears expired or explicitly revoked access", async () => {
    await signIn(); online = false; environment.dispatchEvent(new Event("offline"));
    expect(component(render(), "AcademyView")?.props.readOnly).toBe(true);
    await expect(component(render(), "AcademyView")!.props.onLessonCompletion("lesson", true)).rejects.toThrow("Reconnect");
    vi.setSystemTime(new Date("2026-10-08T13:00:01Z")); await vi.advanceTimersByTimeAsync(1000);
    expect(component(render(), "LaunchAccessGate")?.props.status).toBe("error");
  });
  it("clears access on confirmed revocation and account switch instead of reusing the offline copy", async () => {
    const before = component(await signIn(), "AcademyView")!;
    mock.access.mockResolvedValue({ status: "no_access" });
    environment.dispatchEvent(new Event("focus")); await flush();
    expect(component(render(), "LaunchAccessGate")?.props.status).toBe("no_access");
    const obsoleteUpdate = vi.fn(() => [course]);
    before.props.onCoursesChange(obsoleteUpdate);
    expect(obsoleteUpdate).not.toHaveBeenCalled();
    mock.auth!("SIGNED_IN", { user: { id: "member-two" }, expires_at: Date.now() / 1000 + 3600 });
    mock.access.mockRejectedValue(new Error("Network unavailable")); await vi.advanceTimersByTimeAsync(0); await flush();
    await agreeForFixture();
    expect(component(render(), "LaunchAccessGate")?.props.status).toBe("error");
    expect(component(render(), "AcademyView")).toBeUndefined();
  });
  it("retains initial course links and keeps the reading view mounted while search opens", async () => {
    window.location.search = "?view=learn&course=course";
    const before = component(await signIn(), "AcademyView")!;
    expect(before.props.requestedCourseCloudId).toBe("course");
    elements(render()).find(e => e.props["aria-label"] === "Search")!.props.onClick();
    const searching = render();
    expect(component(searching, "GlobalSearch")).toBeDefined();
    expect(component(searching, "AcademyView")?.key).toBe(before.key);
    expect(elements(searching).some(e => e.type === "div" && e.props.hidden === true && component(e, "AcademyView"))).toBe(true);
  });
});
