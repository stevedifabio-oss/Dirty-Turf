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
  if (["mention", "mention_everyone_post", "mention_everyone_comment"].includes(templateKey)) return "mentions";
  if (["post_reaction", "comment_reaction"].includes(templateKey)) return "reactions";
  if (["new_event", "event_reminder", "event_updated", "event_cancelled", "event_rsvp"].includes(templateKey)) return "event_reminders";
  if (["new_course", "course_unlocked", "course_certificate", "lesson_published"].includes(templateKey)) return "course_updates";
  if (templateKey === "weekly_digest") return "weekly_digest";
  if (templateKey === "new_post") return "new_posts";
  return "admin_announcements";
}

export function templatesForPreference(preference: EmailPreferenceKey) {
  const templates: Record<EmailPreferenceKey, string[]> = {
    replies: ["comment", "reply"],
    mentions: ["mention", "mention_everyone_post", "mention_everyone_comment"],
    reactions: ["post_reaction", "comment_reaction"],
    event_reminders: ["new_event", "event_reminder", "event_updated", "event_cancelled", "event_rsvp"],
    weekly_digest: ["weekly_digest"],
    new_posts: ["new_post"],
    course_updates: ["new_course", "course_unlocked", "course_certificate", "lesson_published"],
    admin_announcements: ["welcome", "announcement", ...Object.keys(lifecycleEmailTemplates).filter(key => !key.startsWith("mention_everyone_"))],
  };
  return templates[preference];
}

