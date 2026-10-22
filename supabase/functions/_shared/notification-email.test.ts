import { describe, expect, it } from "vitest";
import {
  buildAcademyEmail,
  buildNotificationPreferenceStatus,
  buildUnsubscribeConfirmation,
  createUnsubscribeToken,
  preferenceForTemplate,
  verifyUnsubscribeToken,
} from "./notification-email";

const delivery = {
  id: "20d2150b-d932-4a52-a4df-2bc2129ab681",
  recipient_member_id: "040589dc-6e6f-4cf5-a907-451941274aff",
  recipient_email: "member@example.com",
  recipient_name: "Taylor Cleaner",
  template_key: "new_post",
  title: "Steve <script>alert(1)</script> published a new post",
  detail: "How to price a 1,200 sq ft restoration",
  target_type: "post",
  target_id: "6f9f785c-1a96-42bb-ad8c-b4f2b93c4ced",
  payload: { actorName: "Steve & Team", communityName: "7 Figure Turf Cleaning" },
  idempotency_key: "post:1:new_post:member:1",
};

describe("Academy notification email", () => {
  it("builds a branded deep link and escapes imported content", () => {
    const email = buildAcademyEmail(delivery, {
      appUrl: "https://app.dirtyturf.com",
      unsubscribeUrl: "https://example.supabase.co/functions/v1/academy-notifications/unsubscribe?token=signed",
    });

    expect(email.subject).toBe("Steve & Team posted in 7 Figure Turf Cleaning");
    expect(email.actionUrl).toContain("view=community");
    expect(email.actionUrl).toContain(encodeURIComponent(delivery.target_id));
    expect(email.html).not.toContain("<script>alert(1)</script>");
    expect(email.html).toContain("Dirty Turf");
    // Mailgun must preserve native app links and the signed unsubscribe URL.
    const links = email.html.match(/<a\s[^>]+>/g) ?? [];
    expect(links).toHaveLength(3);
    expect(links.every((link) => link.includes('disable-tracking="true"'))).toBe(true);
    expect(email.text).toContain("Unsubscribe from this type of email");
  });

  it("maps every notification template to its preference", () => {
    expect(preferenceForTemplate("reply")).toBe("replies");
    expect(preferenceForTemplate("post_reaction")).toBe("reactions");
    expect(preferenceForTemplate("new_course")).toBe("course_updates");
    expect(preferenceForTemplate("announcement")).toBe("admin_announcements");
  });

  it("signs, verifies, rejects tampering, and expires unsubscribe tokens", async () => {
    const secret = "a-long-test-signing-secret";
    const expiresAt = Date.now() + 60_000;
    const token = await createUnsubscribeToken(delivery.recipient_member_id, "new_posts", secret, expiresAt);
    expect(await verifyUnsubscribeToken(token, secret)).toMatchObject({
      memberId: delivery.recipient_member_id,
      preference: "new_posts",
      expiresAt,
    });
    const tamperedToken = `${token.slice(0, -1)}${token.endsWith("x") ? "y" : "x"}`;
    expect(await verifyUnsubscribeToken(tamperedToken, secret)).toBeNull();
    expect(await verifyUnsubscribeToken(token, secret, expiresAt + 1)).toBeNull();
    expect(await verifyUnsubscribeToken(token, secret, expiresAt)).toBeNull();
    expect(await verifyUnsubscribeToken("x".repeat(1025), secret)).toBeNull();
  });

  it("opens the Academy for welcome without promising paid tool access", () => {
    const email = buildAcademyEmail({ ...delivery, template_key: "welcome", target_type: "community" }, { appUrl: "https://app.dirtyturf.com", unsubscribeUrl: "https://example.test/unsubscribe" });
    expect(new URL(email.actionUrl).searchParams.get("view")).toBe("learn");
    expect(email.text).toContain("Optional courses and tools depend on your account access.");
    expect(email.text).not.toContain("use the field tools");
  });

  it.each(["group_payment_received", "group_subscription_cancelled", "course_subscription_cancelled"])("routes %s to billing even after course/community access ends", template => {
    const email = buildAcademyEmail({ ...delivery, template_key: template, target_type: "course" }, { appUrl: "https://app.dirtyturf.com", unsubscribeUrl: "https://example.test/unsubscribe" });
    expect(email.actionUrl).toBe("https://app.dirtyturf.com/billing");
  });

  it.each(["comment", "reply", "mention", "comment_reaction"])("links %s to the exact parent post and comment", template => {
    const commentId = "abc55555-abcd-4abc-8abc-111111111111";
    const email = buildAcademyEmail({ ...delivery, template_key: template, payload: { ...delivery.payload, commentId } }, { appUrl: "https://app.dirtyturf.com", unsubscribeUrl: "https://example.test/unsubscribe" });
    const url = new URL(email.actionUrl);
    expect(url.searchParams.get("view")).toBe("community");
    expect(url.searchParams.get("post")).toBe(delivery.target_id);
    expect(url.searchParams.get("comment")).toBe(commentId);
    const invalid = buildAcademyEmail({ ...delivery, template_key: template, payload: { commentId: "javascript:bad" } }, { appUrl: "https://app.dirtyturf.com", unsubscribeUrl: "https://example.test/unsubscribe" });
    expect(new URL(invalid.actionUrl).searchParams.has("comment")).toBe(false);
  });

  it("keeps unsubscribe confirmation and errors on brand and escapes their inputs", () => {
    const confirmation = buildUnsubscribeConfirmation('token"><script>bad</script>', 'Comments <script>bad</script>', "https://app.dirtyturf.com");
    const status = buildNotificationPreferenceStatus("<script>bad</script>", 'Private "example"');
    for (const html of [confirmation, status]) {
      expect(html).toContain("/dirty-turf-logo.png");
      expect(html).toContain("poppins-latin-400-normal.woff2");
      expect(html).toContain("outfit-latin-700-normal.woff2");
      expect(html).toContain("#003113"); expect(html).toContain("#047631"); expect(html).toContain("#78c12e");
      expect(html).not.toContain("<script>");
      expect(html).toContain('name="viewport"');
    }
    expect(confirmation).toContain('<form method="post">');
    expect(confirmation).toContain('name="token"');
    expect(status).toContain("panel=settings&amp;section=notifications");
  });
});

