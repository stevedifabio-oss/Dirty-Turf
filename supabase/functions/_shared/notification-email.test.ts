import { describe, expect, it } from "vitest";
import {
  buildAcademyEmail,
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
  });
});
