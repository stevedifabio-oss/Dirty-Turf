import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommunitySchedule, CommunityScheduleOverview } from "../lib/communityScheduler";

type HookState = { slots: any[]; cursor: number; effects: Array<() => void> };
const hooks = vi.hoisted(() => ({ active: null as HookState | null }));
const api = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), state: vi.fn() }));
vi.mock("../lib/communityScheduler", async original => ({ ...await original<typeof import("../lib/communityScheduler")>(), loadCommunityScheduleOverview: api.load, saveCommunitySchedule: api.save, setCommunityScheduleState: api.state }));
vi.mock("../lib/backend", () => ({ supabase: null }));
vi.mock("react", async original => {
  const actual = await original<typeof import("react")>();
  const next = () => { if (!hooks.active) throw new Error("Render through the scheduler harness"); return { state: hooks.active, index: hooks.active.cursor++ }; };
  const same = (a: any[] | undefined, b: any[] | undefined) => a !== undefined && b !== undefined && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  return { ...actual,
    useState: (initial: any) => { const { state, index } = next(); if (!(index in state.slots)) state.slots[index] = typeof initial === "function" ? initial() : initial; return [state.slots[index], (value: any) => { state.slots[index] = typeof value === "function" ? value(state.slots[index]) : value; }]; },
    useRef: (initial: any) => { const { state, index } = next(); return state.slots[index] ??= { current: initial }; },
    useId: () => { next(); return "scheduler-test"; },
    useMemo: (factory: () => any, deps: any[]) => { const { state, index } = next(); if (!same(state.slots[index]?.deps, deps)) state.slots[index] = { deps, value: factory() }; return state.slots[index].value; },
    useCallback: (value: any, deps: any[]) => { const { state, index } = next(); if (!same(state.slots[index]?.deps, deps)) state.slots[index] = { deps, value }; return state.slots[index].value; },
    useEffect: (effect: () => void | (() => void), deps: any[] | undefined) => { const { state, index } = next(); if (!same(state.slots[index]?.deps, deps)) { const previous = state.slots[index]; state.slots[index] = { deps }; state.effects.push(() => { previous?.cleanup?.(); state.slots[index].cleanup = effect(); }); } },
  };
});
import { CommunityScheduler } from "./CommunityScheduler";
type Element = ReactElement<Record<string, any>>;
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const value = node as Element;
  return [value, ...elements(value.props.children)];
}
function content(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(content).join("");
  if (!node || typeof node === "boolean") return "";
  return typeof node === "object" ? "props" in node ? content((node as Element).props.children) : "" : String(node);
}
function find(node: ReactNode, predicate: (element: Element) => boolean) { const element = elements(node).find(predicate); if (!element) throw new Error("Expected scheduler control not found"); return element; }
function button(node: ReactNode, label: string) { return find(node, element => element.type === "button" && (element.props["aria-label"] === label || content(element.props.children).trim() === label)); }
function field(node: ReactNode, label: string) { const wrapper = find(node, element => element.type === "label" && content(element.props.children).startsWith(label)); return find(wrapper.props.children, element => ["input", "select", "textarea"].includes(String(element.type))); }
const flush = async () => { for (let index = 0; index < 30; index++) await Promise.resolve(); };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
const disposals: Array<() => void> = [];
function harness(render: () => ReactNode) {
  const state: HookState = { slots: [], cursor: 0, effects: [] };
  const result = { render: () => { state.cursor = 0; hooks.active = state; let tree: ReactNode; try { tree = render(); } finally { hooks.active = null; } state.effects.splice(0).forEach(effect => effect()); return tree; }, dispose: () => { state.slots.forEach(slot => slot?.cleanup?.()); state.slots = []; } };
  disposals.push(result.dispose); return result;
}
const community = "10000000-0000-4000-8000-000000000001";
const author = "10000000-0000-4000-8000-000000000002";
const category = "10000000-0000-4000-8000-000000000003";
const scheduleId = "10000000-0000-4000-8000-000000000004";
const announcements = "10000000-0000-4000-8000-000000000006";
function schedule(patch: Partial<CommunitySchedule> = {}): CommunitySchedule { return { id: scheduleId, clientRequestId: scheduleId, createdBy: author, communityId: community, authorMemberId: author, categoryId: category, title: "Existing tip", body: "Share one takeaway from your Academy lesson.", kind: "weekly", timeZone: "America/Phoenix", startsOn: "2026-10-26", endsOn: null, localTime: "09:00", weekdays: [1, 3, 5], state: "draft", catchupMinutes: 15, revision: 1, expectedRevision: 1, isAnnouncement: false, createdAt: "2026-10-24T00:00:00Z", updatedAt: "2026-10-24T00:00:00Z", ...patch }; }
function overview(patch: Partial<CommunityScheduleOverview> = {}): CommunityScheduleOverview { return { schedules: [], occurrences: [], author: { id: author, displayName: "Steve" }, currentUserId: author, status: { databaseEnabled: false, workerActivationVerified: false, deliveryActivationVerified: false }, ...patch }; }
async function workspace() {
  const props = { communityId: community, categories: [{ id: category, name: "General" }, { id: announcements, name: "Announcements" }], members: [{ id: author, displayName: "Steve" }], readOnly: false, onDirtyChange: vi.fn(), onRun: vi.fn(async (_label: string, action: () => Promise<unknown>) => { try { await action(); return true; } catch { return false; } }) };
  const root = harness(() => CommunityScheduler(props)); root.render(); await flush();
  const render = root.render;
  const set = (label: string, value: string) => { field(render(), label).props.onChange({ target: { value } }); render(); };
  const newDraft = () => { button(render(), "New scheduled post").props.onClick(); render(); set("Post title", "Monday tip"); set("Post text", "Share one takeaway from your Academy lesson."); set("Publishing date", "2026-10-26"); };
  const submit = async () => { find(render(), element => element.type === "form").props.onSubmit({ preventDefault: vi.fn() }); await flush(); render(); };
  return { props, render, set, newDraft, submit, root };
}
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-24T00:00:00Z"));
  vi.stubGlobal("window", { confirm: vi.fn(() => true) }); vi.stubGlobal("requestAnimationFrame", (callback: () => void) => { callback(); return 1; });
  api.load.mockResolvedValue(overview()); api.save.mockResolvedValue(schedule({ kind: "once", weekdays: [] })); api.state.mockImplementation(async (value: CommunitySchedule, state: CommunitySchedule["state"]) => ({ ...value, state, revision: value.revision + 1 }));
});
afterEach(() => { disposals.splice(0).forEach(dispose => dispose()); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Admin Studio scheduled publishing interactions", () => {
  it("explains paused automation and starts a blank, current-author draft with the agreed zone/time", async () => {
    const page = await workspace();
    expect(content(page.render())).toContain("Automatic publishing is paused. You can prepare drafts.");
    expect(content(page.render())).toContain("No scheduled posts yet");
    button(page.render(), "New scheduled post").props.onClick();
    expect(field(page.render(), "Time zone").props.value).toBe("America/Phoenix");
    expect(field(page.render(), "Local publishing time").props.value).toBe("09:00");
    expect(field(page.render(), "Publishing date").props.value).toBe("");
    expect(content(page.render())).toContain("Publishing as Steve");
    expect(api.save).not.toHaveBeenCalled(); expect(api.state).not.toHaveBeenCalled();
  });
  it("saves a draft once despite duplicate clicks and distinguishes saved state from activation", async () => {
    const pending = deferred<CommunitySchedule>(); api.save.mockReturnValue(pending.promise);
    const page = await workspace(); page.newDraft();
    const form = find(page.render(), element => element.type === "form");
    form.props.onSubmit({ preventDefault: vi.fn() }); form.props.onSubmit({ preventDefault: vi.fn() });
    expect(api.save).toHaveBeenCalledTimes(1); expect(api.save.mock.calls[0][0]).toMatchObject({ authorMemberId: author, state: "draft", startsOn: "2026-10-26", timeZone: "America/Phoenix", localTime: "09:00" });
    pending.resolve(schedule({ title: "Monday tip", kind: "once", weekdays: [] })); await flush();
    expect(content(page.render())).toContain("Draft saved. Activate it separately");
    expect(button(page.render(), "Activate schedule Monday tip").props.disabled).toBe(true);
    expect(api.state).not.toHaveBeenCalled();
  });
  it("keeps the draft and reports failed saves without a success claim", async () => {
    api.save.mockRejectedValue(new Error("This schedule changed in another session."));
    const page = await workspace(); page.newDraft(); await page.submit();
    expect(field(page.render(), "Post title").props.value).toBe("Monday tip");
    expect(content(find(page.render(), element => element.props.role === "alert"))).toContain("another session");
    expect(content(page.render())).not.toContain("Draft saved.");
    expect(page.props.onDirtyChange).toHaveBeenLastCalledWith(true);
  });
  it("switches announcements to the correct channel and previews literal content safely", async () => {
    const page = await workspace(); page.newDraft(); page.set("Post type", "announcement"); page.set("Post text", "<script>private()</script>\nA general announcement.");
    button(page.render(), "Preview post").props.onClick();
    const tree = page.render(); expect(field(tree, "Channel").props.value).toBe(announcements);
    expect(content(find(tree, element => element.props["aria-label"] === "Scheduled post preview"))).toContain("<script>private()</script>");
    expect(elements(tree).some(element => "dangerouslySetInnerHTML" in element.props)).toBe(false);
    await page.submit(); expect(api.save.mock.calls[0][0].categoryId).toBe(announcements);
  });
  it("explains that weekly cadence repeats the same content and shows weekday controls", async () => {
    const page = await workspace(); page.newDraft(); page.set("Schedule", "weekly");
    expect(content(page.render())).toContain("A weekly schedule repeats this exact post");
    const checked = elements(page.render()).filter(element => element.type === "input" && element.props.type === "checkbox" && element.props.checked).map(element => element.props["aria-label"]);
    expect(checked).toEqual(["Monday", "Wednesday", "Friday"]);
    expect(content(page.render())).toContain("Oct 26, 2026, 9:00 AM");
  });
  it("clears weekly-only weekdays and end date when switching back to a one-time post", async () => {
    const page = await workspace(); page.newDraft(); page.set("Schedule", "weekly"); page.set("End date", "2026-11-30"); page.set("Schedule", "once");
    expect(elements(page.render()).some(element => element.type === "input" && element.props.type === "checkbox")).toBe(false);
    await page.submit();
    expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ kind: "once", weekdays: [], endsOn: null }), author);
  });
  it("requires explicit activation, handles cancellation refusal and uses the saved revision", async () => {
    api.load.mockResolvedValue(overview({ schedules: [schedule()], status: { databaseEnabled: true, workerActivationVerified: false, deliveryActivationVerified: false } }));
    const page = await workspace();
    button(page.render(), "Activate schedule Existing tip").props.onClick(); await flush();
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("members who follow the author"));
    expect(api.state).toHaveBeenCalledWith(expect.objectContaining({ revision: 1 }), "active", author);
    expect(content(page.render())).toContain("Delivery still depends");
    button(page.render(), "Pause schedule Existing tip").props.onClick(); await flush();
    expect(api.state).toHaveBeenLastCalledWith(expect.objectContaining({ revision: 2, state: "active" }), "paused", author);
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    button(page.render(), "Cancel schedule Existing tip").props.onClick(); await flush();
    expect(api.state).toHaveBeenCalledTimes(2);
  });
  it("preserves an unsaved draft across loading failures and offline transitions", async () => {
    const page = await workspace(); page.newDraft(); page.props.readOnly = true; page.render();
    expect(field(page.render(), "Post title").props.value).toBe("Monday tip");
    find(page.render(), element => element.type === "form").props.onSubmit({ preventDefault: vi.fn() }); await flush();
    expect(api.save).not.toHaveBeenCalled();
    page.props.readOnly = false; api.load.mockRejectedValue(new Error("The schedule list is unavailable.")); page.render(); await flush();
    expect(content(page.render())).toContain("Previously loaded schedules are still shown");
    expect(field(page.render(), "Post title").props.value).toBe("Monday tip");
    expect(button(page.render(), "Save draft").props.disabled).toBe(true);
  });
  it("shows evaluated history rather than an edited schedule’s title and never calls publication delivery", async () => {
    api.load.mockResolvedValue(overview({ schedules: [schedule({ title: "Later edited title" })], occurrences: [{ id: "10000000-0000-4000-8000-000000000007", scheduleId, communityId: community, scheduledFor: "2026-10-23T16:00:00Z", state: "published", postId: "10000000-0000-4000-8000-000000000008", reasonCode: null, scheduleRevision: 1, snapshot: { title: "Title when it published", timeZone: "America/Phoenix" } }] }));
    const page = await workspace(); button(page.render(), "Publishing history 1").props.onClick();
    const history = find(page.render(), element => element.props.id === "scheduler-test-history");
    expect(content(history)).toContain("Title when it published"); expect(content(history)).not.toContain("Later edited title");
    expect(content(history)).toContain("Post published. Email and push delivery are separate.");
  });
  it("explains load failures and successfully retries without seeding a schedule", async () => {
    api.load.mockRejectedValueOnce(new Error("Scheduled publishing needs its database update."));
    const page = await workspace();
    expect(content(page.render())).toContain("database update"); expect(button(page.render(), "New scheduled post").props.disabled).toBe(true);
    button(page.render(), "Try loading again").props.onClick(); await flush();
    expect(content(page.render())).toContain("No scheduled posts yet"); expect(api.save).not.toHaveBeenCalled();
  });
  it("protects another administrator’s content while retaining pause and cancel controls", async () => {
    api.load.mockResolvedValue(overview({ schedules: [schedule({ state: "active", createdBy: category })] }));
    const page = await workspace();
    const edit = button(page.render(), "Edit schedule Existing tip");
    expect(edit.props.disabled).toBe(true); expect(edit.props.title).toContain("Only the schedule creator");
    edit.props.onClick(); expect(elements(page.render()).some(element => element.type === "form")).toBe(false);
    expect(button(page.render(), "Pause schedule Existing tip").props.disabled).toBe(false);
    button(page.render(), "Pause schedule Existing tip").props.onClick(); await flush();
    expect(api.state).toHaveBeenCalledWith(expect.objectContaining({ createdBy: category }), "paused", author);
  });
});
