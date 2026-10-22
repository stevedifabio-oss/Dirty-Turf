import type { ComponentProps, ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GrowthCatalog, GrowthRequest, GrowthSettings } from "../lib/growth";
import type { ServiceQuote } from "../lib/serviceCheckout";
import type { AccessState } from "../lib/academyAccess";
import { Growth } from "./Growth";
import { GrowthAdmin } from "./GrowthAdmin";

// Exercise the real handlers and effect cleanup using the same persistent-hook
// harness as the existing authoring, community, and resume interaction suites.
type HookState = { slots: any[]; cursor: number; effects: (() => void)[] };
const hooks = vi.hoisted(() => ({ active: null as HookState | null, nextId: 0 }));
const payments = vi.hoisted(() => ({ ownQuotes: vi.fn(), orders: vi.fn(), adminQuotes: vi.fn(), quote: vi.fn(), checkout: vi.fn(), portal: vi.fn(), withdraw: vi.fn() }));
const platform = vi.hoisted(() => ({ native: false }));
const api = vi.hoisted(() => ({ catalog: vi.fn(), own: vi.fn(), create: vi.fn(), admin: vi.fn(), save: vi.fn(), status: vi.fn() }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => platform.native } }));
vi.mock("../lib/growth", () => ({ loadGrowthCatalog: api.catalog, loadOwnGrowthRequests: api.own, createGrowthRequest: api.create, loadAdminGrowthRequests: api.admin, saveGrowthSettings: api.save, updateGrowthRequestStatus: api.status }));
vi.mock("../lib/serviceCheckout", () => ({ loadOwnServiceQuotes: payments.ownQuotes, loadOwnServiceOrders: payments.orders, loadAdminServiceQuotes: payments.adminQuotes, createServiceQuote: payments.quote, beginServiceCheckout: payments.checkout, beginServiceBillingPortal: payments.portal, withdrawServiceQuote: payments.withdraw }));
vi.mock("./AccessOffers", () => ({ AvailableUpgrades: () => null }));
vi.mock("react", async original => {
  const actual = await original<typeof import("react")>();
  const next = () => { if (!hooks.active) throw new Error("Render through the growth hook harness"); return { state: hooks.active, index: hooks.active.cursor++ }; };
  const same = (left: any[] | undefined, right: any[] | undefined) => left !== undefined && right !== undefined && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  return { ...actual,
    useState: (initial: any) => { const { state, index } = next(); if (!(index in state.slots)) state.slots[index] = typeof initial === "function" ? initial() : initial; return [state.slots[index], (value: any) => { state.slots[index] = typeof value === "function" ? value(state.slots[index]) : value; }]; },
    useRef: (initial: any) => { const { state, index } = next(); return state.slots[index] ??= { current: initial }; },
    useId: () => { const { state, index } = next(); return state.slots[index] ??= `growth-test-${++hooks.nextId}`; },
    useEffect: (effect: () => void | (() => void), deps: any[] | undefined) => { const { state, index } = next(); if (!same(state.slots[index]?.deps, deps)) { const previous = state.slots[index]; state.slots[index] = { deps }; state.effects.push(() => { previous?.cleanup?.(); state.slots[index].cleanup = effect(); }); } },
  };
});

