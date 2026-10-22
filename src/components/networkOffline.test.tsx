import type { ComponentProps, ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HubSheet } from "./Network";
import { EventsView } from "./Events";

type HookState = { slots: any[]; cursor: number; effects: (() => void)[] };
const hooks = vi.hoisted(() => ({ active: null as HookState | null }));
const backend = vi.hoisted(() => ({
  loadAccountDeletionRequest: vi.fn(), loadAcademyBillingOverview: vi.fn(),
  loadMemberAccessSummary: vi.fn(), loadNotificationPreferences: vi.fn(),
  openAcademyBillingPortal: vi.fn(), provisionAcademyMemberAccounts: vi.fn(),
  requestAccountDeletion: vi.fn(), saveNotificationPreferences: vi.fn(),
  webBillingAvailable: vi.fn(() => true),
}));
vi.mock("../lib/backend", () => backend);
vi.mock("../lib/useModalDialog", () => ({ useModalDialog: () => undefined }));
vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  const next = () => {
    if (!hooks.active) throw new Error("Use the component harness");
    return { state: hooks.active, index: hooks.active.cursor++ };
  };
  return {
    ...actual,
    useState: (initial: any) => {
      const { state, index } = next();
      if (!(index in state.slots)) state.slots[index] = typeof initial === "function" ? initial() : initial;
      return [state.slots[index], (value: any) => { state.slots[index] = typeof value === "function" ? value(state.slots[index]) : value; }];
    },
    useRef: (initial: any) => { const { state, index } = next(); return state.slots[index] ??= { current: initial }; },
    useEffect: (effect: () => (() => void) | undefined, dependencies: any[]) => {
      const { state, index } = next();
      const previous = state.slots[index];
      if (previous && dependencies.every((value, position) => Object.is(value, previous.dependencies[position]))) return;
      state.effects.push(() => {
        previous?.cleanup?.();
        state.slots[index] = { dependencies, cleanup: effect() };
      });
    },
  };
});

