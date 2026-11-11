import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WebNavigation } from "./WebNavigation";
import { Upgrades } from "./Upgrades";

const platform = vi.hoisted(() => ({ native: false }));
vi.mock("../lib/backend", () => ({ supabase: null }));
vi.mock("@capacitor/core", async importOriginal => {
  const actual = await importOriginal<typeof import("@capacitor/core")>();
  return { ...actual, Capacitor: { ...actual.Capacitor, isNativePlatform: () => platform.native } };
});
const props = { activeView: "home" as const, canManage: false, onNavigate: () => true, onMeasure: () => undefined, onOpenSettings: () => undefined };

describe("web navigation and upgrades boundaries", () => {
  it("does not expose the admin destination without manager access", () => {
    expect(renderToStaticMarkup(<WebNavigation {...props} />)).not.toContain("Admin Studio");
    expect(renderToStaticMarkup(<WebNavigation {...props} canManage />)).toContain("Admin Studio");
  });
  it("offers native store memberships without exposing Stripe checkout links", () => {
    platform.native = true;
    const nativeMemberships = renderToStaticMarkup(<Upgrades />);
    expect(nativeMemberships).toContain("Choose your memberships");
    expect(nativeMemberships).toContain("Subscribe to Turf Scanner");
    expect(nativeMemberships).not.toContain("stripe.com");
    expect(nativeMemberships).not.toContain('href="/membership');
    const markup = renderToStaticMarkup(<WebNavigation {...props} />);
    expect(markup).toContain("Mobile app navigation");
    expect(markup).toContain("Memberships &amp; Upgrades");
    expect(markup).toContain("Grow your business");
    expect(markup).not.toContain("href=");
    platform.native = false;
  });
  it("marks Scanner as the current destination and disables navigation while saving", () => {
    const markup = renderToStaticMarkup(<WebNavigation {...props} activeSection="scanner" disabled />);
    const activeButtons = [...markup.matchAll(/<button[^>]*aria-current="page"[^>]*>(.*?)<\/button>/gs)];
    expect(activeButtons).toHaveLength(2);
    expect(activeButtons.every(button => button[1].includes("Turf Scanner"))).toBe(true);
    expect(markup.match(/<button(?![^>]*disabled)/g)).toBeNull();
  });
  it("shows the agreed separate options without activating checkout or an autocharging trial", () => {
    const html = renderToStaticMarkup(<Upgrades />);
    expect(html).toContain("$19.99");
    expect(html.match(/\$24\.95/g)).toHaveLength(2);
    expect(html.match(/\$195\.95/g)).toHaveLength(2);
    expect(html.match(/\$49\.95/g)).toHaveLength(2);
    expect(html).toContain("no automatic charge");
    expect(html).toContain("New enrollment is being prepared");
    expect(html).not.toContain('href="/membership');
  });
});
