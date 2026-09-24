import { BookOpen, Home, Settings2 } from "lucide-react";

export type PrimaryNavigationView = "home" | "learn" | "community" | "events" | "admin";

type PrimaryNavigationProps = {
  activeView: PrimaryNavigationView;
  settingsOpen: boolean;
  onNavigate: (view: PrimaryNavigationView) => void;
  onOpenSettings: () => void;
};

export function PrimaryNavigation({ activeView, settingsOpen, onNavigate, onOpenSettings }: PrimaryNavigationProps) {
  return (
    <footer className="bottom-nav" aria-label="App sections">
      <NavigationItem icon={<BookOpen size={20} />} label="Academy" active={!settingsOpen && activeView !== "home"} onClick={() => onNavigate("learn")} />
      <NavigationItem icon={<Home size={23} />} label="Dashboard" active={!settingsOpen && activeView === "home"} emphasis onClick={() => onNavigate("home")} />
      <NavigationItem icon={<Settings2 size={20} />} label="Settings" active={settingsOpen} onClick={onOpenSettings} />
    </footer>
  );
}

function NavigationItem({ icon, label, active, emphasis = false, onClick }: { icon: React.ReactNode; label: string; active: boolean; emphasis?: boolean; onClick: () => void }) {
  return <button className={`nav-item${active ? " active" : ""}${emphasis ? " emphasis" : ""}`} onClick={onClick} aria-current={active ? "page" : undefined}>{icon}<span>{label}</span></button>;
}
