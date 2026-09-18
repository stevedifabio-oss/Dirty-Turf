export const emailPreferenceKeys = [
  "replies",
  "mentions",
  "reactions",
  "event_reminders",
  "weekly_digest",
  "new_posts",
  "course_updates",
  "admin_announcements",
] as const;

export type EmailPreferenceKey = typeof emailPreferenceKeys[number];

export type AcademyEmailDelivery = {
  id: string;
  recipient_member_id: string;
  recipient_email: string;
  recipient_name: string;
  template_key: string;
  title: string;
  detail: string;
  target_type: string | null;
  target_id: string | null;
  payload: Record<string, unknown> | null;
  idempotency_key: string;
};

type EmailOptions = {
  appUrl: string;
  unsubscribeUrl: string;
};

type UnsubscribePayload = {
  version: 1;
  memberId: string;
  preference: EmailPreferenceKey;
  expiresAt: number;
};

export function preferenceForTemplate(templateKey: string): EmailPreferenceKey {
  if (["comment", "reply"].includes(templateKey)) return "replies";
  if (templateKey === "mention") return "mentions";
  if (["post_reaction", "comment_reaction"].includes(templateKey)) return "reactions";
  if (["new_event", "event_reminder"].includes(templateKey)) return "event_reminders";
  if (["new_course", "course_unlocked"].includes(templateKey)) return "course_updates";
  if (templateKey === "weekly_digest") return "weekly_digest";
  if (templateKey === "new_post") return "new_posts";
  return "admin_announcements";
}

export function templatesForPreference(preference: EmailPreferenceKey) {
  const templates: Record<EmailPreferenceKey, string[]> = {
    replies: ["comment", "reply"],
    mentions: ["mention"],
    reactions: ["post_reaction", "comment_reaction"],
    event_reminders: ["new_event", "event_reminder"],
    weekly_digest: ["weekly_digest"],
    new_posts: ["new_post"],
    course_updates: ["new_course", "course_unlocked"],
    admin_announcements: ["welcome", "announcement"],
  };
  return templates[preference];
}

export function buildAcademyEmail(delivery: AcademyEmailDelivery, options: EmailOptions) {
  const payload = delivery.payload ?? {};
  const recipientName = firstName(delivery.recipient_name);
  const actorName = stringValue(payload.actorName, "The Dirty Turf team");
  const communityName = stringValue(payload.communityName, "7 Figure Turf Cleaning");
  const actionUrl = targetUrl(options.appUrl, delivery.target_type, delivery.target_id);
  const content = templateContent(delivery, recipientName, actorName, communityName);
  const subject = cleanHeader(content.subject);
  const safeActionUrl = escapeHtml(actionUrl);
  const safeUnsubscribeUrl = escapeHtml(options.unsubscribeUrl);
  const safeManageUrl = escapeHtml(withQuery(options.appUrl, { panel: "settings", section: "notifications" }));

  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;background:#eef4ea;color:#122218;font-family:Arial,Helvetica,sans-serif">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(content.preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef4ea;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #d8e4d3;border-radius:8px;overflow:hidden">
        <tr><td style="background:#063f24;padding:22px 28px;color:#ffffff">
          <div style="font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#8ee02f">Dirty Turf</div>
          <div style="font-size:22px;font-weight:800;margin-top:4px">Academy &amp; Community</div>
        </td></tr>
        <tr><td style="padding:30px 28px 12px">
          <p style="margin:0 0 12px;font-size:16px;line-height:1.55">Hi ${escapeHtml(recipientName)},</p>
          <h1 style="margin:0 0 14px;font-size:25px;line-height:1.25;color:#063f24">${escapeHtml(content.heading)}</h1>
          <p style="margin:0 0 22px;font-size:16px;line-height:1.6;color:#384b3e">${escapeHtml(content.body)}</p>
          ${delivery.detail ? `<div style="margin:0 0 22px;padding:16px 18px;background:#f4f8f1;border-left:4px solid #62c814;color:#203427;font-size:15px;line-height:1.5">${escapeHtml(delivery.detail)}</div>` : ""}
          <a href="${safeActionUrl}" style="display:inline-block;background:#07833f;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 20px;border-radius:6px">${escapeHtml(content.action)}</a>
        </td></tr>
        <tr><td style="padding:18px 28px 30px">
          <p style="margin:0;font-size:13px;line-height:1.55;color:#66756b">Use the same email address that received this message to sign in. Magic links work on the web, iPhone, and Android app.</p>
        </td></tr>
        <tr><td style="border-top:1px solid #e3ebe0;padding:18px 28px;font-size:12px;line-height:1.6;color:#728078">
          Dirty Turf Academy · <a href="${safeManageUrl}" style="color:#287448">Notification settings</a> · <a href="${safeUnsubscribeUrl}" style="color:#287448">Unsubscribe from this type of email</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    `Hi ${recipientName},`,
    "",
    content.heading,
    content.body,
    delivery.detail,
    "",
    `${content.action}: ${actionUrl}`,
    "",
    `Notification settings: ${withQuery(options.appUrl, { panel: "settings", section: "notifications" })}`,
    `Unsubscribe from this type of email: ${options.unsubscribeUrl}`,
  ].filter((line) => line !== "").join("\n");

  return { subject, html, text, actionUrl };
}

