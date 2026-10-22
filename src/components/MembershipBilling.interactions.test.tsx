import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessState } from "../lib/academyAccess";
import type { ServiceOrder } from "../lib/serviceCheckout";
import { MembershipPages } from "./MembershipPages";

type HookState = { slots: any[]; cursor: number; effects: (() => void)[] };
const hooks = vi.hoisted(() => ({ active: null as HookState | null }));
const account = vi.hoisted(() => ({ access: { status: "no_access", hasMemberIdentity: true } as AccessState, accountEmail: "member@example.test", refresh: vi.fn() }));
const platform = vi.hoisted(() => ({ native: false }));
const api = vi.hoisted(() => ({ academy: vi.fn(), academyPortal: vi.fn(), orders: vi.fn(), servicePortal: vi.fn() }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => platform.native } }));
vi.mock("../lib/backend", () => ({ supabase: null, loadAcademyBillingOverview: api.academy, openAcademyBillingPortal: api.academyPortal, requestMagicLink: vi.fn() }));
vi.mock("../lib/useBillingAccess", () => ({ useBillingAccess: () => account }));
vi.mock("../lib/serviceCheckout", () => ({ loadOwnServiceOrders: api.orders, beginServiceBillingPortal: api.servicePortal }));
vi.mock("react", async original => {
  const actual = await original<typeof import("react")>();
  const next = () => { if (!hooks.active) throw new Error("Render through the billing hook harness"); return { state: hooks.active, index: hooks.active.cursor++ }; };
  const same = (left: any[] | undefined, right: any[] | undefined) => left !== undefined && right !== undefined && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  return { ...actual,
    useState: (initial: any) => { const { state, index } = next(); if (!(index in state.slots)) state.slots[index] = typeof initial === "function" ? initial() : initial; return [state.slots[index], (value: any) => { state.slots[index] = typeof value === "function" ? value(state.slots[index]) : value; }]; },
    useRef: (initial: any) => { const { state, index } = next(); return state.slots[index] ??= { current: initial }; },
    useEffect: (effect: () => void | (() => void), deps: any[] | undefined) => { const { state, index } = next(); if (!same(state.slots[index]?.deps, deps)) { const previous = state.slots[index]; state.slots[index] = { deps }; state.effects.push(() => { previous?.cleanup?.(); state.slots[index].cleanup = effect(); }); } },
  };
});
type Element = ReactElement<Record<string, any>>;
function elements(node: ReactNode): Element[] { if (Array.isArray(node)) return node.flatMap(elements); if (!node || typeof node !== "object" || !("props" in node)) return []; const element = node as Element; return [element, ...elements(element.props.children)]; }
function text(node: ReactNode): string { if (Array.isArray(node)) return node.map(text).join(""); if (!node || typeof node === "boolean") return ""; return typeof node === "object" ? "props" in node ? text((node as Element).props.children) : "" : String(node); }
function find(node: ReactNode, predicate: (element: Element) => boolean) { const result = elements(node).find(predicate); if (!result) throw new Error("Expected billing control not found"); return result; }
function button(node: ReactNode, label: string) { return find(node, element => element.type === "button" && text(element.props.children).trim() === label); }
const views: Array<{ dispose: () => void }> = [];
function harness(render: () => ReactNode) {
  const state: HookState = { slots: [], cursor: 0, effects: [] };
  const view = { render: () => { state.cursor = 0; hooks.active = state; let tree: ReactNode; try { tree = render(); } finally { hooks.active = null; } state.effects.splice(0).forEach(effect => effect()); return tree; }, dispose: () => { state.slots.forEach(slot => slot?.cleanup?.()); state.slots = []; } };
  views.push(view); return view;
}
const flush = async () => { for (let index = 0; index < 25; index++) await Promise.resolve(); };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const listeners = new Map<string, Set<() => void>>();
function order(overrides: Partial<ServiceOrder> = {}): ServiceOrder { return { id: "10000000-0000-4000-8000-000000000001", quoteId: "20000000-0000-4000-8000-000000000002", serviceKey: "website-care", amountCents: 9700, billingInterval: "month", status: "paid", createdAt: "2026-10-22T15:00:00Z", subscriptionStatus: "active", ...overrides }; }
async function billing() {
  const page = harness(() => MembershipPages({ route: "billing" }));
  const section = find(page.render(), element => typeof element.type === "function" && element.type.name === "MembershipManagement");
  const view = harness(() => (section.type as (props: any) => ReactNode)(section.props));
  view.render(); await flush(); return view;
}
function setOnline(online: boolean) { Object.assign(navigator, { onLine: online }); listeners.get(online ? "online" : "offline")?.forEach(listener => listener()); }

beforeEach(() => {
  listeners.clear(); platform.native = false; account.access = { status: "no_access", hasMemberIdentity: true }; account.accountEmail = "member@example.test"; account.refresh.mockReset();
  api.academy.mockReset().mockResolvedValue({ plans: [], subscription: null }); api.academyPortal.mockReset().mockResolvedValue(undefined); api.orders.mockReset().mockResolvedValue([order()]); api.servicePortal.mockReset().mockResolvedValue("https://billing.stripe.com/p/session/fixture");
  vi.stubGlobal("document", { title: "Academy" }); vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("window", { location: { assign: vi.fn() }, addEventListener: (name: string, listener: () => void) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(listener); }, removeEventListener: (name: string, listener: () => void) => listeners.get(name)?.delete(listener) });
});
afterEach(() => { views.splice(0).reverse().forEach(view => view.dispose()); vi.unstubAllGlobals(); });

