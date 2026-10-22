import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const hooks = vi.hoisted(() => ({ active: null as null | { slots: any[]; cursor: number; effects: (() => void)[] } }));
const api = vi.hoisted(() => ({ preview: vi.fn(), run: vi.fn() }));
vi.mock("../lib/adminBackend", () => ({ previewMemberInviteAction: api.preview, runMemberInviteAction: api.run }));
vi.mock("react", async original => {
  const actual = await original<typeof import("react")>();
  const next = () => { if (!hooks.active) throw new Error("Use member setup harness"); return { state: hooks.active, index: hooks.active.cursor++ }; };
  return { ...actual,
    useState(initial: any) { const { state, index } = next(); if (!(index in state.slots)) state.slots[index] = typeof initial === "function" ? initial() : initial; return [state.slots[index], (value: any) => { state.slots[index] = typeof value === "function" ? value(state.slots[index]) : value; }]; },
    useRef(initial: any) { const { state, index } = next(); return state.slots[index] ??= { current: initial }; },
    useEffect(effect: () => void | (() => void), deps: any[]) { const { state, index } = next(); if (!state.slots[index] || !deps.every((value, i) => Object.is(value, state.slots[index].deps[i]))) { const previous = state.slots[index]; state.slots[index] = { deps }; state.effects.push(() => { previous?.cleanup?.(); state.slots[index].cleanup = effect(); }); } },
  };
});
import { AdminMemberSetup } from "./AdminMemberSetup";
type Element = ReactElement<Record<string, any>>;
const elements = (node: ReactNode): Element[] => Array.isArray(node) ? node.flatMap(elements) : node && typeof node === "object" && "props" in node ? [node as Element, ...elements((node as Element).props.children)] : [];
const text = (node: ReactNode): string => Array.isArray(node) ? node.map(text).join("") : node == null || typeof node === "boolean" ? "" : typeof node === "object" ? "props" in node ? text((node as Element).props.children) : "" : String(node);
const find = (node: ReactNode, test: (e: Element) => boolean) => { const match = elements(node).find(test); if (!match) throw new Error("Expected member setup control"); return match; };
const button = (node: ReactNode, label: string) => find(node, e => e.type === "button" && text(e.props.children).startsWith(label));
const first = "11111111-1111-4111-8111-111111111111", second = "22222222-2222-4222-8222-222222222222";
const candidates = [first,second].map((id, index) => ({ academyMemberId: id, inviteId: `invite-${index}`, displayName: index ? "Blair Demo" : "Alex Demo", email: index ? "blair@example.invalid" : "alex@example.invalid", inviteStatus: "pending" }));
const preview = (action = "provision", ids: string[] = []) => ({ dryRun: true, previewAction: action, candidates, selected: candidates.filter(member => ids.includes(member.academyMemberId)), blocked: [], previewToken: ids.length ? "signed-review" : null, previewExpiresAt: ids.length ? new Date(Date.now()+600000).toISOString() : null });
const instances: Array<() => void> = [];
function workspace() {
  const state = { slots: [] as any[], cursor: 0, effects: [] as (() => void)[] };
  const props = { disabled: false, onRun: vi.fn(async (_action: string, execute: () => Promise<unknown>) => { await execute(); return true; }) };
  const render = () => { state.cursor=0; hooks.active=state; try { const tree = AdminMemberSetup(props); state.effects.splice(0).forEach(run => run()); return tree; } finally { hooks.active=null; } };
  const dispose = () => state.slots.forEach(slot => slot?.cleanup?.()); instances.push(dispose);
  const checkbox = (id: string) => find(render(), e => e.type === "label" && e.props.className === "admin-member-candidate" && text(e.props.children).includes(id === first ? "Alex Demo" : "Blair Demo")).props.children[0];
  return { props, render, dispose, checkbox };
}
const flush = async () => { for (let i=0;i<20;i++) await Promise.resolve(); };
beforeEach(() => { vi.clearAllMocks(); api.preview.mockImplementation(async (action, ids = []) => preview(action,ids)); api.run.mockResolvedValue({ processed:1,failed:0 }); });
afterEach(() => { instances.splice(0).forEach(dispose => dispose()); vi.useRealTimers(); });
describe("member migration review workflow", () => {
  it("does nothing until the administrator requests an inventory; a preview sends no email", async () => {
    const view=workspace(); expect(text(view.render())).toContain("separate reviewed action"); expect(api.preview).not.toHaveBeenCalled();
    await button(view.render(),"Load eligible members").props.onClick(); await flush();
    expect(api.preview).toHaveBeenCalledWith("provision",[]); expect(api.run).not.toHaveBeenCalled();
    expect(button(view.render(),"Review selected").props.disabled).toBe(true);
  });
  it("keeps exact selection visible in review even when search hides a selected member", async () => {
    const view=workspace(); await button(view.render(),"Load eligible members").props.onClick(); await flush();
    view.checkbox(first).props.onChange();
    find(view.render(), e => e.type === "input" && e.props.type === "search").props.onChange({target:{value:"Blair"}});
    expect(text(view.render())).toContain("1 selected");
    await button(view.render(),"Review selected").props.onClick(); await flush();
    expect(api.preview).toHaveBeenLastCalledWith("provision",[first]);
    const review=find(view.render(), e=>e.props["aria-label"] === "Selected member review");
    expect(text(review)).toContain("alex@example.invalid"); expect(text(review)).not.toContain("blair@example.invalid");
    await button(view.render(),"Set up 1 account").props.onClick(); await flush();
    expect(api.run).toHaveBeenCalledWith("provision",expect.objectContaining({memberIds:[first],previewToken:"signed-review"}));
  });
  it("invalidates a reviewed approval when selection changes", async () => {
    const view=workspace(); await button(view.render(),"Load eligible members").props.onClick(); await flush(); view.checkbox(first).props.onChange();
    await button(view.render(),"Review selected").props.onClick(); await flush(); view.checkbox(second).props.onChange();
    expect(elements(view.render()).some(e=>e.props["aria-label"] === "Selected member review")).toBe(false); expect(api.run).not.toHaveBeenCalled();
  });
  it("holds every mutation when one selected member is blocked", async () => {
    const view=workspace(); await button(view.render(),"Load eligible members").props.onClick(); await flush(); view.checkbox(first).props.onChange();
    api.preview.mockResolvedValueOnce({...preview("provision",[first]),previewToken:null,blocked:[{academyMemberId:first,reason:"member_is_not_active"}]});
    await button(view.render(),"Review selected").props.onClick(); await flush();
    expect(text(view.render())).toContain("This membership is not active"); expect(button(view.render(),"Set up 1 account").props.disabled).toBe(true);
    await button(view.render(),"Set up 1 account").props.onClick(); expect(api.run).not.toHaveBeenCalled();
  });
  it("explains an uncertain previous email without offering another send", async () => {
    const view=workspace(); await button(view.render(),"Load eligible members").props.onClick(); await flush(); view.checkbox(first).props.onChange();
    api.preview.mockResolvedValueOnce({...preview("provision",[first]),previewToken:null,blocked:[{academyMemberId:first,reason:"email_delivery_outcome_requires_review"}]});
    await button(view.render(),"Review selected").props.onClick(); await flush();
    expect(text(view.render())).toContain("An earlier email may already have been sent");
    expect(text(view.render())).not.toContain("email_delivery_outcome_requires_review");
    await button(view.render(),"Set up 1 account").props.onClick(); expect(api.run).not.toHaveBeenCalled();
  });
  it("locks duplicate submissions synchronously and consumes approval after a failure", async () => {
    const view=workspace(); await button(view.render(),"Load eligible members").props.onClick(); await flush(); view.checkbox(first).props.onChange();
    await button(view.render(),"Review selected").props.onClick(); await flush();
    let finish!: (saved:boolean)=>void; view.props.onRun.mockImplementationOnce(async ()=>new Promise(resolve=>{finish=resolve;}));
    const execute=button(view.render(),"Set up 1 account").props.onClick; execute();execute(); await flush();
    expect(view.props.onRun).toHaveBeenCalledOnce(); finish(false);await flush();
    expect(text(view.render())).toContain("load a new preview"); expect(elements(view.render()).some(e=>e.props["aria-label"] === "Selected member review")).toBe(false);
  });
  it("separates email action and clears the old selection when the action changes", async () => {
    const view=workspace(); await button(view.render(),"Load eligible members").props.onClick(); await flush(); view.checkbox(first).props.onChange();
    find(view.render(),e=>e.type === "select").props.onChange({target:{value:"notify"}});
    expect(text(view.render())).not.toContain("1 selected"); await button(view.render(),"Load eligible members").props.onClick(); await flush();
    expect(api.preview).toHaveBeenLastCalledWith("notify",[]); expect(text(view.render())).toContain("maximum 25"); expect(api.run).not.toHaveBeenCalled();
  });
  it("disables an expired approval and explains how to refresh it", async () => {
    vi.useFakeTimers();
    const view=workspace(); await button(view.render(),"Load eligible members").props.onClick(); await flush();view.checkbox(first).props.onChange();
    await button(view.render(),"Review selected").props.onClick();await flush();view.render();
    vi.advanceTimersByTime(600001);
    expect(text(view.render())).toContain("This preview expired");expect(button(view.render(),"Set up 1 account").props.disabled).toBe(true);
    await button(view.render(),"Set up 1 account").props.onClick();expect(api.run).not.toHaveBeenCalled();
  });
  it("blocks forced handlers when the workspace becomes read-only", async () => {
    const view=workspace(); const load=button(view.render(),"Load eligible members").props.onClick; view.props.disabled=true;view.render(); load();await flush();
    expect(api.preview).not.toHaveBeenCalled();expect(api.run).not.toHaveBeenCalled();
  });
});
