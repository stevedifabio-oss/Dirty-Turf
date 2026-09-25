import { describe, expect, it } from "vitest";
import type { AcademyEvent } from "../domain";
import { academyEventStatus, getNextUpcomingEvent, isUpcomingAcademyEvent } from "./eventTiming";

const event: AcademyEvent = {
  id: 1, title: "Session", description: "", date: "Sep 22", time: "2:00 PM", duration: "60 min",
  startsAt: "2026-09-22T14:00:00Z", endsAt: "2026-09-22T15:00:00Z",
  host: "Steve", kind: "live", attending: false, attendeeCount: 0,
};

describe("academy event timing", () => {
  it("distinguishes upcoming, live, and past from source timestamps", () => {
    expect(academyEventStatus(event, Date.parse("2026-09-22T13:59:00Z"))).toBe("upcoming");
    expect(academyEventStatus(event, Date.parse("2026-09-22T14:30:00Z"))).toBe("live");
    expect(academyEventStatus(event, Date.parse("2026-09-22T15:00:00Z"))).toBe("past");
  });

  it("never presents a past or live event as the next event", () => {
    const now = Date.parse("2026-09-23T00:00:00Z");
    const later = { ...event, id: 2, startsAt: "2026-09-25T14:00:00Z", endsAt: "2026-09-25T15:00:00Z" };
    const sooner = { ...event, id: 3, startsAt: "2026-09-24T14:00:00Z", endsAt: "2026-09-24T15:00:00Z" };
    expect(isUpcomingAcademyEvent(event, now)).toBe(false);
    expect(getNextUpcomingEvent([event, later, sooner], now)?.id).toBe(3);
  });

  it("handles legacy cached events and rejects unknown dates", () => {
    const legacy = { ...event, startsAt: undefined, endsAt: undefined };
    expect(academyEventStatus(legacy, new Date(2026, 8, 23).getTime())).toBe("past");
    expect(academyEventStatus({ ...legacy, date: "invalid" })).toBe("unknown");
  });
});
