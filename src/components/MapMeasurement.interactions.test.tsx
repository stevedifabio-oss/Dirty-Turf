import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MapMeasurement } from "./MapMeasurement";
import { PropertyAddressSearch } from "./PropertyAddressSearch";

const hooks = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as Array<() => void> }));
const api = vi.hoisted(() => ({ search: vi.fn() }));
const drawing = vi.hoisted(() => ({ setView: vi.fn(), events: {} as Record<string, (event: any) => void>, marker: vi.fn(), line: vi.fn() }));
vi.mock("../lib/backend", () => ({ searchPropertyAddress: api.search }));
vi.mock("leaflet", () => {
  const layer = () => { const value: any = { addTo: () => value, on: () => value, clearLayers: vi.fn(), bindTooltip: () => value }; return value; };
  const map: any = { setView: (...args: any[]) => { drawing.setView(...args); return map; }, on: (name: string, handler: any) => { drawing.events[name] = handler; }, off: vi.fn(), remove: vi.fn(), invalidateSize: vi.fn() };
  return { default: { map: () => map, layerGroup: layer, tileLayer: layer, polygon: layer, polyline: (...args: any[]) => { drawing.line(...args); return layer(); }, marker: (...args: any[]) => { drawing.marker(...args); return layer(); }, circleMarker: layer, divIcon: (options: any) => options } };
});
vi.mock("react", async original => {
  const actual = await original<typeof import("react")>();
  return { ...actual,
    useState: (initial: any) => { const i = hooks.cursor++; if (!(i in hooks.slots)) hooks.slots[i] = typeof initial === "function" ? initial() : initial; return [hooks.slots[i], (next: any) => { hooks.slots[i] = typeof next === "function" ? next(hooks.slots[i]) : next; }]; },
    useRef: (initial: any) => { const i = hooks.cursor++; return hooks.slots[i] ??= { current: initial }; },
    useCallback: (fn: any) => { hooks.cursor++; return fn; },
    useEffect: (effect: () => any, deps: any[]) => { const i = hooks.cursor++; const previous = hooks.slots[i]; if (!previous || !deps.every((value, index) => Object.is(value, previous.deps[index]))) { hooks.slots[i] = { deps }; hooks.effects.push(() => { previous?.cleanup?.(); hooks.slots[i].cleanup = effect(); }); } },
  };
});
type Element = ReactElement<Record<string, any>>;
function elements(node: ReactNode): Element[] { if (Array.isArray(node)) return node.flatMap(elements); if (!node || typeof node !== "object" || !("props" in node)) return []; const element = node as Element; return [element, ...elements(element.props.children)]; }
function text(node: ReactNode): string { if (Array.isArray(node)) return node.map(text).join(""); return node && typeof node === "object" && "props" in node ? text((node as Element).props.children) : typeof node === "string" || typeof node === "number" ? String(node) : ""; }
function find(tree: ReactNode, predicate: (element: Element) => boolean) { const found = elements(tree).find(predicate); if (!found) throw new Error("Map control missing"); return found; }
function button(tree: ReactNode, label: string) { return find(tree, element => element.type === "button" && (element.props["aria-label"] === label || text(element.props.children).trim() === label)); }
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const match = { formattedAddress: "123 Fixture Lane, Test City, AZ", latitude: 33.5, longitude: -112.1 };
function fixture() {
  const props = { address: "", area: 0, onAddressChange: vi.fn(), onAreaChange: vi.fn() };
  const render = () => { hooks.cursor = 0; const tree = MapMeasurement(props); const canvas = find(tree, element => element.props["aria-label"] === "Interactive property measurement map"); canvas.props.ref.current = {}; hooks.effects.splice(0).forEach(effect => effect()); return tree; };
  render();
  const input = (query: string) => find(render(), element => element.type === PropertyAddressSearch).props.onChange(query);
  const search = () => find(render(), element => element.type === PropertyAddressSearch).props.onSearch();
  return { props, render, input, search };
}
beforeEach(() => { hooks.slots = []; hooks.cursor = 0; hooks.effects = []; drawing.events = {}; drawing.setView.mockReset(); drawing.marker.mockReset(); drawing.line.mockReset(); api.search.mockReset(); vi.stubGlobal("window", { setTimeout: () => 1, clearTimeout: vi.fn() }); });
afterEach(() => { hooks.slots.forEach(slot => slot?.cleanup?.()); vi.unstubAllGlobals(); });

