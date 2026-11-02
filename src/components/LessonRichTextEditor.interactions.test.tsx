import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LessonRichTextEditor } from "./LessonRichTextEditor";

const hooks = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as Array<() => void> }));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useRef: (initial: any) => hooks.slots[hooks.cursor++] ??= { current: initial },
  useState: (initial: any) => { const index = hooks.cursor++; if (!(index in hooks.slots)) hooks.slots[index] = initial; return [hooks.slots[index], (value: any) => { hooks.slots[index] = typeof value === "function" ? value(hooks.slots[index]) : value; }]; },
  useEffect: (effect: () => void) => { hooks.cursor++; hooks.effects.push(effect); },
}));
type Element = ReactElement<Record<string, any>>;
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  return [node as Element, ...elements((node as Element).props.children)];
}
beforeEach(() => {
  hooks.slots = []; hooks.cursor = 0; hooks.effects = [];
  vi.stubGlobal("window", { getSelection: () => null });
  vi.stubGlobal("document", { execCommand: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

describe("rich description interaction boundaries", () => {
  it("keeps original imported HTML untouched until an input and escapes pasted markup", () => {
    const onChange = vi.fn();
    const tree = LessonRichTextEditor({ html: '<p data-ghl="metadata">Original</p>', label: "Description", onChange });
    const editable = elements(tree).find(row => row.props.role === "textbox")!;
    const dom = { innerHTML: "", focus: vi.fn(), contains: () => false };
    editable.props.ref.current = dom;
    hooks.effects.forEach(effect => effect());
    expect(onChange).not.toHaveBeenCalled();
    const preventDefault = vi.fn();
    editable.props.onPaste({ preventDefault, clipboardData: { getData: () => '<img src=x onerror="attack()">\nText' } });
    expect(preventDefault).toHaveBeenCalled();
    expect(document.execCommand).toHaveBeenCalledWith("insertHTML", false, "&lt;img src=x onerror=&quot;attack()&quot;&gt;<br>Text");
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("rejects a dangerous link before executing a browser command", () => {
    const props = { html: "", label: "Description", onChange: vi.fn() };
    let tree = LessonRichTextEditor(props);
    const controls = elements(tree);
    controls.find(row => row.type === "button" && row.props.children === "Add link")!.props.onClick();
    hooks.cursor = 0; tree = LessonRichTextEditor(props);
    elements(tree).find(row => row.type === "input")!.props.onChange({ target: { value: "javascript:alert(1)" } });
    hooks.cursor = 0; tree = LessonRichTextEditor(props);
    elements(tree).find(row => row.type === "button" && row.props.children === "Apply link")!.props.onClick();
    expect(document.execCommand).not.toHaveBeenCalled();
    expect(props.onChange).not.toHaveBeenCalled();
    hooks.cursor = 0; tree = LessonRichTextEditor(props);
    expect(elements(tree).find(row => row.props.role === "alert")?.props.children).toContain("full http:// or https://");
  });

  it("blocks dropped HTML/files without changing saved content", () => {
    const onChange = vi.fn();
    const tree = LessonRichTextEditor({ html: "Kept", label: "Description", onChange });
    const preventDefault = vi.fn();
    elements(tree).find(row => row.props.role === "textbox")!.props.onDrop({ preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(document.execCommand).not.toHaveBeenCalled();
  });
});