type Element = ReactElement<Record<string, any>>;
function elements(node: ReactNode): Element[] { if (Array.isArray(node)) return node.flatMap(elements); if (!node || typeof node !== "object" || !("props" in node)) return []; const element = node as Element; return [element, ...elements(element.props.children)]; }
function text(node: ReactNode): string { if (Array.isArray(node)) return node.map(text).join(""); if (!node || typeof node === "boolean") return ""; return typeof node === "object" ? "props" in node ? text((node as Element).props.children) : "" : String(node); }
function find(node: ReactNode, predicate: (element: Element) => boolean) { const found = elements(node).find(predicate); if (!found) throw new Error("Expected growth control not found"); return found; }
function button(node: ReactNode, label: string) { return find(node, element => element.type === "button" && text(element.props.children).trim() === label); }
function serviceCard(node: ReactNode, title: string) { return find(node, element => element.type === "article" && elements(element.props.children).some(child => child.type === "h3" && text(child.props.children) === title)); }
const views: Array<{ dispose: () => void }> = [];
function harness(render: () => ReactNode) {
  const state: HookState = { slots: [], cursor: 0, effects: [] };
  const view = { render: () => { state.cursor = 0; hooks.active = state; let tree: ReactNode; try { tree = render(); } finally { hooks.active = null; } state.effects.splice(0).forEach(effect => effect()); return tree; }, dispose: () => { state.slots.forEach(slot => slot?.cleanup?.()); state.slots = []; } };
  views.push(view); return view;
}
const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const communityId = "10000000-0000-4000-8000-000000000001";
const requestId = "20000000-0000-4000-8000-000000000002";
const access: AccessState = { status: "member", canManage: false, pricingGatesEnabled: true, communityAccess: true, courseIds: ["current-academy"], features: [] };
const settings = (): GrowthSettings => ({ communityId, serviceCadences: { website: "one_time", ghl: "one_time", "seo-aeo": "one_time", "facebook-ads": "month", "website-care": "month", "ghl-subscription": "month" } });
function catalog(): GrowthCatalog { return { settings: settings(), services: [
  { key: "website", title: "Website", summary: "A website for your turf cleaning business.", fromCents: 149500, toCents: 249500, billingInterval: "one_time" },
  { key: "ghl", title: "GoHighLevel", summary: "CRM setup.", fromCents: 149500, toCents: 249500, billingInterval: "one_time" },
  { key: "seo-aeo", title: "SEO / AEO", summary: "Search visibility.", fromCents: 149500, toCents: 249500, billingInterval: "one_time" },
  { key: "facebook-ads", title: "Facebook ads management", summary: "Manage your advertising.", fromCents: 49500, toCents: 89500, billingInterval: "month" },
  { key: "website-care", title: "Website care", summary: "Optional website care.", fromCents: 9700, toCents: 9700, billingInterval: "month" },
  { key: "ghl-subscription", title: "GoHighLevel subscription", summary: "Optional CRM subscription.", fromCents: 19700, toCents: 19700, billingInterval: "month" },
] }; }
function quote(overrides: Partial<ServiceQuote> = {}): ServiceQuote { return { id: "30000000-0000-4000-8000-000000000003", requestId, serviceKey: "website", amountCents: 180000, currency: "usd", billingInterval: "one_time", status: "offered", createdAt: "2026-10-22T16:00:00Z", ...overrides }; }
function request(overrides: Partial<GrowthRequest> = {}): GrowthRequest { return { id: requestId, serviceKey: "website", status: "new", notes: "Help with a website", createdAt: "2026-10-22T15:00:00Z", memberName: "Test member", companyName: "Test cleaning company", ...overrides }; }
async function member(overrides: Partial<ComponentProps<typeof Growth>> = {}) { const props: ComponentProps<typeof Growth> = { access, onToast: vi.fn(), ...overrides }; const view = harness(() => Growth(props)); view.render(); await flush(); return { props, view, render: view.render }; }
async function admin(overrides: Partial<ComponentProps<typeof GrowthAdmin>> = {}) { const props: ComponentProps<typeof GrowthAdmin> = { communityId, onToast: vi.fn(), onDirtyChange: vi.fn(), ...overrides }; const view = harness(() => GrowthAdmin(props)); view.render(); await flush(); return { props, view, render: view.render }; }
function notes(node: ReactNode, value: string) { find(node, element => element.type === "textarea").props.onChange({ target: { value } }); }
function submit(node: ReactNode) { find(node, element => element.type === "form").props.onSubmit({ preventDefault: vi.fn() }); }

