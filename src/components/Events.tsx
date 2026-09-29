import { useEffect, useRef, useState } from "react";
import { CalendarDays, Check, Clock3, ExternalLink, Radio, Users } from "lucide-react";
import type { AcademyEvent } from "../domain";
import { academyEventStatus } from "../lib/eventTiming";

type Props = {
  events: AcademyEvent[];
  requestedEventCloudId?: string;
  onRequestedEventOpened?: () => void;
  onEventsChange: (events: AcademyEvent[]) => void;
  onToggleRsvp: (event: AcademyEvent) => Promise<boolean | null>;
  onToast: (message: string) => void;
};

export function EventsView({ events, requestedEventCloudId, onRequestedEventOpened, onEventsChange, onToggleRsvp, onToast }: Props) {
  const [now, setNow] = useState(Date.now);
  const requestedEventRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!requestedEventCloudId || !requestedEventRef.current) return;
    requestedEventRef.current.scrollIntoView({ block: "center" });
    requestedEventRef.current.focus({ preventScroll: true });
    onRequestedEventOpened?.();
  }, [requestedEventCloudId, events, onRequestedEventOpened]);
  useEffect(() => {
    const updateTime = () => setNow(Date.now());
    const timer = window.setInterval(updateTime, 1000);
    window.addEventListener("focus", updateTime);
    document.addEventListener("visibilitychange", updateTime);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", updateTime);
      document.removeEventListener("visibilitychange", updateTime);
    };
  }, []);
  const toggleRsvp = async (event: AcademyEvent) => {
    if (academyEventStatus(event) !== "upcoming") return;
    const nextAttending = !event.attending;
    const nextCount = Math.max(0, event.attendeeCount + (nextAttending ? 1 : -1));
    onEventsChange(events.map((item) => item.id === event.id ? { ...item, attending: nextAttending, attendeeCount: nextCount } : item));
    try {
      const cloudValue = await onToggleRsvp(event);
      if (cloudValue !== null && cloudValue !== nextAttending) {
        const reconciledCount = Math.max(0, event.attendeeCount + (cloudValue === event.attending ? 0 : cloudValue ? 1 : -1));
        onEventsChange(events.map((item) => item.id === event.id ? { ...item, attending: cloudValue, attendeeCount: reconciledCount } : item));
      }
      onToast(nextAttending ? "You are attending." : "RSVP removed.");
    } catch {
      onEventsChange(events);
      onToast("RSVP could not be saved.");
    }
  };

  return (
    <div className="view-content events-view">
      <section className="events-intro">
        <span><CalendarDays size={24} /></span>
        <div><p className="kicker">Academy calendar</p><h2>Live training and operator sessions</h2></div>
      </section>
      <section className="event-list">
        {events.map((event) => {
          const status = academyEventStatus(event, now);
          const requested = event.cloudId === requestedEventCloudId && Boolean(requestedEventCloudId);
          return <article className={requested ? "event-card requested-event" : "event-card"} key={event.id} ref={requested ? requestedEventRef : undefined} tabIndex={requested ? -1 : undefined} aria-label={requested ? `Selected event: ${event.title}` : undefined}>
          <div className="event-date"><strong>{event.date.split(" ")[1]}</strong><span>{event.date.split(" ")[0]}</span></div>
          <div className="event-content">
            <span className="event-kind"><Radio size={13} /> {status === "past" ? "Past session" : status === "live" ? "Live now" : event.kind.replace("-", " ")}</span>
            <h3>{event.title}</h3>
            <p>{event.description}</p>
            <div className="event-meta"><span><Clock3 size={14} /> {event.time} · {event.duration}</span><span><Users size={14} /> {event.attendeeCount} attending</span></div>
            <div className="event-actions">
              {status === "upcoming" && <button className={event.attending ? "secondary-button attending" : "primary-button"} onClick={() => void toggleRsvp(event)}>{event.attending && <Check size={16} />}{event.attending ? "Attending" : "RSVP"}</button>}
              {status === "live" && <span className="event-status-note">{event.attending ? "You're attending" : "Registration closed"}</span>}
              {status === "live" && event.attending && event.meetingUrl && <a className="secondary-button" href={event.meetingUrl} target="_blank" rel="noopener noreferrer">Join <ExternalLink size={15} /></a>}
              {status === "past" && <span className="event-status-note">Session ended</span>}
              {status === "unknown" && <span className="event-status-note">Schedule unavailable</span>}
            </div>
          </div>
        </article>})}
      </section>
      {events.length === 0 && <div className="empty-state"><CalendarDays size={24} /><h3>No sessions scheduled</h3><p>New Academy events will appear here as soon as they are published.</p></div>}
    </div>
  );
}