describe("property map search and boundaries", () => {
  it("shows an actionable provider failure instead of pretending to locate a property", async () => {
    api.search.mockRejectedValue(new Error("The address service could not be reached."));
    const ui = fixture(); ui.input("123 Fixture Lane"); ui.search(); await flush();
    expect(text(find(ui.render(), element => element.props.role === "alert"))).toContain("address service could not be reached");
    expect(drawing.setView).toHaveBeenCalledTimes(1); // Initial map only.
    expect(ui.props.onAddressChange).not.toHaveBeenCalled();
  });
  it("lets the member choose an ambiguous result before changing the map", async () => {
    const second = { ...match, formattedAddress: "456 Fixture Lane, Other City, AZ", latitude: 34 };
    api.search.mockResolvedValue([match, second]);
    const ui = fixture(); ui.input("Fixture Lane"); ui.search(); await flush();
    expect(drawing.setView).toHaveBeenCalledTimes(1);
    button(ui.render(), second.formattedAddress).props.onClick();
    expect(drawing.setView).toHaveBeenLastCalledWith([34, -112.1], 20);
    expect(ui.props.onAddressChange).toHaveBeenCalledWith(second.formattedAddress);
  });
  it("ignores a late result after the member changes the query", async () => {
    let resolve!: (value: any) => void;
    api.search.mockReturnValue(new Promise(yes => { resolve = yes; }));
    const ui = fixture(); ui.input("123 Fixture Lane"); const pending = ui.search(); ui.input("Another property");
    resolve([match]); await pending; await flush(); ui.render();
    expect(drawing.setView).toHaveBeenCalledTimes(1);
    expect(ui.props.onAddressChange).not.toHaveBeenCalled();
  });
  it("protects flags added while search is pending, then clears them only after confirmation", async () => {
    let resolve!: (value: any) => void;
    api.search.mockReturnValue(new Promise(yes => { resolve = yes; }));
    const ui = fixture(); ui.input("123 Fixture Lane"); const pending = ui.search();
    drawing.events.click({ latlng: { lat: 33, lng: -112 } }); ui.render();
    resolve([match]); await pending; await flush();
    expect(text(ui.render())).toContain("This clears the areas currently traced");
    expect(ui.props.onAddressChange).not.toHaveBeenCalled();
    button(ui.render(), "Clear areas and show property").props.onClick(); ui.render();
    expect(ui.props.onAreaChange).toHaveBeenLastCalledWith(0);
    expect(ui.props.onAddressChange).toHaveBeenCalledWith(match.formattedAddress);
  });
  it("fills and centers a chosen autocomplete address without another geocoding request", () => {
    const ui = fixture();
    find(ui.render(), element => element.type === PropertyAddressSearch).props.onSelect(match);
    expect(drawing.setView).toHaveBeenLastCalledWith([33.5, -112.1], 20);
    expect(ui.props.onAddressChange).toHaveBeenCalledWith(match.formattedAddress);
    expect(api.search).not.toHaveBeenCalled();
  });
  it("draws camera-style flags anchored at their feet and yellow ruler lines, including finished areas", () => {
    const ui = fixture();
    for (const point of [{ lat: 33, lng: -112 }, { lat: 33.0001, lng: -112 }, { lat: 33.0001, lng: -112.0001 }]) { drawing.events.click({ latlng: point }); ui.render(); }
    const marker = drawing.marker.mock.calls.at(-1)!;
    expect(marker[1].icon.iconAnchor).toEqual([8, 52]);
    expect(marker[1].icon.html).toContain('fill="#e5372e"');
    expect(drawing.line.mock.calls.some(call => call[1].color === "#ffff32")).toBe(true);
    button(ui.render(), "Finish area").props.onClick();
    expect(text(ui.render())).toContain("Area 1");
    expect(drawing.marker.mock.calls.at(-1)![1].icon.html).toContain('fill="#e5372e"');
  });
});