type Element = ReactElement<Record<string, any>>;
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  return [node as Element, ...elements((node as Element).props.children)];
}
function find(node: ReactNode, predicate: (element: Element) => boolean) {
  const result = elements(node).find(predicate);
  if (!result) throw new Error("Expected control missing");
  return result;
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "object") return "props" in node ? text((node as Element).props.children) : "";
  return String(node);
}
function state(): HookState { return { slots: [], cursor: 0, effects: [] }; }
function render(component: (props: any) => ReactNode, props: any, instance: HookState) {
  instance.cursor = 0; instance.effects = []; hooks.active = instance;
  let tree;
  try { tree = component(props); } finally { hooks.active = null; }
  instance.effects.forEach(effect => effect());
  return tree;
}
function hub(section: "settings" | "access" | "notifications" = "settings") {
  const props: ComponentProps<typeof HubSheet> = {
    section, onClose: vi.fn(), onToast: vi.fn(), onRequestMagicLink: vi.fn().mockResolvedValue(undefined),
    onSignOut: vi.fn().mockResolvedValue(undefined), dataMode: "cloud", canManage: true, readOnly: false,
    notifications: [{ id: 1, title: "Training", detail: "New session", age: "Today", kind: "event", read: false }],
    onOpenNotification: vi.fn(), onMarkAllNotificationsRead: vi.fn().mockResolvedValue(undefined), primaryNavigation: null,
  };
  const outer = state(), inner = state();
  return { props, render: () => {
    const tree = render(HubSheet, props, outer);
    const panel = find(tree, element => typeof element.type === "function" && /^(Settings|Access|Notifications)Panel$/.test(element.type.name));
    return render(panel.type as (props: any) => ReactNode, panel.props, inner);
  } };
}
function button(tree: ReactNode, label: string) {
  return find(tree, element => element.type === "button" && text(element.props.children).includes(label));
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
afterEach(() => vi.unstubAllGlobals());

beforeEach(() => {
  vi.clearAllMocks();
  backend.webBillingAvailable.mockReturnValue(true);
  backend.loadNotificationPreferences.mockResolvedValue({ emailEnabled: true, replies: true, mentions: true, reactions: true,
    newPosts: false, adminAnnouncements: true, eventReminders: true, courseUpdates: true, weeklyDigest: false });
  backend.loadMemberAccessSummary.mockResolvedValue({ summary: { allEligibleReady: false, provisionedMembers: 2, eligibleMembers: 3,
    enrolledReady: 2, enrolledMembers: 3, membersNotReady: 1 } });
  backend.loadAccountDeletionRequest.mockResolvedValue(null);
  backend.loadAcademyBillingOverview.mockResolvedValue({ plans: [], subscription: { status: "active", cancelAtPeriodEnd: false,
    currentPeriodEnd: null, planName: "Paid membership", billingType: "subscription" } });
  vi.stubGlobal("window", { setInterval: vi.fn(), clearInterval: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("document", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

describe("offline workspace sheets and events", () => {
  it("starts offline without fetching settings, keeps support and sign-out available", async () => {
    const view = hub(); view.props.readOnly = true;
    const tree = view.render();
    for (const read of [backend.loadMemberAccessSummary, backend.loadNotificationPreferences, backend.loadAccountDeletionRequest, backend.loadAcademyBillingOverview]) {
      expect(read).not.toHaveBeenCalled();
    }
    expect(text(tree)).toContain("Connect again to load notification preferences");
    const deletion = button(tree, "Request account deletion");
    expect(deletion.props.disabled).toBe(true); await deletion.props.onClick();
    expect(backend.requestAccountDeletion).not.toHaveBeenCalled();
    expect(find(tree, element => element.type === "a" && element.props.href === "/support.html")).toBeDefined();
    expect(button(tree, "Sign out").props.disabled).toBe(false);
    await button(tree, "Sign out").props.onClick(); expect(view.props.onSignOut).toHaveBeenCalledOnce();
  });

  it("preserves loaded settings offline and guards forced write handlers", async () => {
    const view = hub(); view.render(); await flush();
    view.props.readOnly = true; view.render();
    const tree = view.render();
    expect(text(tree)).toContain("Paid membership");
    expect(text(tree)).toContain("2 of 3 current members ready");
    const toggle = find(tree, element => typeof element.type === "function" && element.props.label === "Email notifications");
    expect(toggle.props.checked).toBe(true); expect(toggle.props.disabled).toBe(true);
    await toggle.props.onChange(false); await button(tree, "Provision 1 missing account").props.onClick();
    await button(tree, "Manage billing").props.onClick();
    expect(backend.saveNotificationPreferences).not.toHaveBeenCalled();
    expect(backend.provisionAcademyMemberAccounts).not.toHaveBeenCalled();
    expect(backend.openAcademyBillingPortal).not.toHaveBeenCalled();
    const membership = find(tree, element => element.type === "a" && element.props.href === "/membership");
    const preventDefault = vi.fn(); membership.props.onClick({ preventDefault }); expect(preventDefault).toHaveBeenCalledOnce();
    expect(backend.loadNotificationPreferences).toHaveBeenCalledOnce();
  });

  it("ignores a cloud read completing after offline and reloads on reconnect", async () => {
    let finish!: (value: any) => void;
    backend.loadNotificationPreferences.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const view = hub(); view.render(); view.props.readOnly = true; view.render();
    finish({ emailEnabled: true }); await flush();
    expect(text(view.render())).toContain("Connect again to load notification preferences");
    view.props.readOnly = false; view.render(); await flush();
    expect(backend.loadNotificationPreferences).toHaveBeenCalledTimes(2);
    expect(find(view.render(), element => typeof element.type === "function" && element.props.label === "Email notifications").props.checked).toBe(true);
  });

  it("keeps an email draft while blocking offline magic-link submission", async () => {
    const view = hub("access"); view.props.readOnly = true;
    find(view.render(), element => element.type === "input").props.onChange({ target: { value: "pilot@example.com" } });
    const offline = view.render();
    expect(button(offline, "Email me a sign-in link").props.disabled).toBe(true);
    await find(offline, element => element.type === "form").props.onSubmit({ preventDefault: vi.fn() });
    expect(view.props.onRequestMagicLink).not.toHaveBeenCalled();
    view.props.readOnly = false;
    const online = view.render(); expect(find(online, element => element.type === "input").props.value).toBe("pilot@example.com");
    await find(online, element => element.type === "form").props.onSubmit({ preventDefault: vi.fn() });
    expect(view.props.onRequestMagicLink).toHaveBeenCalledExactlyOnceWith("pilot@example.com");
  });

  it("blocks mark-all-read offline without blocking loaded notification navigation", async () => {
    const view = hub("notifications"); view.props.readOnly = true;
    const tree = view.render(); const all = button(tree, "Mark all read");
    expect(all.props.disabled).toBe(true); await all.props.onClick();
    expect(view.props.onMarkAllNotificationsRead).not.toHaveBeenCalled();
    button(tree, "Training").props.onClick(); expect(view.props.onOpenNotification).toHaveBeenCalledOnce();
  });

  it("guards offline RSVP against optimistic updates and backend calls, then permits it online", async () => {
    const props: ComponentProps<typeof EventsView> = { events: [{ id: 1, title: "Future training", description: "Training details", host: "Trainer",
      date: "Oct 9", time: "9:00 AM", duration: "60 min", kind: "workshop", attendeeCount: 2, attending: false,
      startsAt: "2099-10-09T09:00:00Z", endsAt: "2099-10-09T10:00:00Z" }], onEventsChange: vi.fn(),
      onToggleRsvp: vi.fn().mockResolvedValue(true), onToast: vi.fn(), readOnly: true };
    const instance = state(); const offline = render(EventsView, props, instance);
    expect(button(offline, "RSVP").props.disabled).toBe(true); await button(offline, "RSVP").props.onClick();
    expect(props.onEventsChange).not.toHaveBeenCalled(); expect(props.onToggleRsvp).not.toHaveBeenCalled();
    props.readOnly = false; await button(render(EventsView, props, instance), "RSVP").props.onClick(); await flush();
    expect(props.onToggleRsvp).toHaveBeenCalledOnce();
    expect(props.onEventsChange).toHaveBeenCalledWith([expect.objectContaining({ attending: true, attendeeCount: 3 })]);
  });
});
