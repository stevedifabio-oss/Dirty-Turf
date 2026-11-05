import { useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { BookOpen, CalendarDays, ChevronDown, CreditCard, Home, Menu, Ruler, Settings2, ShieldCheck, TrendingUp, Users } from "lucide-react";
import type { PrimaryNavigationView } from "./PrimaryNavigation";
import "./WebNavigation.css";

type Props = {
  activeView: PrimaryNavigationView;
  canManage: boolean;
  onNavigate: (view: PrimaryNavigationView) => boolean | void;
  onMeasure: () => void;
  onOpenSettings: () => void;
  activeSection?: "scanner" | "settings";
  disabled?: boolean;
};

export function WebNavigation({ activeView, canManage, onNavigate, onMeasure, onOpenSettings, activeSection, disabled = false }: Props) {
  const native = Capacitor.isNativePlatform();
  const dropdown = useRef<HTMLDetailsElement>(null);
  const close = () => { if (dropdown.current) dropdown.current.open = false; };
  const navigate = (view: PrimaryNavigationView) => { if (onNavigate(view) !== false) close(); };
  const destinations = [
    { view: "home" as const, label: "Dashboard", Icon: Home },
    { view: "learn" as const, label: "Academy", Icon: BookOpen },
    { view: "community" as const, label: "Community", Icon: Users },
    { view: "events" as const, label: "Events", Icon: CalendarDays },
    { view: "upgrades" as const, label: "Memberships & Upgrades", Icon: CreditCard },
    { view: "grow" as const, label: "Grow your business", Icon: TrendingUp },
    ...(canManage ? [{ view: "admin" as const, label: "Admin Studio", Icon: ShieldCheck }] : []),
  ];
  const items = () => <>
    {destinations.map(({ view, label, Icon }) => <button type="button" disabled={disabled} key={view} aria-current={!activeSection && activeView === view ? "page" : undefined} onClick={() => navigate(view)}><Icon size={17} /><span>{label}</span></button>)}
    <button type="button" disabled={disabled} aria-current={activeSection === "scanner" ? "page" : undefined} onClick={() => { onMeasure(); close(); }}><Ruler size={17} /><span>Turf Scanner</span></button>
    <button type="button" disabled={disabled} aria-current={activeSection === "settings" ? "page" : undefined} onClick={() => { onOpenSettings(); close(); }}><Settings2 size={17} /><span>Settings</span></button>
  </>;
  return <div className="web-navigation">
    <nav className="web-desktop-links" aria-label={native ? "App navigation" : "Website navigation"}>{items()}</nav>
    <details className="web-mobile-dropdown" ref={dropdown} onKeyDown={event => {
      if (event.key === "Escape" && dropdown.current?.open) {
        event.preventDefault();
        event.stopPropagation();
        close();
        dropdown.current.querySelector("summary")?.focus();
      }
    }}>
      <summary><Menu size={19} /><span>Menu <small>{activeSection ? { scanner: "Turf Scanner", settings: "Settings" }[activeSection] : destinations.find(item => item.view === activeView)?.label}</small></span><ChevronDown size={18} /></summary>
      <nav aria-label={native ? "Mobile app navigation" : "Mobile website navigation"}>{items()}</nav>
    </details>
  </div>;
}
