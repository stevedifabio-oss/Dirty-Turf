import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CommunityMediaGallery, CommunityVideoAttachment } from "./CommunityMediaGallery";

const hooks = vi.hoisted(() => ({ active: null as null | { slots: any[]; cursor: number; pending: (() => void | (() => void))[] }, native: false,
  nativeCallback: null as null | ((state: { isActive: boolean }) => void), removeNative: vi.fn(async () => undefined) }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => hooks.native } }));
vi.mock("@capacitor/app", () => ({ App: { addListener: vi.fn(async (_name, callback) => { hooks.nativeCallback = callback; return { remove: hooks.removeNative }; }) } }));
vi.mock("react", async original => {
  const actual = await original<typeof import("react")>();
  return { ...actual,
    useState: (initial: any) => {
      if (!hooks.active) return actual.useState(initial);
      const state = hooks.active, index = state.cursor++;
      state.slots[index] ??= { value: initial };
      return [state.slots[index].value, (next: any) => { state.slots[index].value = typeof next === "function" ? next(state.slots[index].value) : next; }];
    },
    useRef: (initial: any) => {
      if (!hooks.active) return actual.useRef(initial);
      const state = hooks.active, index = state.cursor++;
      return state.slots[index] ??= { current: initial };
    },
    useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
      if (!hooks.active) return actual.useEffect(effect, deps);
      const state = hooks.active, index = state.cursor++;
      if (!state.slots[index]) { state.slots[index] = true; state.pending.push(effect); }
    },
  };
});

type Element = ReactElement<Record<string, any>>;
const videoUrl = "https://cdn.example.com/demonstration.mp4";
const cleanups: (() => void)[] = [];
let doc: EventTarget & { visibilityState: string };
let win: EventTarget;
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const el = node as Element;
  return [el, ...elements(el.props.children)];
}
function player(url = videoUrl) {
  const state = { slots: [] as any[], cursor: 0, pending: [] as (() => void | (() => void))[] };
  const media = { hidden: true, preload: "none", src: "", error: null as null | object, focus: vi.fn(), pause: vi.fn(), play: vi.fn(async () => undefined), load: vi.fn(() => { media.error = null; }) };
  const render = () => {
    hooks.active = state; state.cursor = 0;
    let tree: ReactNode;
    try { tree = CommunityVideoAttachment({ item: { kind: "video", url, label: "Technique demonstration" }, label: "Technique demonstration" }); } finally { hooks.active = null; }
    const rows = elements(tree);
    const video = rows.find(row => row.type === "video")!;
    video.props.ref.current = media;
    for (const effect of state.pending.splice(0)) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); }
    return { tree: tree!, rows, video, start: rows.find(row => row.type === "button" && row.props["aria-label"]) };
  };
  return { media, render };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
beforeEach(() => {
  hooks.native = false; hooks.nativeCallback = null; hooks.removeNative.mockClear();
  doc = Object.assign(new EventTarget(), { visibilityState: "visible" }); win = new EventTarget();
  vi.stubGlobal("document", doc); vi.stubGlobal("window", win);
});
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.unstubAllGlobals(); });

