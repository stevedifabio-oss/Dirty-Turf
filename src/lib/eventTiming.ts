import type { AcademyEvent } from "../domain";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function validTime(value?: string): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function legacyStart(event: AcademyEvent, now: number): number | null {
  const date = /^(\w{3})\s+(\d{1,2})$/.exec(event.date.trim());
  const time = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(event.time.trim());
  if (!date || !time) return null;
  const month = MONTHS.findIndex((value) => value.toLowerCase() === date[1].toLowerCase());
  const day = Number(date[2]);
  const hour = Number(time[1]) % 12 + (time[3].toUpperCase() === "PM" ? 12 : 0);
  const minute = Number(time[2]);
  if (month < 0 || day < 1 || day > 31 || minute > 59 || Number(time[1]) < 1 || Number(time[1]) > 12) return null;
  const year = new Date(now).getFullYear();
  const candidates = [year - 1, year, year + 1].map((candidateYear) => {
    const parsed = new Date(candidateYear, month, day, hour, minute);
    return parsed.getMonth() === month && parsed.getDate() === day ? parsed.getTime() : null;
  }).filter((value): value is number => value !== null);
  return candidates.sort((left, right) => Math.abs(left - now) - Math.abs(right - now))[0] ?? null;
}

export function academyEventTimes(event: AcademyEvent, now = Date.now()): { start: number; end: number } | null {
  const start = validTime(event.startsAt) ?? legacyStart(event, now);
  if (start === null) return null;
  const durationMinutes = Number.parseInt(event.duration, 10);
  const fallbackEnd = start + (Number.isFinite(durationMinutes) ? Math.max(durationMinutes, 0) : 0) * 60_000;
  const end = validTime(event.endsAt) ?? fallbackEnd;
  return { start, end: Math.max(start, end) };
}

export function academyEventStatus(event: AcademyEvent, now = Date.now()): "upcoming" | "live" | "past" | "unknown" {
  const times = academyEventTimes(event, now);
  if (!times) return "unknown";
  if (times.end <= now) return "past";
  return times.start <= now ? "live" : "upcoming";
}

export function isUpcomingAcademyEvent(event: AcademyEvent, now = Date.now()): boolean {
  return academyEventStatus(event, now) === "upcoming";
}

export function getNextUpcomingEvent(events: AcademyEvent[], now = Date.now()): AcademyEvent | undefined {
  return events.filter((event) => isUpcomingAcademyEvent(event, now))
    .sort((left, right) => academyEventTimes(left, now)!.start - academyEventTimes(right, now)!.start)[0];
}