describe("independent Academy and service billing", () => {
  it("keeps paid monthly service management available after Academy access ends or its billing check fails", async () => {
    api.academy.mockRejectedValue(new Error("Academy unavailable"));
    const ui = await billing();
    expect(text(ui.render())).toContain("Academy access has ended"); expect(text(ui.render())).toContain("Active subscription");
    button(ui.render(), "Manage billing").props.onClick(); await flush();
    expect(api.servicePortal).toHaveBeenCalledWith(order().id); expect(window.location.assign).toHaveBeenCalledWith("https://billing.stripe.com/p/session/fixture");
    expect(api.academyPortal).not.toHaveBeenCalled();
  });
  it("does not hide Academy billing when service billing is unavailable and retries it independently", async () => {
    account.access = { status: "member", canManage: false, pricingGatesEnabled: true, communityAccess: true, courseIds: [], features: [] };
    api.academy.mockResolvedValue({ plans: [], subscription: { planName: "Academy membership", status: "active", cancelAtPeriodEnd: false } });
    api.orders.mockRejectedValueOnce(new Error("Service migration unavailable"));
    const ui = await billing();
    expect(button(ui.render(), "Open Academy billing").props.disabled).toBe(false);
    expect(text(ui.render())).toContain("Service payments could not load");
    expect(api.academy).toHaveBeenCalledOnce(); button(ui.render(), "Retry service billing").props.onClick(); ui.render(); await flush();
    expect(text(ui.render())).toContain("Website care"); expect(api.orders).toHaveBeenCalledTimes(2); expect(api.academy).toHaveBeenCalledOnce();
  });
  it("guards double clicks, keeps failures retryable, and does not change a subscription itself", async () => {
    const first = deferred<string>(); api.servicePortal.mockReturnValueOnce(first.promise);
    const ui = await billing();
    const control = button(ui.render(), "Manage billing"); control.props.onClick(); control.props.onClick();
    expect(api.servicePortal).toHaveBeenCalledOnce(); expect(button(ui.render(), "Opening billing…").props.disabled).toBe(true);
    first.reject(new Error("Portal unavailable")); await flush();
    expect(text(ui.render())).toContain("Your subscription has not changed");
    button(ui.render(), "Manage billing").props.onClick(); await flush();
    expect(api.servicePortal).toHaveBeenCalledTimes(2); expect(window.location.assign).toHaveBeenCalledOnce();
  });
  it("disables financial navigation offline, including stale handlers, and resumes when connected", async () => {
    const ui = await billing(); const stale = button(ui.render(), "Manage billing");
    setOnline(false); ui.render();
    expect(button(ui.render(), "Manage billing").props.disabled).toBe(true); stale.props.onClick(); expect(api.servicePortal).not.toHaveBeenCalled();
    setOnline(true); ui.render(); await flush(); button(ui.render(), "Manage billing").props.onClick(); await flush(); expect(api.servicePortal).toHaveBeenCalledOnce();
  });
  it("shows cancellation and delinquency lifecycle states without presenting an old receipt as an active subscription", async () => {
    api.orders.mockResolvedValue([order({ subscriptionStatus: "canceled" }), order({ id: "other-order", serviceKey: "ghl-subscription", amountCents: 19700, subscriptionStatus: "past_due" })]);
    const ui = await billing();
    expect(text(ui.render())).toContain("Subscription cancelled"); expect(text(ui.render())).toContain("Payment overdue");
    expect(text(ui.render())).not.toContain("Active subscription");
    expect(elements(ui.render()).filter(element => element.type === "button" && text(element.props.children).trim() === "Manage billing")).toHaveLength(2);
  });
  it("clears the previous account’s orders and prevents a late portal response from redirecting a different account", async () => {
    const portal = deferred<string>(); api.servicePortal.mockReturnValueOnce(portal.promise);
    const ui = await billing(); button(ui.render(), "Manage billing").props.onClick();
    account.accountEmail = "other@example.test"; api.orders.mockResolvedValue([]); const switched = ui.render(); expect(text(switched)).not.toContain("Website care"); await flush();
    expect(text(ui.render())).not.toContain("Website care"); portal.resolve("https://billing.stripe.com/p/session/old-account"); await flush();
    expect(window.location.assign).not.toHaveBeenCalled();
  });
  it("does not load service orders when signed out and suppresses native billing", async () => {
    account.access = { status: "signed_out" }; account.accountEmail = "";
    const ui = await billing(); expect(text(ui.render())).toContain("Sign in with your Academy email"); expect(api.orders).not.toHaveBeenCalled();
    platform.native = true; expect(ui.render()).toBeNull(); expect(api.servicePortal).not.toHaveBeenCalled();
  });
});
