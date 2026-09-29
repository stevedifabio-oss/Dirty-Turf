import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.116.0";
import { loadRuntimeConfig } from "../_shared/runtime-config.ts";
import { verifyGhlEmailRecipient, sendGhlEmail, GhlEmailRejected, GhlRecipientUnavailable } from "../_shared/ghl-email.ts";
import {
  buildAcademyEmail,
  createUnsubscribeToken,
  escapeHtml,
  preferenceForTemplate,
  templatesForPreference,
  verifyUnsubscribeToken,
  type AcademyEmailDelivery,
  type EmailPreferenceKey,
} from "../_shared/notification-email.ts";

type RuntimeConfig = {
  supabaseUrl: string;
  serviceRoleKey: string;
  appUrl: string;
  dispatchSecret: string;
  signingSecret: string;
  provider: "mailgun" | "ghl";
  ghl: { token: string; locationId: string; from: string };
  mailgunApiKey: string;
  mailgunDomain: string;
  mailgunFromEmail: string;
  mailgunFromName: string;
  mailgunRegion: string;
};

Deno.serve(async (request) => {
  const url = new URL(request.url);
  if (url.pathname.endsWith("/unsubscribe")) return handleUnsubscribe(request, url);
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const settings = await loadNotificationSettings();
  if (settings.ACADEMY_EMAIL_DELIVERY_ENABLED !== "true") return json({ enabled: false, sent: 0 });
  const config = loadConfig(settings);
  if (!config) return json({ error: "Notification delivery is not configured" }, 503);
  if (!safeEqual(request.headers.get("x-notification-secret") ?? "", config.dispatchSecret)) {
    return json({ error: "Authentication required" }, 401);
  }

  const admin = adminClient(config);
  const requestedLimit = await readLimit(request);
  const { data: scheduled, error: scheduleError } = await admin.rpc(
    "queue_academy_scheduled_notifications",
    { p_now: new Date().toISOString() },
  );
  if (scheduleError) return json({ error: "Scheduled notifications could not be queued" }, 500);

  const lockToken = crypto.randomUUID();
  const { data, error } = await admin.rpc("claim_academy_email_deliveries", {
    p_limit: requestedLimit,
    p_lock_token: lockToken,
  });
  if (error) return json({ error: "Notification deliveries could not be claimed" }, 500);

  const deliveries = (Array.isArray(data) ? data : []) as AcademyEmailDelivery[];
  const results: { id: string; status: "sent" | "retrying" | "cancelled" | "review_required" }[] = [];
  for (const claimedDelivery of deliveries) {
    let delivery = claimedDelivery;
    let providerAttempted = false;
    let providerAccepted = false;
    try {
      const { data: prepared, error: prepareError } = await admin.rpc("prepare_academy_email_delivery", {
        p_delivery_id: delivery.id, p_lock_token: lockToken,
      });
      if (prepareError) throw prepareError;
      if (!Array.isArray(prepared) || !prepared[0]) { results.push({ id: delivery.id, status: "cancelled" }); continue; }
      delivery = prepared[0] as AcademyEmailDelivery;
      const preference = preferenceForTemplate(delivery.template_key);
      const token = await createUnsubscribeToken(
        delivery.recipient_member_id,
        preference,
        config.signingSecret,
      );
      const unsubscribeUrl = new URL("/email/unsubscribe", config.appUrl);
      unsubscribeUrl.searchParams.set("token", token);
      const email = buildAcademyEmail(delivery, { appUrl: config.appUrl, unsubscribeUrl: unsubscribeUrl.toString() });
      let contactId: string | null = null;
      if (config.provider === "ghl") {
        const { data: link, error: linkError } = await admin.from("academy_member_links")
          .select("external_contact_id").eq("academy_member_id", delivery.recipient_member_id)
          .eq("external_provider", "highlevel").maybeSingle();
        if (linkError) throw new Error("HighLevel contact mapping could not be read");
        contactId = await verifyGhlEmailRecipient(config.ghl, link?.external_contact_id ?? null, delivery.recipient_email);
      }
      providerAttempted = true;
      const providerMessageId = config.provider === "ghl"
        ? await sendGhlEmail(config.ghl, contactId!, delivery.recipient_email, email)
        : await sendMailgun(config, delivery, email, unsubscribeUrl.toString());
      providerAccepted = true;
      const { data: completed, error: completeError } = await admin.rpc("complete_academy_email_delivery", {
        p_delivery_id: delivery.id,
        p_lock_token: lockToken,
        p_provider_message_id: providerMessageId,
      });
      if (completeError || !completed) throw completeError ?? new Error("Delivery lock lost after provider acceptance");
      results.push({ id: delivery.id, status: "sent" });
    } catch (deliveryError) {
      if (deliveryError instanceof GhlRecipientUnavailable) {
        await admin.from("academy_email_deliveries").update({ status: "failed", last_error: deliveryError.message, lock_token: null, locked_at: null })
          .eq("id", delivery.id).eq("lock_token", lockToken).eq("status", "processing");
        results.push({ id: delivery.id, status: "review_required" });
        continue;
      }
      // Providers do not promise idempotency for messages. A timeout, 5xx, or DB failure
      // after acceptance requires provider review; automatic resend can duplicate mail.
      if (providerAccepted || (providerAttempted && !(deliveryError instanceof ProviderRejected || deliveryError instanceof GhlEmailRejected))) {
        await admin.from("academy_email_deliveries").update({ status: "failed", last_error: "Provider result uncertain; review before retry", lock_token: null, locked_at: null })
          .eq("id", delivery.id).eq("lock_token", lockToken).eq("status", "processing");
        results.push({ id: delivery.id, status: "review_required" });
        continue;
      }
      await admin.rpc("fail_academy_email_delivery", {
        p_delivery_id: delivery.id,
        p_lock_token: lockToken,
        p_error: errorMessage(deliveryError),
      });
      results.push({ id: delivery.id, status: "retrying" });
    }
  }

  return json({
    scheduled: scheduled ?? { eventReminders: 0, weeklyDigests: 0 },
    claimed: deliveries.length,
    sent: results.filter((result) => result.status === "sent").length,
    cancelled: results.filter((result) => result.status === "cancelled").length,
    reviewRequired: results.filter((result) => result.status === "review_required").length,
    retrying: results.filter((result) => result.status === "retrying").length,
  });
});