export async function createUnsubscribeToken(
  memberId: string,
  preference: EmailPreferenceKey,
  secret: string,
  expiresAt = Date.now() + 90 * 24 * 60 * 60 * 1000,
) {
  const payload: UnsubscribePayload = { version: 1, memberId, preference, expiresAt };
  const encodedPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await sign(encodedPayload, secret);
  return `${encodedPayload}.${base64UrlEncode(signature)}`;
}

export async function verifyUnsubscribeToken(token: string, secret: string, now = Date.now()) {
  const [encodedPayload, encodedSignature, extra] = token.split(".");
  if (!encodedPayload || !encodedSignature || extra) return null;
  try {
    const key = await importSigningKey(secret);
    const verified = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlDecode(encodedSignature),
      new TextEncoder().encode(encodedPayload),
    );
    if (!verified) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedPayload))) as Partial<UnsubscribePayload>;
    if (
      payload.version !== 1 ||
      typeof payload.memberId !== "string" ||
      !emailPreferenceKeys.includes(payload.preference as EmailPreferenceKey) ||
      typeof payload.expiresAt !== "number" ||
      payload.expiresAt < now
    ) return null;
    return payload as UnsubscribePayload;
  } catch {
    return null;
  }
}

export function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function templateContent(
  delivery: AcademyEmailDelivery,
  recipientName: string,
  actorName: string,
  communityName: string,
) {
  const fallback = {
    subject: delivery.title,
    preheader: delivery.detail || delivery.title,
    heading: delivery.title,
    body: `There is an update waiting for you in ${communityName}.`,
    action: "Open the Academy",
  };
  const templates: Record<string, typeof fallback> = {
    welcome: {
      subject: `Welcome to ${communityName}`,
      preheader: "Your Dirty Turf Academy account is ready.",
      heading: `Welcome to the community, ${recipientName}`,
      body: "Your Academy account is ready. Join the community, continue your courses, and use the field tools from one place.",
      action: "Start learning",
    },
    new_post: {
      subject: `${actorName} posted in ${communityName}`,
      preheader: delivery.detail,
      heading: delivery.title,
      body: `${actorName} started a new discussion in the Academy community.`,
      action: "Read the post",
    },
    announcement: {
      subject: `New Academy announcement: ${delivery.detail || delivery.title}`,
      preheader: delivery.title,
      heading: delivery.detail || delivery.title,
      body: "The Dirty Turf team posted a new Academy announcement.",
      action: "Read the announcement",
    },
    comment: {
      subject: delivery.title,
      preheader: delivery.detail,
      heading: `${actorName} commented on your post`,
      body: "Your discussion has a new response.",
      action: "View the reply",
    },
    reply: {
      subject: delivery.title,
      preheader: delivery.detail,
      heading: `${actorName} replied to your comment`,
      body: "The conversation is continuing in the Academy community.",
      action: "View the conversation",
    },
    mention: {
      subject: delivery.title,
      preheader: delivery.detail,
      heading: `${actorName} mentioned you`,
      body: "You were tagged in an Academy community conversation.",
      action: "See the mention",
    },
    post_reaction: {
      subject: delivery.title,
      preheader: delivery.detail,
      heading: `${actorName} liked your post`,
      body: "Your contribution is getting attention from the community.",
      action: "View your post",
    },
    comment_reaction: {
      subject: delivery.title,
      preheader: delivery.detail,
      heading: `${actorName} liked your comment`,
      body: "A community member appreciated your response.",
      action: "View the conversation",
    },
    new_event: {
      subject: `New Academy event: ${delivery.detail || delivery.title}`,
      preheader: "A new live event has been added.",
      heading: delivery.detail || delivery.title,
      body: "A new live session is on the Academy calendar.",
      action: "View the event",
    },
    event_reminder: {
      subject: delivery.title,
      preheader: "Your Academy event starts tomorrow.",
      heading: delivery.title,
      body: "This is your reminder for an Academy event you marked as going or interested.",
      action: "View event details",
    },
    new_course: {
      subject: `New Academy course: ${delivery.detail || delivery.title}`,
      preheader: "New training is ready in your library.",
      heading: delivery.detail || delivery.title,
      body: "New training is now available in the Dirty Turf Academy.",
      action: "Open the course",
    },
    course_unlocked: {
      subject: `Course unlocked: ${delivery.detail || delivery.title}`,
      preheader: "Your next Academy course is ready.",
      heading: delivery.detail || delivery.title,
      body: "You now have access to the next course in your learning path.",
      action: "Continue learning",
    },
    weekly_digest: {
      subject: "Your week in the Dirty Turf community",
      preheader: delivery.detail,
      heading: "Here is what happened this week",
      body: delivery.detail || "Catch up on the latest Academy discussions.",
      action: "Catch up now",
    },
  };
  return templates[delivery.template_key] ?? fallback;
}

function targetUrl(appUrl: string, targetType: string | null, targetId: string | null) {
  if (targetType === "post" && targetId) return withQuery(appUrl, { view: "community", post: targetId });
  if (targetType === "event" && targetId) return withQuery(appUrl, { view: "events", event: targetId });
  if (targetType === "course" && targetId) return withQuery(appUrl, { view: "learn", course: targetId });
  return withQuery(appUrl, { view: "community" });
}

function withQuery(baseUrl: string, values: Record<string, string>) {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
  return url.toString();
}

function firstName(value: string) {
  return value.trim().split(/\s+/)[0] || "there";
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function cleanHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, 180);
}

async function sign(value: string, secret: string) {
  return new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    await importSigningKey(secret),
    new TextEncoder().encode(value),
  ));
}

function importSigningKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function base64UrlEncode(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
