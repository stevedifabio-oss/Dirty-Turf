import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PropertyAddressSearch } from "./PropertyAddressSearch";

const hooks = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as Array<() => void> }));
const api = vi.hoisted(() => ({ suggest: vi.fn() }));
vi.mock("../lib/addressAutocomplete", () => ({ ADDRESS_SUGGESTION_DELAY_MS: 650, ADDRESS_SUGGESTION_MIN_LENGTH: 4, suggestPropertyAddresses: api.suggest }));
vi.mock("react", async original => {
  const actual = await original<typeof import("react")>();
  return { ...actual,
    useId: () => { hooks.cursor++; return "address-search-test"; },
    useState: (initial: any) => { const i = hooks.cursor++; if (!(i in hooks.slots)) hooks.slots[i] = initial; return [hooks.slots[i], (next: any) => { hooks.slots[i] = typeof next === "function" ? next(hooks.slots[i]) : next; }]; },
    useRef: (initial: any) => { const i = hooks.cursor++; return hooks.slots[i] ??= { current: initial }; },
    useEffect: (effect: () => any, deps: any[]) => { const i = hooks.cursor++; const previous = hooks.slots[i]; if (!previous || !deps.every((value, index) => Object.is(value, previous.deps[index]))) { hooks.slots[i] = { deps }; hooks.effects.push(() => { previous?.cleanup?.(); hooks.slots[i].cleanup = effect(); }); } },
  };
});
type Element = ReactElement<Record<string, any>>;
function elements(node: ReactNode): Element[] { if (Array.isArray(node)) return node.flatMap(elements); if (!node || typeof node !== "object" || !("props" in node)) return []; const element = node as Element; return [element, ...elements(element.props.children)]; }
function text(node: ReactNode): string { if (Array.isArray(node)) return node.map(text).join(""); return node && typeof node === "object" && "props" in node ? text((node as Element).props.children) : typeof node === "string" ? node : ""; }
function find(node: ReactNode, role: string) { const element = elements(node).find(element => element.props.role === role); if (!element) throw new Error(`Missing ${role}`); return element; }
const match = { formattedAddress: "123 Fixture Lane, Test City, AZ", latitude: 33.5, longitude: -112.1 };
function fixture() {
  const props = { value: "", searching: false, onChange: (value: string) => { props.value = value; }, onSelect: vi.fn(), onSearch: vi.fn(), onLocate: vi.fn() };
  const render = () => { hooks.cursor = 0; const tree = PropertyAddressSearch(props); hooks.effects.splice(0).forEach(effect => effect()); return tree; };
  const input = () => find(render(), "combobox");
  const type = (value: string) => { input().props.onChange({ target: { value } }); render(); };
  const key = (key: string) => input().props.onKeyDown({ key, preventDefault: vi.fn(), stopPropagation: vi.fn() });
  render(); return { props, render, input, type, key };
}
beforeEach(() => { vi.useFakeTimers(); hooks.slots = []; hooks.effects = []; hooks.cursor = 0; api.suggest.mockReset().mockResolvedValue([match]); });
afterEach(() => { hooks.slots.forEach(slot => slot?.cleanup?.()); vi.useRealTimers(); });

describe("address suggestions", () => {
  it("waits for a typing pause, then lets a tap select the address", async () => {
    const ui = fixture(); ui.type("123"); await vi.advanceTimersByTimeAsync(700); expect(api.suggest).not.toHaveBeenCalled();
    ui.type("123 Fi"); await vi.advanceTimersByTimeAsync(300); ui.type("123 Fixture"); await vi.advanceTimersByTimeAsync(649); expect(api.suggest).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(api.suggest).toHaveBeenCalledWith("123 Fixture", expect.any(AbortSignal));
    find(ui.render(), "option").props.onClick();
    expect(ui.props.onSelect).toHaveBeenCalledWith(match);
    expect(ui.input().props["aria-expanded"]).toBe(false);
    expect(ui.props.onSearch).not.toHaveBeenCalled();
  });
  it("supports arrows and Enter, and Escape closes without invoking a surrounding dialog", async () => {
    const ui = fixture(); ui.type("123 Fixture"); await vi.advanceTimersByTimeAsync(650);
    ui.key("ArrowDown"); expect(ui.input().props["aria-activedescendant"]).toBe("address-search-test-option-0");
    ui.key("Enter"); expect(ui.props.onSelect).toHaveBeenCalledWith(match);
    ui.type("456 Fixture"); await vi.advanceTimersByTimeAsync(1000);
    const event = { key: "Escape", preventDefault: vi.fn(), stopPropagation: vi.fn() }; ui.input().props.onKeyDown(event);
    expect(event.stopPropagation).toHaveBeenCalled(); expect(ui.input().props["aria-expanded"]).toBe(false);
  });
  it("ignores obsolete responses when the input changes and after blur", async () => {
    let resolve!: (value: any) => void;
    api.suggest.mockReturnValue(new Promise(yes => { resolve = yes; }));
    const ui = fixture(); ui.type("123 Fixture"); await vi.advanceTimersByTimeAsync(650);
    const signal = api.suggest.mock.calls[0][1] as AbortSignal;
    ui.type("Another street"); expect(signal.aborted).toBe(true);
    resolve([match]); await vi.advanceTimersByTimeAsync(0); expect(ui.input().props["aria-expanded"]).toBe(false);
    ui.input().props.onBlur(); ui.render(); await vi.advanceTimersByTimeAsync(1500);
    expect(api.suggest).toHaveBeenCalledTimes(1);
  });
  it("preserves manual Search after a suggestion-service outage", async () => {
    api.suggest.mockRejectedValue(new Error("offline"));
    const ui = fixture(); ui.type("123 Fixture"); await vi.advanceTimersByTimeAsync(650);
    expect(text(ui.render())).toContain("Enter the full address and press Search");
    ui.key("Enter"); expect(ui.props.onSearch).toHaveBeenCalledTimes(1);
  });
  it("does not send a saved address on initial render or focus", async () => {
    const ui = fixture(); ui.props.value = match.formattedAddress; ui.input().props.onFocus(); ui.render(); await vi.advanceTimersByTimeAsync(2000);
    expect(api.suggest).not.toHaveBeenCalled();
  });
});