describe("Community email parity", () => {
  const options = { appUrl: "https://app.dirtyturf.com", unsubscribeUrl: "https://example.com/unsubscribe" };
  const event = { ...delivery, template_key: "new_event", title: "New event", detail: "Turf Clean call", target_type: "event", payload: {
    eventTitle: "Turf Clean call", communityName: "7 Figure Turf Cleaning", startsAt: "2026-09-27T20:00:00Z", endsAt: "2026-09-27T21:00:00Z", timezone: "America/Phoenix", meetingUrl: "https://example.com/meeting", hoursBefore: 24,
  } };
  it("replicates launch subject, registration, event date, local time and location", () => {
    const email = buildAcademyEmail(event, options);
    expect(email.subject).toBe("Register Now: Turf Clean call just Launched! 🎉");
    expect(email.text).toContain("Sunday, September 27, 2026");
    expect(email.text).toContain("1:00 PM – 2:00 PM (America/Phoenix)");
    expect(email.text).toContain("Location: https://example.com/meeting");
    expect(email.text).toContain("Register: https://app.dirtyturf.com/");
    expect(email.actionUrl).toContain("view=events");
  });
  it("renders valid one-hour reminders and uses UTC for invalid timezone", () => {
    const email = buildAcademyEmail({ ...event, template_key: "event_reminder", payload: { ...event.payload, hoursBefore: 1, timezone: "Not/AZone" } }, options);
    expect(email.html).toContain("begins in 1 hour");
    expect(email.text).toContain("(UTC)");
  });
  it("omits unsafe meeting URLs and cancelled meeting links", () => {
    const unsafe = buildAcademyEmail({ ...event, payload: { ...event.payload, meetingUrl: 'javascript:alert("x")' } }, options);
    expect(unsafe.html).not.toContain("javascript:");
    const cancelled = buildAcademyEmail({ ...event, template_key: "event_cancelled" }, options);
    expect(cancelled.html).not.toContain("https://example.com/meeting");
    expect(cancelled.actionUrl).not.toContain("event=");
  });
  it("escapes community content excerpts", () => {
    const email = buildAcademyEmail({ ...delivery, payload: { excerpt: '<img src=x onerror="alert(1)">' } }, options);
    expect(email.html).toContain("&lt;img");
    expect(email.html).not.toContain("<img src=x");
    expect(email.html).not.toContain('onerror="alert(1)"');
  });
  it("maps lifecycle, event and lesson emails to their preference and unsubscribe sets", async () => {
    const { templatesForPreference, lifecycleEmailTemplates } = await import("./notification-email");
    for (const template of ["new_event", "event_reminder", "event_updated", "event_cancelled", "event_rsvp"]) {
      expect(preferenceForTemplate(template)).toBe("event_reminders");
      expect(templatesForPreference("event_reminders")).toContain(template);
    }
    for (const template of ["new_course", "course_unlocked", "lesson_published", "course_certificate"]) {
      expect(preferenceForTemplate(template)).toBe("course_updates");
      expect(templatesForPreference("course_updates")).toContain(template);
    }
    for (const template of Object.keys(lifecycleEmailTemplates)) {
      expect(templatesForPreference(preferenceForTemplate(template))).toContain(template);
      const email = buildAcademyEmail({ ...delivery, template_key: template }, options);
      expect(email.html).toContain("Unsubscribe");
      expect(email.text).not.toContain("There is an update waiting");
    }
    expect(templatesForPreference("admin_announcements")).not.toContain("mention_everyone_post");
  });
});