export function buildAcademyEmail(delivery: AcademyEmailDelivery, options: EmailOptions) {
  const payload = delivery.payload ?? {};
  const recipientName = firstName(delivery.recipient_name);
  const actorName = stringValue(payload.actorName, "The Dirty Turf team");
  const communityName = stringValue(payload.communityName, "7 Figure Turf Cleaning");
  const actionUrl = delivery.template_key === "event_cancelled"
    ? withQuery(options.appUrl, { view: "events" })
    : targetUrl(options.appUrl, delivery.target_type, delivery.target_id);
  const content = templateContent(delivery, recipientName, actorName, communityName);
  const eventDetails = buildEventDetails(delivery);
  const excerpt = stringValue(payload.excerpt, "").slice(0, 500);
  const subject = cleanHeader(content.subject);
  const safeActionUrl = escapeHtml(actionUrl);
  const safeUnsubscribeUrl = escapeHtml(options.unsubscribeUrl);
  const safeManageUrl = escapeHtml(withQuery(options.appUrl, { panel: "settings", section: "notifications" }));

  const logoUrl = escapeHtml(new URL("/dirty-turf-logo.png", options.appUrl).href);
  const fontUrl = (file: string) => escapeHtml(new URL(`/email-assets/${file}`, options.appUrl).href);
  const bodyFont = "'Poppins',Arial,Helvetica,sans-serif";
  const headingFont = "'Outfit','Poppins',Arial,Helvetica,sans-serif";

  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title>
<!--[if !mso]><!--><style>
@font-face{font-family:'Poppins';font-style:normal;font-weight:400;src:url('${fontUrl("poppins-latin-400-normal.woff2")}') format('woff2')}
@font-face{font-family:'Poppins';font-style:normal;font-weight:700;src:url('${fontUrl("poppins-latin-700-normal.woff2")}') format('woff2')}
@font-face{font-family:'Outfit';font-style:normal;font-weight:700;src:url('${fontUrl("outfit-latin-700-normal.woff2")}') format('woff2')}
</style><!--<![endif]-->
<!--[if mso]><style>body,table,td,p,a,h1,div{font-family:Arial,Helvetica,sans-serif !important}</style><![endif]-->
</head>
<body style="margin:0;background:#f4faee;color:#111f14;font-family:${bodyFont}">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(content.preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4faee;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-family:${bodyFont};max-width:620px;background:#ffffff;border:1px solid #e8f5d0;border-radius:8px;overflow:hidden">
        <tr><td style="background:#003113;padding:24px 28px;color:#ffffff;border-bottom:4px solid #78c12e">
          <img src="${logoUrl}" alt="Dirty Turf" width="224" height="97" style="display:block;width:224px;max-width:100%;height:auto;border:0;color:#ffffff;font-size:24px;font-weight:700">
          <div style="font-family:${headingFont};font-size:20px;font-weight:700;line-height:1.3;margin-top:14px">Academy &amp; Community</div>
        </td></tr>
        <tr><td style="padding:30px 28px 12px">
          <p style="margin:0 0 12px;font-size:16px;line-height:1.55">Hi ${escapeHtml(recipientName)},</p>
          <h1 style="font-family:${headingFont};font-weight:700;margin:0 0 14px;font-size:25px;line-height:1.25;color:#003113">${escapeHtml(content.heading)}</h1>
          <p style="margin:0 0 22px;font-size:16px;line-height:1.6;color:#3d5c44">${escapeHtml(content.body)}</p>
          ${delivery.detail ? `<div style="margin:0 0 22px;padding:16px 18px;background:#f4faee;border-left:4px solid #78c12e;color:#111f14;font-size:15px;line-height:1.5">${escapeHtml(delivery.detail)}</div>` : ""}
          ${excerpt ? `<p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#3d5c44">${escapeHtml(excerpt)}</p>` : ""}
          ${eventDetails.html}
          <a href="${safeActionUrl}" style="display:inline-block;background:#047631;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 20px;border-radius:6px">${escapeHtml(content.action)}</a>
        </td></tr>
        <tr><td style="padding:18px 28px 30px">
          <p style="margin:0;font-size:13px;line-height:1.55;color:#3d5c44">Use the same email address that received this message to sign in. Magic links work on the web, iPhone, and Android app.</p>
        </td></tr>
        <tr><td style="border-top:1px solid #e8f5d0;padding:18px 28px;font-size:12px;line-height:1.6;color:#3d5c44">
          Dirty Turf Academy · <a href="${safeManageUrl}" style="color:#035f27">Notification settings</a> · <a href="${safeUnsubscribeUrl}" style="color:#035f27">Unsubscribe from this type of email</a>
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
    excerpt,
    eventDetails.text,
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
    const payloadBytes = base64UrlDecode(encodedPayload);
    const signatureBytes = base64UrlDecode(encodedSignature);
    if (
      base64UrlEncode(payloadBytes) !== encodedPayload
      || base64UrlEncode(signatureBytes) !== encodedSignature
    ) return null;
    const key = await importSigningKey(secret);
    const verified = await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes,
      new TextEncoder().encode(encodedPayload),
    );
    if (!verified) return null;
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as Partial<UnsubscribePayload>;
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
      subject: `Register Now: ${stringValue(delivery.payload?.eventTitle, delivery.detail || delivery.title)} just Launched! 🎉`,
      preheader: "A new live event has been added.",
      heading: delivery.detail || delivery.title,
      body: `Exciting news! A new event is now open for registration in "${communityName}". Secure your spot — we would love to see you there.`,
      action: "Register",
    },
    event_reminder: {
      subject: delivery.title,
      preheader: `Your Academy event begins in ${delivery.payload?.hoursBefore === 1 ? "1 hour" : "24 hours"}.`,
      heading: delivery.title,
      body: "This is your reminder for an Academy event you marked as going or interested.",
      action: "View Event",
    },
    event_updated: {
      subject: delivery.title, preheader: "The event details have changed.", heading: delivery.title,
      body: "An event you are following has been updated. Please review the latest date, time, and location below.", action: "View Event",
    },
    event_cancelled: {
      subject: delivery.title, preheader: "This event has been cancelled.", heading: delivery.title,
      body: "This event will no longer take place. Check the Academy calendar for other upcoming sessions.", action: "Open the calendar",
    },
    event_rsvp: {
      subject: delivery.title, preheader: "Your event preference is saved.", heading: delivery.title,
      body: delivery.payload?.rsvpStatus === "going" ? "Your registration is confirmed. Here are your event details." : "You marked this event as interested. Here are the details.", action: "View Event",
    },
    course_certificate: {
      subject: delivery.title, preheader: "Your course certificate is ready.", heading: delivery.title,
      body: "You have completed the required course work. Open the course to view your certificate.", action: "Open course",
    },
    lesson_published: { subject: delivery.title, preheader: delivery.detail, heading: delivery.title, body: "A new lesson is ready in your course. Your existing progress is saved.", action: "Open course" },
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
  const lifecycle = lifecycleEmailTemplates[delivery.template_key];
  if (lifecycle) return { ...fallback, subject: delivery.title, heading: delivery.title, body: lifecycle.body, action: lifecycle.action };
  return templates[delivery.template_key] ?? fallback;
}

