import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const hooks = vi.hoisted(() => ({ active: null as null | { slots: any[]; cursor: number; effects: Array<() => void> } }));
const load = vi.hoisted(() => ({ document: vi.fn(), reader: vi.fn() }));
vi.mock("../lib/useModalDialog", () => ({ useModalDialog: vi.fn() }));
vi.mock("../lib/legalDocument", () => ({ loadLegalDocument: load.document }));
vi.mock("../lib/legalReader", () => ({ legalReaderNodes: load.reader }));
vi.mock("react", async original => {
  const actual = await original<typeof import("react")>();
  const next = () => { if (!hooks.active) throw new Error("Use terms harness"); return { state: hooks.active, index: hooks.active.cursor++ }; };
  return { ...actual,
    useState(initial: any) { const { state, index } = next(); if (!(index in state.slots)) state.slots[index] = initial; return [state.slots[index], (value: any) => { state.slots[index] = typeof value === "function" ? value(state.slots[index]) : value; }]; },
    useRef(initial: any) { const { state, index } = next(); return state.slots[index] ??= { current: initial }; },
    useEffect(effect: () => void | (() => void), deps: any[]) { const { state, index } = next(); if (!state.slots[index] || !deps.every((value, i) => Object.is(value, state.slots[index].deps[i]))) { const old = state.slots[index]; state.slots[index] = { deps }; state.effects.push(() => { old?.cleanup?.(); state.slots[index].cleanup = effect(); }); } },
  };
});
import { CommunityTermsGate, TermsChoice } from "./TermsConsent";
type Element = ReactElement<Record<string, any>>;
const elements = (node: ReactNode): Element[] => Array.isArray(node) ? node.flatMap(elements) : node && typeof node === "object" && "props" in node ? [node as Element, ...elements((node as Element).props.children)] : [];
const text = (node: ReactNode): string => Array.isArray(node) ? node.map(text).join("") : node == null || typeof node === "boolean" ? "" : typeof node === "object" ? "props" in node ? text((node as Element).props.children) : "" : String(node);
const find = (node: ReactNode, test: (e: Element) => boolean) => { const value = elements(node).find(test); if (!value) throw new Error("Missing legal control"); return value; };
const button = (node: ReactNode, label: string) => find(node, e => e.type === "button" && text(e.props.children) === label);
const instances: Array<() => void> = [];
function harness(render: () => ReactNode) {
  const state = { slots: [] as any[], cursor: 0, effects: [] as Array<() => void> };
  const dispose = () => state.slots.forEach(value => value?.cleanup?.()); instances.push(dispose);
  return { render: () => { state.cursor = 0; hooks.active = state; try { const tree = render(); state.effects.splice(0).forEach(run => run()); return tree; } finally { hooks.active = null; } }, dispose };
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function reader() {
  const props = { checked: false, onChange: vi.fn() }, choice = harness(() => TermsChoice(props));
  button(choice.render(), "Terms of Use and Community Rules").props.onClick();
  let element = find(choice.render(), e => typeof e.type === "function" && e.type.name === "LegalDocument");
  const document = harness(() => (element.type as (props: any) => ReactNode)(element.props));
  return { props, choice, document, change: (name: string) => { element.props.onDocumentChange(name); element = find(choice.render(), e => typeof e.type === "function" && e.type.name === "LegalDocument"); } };
}
beforeEach(() => { vi.clearAllMocks(); load.reader.mockReturnValue([{ tag: "p", children: ["Rules in plain text"] }]); });
afterEach(() => { instances.splice(0).reverse().forEach(dispose => dispose()); });

describe("legal agreement and document state", () => {
  it("holds acceptance until the member explicitly checks the agreement", () => {
    const accept = vi.fn(), view = harness(() => CommunityTermsGate({ onAccept: accept, onSignOut: vi.fn() }));
    expect(button(view.render(), "Agree and continue").props.disabled).toBe(true);
    button(view.render(), "Agree and continue").props.onClick(); expect(accept).not.toHaveBeenCalled();
    find(view.render(), e => e.type === TermsChoice).props.onChange(true);
    expect(button(view.render(), "Agree and continue").props.disabled).toBe(false);
    // This is an isolated callback test, with no Auth, storage or legal acceptance.
    button(view.render(), "Agree and continue").props.onClick(); expect(accept).toHaveBeenCalledOnce();
  });
  it("keeps loading and failed reads independent from the unchecked agreement, with Close and Retry available", async () => {
    let fail!: (reason: Error) => void; load.document.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    const view = reader(); expect(text(view.document.render())).toContain("Loading terms");
    expect(button(view.document.render(), "Close").props["data-dialog-autofocus"]).toBe(true);
    fail(new Error("Offline")); await flush();
    const error = find(view.document.render(), e => e.props.role === "alert"); expect(text(error)).toContain("Reconnect and try again");
    expect(button(error, "Retry")).toBeDefined(); expect(view.props.onChange).not.toHaveBeenCalled(); expect(view.props.checked).toBe(false);
    expect(elements(view.document.render()).some(e => e.type === "iframe")).toBe(false);
  });
  it("rejects a malformed reader result without changing agreement state", async () => {
    load.document.mockResolvedValueOnce("malformed source"); load.reader.mockImplementationOnce(() => { throw new Error("unavailable"); });
    const view = reader(); view.document.render(); await flush();
    expect(find(view.document.render(), e => e.props.role === "alert")).toBeDefined(); expect(view.props.onChange).not.toHaveBeenCalled();
  });
  it("does not display a stale Terms response after switching to Privacy", async () => {
    let finishTerms!: (html: string) => void;
    load.document.mockImplementationOnce(() => new Promise(resolve => { finishTerms = resolve; })).mockResolvedValueOnce("privacy document");
    const view = reader(); view.document.render();
    const signal = load.document.mock.calls[0][1] as AbortSignal;
    view.change("privacy"); view.document.render(); expect(signal.aborted).toBe(true); await flush();
    finishTerms("stale terms document"); await flush();
    expect(load.reader).toHaveBeenCalledExactlyOnceWith("privacy document");
    const content = find(view.document.render(), e => e.props.role === "document");
    expect(content.props["aria-label"]).toBe("Privacy Policy"); expect(content.props.tabIndex).toBe(0); expect(text(content)).toContain("Rules in plain text");
    expect(view.props.onChange).not.toHaveBeenCalled();
  });
});
