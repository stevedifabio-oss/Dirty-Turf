import { ArrowUpRight, BookOpen, CalendarDays, CheckCircle2, Users } from "lucide-react";

type Props = {
  kind: "courses" | "community" | "events";
  url: string;
};

const portalCopy = {
  courses: {
    eyebrow: "Dirty Turf Academy",
    title: "Course library",
    action: "Open course library",
    icon: BookOpen,
    items: ["Courses", "Resources", "Progress"],
  },
  community: {
    eyebrow: "7 Figure Turf Cleaning",
    title: "Member community",
    action: "Open community",
    icon: Users,
    items: ["Discussion", "Members", "Leaderboards"],
  },
  events: {
    eyebrow: "Dirty Turf Academy",
    title: "Live events",
    action: "Open event calendar",
    icon: CalendarDays,
    items: ["Sessions", "RSVPs", "Replays"],
  },
};

export function GhlPortalView({ kind, url }: Props) {
  const copy = portalCopy[kind];
  const PortalIcon = copy.icon;

  return (
    <div className="view-content live-portal-view">
      <section className={`portal-launch portal-launch-${kind}`}>
        <header className="portal-launch-brand">
          <img src="/dirty-turf-logo.png" alt="Dirty Turf" />
          <span><i /> Live in HighLevel</span>
        </header>
        <div className="portal-launch-icon"><PortalIcon size={30} /></div>
        <p>{copy.eyebrow}</p>
        <h2>{copy.title}</h2>
        <div className="portal-highlights" aria-label={`${copy.title} sections`}>
          {copy.items.map((item) => <span key={item}><CheckCircle2 size={14} />{item}</span>)}
        </div>
        <a className="portal-primary-action" href={url} target="_blank" rel="noopener noreferrer">
          {copy.action}<ArrowUpRight size={18} />
        </a>
      </section>
      <div className="portal-boundary"><span>HighLevel is the live source</span><small>Native rebuild planned</small></div>
    </div>
  );
}