function targetUrl(appUrl: string, targetType: string | null, targetId: string | null) {
  if (targetType === "post" && targetId) return withQuery(appUrl, { view: "community", post: targetId });
  if (targetType === "event" && targetId) return withQuery(appUrl, { view: "events", event: targetId });
  if (targetType === "course" && targetId) return withQuery(appUrl, { view: "learn", course: targetId });
  if (targetType === "billing") return new URL("/billing", appUrl).toString();
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


/** Evidence-backed message families. Only trusted producers can queue these. */
export const lifecycleEmailTemplates: Record<string, { body: string; action: string }> = {
  mention_everyone_post: { body: "Everyone in the community was tagged in a post.", action: "View Post" },
  mention_everyone_comment: { body: "Everyone in the community was tagged in a comment.", action: "View Comment" },
  membership_requested: { body: "Your request to join the community has been received. We will let you know when it is reviewed.", action: "View community" },
  membership_request_admin: { body: "A member has requested to join your community. Review the request before granting access.", action: "Open community" },
  membership_approved: { body: "Your request to join the community has been approved. Welcome aboard!", action: "Open community" },
  membership_declined: { body: "Your request to join the community was not approved. Contact the community team if you have questions.", action: "Open community" },
  membership_removed: { body: "Your community membership is no longer active. Contact the community team if you believe this is a mistake.", action: "Open community" },
  membership_removed_admin: { body: "A member's community access has been removed or declined.", action: "Open community" },
  private_channel_added: { body: "You have been added to a private community channel.", action: "Open community" },
  role_changed: { body: "Your role in the community has changed. Open the community to see your available tools.", action: "Open community" },
  ownership_transferred: { body: "Community ownership has been transferred. Review your role and community settings.", action: "Open community" },
  content_reported_admin: { body: "Community content has been reported. Review it using the moderation tools.", action: "Review community" },
  group_payment_received: { body: "Your payment for community access was confirmed. Your payment provider supplies the receipt.", action: "Manage membership" },
  group_payment_received_admin: { body: "A member's payment for community access was confirmed.", action: "Open community" },
  course_payment_received: { body: "Your course payment was confirmed. Your payment provider supplies the receipt.", action: "Open course" },
  course_payment_received_admin: { body: "A member's payment for a course was confirmed.", action: "Open community" },
  group_subscription_cancelled: { body: "Your community subscription cancellation is confirmed. Check billing for your remaining access period.", action: "Manage membership" },
  group_subscription_cancelled_admin: { body: "A member's community subscription was cancelled.", action: "Open community" },
  course_subscription_cancelled: { body: "Your course subscription cancellation is confirmed. Check billing for your remaining access period.", action: "Manage membership" },
  course_subscription_cancelled_admin: { body: "A member's course subscription was cancelled.", action: "Open community" },
};

function buildEventDetails(delivery: AcademyEmailDelivery) {
  if (!delivery.template_key.startsWith("event_") && delivery.template_key !== "new_event") return { html: "", text: "" };
  const payload = delivery.payload ?? {};
  const start = typeof payload.startsAt === "string" ? new Date(payload.startsAt) : null;
  const end = typeof payload.endsAt === "string" ? new Date(payload.endsAt) : null;
  let timezone = stringValue(payload.timezone, "UTC");
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(); } catch { timezone = "UTC"; }
  const validStart = start && !Number.isNaN(start.getTime());
  const date = validStart ? new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(start) : "";
  const formatTime = (value: Date) => new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(value);
  const time = validStart ? `${formatTime(start)}${end && !Number.isNaN(end.getTime()) ? ` – ${formatTime(end)}` : ""} (${timezone})` : "";
  const meetingUrl = safeMeetingUrl(payload.meetingUrl);
  const cancelled = delivery.template_key === "event_cancelled";
  const rows = [date ? `Date: ${date}` : "", time ? `Time: ${time}` : ""];
  const htmlRows = rows.filter(Boolean).map(row => `<p style="margin:0 0 8px">${escapeHtml(row)}</p>`).join("");
  // Cancelled events never advertise a meeting link.
  return {
    html: `<div style="margin:0 0 22px;font-size:15px;line-height:1.5;overflow-wrap:anywhere;word-break:break-word">${htmlRows}${meetingUrl && !cancelled ? `<p style="margin:0">Location: <a href="${escapeHtml(meetingUrl)}" style="color:#047631">${escapeHtml(meetingUrl)}</a></p>` : ""}</div>`,
    text: [...rows, meetingUrl && !cancelled ? `Location: ${meetingUrl}` : ""].filter(Boolean).join("\n"),
  };
}

function safeMeetingUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null; } catch { return null; }
}