beforeEach(() => { vi.stubGlobal("window", { location: { search: "", assign: vi.fn() } }); platform.native = false; hooks.nextId = 0; api.catalog.mockReset().mockImplementation(async () => catalog()); api.own.mockReset().mockResolvedValue([]); api.create.mockReset().mockImplementation(async (serviceKey, notes, id) => request({ serviceKey, notes, id })); api.admin.mockReset().mockResolvedValue([]); api.save.mockReset().mockImplementation(async value => value); api.status.mockReset().mockResolvedValue(undefined); payments.ownQuotes.mockReset().mockResolvedValue([]); payments.orders.mockReset().mockResolvedValue([]); payments.adminQuotes.mockReset().mockResolvedValue([]); payments.quote.mockReset().mockImplementation(async input => quote({ ...input })); payments.checkout.mockReset().mockResolvedValue("https://checkout.stripe.com/c/pay/cs_test_fixture"); payments.portal.mockReset().mockResolvedValue("https://billing.stripe.com/p/session/fixture"); payments.withdraw.mockReset().mockResolvedValue(undefined); });
afterEach(() => { views.splice(0).reverse().forEach(view => view.dispose()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("member growth requests", () => {
  it("shows configured prices and optional add-ons without preselecting or buying anything", async () => {
    const ui = await member();
    const markup = text(ui.render());
    expect(markup).toContain("$1,495–$2,495");
    expect(markup).toContain("$97"); expect(markup).toContain("$197");
    expect(markup.match(/Optional monthly add-on/g)).toHaveLength(2);
    expect(markup).toContain("Community membership is already included");
    expect(elements(ui.render()).some(element => element.type === "form")).toBe(false);
    expect(api.create).not.toHaveBeenCalled();
    const upgrades = elements(ui.render()).filter(element => typeof element.type === "function" && element.props.access === access);
    expect(upgrades).toHaveLength(1); expect(upgrades[0].props.kind).toBeUndefined();
    expect(markup).not.toContain("$10");
  });
  it("retries an uncertain write with the same request ID and notes, preventing double submission", async () => {
    const first = deferred<GrowthRequest>();
    api.create.mockReturnValueOnce(first.promise);
    const ui = await member();
    button(serviceCard(ui.render(), "Website"), "Request details").props.onClick();
    notes(ui.render(), "  Need a turf cleaning site.  ");
    const form = ui.render(); submit(form); submit(form);
    expect(api.create).toHaveBeenCalledOnce();
    expect(button(ui.render(), "Saving request…").props.disabled).toBe(true);
    const id = api.create.mock.calls[0][2];
    first.reject(new Error("Connection interrupted")); await flush();
    expect(find(ui.render(), element => element.type === "textarea").props.value).toBe("  Need a turf cleaning site.  ");
    expect(text(ui.render())).toContain("Your request could not be confirmed");
    api.own.mockResolvedValue([request({ notes: "Need a turf cleaning site." })]);
    submit(ui.render()); await flush();
    expect(api.create).toHaveBeenNthCalledWith(2, "website", "Need a turf cleaning site.", id);
    expect(elements(ui.render()).some(element => element.type === "form")).toBe(false);
    expect(text(ui.render())).toContain("Request received");
    expect(ui.props.onToast).toHaveBeenCalledOnce();
  });
  it("keeps a confirmed request when the list refresh fails and pauses new requests", async () => {
    const ui = await member();
    button(serviceCard(ui.render(), "Website"), "Request details").props.onClick();
    api.own.mockRejectedValue(new Error("List unavailable"));
    submit(ui.render()); await flush();
    expect(ui.props.onToast).toHaveBeenCalledWith(expect.stringContaining("Request saved"));
    expect(text(ui.render())).toContain("Request received");
    expect(text(ui.render())).toContain("new requests are paused");
    expect(button(serviceCard(ui.render(), "GoHighLevel"), "Request details").props.disabled).toBe(true);
    expect(api.create).toHaveBeenCalledOnce();
  });
  it("will not submit duplicate open services or submit until the member request list is verified", async () => {
    api.own.mockResolvedValue([request({ status: "contacted" })]);
    const ui = await member();
    expect(button(serviceCard(ui.render(), "Website"), "In conversation").props.disabled).toBe(true);
    button(serviceCard(ui.render(), "Website"), "In conversation").props.onClick();
    expect(elements(ui.render()).some(element => element.type === "form")).toBe(false);
    expect(api.create).not.toHaveBeenCalled();
    api.own.mockRejectedValue(new Error("Cannot verify"));
    button(ui.render(), "Refresh").props.onClick(); ui.render(); await flush();
    expect(button(serviceCard(ui.render(), "GoHighLevel"), "Request details").props.disabled).toBe(true);
  });
  it("keeps drafts through offline and resume, disables links, and blocks a stale submit handler offline", async () => {
    const ui = await member();
    button(serviceCard(ui.render(), "Website"), "Request details").props.onClick(); notes(ui.render(), "Keep these notes.");
    const staleForm = ui.render();
    ui.props.readOnly = true;
    expect(find(ui.render(), element => element.type === "textarea").props.disabled).toBe(true);
    expect(elements(ui.render()).some(element => element.type === "a")).toBe(false);
    submit(staleForm); expect(api.create).not.toHaveBeenCalled();
    ui.props.readOnly = false; ui.render(); await flush();
    expect(find(ui.render(), element => element.type === "textarea").props.value).toBe("Keep these notes.");
    submit(ui.render()); await flush(); expect(api.create).toHaveBeenCalledOnce();
  });
  it("reports unavailable setup honestly and recovers through reload", async () => {
    api.catalog.mockRejectedValueOnce(new Error("Missing migration"));
    const ui = await member();
    expect(text(ui.render())).toContain("Business services could not load");
    button(ui.render(), "Reload services").props.onClick(); ui.render(); await flush();
    expect(text(ui.render())).toContain("$1,495–$2,495");
  });
  it("uses the canonical deduplicated request and keeps newer unsent notes", async () => {
    const ui = await member();
    button(serviceCard(ui.render(), "Website"), "Request details").props.onClick(); notes(ui.render(), "These are new notes.");
    api.create.mockResolvedValueOnce(request({ notes: "Original saved notes", createdAt: "2026-10-20T15:00:00Z" }));
    api.own.mockResolvedValue([request({ notes: "Original saved notes", createdAt: "2026-10-20T15:00:00Z" })]);
    submit(ui.render()); await flush();
    expect(text(ui.render())).toContain("Your new notes were not sent");
    expect(text(ui.render())).toContain("Original saved notes");
    expect(text(ui.render())).toContain("Oct 20, 2026");
    expect(find(ui.render(), element => element.type === "textarea").props.value).toBe("These are new notes.");
    expect(button(ui.render(), "Open request already exists").props.disabled).toBe(true);
    expect(ui.props.onToast).toHaveBeenCalledWith("Existing request found. Your new notes were not sent.");
  });
  it("only opens an explicitly chosen quote in Stripe and reuses its checkout key on retry", async () => {
    payments.ownQuotes.mockResolvedValue([quote({ serviceKey: "website-care", amountCents: 9700, billingInterval: "month" })]);
    const ui = await member();
    expect(payments.checkout).not.toHaveBeenCalled();
    expect(text(ui.render())).toContain("$97.00"); expect(text(ui.render())).toContain("renews monthly until cancelled");
    const first = deferred<string>(); payments.checkout.mockReturnValueOnce(first.promise);
    const before = ui.render(); button(before, "Continue to Stripe").props.onClick(); button(before, "Continue to Stripe").props.onClick();
    expect(payments.checkout).toHaveBeenCalledOnce(); const key = payments.checkout.mock.calls[0][1];
    expect(button(ui.render(), "Opening Stripe…").props.disabled).toBe(true);
    first.reject(new Error("Unavailable")); await flush();
    button(ui.render(), "Continue to Stripe").props.onClick(); await flush();
    expect(payments.checkout).toHaveBeenNthCalledWith(2, quote().id, key);
    expect(window.location.assign).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/cs_test_fixture");
  });
  it("offers billing management for paid monthly services and guards offline and duplicate clicks", async () => {
    payments.ownQuotes.mockResolvedValue([quote({ serviceKey: "website-care", amountCents: 9700, billingInterval: "month", status: "paid" })]);
    payments.orders.mockResolvedValue([{ id: requestId, quoteId: quote().id, serviceKey: "website-care", amountCents: 9700, billingInterval: "month", status: "paid", subscriptionStatus: "active", createdAt: "2026-10-22T16:00:00Z" }]);
    const ui = await member();
    const stale = button(ui.render(), "Manage billing");
    ui.props.readOnly = true; expect(button(ui.render(), "Manage billing").props.disabled).toBe(true);
    stale.props.onClick(); expect(payments.portal).not.toHaveBeenCalled();
    ui.props.readOnly = false; ui.render(); await flush();
    const portal = deferred<string>(); payments.portal.mockReturnValueOnce(portal.promise);
    const control = button(ui.render(), "Manage billing"); control.props.onClick(); control.props.onClick();
    expect(payments.portal).toHaveBeenCalledOnce(); expect(payments.portal).toHaveBeenCalledWith(requestId);
    portal.resolve("https://billing.stripe.com/p/session/fixture"); await flush();
    expect(window.location.assign).toHaveBeenCalledWith("https://billing.stripe.com/p/session/fixture");
    expect(payments.checkout).not.toHaveBeenCalled();
  });
  it("never treats the Stripe return URL or a pending order as confirmed payment", async () => {
    window.location.search = "?service_checkout=return";
    payments.ownQuotes.mockResolvedValue([quote()]);
    payments.orders.mockResolvedValue([{ id: "order", quoteId: quote().id, serviceKey: "website", amountCents: 180000, billingInterval: "one_time", status: "pending", createdAt: "2026-10-22T16:00:00Z" }]);
    const ui = await member();
    expect(text(ui.render())).toContain("Checking payment status"); expect(text(ui.render())).toContain("Payment pending");
    expect(text(ui.render())).not.toContain("Payment confirmed");
    expect(payments.checkout).not.toHaveBeenCalled();
  });
  it("renders no native checkout or service steering and makes no native reads", async () => {
    platform.native = true;
    const ui = await member();
    expect(ui.render()).toBeNull(); expect(api.catalog).not.toHaveBeenCalled(); expect(api.own).not.toHaveBeenCalled();
  });
});

describe("business service administration", () => {
  it("shows approved prices without editable cadence controls and preserves quote drafts offline", async () => {
    api.admin.mockResolvedValue([request()]);
    const ui = await admin();
    expect(text(ui.render())).toContain("Approved prices");
    expect(elements(ui.render()).some(element => element.type === "select" && element.props.id.endsWith("-website"))).toBe(false);
    const price = () => find(ui.render(), element => element.type === "input" && element.props.id.includes("-amount-"));
    price().props.onChange({ target: { value: "1800" } }); ui.render();
    expect(ui.props.onDirtyChange).toHaveBeenLastCalledWith(true);
    ui.props.readOnly = true; ui.render();
    expect(price().props.value).toBe("1800");
    expect(find(ui.render(), element => element.type === "fieldset").props.disabled).toBe(true);
    ui.props.readOnly = false; ui.render(); await flush();
    expect(price().props.value).toBe("1800");
    expect(api.save).not.toHaveBeenCalled();
  });
  it("keeps the previous request status on failure and updates the queue after confirmation", async () => {
    api.admin.mockResolvedValue([request()]);
    const ui = await admin();
    const status = () => find(ui.render(), element => element.type === "select" && element.props.id.endsWith(`-request-${requestId}`));
    api.status.mockRejectedValueOnce(new Error("Failed"));
    status().props.onChange({ target: { value: "contacted" } }); await flush();
    expect(status().props.value).toBe("new"); expect(text(ui.render())).toContain("previous status is still shown");
    const update = deferred<void>(); api.status.mockReturnValueOnce(update.promise);
    const existing = status(); existing.props.onChange({ target: { value: "contacted" } }); existing.props.onChange({ target: { value: "closed" } });
    expect(api.status).toHaveBeenCalledTimes(2); expect(status().props.disabled).toBe(true);
    update.resolve(); await flush();
    expect(text(ui.render())).toContain("No new requests.");
    api.admin.mockResolvedValue([request({ status: "contacted" })]);
    find(ui.render(), element => element.type === "select" && element.props.id.endsWith("-filter")).props.onChange({ target: { value: "all" } }); ui.render(); await flush();
    expect(status().props.value).toBe("contacted");
    expect(ui.props.onToast).toHaveBeenCalledWith("Request status updated.");
  });
  it("queries each queue filter at the server rather than filtering one capped result set", async () => {
    const ui = await admin();
    expect(api.admin).toHaveBeenLastCalledWith(communityId, "new");
    const filter = () => find(ui.render(), element => element.type === "select" && element.props.id.endsWith("-filter"));
    filter().props.onChange({ target: { value: "contacted" } }); ui.render(); await flush();
    expect(api.admin).toHaveBeenLastCalledWith(communityId, "contacted");
    filter().props.onChange({ target: { value: "all" } }); ui.render(); await flush();
    expect(api.admin).toHaveBeenLastCalledWith(communityId, undefined);
  });
  it("offers an exact in-range quote only after confirmation and preserves inputs after an uncertain response", async () => {
    api.admin.mockResolvedValue([request()]);
    const ui = await admin();
    const input = (part: string) => find(ui.render(), element => element.type === "input" && element.props.id.includes(part));
    input("-amount-").props.onChange({ target: { value: "100" } });
    expect(button(ui.render(), "Offer quote").props.disabled).toBe(true);
    submit(ui.render()); await flush(); expect(payments.quote).not.toHaveBeenCalled();
    input("-amount-").props.onChange({ target: { value: "1800.00" } });
    payments.quote.mockRejectedValueOnce(new Error("Uncertain response"));
    submit(ui.render()); await flush();
    expect(input("-amount-").props.value).toBe("1800.00");
    expect(text(ui.render())).toContain("quote could not be confirmed");
    const pending = deferred<ServiceQuote>(); payments.quote.mockReturnValueOnce(pending.promise);
    const before = ui.render(); submit(before); submit(before);
    expect(payments.quote).toHaveBeenCalledTimes(2);
    expect(payments.quote).toHaveBeenLastCalledWith({ requestId, amountCents: 180000, billingInterval: "one_time" });
    pending.resolve(quote()); await flush(); ui.render();
    expect(text(ui.render())).toContain("Quote offered");
    expect(elements(ui.render()).some(element => element.type === "form")).toBe(false);
    expect(ui.props.onDirtyChange).toHaveBeenLastCalledWith(false);
    expect(payments.checkout).not.toHaveBeenCalled();
  });
  it("withdraws only offered quotes and waits for the server refresh before allowing revised terms", async () => {
    api.admin.mockResolvedValue([request()]); payments.adminQuotes.mockResolvedValue([quote()]);
    const ui = await admin();
    const pending = deferred<void>(); payments.withdraw.mockReturnValueOnce(pending.promise);
    const control = button(ui.render(), "Withdraw quote"); control.props.onClick(); control.props.onClick();
    expect(payments.withdraw).toHaveBeenCalledOnce(); expect(payments.withdraw).toHaveBeenCalledWith(quote().id);
    expect(button(ui.render(), "Withdrawing…").props.disabled).toBe(true);
    payments.adminQuotes.mockResolvedValue([quote({ status: "withdrawn" })]); pending.resolve(); await flush();
    expect(text(ui.render())).toContain("Quote withdrawn");
    expect(button(ui.render(), "Offer quote").props.disabled).toBe(true);
    expect(elements(ui.render()).some(element => element.type === "form")).toBe(true);
    payments.adminQuotes.mockResolvedValue([quote({ status: "paid" })]); button(ui.render(), "Refresh").props.onClick(); ui.render(); await flush();
    expect(elements(ui.render()).some(element => element.type === "button" && text(element.props.children) === "Withdraw quote")).toBe(false);
  });
  it("will not display another Academy’s settings and offers retry for an unapplied schema", async () => {
    api.catalog.mockResolvedValueOnce({ ...catalog(), settings: { ...settings(), communityId: "different-academy" } });
    const ui = await admin();
    expect(text(ui.render())).toContain("database update may still need to be applied");
    expect(elements(ui.render()).some(element => element.type === "form")).toBe(false);
    button(ui.render(), "Reload settings").props.onClick(); ui.render(); await flush();
    expect(text(ui.render())).toContain("Approved prices");
  });
  it("makes no reads or writes for native and offline initial views", async () => {
    const offline = await admin({ readOnly: true });
    expect(api.catalog).not.toHaveBeenCalled(); expect(api.admin).not.toHaveBeenCalled();
    expect(text(offline.render())).toContain("Reconnect to load business services");
    platform.native = true;
    const native = await admin();
    expect(native.render()).toBeNull(); expect(api.catalog).not.toHaveBeenCalled(); expect(api.admin).not.toHaveBeenCalled(); expect(api.save).not.toHaveBeenCalled();
  });
});