async function handleUnsubscribe(request: Request, url: URL) {
  if (!["GET", "POST"].includes(request.method)) return htmlPage("Method not allowed", "Use the link from your email.", 405);
  const config = loadUnsubscribeConfig(await loadNotificationSettings());
  if (!config) return htmlPage("Notifications are unavailable", "Please update your preferences inside the Academy app.", 503);

  let token = url.searchParams.get("token") ?? "";
  if (request.method === "POST" && !token) {
    const form = await request.formData().catch(() => null);
    token = String(form?.get("token") ?? "");
  }
  const payload = await verifyUnsubscribeToken(token, config.signingSecret);
  if (!payload) return htmlPage("This link is no longer valid", "Open notification settings in the Academy app to make changes.", 400, config.appUrl);

  if (request.method === "GET") {
    const label = preferenceLabel(payload.preference);
    return new Response(confirmUnsubscribeHtml(token, label, config.appUrl), {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const admin = createClient(config.supabaseUrl, config.serviceRoleKey, { auth: { persistSession: false } });
  const { data: member, error: memberError } = await admin
    .from("academy_members")
    .select("user_id")
    .eq("id", payload.memberId)
    .maybeSingle();
  if (memberError || !member?.user_id) return htmlPage("Preference could not be updated", "Open notification settings in the Academy app.", 422, config.appUrl);

  const { error: preferenceError } = await admin
    .from("notification_preferences")
    .upsert({ user_id: member.user_id, [payload.preference]: false, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (preferenceError) return htmlPage("Preference could not be updated", "Please try again from the Academy app.", 500, config.appUrl);

  const templates = templatesForPreference(payload.preference);
  await admin
    .from("academy_email_deliveries")
    .update({ status: "cancelled", last_error: "Recipient unsubscribed" })
    .eq("recipient_member_id", payload.memberId)
    .in("status", ["pending", "processing"])
    .in("template_key", templates);

  return htmlPage("You are unsubscribed", `${preferenceLabel(payload.preference)} emails are now off. You can turn them back on in notification settings.`, 200, config.appUrl);
}

async function sendMailgun(
  config: RuntimeConfig,
  delivery: AcademyEmailDelivery,
  email: ReturnType<typeof buildAcademyEmail>,
  unsubscribeUrl: string,
) {
  const endpoint = config.mailgunRegion.toLowerCase() === "eu"
    ? "https://api.eu.mailgun.net"
    : "https://api.mailgun.net";
  const form = new FormData();
  form.set("from", `${config.mailgunFromName} <${config.mailgunFromEmail}>`);
  // Display names are user-editable; never interpolate them into an address header.
  form.set("to", delivery.recipient_email);
  form.set("subject", email.subject);
  form.set("html", email.html);
  form.set("text", email.text);
  form.set("o:tag", `academy-${delivery.template_key}`);
  form.set("v:delivery-id", delivery.id);
  form.set("v:idempotency-key", delivery.idempotency_key);
  form.set("o:tracking", "no");
  form.set("o:tracking-clicks", "no");
  form.set("o:tracking-opens", "no");
  form.set("h:List-Unsubscribe", `<${unsubscribeUrl}>`);
  form.set("h:List-Unsubscribe-Post", "List-Unsubscribe=One-Click");

  const response = await fetch(`${endpoint}/v3/${encodeURIComponent(config.mailgunDomain)}/messages`, {
    method: "POST",
    headers: { authorization: `Basic ${btoa(`api:${config.mailgunApiKey}`)}` },
    body: form,
    signal: AbortSignal.timeout(20_000),
  });
  const result = await response.json().catch(() => ({})) as { id?: string; message?: string };
  if (response.status >= 400 && response.status < 500) throw new ProviderRejected(`Mailgun rejected delivery (${response.status})`);
  if (!response.ok || !result.id) throw new Error("Mailgun delivery result is uncertain");
  return result.id;
}

class ProviderRejected extends Error {}

async function loadNotificationSettings() {
  const names = ["ACADEMY_EMAIL_DELIVERY_ENABLED", "NOTIFICATION_DISPATCH_SECRET", "NOTIFICATION_SIGNING_SECRET", "MAILGUN_API_KEY", "MAILGUN_DOMAIN", "MAILGUN_FROM_EMAIL", "MAILGUN_FROM_NAME", "MAILGUN_REGION", "ACADEMY_EMAIL_PROVIDER", "GHL_EMAIL_FROM", "GHL_PRIVATE_INTEGRATION_TOKEN", "GHL_LOCATION_ID"];
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return Object.fromEntries(names.map(name => [name, Deno.env.get(name)]));
  const admin = createClient(url, key, { auth: { persistSession: false } });
  return loadRuntimeConfig(admin, names, name => Deno.env.get(name));
}

function loadConfig(settings: Record<string, string | undefined>): RuntimeConfig | null {
  const unsubscribe = loadUnsubscribeConfig(settings);
  const dispatchSecret = settings.NOTIFICATION_DISPATCH_SECRET?.trim();
  const provider = settings.ACADEMY_EMAIL_PROVIDER ?? "mailgun";
  if (provider !== "mailgun" && provider !== "ghl") return null;
  const ghl = { token: settings.GHL_PRIVATE_INTEGRATION_TOKEN ?? "", locationId: settings.GHL_LOCATION_ID ?? "", from: settings.GHL_EMAIL_FROM ?? "" };
  const mailgunApiKey = settings.MAILGUN_API_KEY?.trim() || "";
  const mailgunDomain = settings.MAILGUN_DOMAIN?.trim() || "";
  const mailgunFromEmail = settings.MAILGUN_FROM_EMAIL?.trim() || "";
  if (!unsubscribe || !dispatchSecret) return null;
  if (provider === "mailgun" && (!mailgunApiKey || !mailgunDomain || !mailgunFromEmail)) return null;
  if (provider === "ghl" && (!ghl.token || /[\r\n]/.test(ghl.token) || !/^[A-Za-z0-9_-]{1,128}$/.test(ghl.locationId) || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(ghl.from))) return null;
  return {
    ...unsubscribe,
    provider,
    ghl,
    dispatchSecret,
    mailgunApiKey,
    mailgunDomain,
    mailgunFromEmail,
    mailgunFromName: settings.MAILGUN_FROM_NAME?.trim() || "Dirty Turf Academy",
    mailgunRegion: settings.MAILGUN_REGION?.trim() || "us",
  };
}

function loadUnsubscribeConfig(settings: Record<string, string | undefined>) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  const appUrl = Deno.env.get("APP_URL")?.trim();
  const signingSecret = settings.NOTIFICATION_SIGNING_SECRET?.trim();
  if (!supabaseUrl || !serviceRoleKey || !appUrl || !signingSecret) return null;
  try {
    return { supabaseUrl, serviceRoleKey, appUrl: new URL(appUrl).origin, signingSecret };
  } catch {
    return null;
  }
}

function adminClient(config: RuntimeConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.serviceRoleKey, { auth: { persistSession: false } });
}

async function readLimit(request: Request) {
  try {
    const body = await request.json() as { limit?: number };
    return Math.max(1, Math.min(Number(body.limit) || 25, 100));
  } catch {
    return 25;
  }
}

function safeEqual(left: string, right: string) {
  if (!left || left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown notification delivery error";
}

function preferenceLabel(preference: EmailPreferenceKey) {
  const labels: Record<EmailPreferenceKey, string> = {
    replies: "Comments and replies",
    mentions: "Mentions",
    reactions: "Post and comment likes",
    event_reminders: "Events and reminders",
    weekly_digest: "Weekly digest",
    new_posts: "New community posts",
    course_updates: "Course updates",
    admin_announcements: "Academy announcements",
  };
  return labels[preference];
}

function confirmUnsubscribeHtml(token: string, label: string, appUrl: string) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Manage email notifications</title><body style="margin:0;background:#eef4ea;font-family:Arial,sans-serif;color:#122218"><main style="max-width:520px;margin:10vh auto;background:#fff;border:1px solid #d8e4d3;border-radius:8px;padding:30px"><p style="color:#07833f;font-weight:700;text-transform:uppercase;font-size:12px">Dirty Turf Academy</p><h1 style="font-size:25px">Turn off ${escapeHtml(label)} emails?</h1><p>You will still see these updates in the Academy notification center.</p><form method="post"><input type="hidden" name="token" value="${escapeHtml(token)}"><button style="border:0;border-radius:6px;background:#07833f;color:#fff;font-weight:700;padding:13px 18px;cursor:pointer">Unsubscribe</button></form><p><a style="color:#287448" href="${escapeHtml(appUrl)}">Return to the Academy</a></p></main></body></html>`;
}

function htmlPage(title: string, detail: string, status: number, appUrl = "https://app.dirtyturf.com") {
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><body style="margin:0;background:#eef4ea;font-family:Arial,sans-serif;color:#122218"><main style="max-width:520px;margin:10vh auto;background:#fff;border:1px solid #d8e4d3;border-radius:8px;padding:30px"><p style="color:#07833f;font-weight:700;text-transform:uppercase;font-size:12px">Dirty Turf Academy</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p><a style="color:#287448" href="${escapeHtml(appUrl)}">Open the Academy</a></main></body></html>`, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
