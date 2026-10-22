import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const effects = vi.hoisted(() => ({ cleanups: [] as Array<() => void> }));
vi.mock("react", async original => ({ ...(await original<typeof import("react")>()), useRef: (value: unknown) => ({ current: value }), useEffect: (run: () => () => void) => { effects.cleanups.push(run()); } }));
import { useModalDialog } from "./useModalDialog";

let doc: { activeElement: FakeElement | null; body: { style: { overflow: string } }; addEventListener: (name: string, fn: (event: any) => void) => void; removeEventListener: (name: string, fn: (event: any) => void) => void };
let listeners: Map<string, Set<(event: any) => void>>;
class FakeElement {
  offsetParent = {};
  children: FakeElement[] = [];
  constructor(public name: string, public autofocus = false) {}
  contains(node: unknown): boolean { return node === this || this.children.some(child => child.contains(node)); }
  querySelector() { return this.children.find(child => child.autofocus) ?? null; }
  querySelectorAll() { return this.children; }
  focus() { doc.activeElement = this; listeners.get("focusin")?.forEach(run => run({ target: this })); }
}
const mount = (name = "dialog") => {
  const dialog = new FakeElement(name), first = new FakeElement("Close", true), last = new FakeElement("Read document");
  dialog.children = [first, last]; const close = vi.fn();
  useModalDialog({ current: dialog } as unknown as React.RefObject<HTMLElement>, close);
  const cleanup = effects.cleanups.at(-1)!;
  vi.runOnlyPendingTimers(); return { dialog, first, last, close, cleanup };
};
const key = (value: string, shiftKey = false) => { const event = { key: value, shiftKey, preventDefault: vi.fn() }; listeners.get("keydown")?.forEach(run => run(event)); return event; };
beforeEach(() => {
  vi.useFakeTimers(); listeners = new Map();
  doc = { activeElement: null, body: { style: { overflow: "auto" } }, addEventListener(name, run) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(run); }, removeEventListener(name, run) { listeners.get(name)?.delete(run); } };
  vi.stubGlobal("document", doc); vi.stubGlobal("HTMLElement", FakeElement); vi.stubGlobal("Node", FakeElement); vi.stubGlobal("window", { setTimeout, clearTimeout });
});
afterEach(() => { effects.cleanups.splice(0).reverse().forEach(run => run()); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("modal keyboard ownership", () => {
  it("focuses Close, cycles both Tab boundaries, closes with Escape and restores its opener", () => {
    const opener = new FakeElement("Open rules"); opener.focus(); const modal = mount();
    expect(doc.activeElement).toBe(modal.first); expect(doc.body.style.overflow).toBe("hidden");
    expect(key("Tab", true).preventDefault).toHaveBeenCalledOnce(); expect(doc.activeElement).toBe(modal.last);
    key("Tab"); expect(doc.activeElement).toBe(modal.first);
    key("Escape"); expect(modal.close).toHaveBeenCalledOnce(); modal.cleanup(); effects.cleanups.pop();
    expect(doc.activeElement).toBe(opener); expect(doc.body.style.overflow).toBe("auto");
  });
  it("recaptures focus that lands behind the active modal", () => {
    const modal = mount(); new FakeElement("Underlying sign out").focus();
    expect(doc.activeElement).toBe(modal.first);
    doc.activeElement = new FakeElement("External focus without an event");
    key("Tab", true); expect(doc.activeElement).toBe(modal.last);
  });
  it("lets only the foremost dialog handle Escape or outside focus", () => {
    const parent = mount("parent"), child = mount("child");
    expect(doc.activeElement).toBe(child.first);
    key("Escape"); expect(child.close).toHaveBeenCalledOnce(); expect(parent.close).not.toHaveBeenCalled();
    parent.first.focus(); expect(doc.activeElement).toBe(child.first);
    child.cleanup(); effects.cleanups.pop(); expect(doc.activeElement).toBe(parent.first);
    key("Escape"); expect(parent.close).toHaveBeenCalledOnce();
  });
  it("keeps scrolling locked when a background dialog unmounts first", () => {
    const parent = mount("parent"), child = mount("child");
    parent.cleanup(); effects.cleanups.splice(0, 1); expect(doc.body.style.overflow).toBe("hidden"); expect(doc.activeElement).toBe(child.first);
    child.cleanup(); effects.cleanups.pop(); expect(doc.body.style.overflow).toBe("auto");
  });
});