describe("community attachment rendering", () => {
  it("labels comment attachments and provides native image/video loading and playback", () => {
    const html = renderToStaticMarkup(<CommunityMediaGallery context="Comment" items={[
      { kind: "image", url: "https://cdn.example.com/after.webp", label: "After cleaning" },
      { kind: "video", url: "https://cdn.example.com/reply.mp4", label: "Reply walkthrough" },
      { kind: "file", url: "https://cdn.example.com/checklist.pdf", label: "Cleaning checklist" },
    ]} />);
    expect(html).toContain('aria-label="Comment attachments"');
    expect(html).toContain('alt="After cleaning"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain('<video');
    expect(html).toContain('controls=""');
    expect(html).toContain('playsInline=""');
    expect(html).toContain('preload="none"');
    expect(html).toContain('aria-label="Play Reply walkthrough"');
    expect(html).not.toContain('src="https://cdn.example.com/reply.mp4"');
    expect(html).toContain('aria-label="Reply walkthrough"');
    expect(html).toContain('Cleaning checklist');
    expect(html).toContain('Open attachment');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("assigns the source and requests playback in the tap handler, keeping native controls and loading status", async () => {
    const view = player(); let tree = view.render();
    expect(tree.video.props.src).toBeUndefined(); expect(tree.video.props.preload).toBe("none");
    expect(view.media.play).not.toHaveBeenCalled(); expect(view.media.load).not.toHaveBeenCalled();
    tree.start!.props.onClick({ detail: 1 });
    expect(view.media.src).toBe(videoUrl); expect(view.media.hidden).toBe(false); expect(view.media.play).toHaveBeenCalledOnce();
    tree = view.render();
    expect(tree.video.props).toMatchObject({ controls: true, playsInline: true, preload: "metadata", hidden: false });
    // React must never rewrite src after the tap's imperative play request.
    expect(tree.video.props).not.toHaveProperty("src"); expect(view.media.src).toBe(videoUrl);
    expect(tree.rows.some(row => row.props.role === "status")).toBe(true);
    tree.video.props.onLoadedMetadata(); tree = view.render();
    expect(tree.rows[0].props["aria-busy"]).toBe(false);
    expect(tree.start).toBeUndefined(); await flush();
  });

  it("moves keyboard focus to the controls when its play button disappears", () => {
    const view = player(); const tree = view.render();
    tree.start!.props.onClick({ detail: 0 });
    expect(view.media.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(view.render().video.props.tabIndex).toBe(0);
  });

  it("pauses on hidden/background navigation and cleanup without automatically resuming", () => {
    const view = player(); const tree = view.render(); tree.start!.props.onClick({ detail: 1 });
    doc.visibilityState = "hidden"; doc.dispatchEvent(new Event("visibilitychange"));
    expect(view.media.pause).toHaveBeenCalledOnce();
    doc.visibilityState = "visible"; doc.dispatchEvent(new Event("visibilitychange"));
    expect(view.media.play).toHaveBeenCalledOnce();
    win.dispatchEvent(new Event("pagehide")); expect(view.media.pause).toHaveBeenCalledTimes(2);
    // React clears refs before effect cleanup; the retained node must still stop.
    tree.video.props.ref.current = null; cleanups.pop()!(); expect(view.media.pause).toHaveBeenCalledTimes(3);
  });

  it("pauses the previous community player when another starts", () => {
    const first = player(); const one = first.render(); one.start!.props.onClick({ detail: 1 }); one.video.props.onPlay({ currentTarget: first.media });
    const second = player("https://cdn.example.com/second.mp4"); const two = second.render(); two.start!.props.onClick({ detail: 1 }); two.video.props.onPlay({ currentTarget: second.media });
    expect(first.media.pause).toHaveBeenCalledOnce(); expect(second.media.pause).not.toHaveBeenCalled();
  });

  it("pauses for native app background events and removes the native subscription", async () => {
    hooks.native = true; const view = player(); const tree = view.render(); tree.start!.props.onClick({ detail: 1 }); await flush();
    await vi.waitFor(() => expect(hooks.nativeCallback).not.toBeNull()); hooks.nativeCallback!({ isActive: false });
    expect(view.media.pause).toHaveBeenCalledOnce(); hooks.nativeCallback!({ isActive: true });
    expect(view.media.play).toHaveBeenCalledOnce(); cleanups.pop()!(); await flush();
    expect(hooks.removeNative).toHaveBeenCalledOnce();
  });

  it("exposes platform controls after a play-policy rejection, and retries media errors only on request", async () => {
    const view = player(); let tree = view.render();
    view.media.play.mockRejectedValueOnce(new Error("Playback needs another tap")); tree.start!.props.onClick({ detail: 1 }); await flush();
    tree = view.render(); expect(tree.video.props.hidden).toBe(false); expect(tree.rows[0].props["aria-busy"]).toBe(false);
    view.media.error = {}; tree.video.props.onError(); tree = view.render();
    expect(tree.video.props.hidden).toBe(true); expect(renderToStaticMarkup(tree.tree)).toContain(`href="${videoUrl}"`);
    expect(view.media.load).toHaveBeenCalledOnce();
    tree.rows.find(row => row.type === "button" && !row.props["aria-label"])!.props.onClick({ detail: 1 });
    expect(view.media.load).toHaveBeenCalledTimes(2); expect(view.media.play).toHaveBeenCalledTimes(2);
  });

  it("renders no gallery for empty or unsafe attachments", () => {
    expect(renderToStaticMarkup(<CommunityMediaGallery items={[]} />)).toBe("");
    expect(renderToStaticMarkup(<CommunityMediaGallery items={[
      { kind: "image", url: "javascript:alert(1)", label: "Bad source" },
      { kind: "file", url: "https://user:password@example.com/file", label: "Credentials" },
    ]} />)).toBe("");
  });
});
