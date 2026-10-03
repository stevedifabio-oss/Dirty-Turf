import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { NumberField } from "./NumberField";
import { calculateQuote } from "../lib/quote";

// Match the project's existing component-handler harness without a new DOM dependency.
const hooks = vi.hoisted(() => ({ active: null as null | { slots: any[]; cursor: number; effects: (() => void)[] } }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const next = () => {
    if (!hooks.active) throw new Error("Render through the field harness");
    return { state: hooks.active, index: hooks.active.cursor++ };
  };
  return {
    ...actual,
    useState: (initial: any) => {
      const { state, index } = next();
      if (!(index in state.slots)) state.slots[index] = initial;
      return [state.slots[index], (value: any) => { state.slots[index] = typeof value === "function" ? value(state.slots[index]) : value; }];
    },
    useEffect: (effect: () => void, deps: unknown[]) => {
      const { state, index } = next();
      const previous = state.slots[index];
      if (previous && deps.every((value, i) => Object.is(value, previous[i]))) return;
      state.slots[index] = deps;
      state.effects.push(effect);
    },
  };
});

type Element = ReactElement<Record<string, any>>;
function input(node: ReactNode): Element | undefined {
  if (Array.isArray(node)) return node.map(input).find(Boolean);
  if (!node || typeof node !== "object" || !("props" in node)) return;
  const element = node as Element;
  return element.type === "input" ? element : input(element.props.children);
}

function field(initial = 0, label = "Length") {
  const state = { slots: [] as any[], cursor: 0, effects: [] as (() => void)[] };
  let value = initial;
  const update = vi.fn((next: number) => { value = next; });
  const render = () => {
    state.cursor = 0;
    hooks.active = state;
    try { return input(NumberField({ label, value, update }))!; }
    finally { hooks.active = null; }
  };
  const control = () => {
    render();
    state.effects.splice(0).forEach((effect) => effect());
    return render().props;
  };
  return {
    control,
    change(text: string) { control().onChange({ target: { value: text } }); return control(); },
    external(next: number) { value = next; return control(); },
    blur() { control().onBlur(); return control(); },
    get value() { return value; },
    update,
  };
}

describe("measurement number editing", () => {
  it.each(["Length", "Width", "AR measured area", "What you charge"])("allows backspacing all of %s without reinserting zero", (label) => {
    const view = field(38, label);
    expect(view.change("3").value).toBe("3");
    expect(view.change("").value).toBe("");
    expect(view.value).toBe(0);
    expect(view.blur().value).toBe("");
    expect(view.change("7").value).toBe("7");
    expect(view.value).toBe(7);
  });

  it("starts zero values empty and keeps an explicitly typed zero editable", () => {
    const view = field();
    expect(view.control().value).toBe("");
    expect(view.change("0").value).toBe("0");
    expect(view.blur().value).toBe("0");
    expect(view.change("").value).toBe("");
  });

  it("preserves decimal editing and updates the actual quote before blur", () => {
    const view = field();
    for (const text of ["1", "12", "12.", "12.5", "12.50"]) expect(view.change(text).value).toBe(text);
    expect(view.control().inputMode).toBe("decimal");
    expect(view.value).toBe(12.5);
    const quote = calculateQuote({ address: "", mode: "manual", length: view.value, width: 8, cameraArea: 0, mapArea: 0, infillRate: 0.25, serviceRate: 0.72 });
    expect(quote.area).toBe(100);
    expect(quote.serviceTotal).toBe(72);
    expect(view.blur().value).toBe("12.5");
    view.change("");
    expect(view.change(".").value).toBe(".");
    expect(view.change(".5").value).toBe(".5");
    expect(view.value).toBe(0.5);
  });

  it("accepts a mobile decimal comma and normalizes only after editing", () => {
    const view = field();
    expect(view.change("0,").value).toBe("0,");
    expect(view.change("0,72").value).toBe("0,72");
    expect(view.value).toBe(0.72);
    expect(view.blur().value).toBe("0.72");
  });

  it("shows new AR results and external resets without losing equivalent input drafts", () => {
    const view = field(10);
    expect(view.change("10.").value).toBe("10.");
    expect(view.external(125.75).value).toBe("125.75");
    expect(view.external(0).value).toBe("");
  });

  it("does not send negative, malformed, or non-finite values to calculations", () => {
    const view = field(12);
    for (const invalid of ["-3", "NaN", "1.2.3", "1,2.3", "Infinity", "1e5", "9".repeat(400)]) {
      expect(view.change(invalid).value).toBe("12");
      expect(view.value).toBe(12);
    }
    expect(view.update).not.toHaveBeenCalled();
  });
});
