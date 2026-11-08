import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PushSettings } from "./PushSettings";
const hooks = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as Array<() => void> }));
const backend = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), enable: vi.fn(), disable: vi.fn(), subscribe: vi.fn(() => () => undefined) }));
vi.mock("../lib/nativePush", () => ({ readNativePushStatus: backend.read, saveNativePushPreferences: backend.save, enableNativePush: backend.enable, disableNativePush: backend.disable, subscribeNativePushStatus: backend.subscribe }));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useRef: (initial: any) => hooks.slots[hooks.cursor++] ??= { current: initial },
  useState: (initial: any) => { const index = hooks.cursor++; if (!(index in hooks.slots)) hooks.slots[index] = initial; return [hooks.slots[index], (value: any) => { hooks.slots[index] = typeof value === "function" ? value(hooks.slots[index]) : value; }]; },
  useEffect: (effect: () => void, deps: any[]) => { const index = hooks.cursor++; const last = hooks.slots[index]; if (!last || deps.some((value, key) => value !== last[key])) { hooks.slots[index] = deps; hooks.effects.push(effect); } },
}));
type Element = ReactElement<Record<string, any>>;
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  return [node as Element, ...elements((node as Element).props.children)];
}
function copy(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(copy).join("");
  if (!node || typeof node === "boolean") return "";
  return typeof node === "object" && "props" in node ? copy((node as Element).props.children) : String(node);
}
function input(tree: ReactNode, label: string) {
  const row = elements(tree).find(element => element.type === "label" && copy(element).includes(label));
  if (!row) throw new Error(`Missing preference ${label}`);
  return elements(row).find(element => element.type === "input")!;
}
const preferences = { push_replies: true, push_mentions: true, push_reactions: false, push_all_new_posts: false, push_new_posts: false, push_new_members: false, push_admin_announcements: true, push_event_reminders: true, push_course_updates: true };
const status = (extra: Record<string, unknown> = {}) => ({ supported: true, ready: false, enabled: false, permission: "granted", preferences, communityAlertsReady: true, appUpdateAlertsReady: true, ...extra });
const flush = async () => { for (let index = 0; index < 10; index++) await Promise.resolve(); };
function render() {
  hooks.cursor = 0;
  const tree = PushSettings({ onToast: vi.fn() });
  hooks.effects.splice(0).forEach(effect => effect());
  return tree;
}
beforeEach(() => {
  hooks.slots = []; hooks.cursor = 0; hooks.effects = []; vi.clearAllMocks();
  backend.read.mockResolvedValue(status()); backend.save.mockResolvedValue(undefined);
});

describe("grouped phone notification switches", () => {
  it("shows a master and three categories without enabling delivery on mount", async () => {
    render(); await flush(); const tree = render();
    expect(input(tree, "Phone notifications").props).toMatchObject({ role: "switch", checked: false, disabled: true });
    expect(elements(tree).filter(element => element.type === "input")).toHaveLength(4);
    expect(backend.enable).not.toHaveBeenCalled(); expect(backend.save).not.toHaveBeenCalled();
  });
  it("enables the phone without rewriting saved category choices", async () => {
    backend.read.mockResolvedValue(status({ ready: true, preferences: { ...preferences, push_course_updates: false } }));
    render(); await flush(); input(render(), "Phone notifications").props.onChange({ target: { checked: true } }); await flush();
    expect(backend.enable).toHaveBeenCalledOnce(); expect(backend.save).not.toHaveBeenCalled();
  });
  it("mutes the whole community group while retaining other choices", async () => {
    backend.read.mockResolvedValue(status({ ready: true, enabled: true }));
    render(); await flush(); input(render(), "Community").props.onChange({ target: { checked: false } }); await flush();
    expect(backend.save).toHaveBeenCalledWith(expect.objectContaining({ push_replies: false, push_mentions: false, push_reactions: false, push_new_posts: false, push_all_new_posts: false, push_new_members: false, push_admin_announcements: false, push_event_reminders: false, push_course_updates: true, push_app_updates: true }), true, true);
    expect(backend.enable).not.toHaveBeenCalled();
  });
  it("changes courses without widening community consent", async () => {
    backend.read.mockResolvedValue(status({ ready: true, enabled: true }));
    render(); await flush(); input(render(), "Courses").props.onChange({ target: { checked: false } }); await flush();
    expect(backend.save).toHaveBeenCalledWith({ ...preferences, push_course_updates: false, push_app_updates: true }, true, true);
  });
  it("holds unavailable categories against an older backend", async () => {
    backend.read.mockResolvedValue(status({ ready: true, enabled: true, communityAlertsReady: false, appUpdateAlertsReady: false }));
    render(); await flush(); const tree=render();
    expect(input(tree, "App updates").props.disabled).toBe(true);
    expect(copy(tree)).toContain("waiting for release setup");
    input(tree, "Community").props.onChange({ target: { checked: true } }); await flush();
    expect(backend.save).toHaveBeenCalledWith(expect.objectContaining({ push_replies: true, push_all_new_posts: false, push_new_members: false }), false, false);
  });
  it("reports category save failure", async () => {
    backend.read.mockResolvedValue(status({ ready: true, enabled: true })); backend.save.mockRejectedValueOnce(new Error("Could not save preferences"));
    render(); await flush(); input(render(), "Courses").props.onChange({ target: { checked: false } }); await flush();
    expect(copy(render())).toContain("Could not save preferences"); expect(backend.enable).not.toHaveBeenCalled();
  });
  it("turns the master off without rewriting categories", async () => {
    backend.read.mockResolvedValue(status({ ready: false, enabled: true }));
    render(); await flush(); const tree=render(); expect(input(tree, "Phone notifications").props.disabled).toBe(false);
    input(tree, "Phone notifications").props.onChange({ target: { checked: false } }); await flush();
    expect(backend.disable).toHaveBeenCalledOnce(); expect(backend.save).not.toHaveBeenCalled();
  });
});
