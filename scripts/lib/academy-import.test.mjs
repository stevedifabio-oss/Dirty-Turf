import { describe, expect, it } from "vitest";
import { cleanCommunityPostBody, composeAcademyImport, isCommunityPostMediaUrl, parseCommunityEvent, parseRelativeTimestamp } from "./academy-import.mjs";

const capturedAt = "2026-09-17T17:00:00.000Z";

function fixture() {
  return {
    courseArchive: {
      commit: false,
      sourceExportedAt: capturedAt,
      community: { externalId: "community-1", name: "Academy", slug: "academy" },
      courses: [{ externalId: "course-1", title: "Course", modules: [{ externalId: "module-1", title: "Module", lessons: [{ externalId: "lesson-1", title: "Lesson" }] }] }],
      progress: [],
      assets: [],
    },
    communityArchive: {
      schemaVersion: "fixture-v1",
      capturedAt,
      source: { locationId: "location-1", communitySlug: "academy", courseProductId: "course-1" },
      summary: { title: "Academy" },
      channels: [{ slug: "general-a", name: "General" }, { slug: "general-b", name: "General" }],
      members: [
        { sourceId: "contact-1", name: "Alex Owner", handle: "alex", role: "admin", joined: "Joined 14 Aug 2026", active: "Active 1 hours ago" },
        { sourceId: "contact-2", name: "Taylor Tech", handle: "taylor", role: "contributor", joined: "Joined 15 Aug 2026", active: "Active 3 days ago" },
      ],
      courseEnrollments: [
        { sourceId: "enrollment-1", email: "alex@example.test", progress: 77, logins: 5, startDate: "2026-08-20 11:38 AM", lastLogin: "2026-09-17 10:31 AM" },
        { sourceId: "enrollment-2", email: "course-only@example.test", progress: 0, logins: 0, startDate: "Not Started", lastLogin: "Never" },
      ],
      posts: [{
        sourceId: "post-1", authorSourceId: "contact-1", author: "Alex Owner", channel: "Posted in General", title: "Welcome", body: "Hello", timestamp: "3d", assets: [], comments: [
          { sourceId: "comment-1", author: "Taylor Tech", handle: "taylor", body: "Thanks", timestamp: "1h" },
          { sourceId: "comment-2", author: "Former Member", handle: "former", body: "Archived", timestamp: "1w" },
        ],
      }],
      events: [{
        sourceId: "event-1", status: "upcoming", title: "Group Call", links: ["https://example.test/meet"],
        rawText: "Group Call\n\n20th Sep 2026\n\n/\n\n8:00 PM - 9:00 PM GMT-5\n\nDescription\n\nQuestions and answers\n\nEntry Fee\n\nFree",
      }],
      leaderboards: { allTime: [{ name: "Alex Owner", points: 42, rank: 1 }] },
    },
    contactReconciliation: {
      locationId: "location-1",
      contacts: [
        { sourceId: "contact-1", email: "alex@example.test", firstName: "Alex", lastName: "Owner" },
        { sourceId: "contact-2", email: "taylor@example.test", firstName: "Taylor", lastName: "Tech" },
      ],
    },
  };
}

describe("Academy import composition", () => {
  it("combines GHL captures without inventing lesson progress, reactions, or RSVPs", () => {
    const { manifest, report } = composeAcademyImport(fixture());
    expect(report.readyForDryRun).toBe(true);
    expect(manifest.categories).toHaveLength(1);
    expect(manifest.members).toHaveLength(4);
    expect(manifest.enrollments).toHaveLength(2);
    expect(manifest.enrollments[0].memberExternalId).toBe("contact-1");
    expect(manifest.enrollments[0].sourceProgressPercent).toBe(77);
    expect(manifest.progress).toEqual([]);
    expect(manifest.reactions).toEqual([]);
    expect(manifest.rsvps).toEqual([]);
    expect(report.reconciliation.historicalContentAuthorCount).toBe(1);
    expect(report.reconciliation.courseOnlyMemberCount).toBe(1);
  });

  it("is deterministic for identical source captures", () => {
    const first = composeAcademyImport(fixture());
    const second = composeAcademyImport(fixture());
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("keeps shared post media while excluding HighLevel avatars and profile links", () => {
    expect(isCommunityPostMediaUrl("https://assetsdrm.clientclub.net/images/communities/location/group/posts/photo.jpeg")).toBe(true);
    expect(isCommunityPostMediaUrl("https://www.instagram.com/reel/example")).toBe(true);
    expect(isCommunityPostMediaUrl("https://assetsdrm.clientclub.net/images/client-portal/location/users/member-id")).toBe(false);
    expect(isCommunityPostMediaUrl("https://assetsdrm.clientclub.net/images/communities/location/profile-avatars/3.webp")).toBe(false);
    expect(isCommunityPostMediaUrl("https://academy.dirtyturf.com/communities/users/member-name")).toBe(false);
    expect(isCommunityPostMediaUrl("javascript:alert(1)")).toBe(false);
  });

  it("removes captured community chrome from post bodies", () => {
    expect(cleanCommunityPostBody("Welcome\n\nUseful post copy.\n\n7\n\n5 Comments\n\nLike\nComment\nShare", "Welcome"))
      .toBe("Useful post copy.");
    expect(cleanCommunityPostBody("Video\n\nhttps://example.test/video\nPlay\nRewind 10s\nForward 10s\n00:34\nMute\nSettings\nPIP\nEnter fullscreen\nPlay\nLike\nComment\nShare", "Video"))
      .toBe("https://example.test/video");
    expect(cleanCommunityPostBody("", "Empty post")).toBe("");
  });

  it("fails closed when reconciled contacts reuse an email", () => {
    const input = fixture();
    input.contactReconciliation.contacts[1].email = "alex@example.test";
    const { report } = composeAcademyImport(input);
    expect(report.readyForDryRun).toBe(false);
    expect(report.errors.some((error) => error.includes("Duplicate reconciled email"))).toBe(true);
  });

  it("parses explicit GMT offsets and relative capture timestamps", () => {
    const event = parseCommunityEvent(fixture().communityArchive.events[0]);
    expect(event.startsAt).toBe("2026-09-21T01:00:00.000Z");
    expect(event.endsAt).toBe("2026-09-21T02:00:00.000Z");
    expect(parseRelativeTimestamp("3d", capturedAt)).toBe("2026-09-14T17:00:00.000Z");
  });

  it("reports an event whose date cannot be verified", () => {
    const input = fixture();
    input.communityArchive.events[0].rawText = "Date coming soon";
    const { report } = composeAcademyImport(input);
    expect(report.readyForDryRun).toBe(false);
    expect(report.errors).toContain("Event event-1 has an unparseable date or time");
  });
});
