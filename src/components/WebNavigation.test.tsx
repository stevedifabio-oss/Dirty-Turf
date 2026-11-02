import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WebNavigation } from "./WebNavigation";
import { Upgrades } from "./Upgrades";

const platform = vi.hoisted(() => ({ native: false }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => platform.native } }));
const props = { activeView: "home" as const, canManage: false, onNavigate: () => true, onMeasure: () => undefined, onOpenSettings: () => undefined };

describe("web navigation and upgrades boundaries", () => {
  it("does not expose the admin destination without manager access", () => {
    expect(renderToStaticMarkup(<WebNavigation {...props} />)).not.toContain("Admin Studio");
    expect(renderToStaticMarkup(<WebNavigation {...props} canManage />)).toContain("Admin Studio");
  });
  it("does not offer purchases or enrollment on native platforms", () => {
    platform.native = true;
    expect(renderToStaticMarkup(<Upgrades />)).toBe("");
    const markup = renderToStaticMarkup(<WebNavigation {...props} />);
    expect(markup).toContain("Mobile app navigation");
    expect(markup).not.toContain("Memberships &amp; Upgrades");
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
