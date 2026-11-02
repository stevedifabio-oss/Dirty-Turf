import { beforeEach, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
const harness = vi.hoisted(() => ({ slots: [] as any[], cursor: 0 }));
const backend = vi.hoisted(() => ({ loadFreeAccess: vi.fn(), saveFreeAccess: vi.fn() }));
vi.mock("../lib/freeAccess", () => backend);
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useState: (initial: any) => {
    const index = harness.cursor++;
    if (!(index in harness.slots)) harness.slots[index] = initial;
    return [harness.slots[index], (value: any) => { harness.slots[index] = value; }];
  },
  useRef: (initial: any) => harness.slots[harness.cursor++] ??= { current: initial },
  useEffect: () => {},
}));
import { AdminFreeAccess } from "./AdminFreeAccess";
const onChange = vi.fn();
function render() {
  harness.cursor = 0;
  return AdminFreeAccess({ memberId: "selected-member", courses: [{ id: "course-id", title: "Test course" }], disabled: false, onChange });
}
function elements(node: ReactNode): ReactElement<any>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<any>;
  return [element, ...elements(element.props.children)];
}
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
beforeEach(() => {
  harness.slots = []; harness.cursor = 0;
  vi.clearAllMocks();
  backend.loadFreeAccess.mockResolvedValue([]);
  backend.saveFreeAccess.mockResolvedValue(undefined);
});
it("saves permanent access for the selected person without a date entry", async () => {
  let tree = render(); tree.props.onToggle({ currentTarget: { open: true } }); await settle(); tree = render();
  const inputs = elements(tree).filter(element => element.type === "input");
  expect(inputs.map(element => element.props.type)).toEqual(["checkbox", "checkbox", "checkbox"]);
  inputs[1].props.onChange({ target: { checked: true } }); await settle();
  expect(backend.saveFreeAccess).toHaveBeenCalledExactlyOnceWith("selected-member", "measuring_tool", true, null);
  expect(onChange).toHaveBeenCalledOnce();
});
it("keeps authoritative choices visible after a rejected course grant and shows the reason", async () => {
  backend.loadFreeAccess.mockResolvedValue([{ resource: "community", endsAt: null }]);
  backend.saveFreeAccess.mockRejectedValue(new Error("This course has an access restriction."));
  let tree = render(); tree.props.onToggle({ currentTarget: { open: true } }); await settle(); tree = render();
  elements(tree).filter(element => element.type === "input")[2].props.onChange({ target: { checked: true } });
  await settle(); tree = render();
  const inputs = elements(tree).filter(element => element.type === "input");
  expect(inputs).toHaveLength(3);
  expect(inputs[0].props.checked).toBe(true);
  expect(inputs[2].props.checked).toBe(false);
  expect(elements(tree).find(element => element.props.role === "status")?.props.children).toBe("This course has an access restriction.");
  expect(onChange).not.toHaveBeenCalled();
});
