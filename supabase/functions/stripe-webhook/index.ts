import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!signature || !webhookSecret || !(await verifyStripeSignature(rawBody, signature, webhookSecret))) {
    return Response.json({ error: "Invalid webhook signature" }, { status: 401 });
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return Response.json({ error: "Server is not configured" }, { status: 503 });
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const { error: eventError } = await supabase.from("integration_events").insert({
    provider: "stripe",
    external_event_id: event.id,
    event_type: event.type,
    payload: event,
  });
  if (eventError?.code === "23505") return Response.json({ accepted: true, duplicate: true });
  if (eventError) {
    console.error("Failed to store Stripe event", eventError);
    return Response.json({ error: "Webhook could not be queued" }, { status: 500 });
  }

  const object = event.data.object;
  if (event.type === "checkout.session.completed" && object.mode === "subscription") {
    await upsertSubscription(supabase, object.metadata, {
      provider_customer_id: stringValue(object.customer),
      provider_subscription_id: stringValue(object.subscription),
      status: "active",
    });
  }
  if (event.type.startsWith("customer.subscription.")) {
    await upsertSubscription(supabase, object.metadata, {
      provider_customer_id: stringValue(object.customer),
      provider_subscription_id: object.id,
      status: membershipStatus(stringValue(object.status)),
      current_period_end: typeof object.current_period_end === "number" ? new Date(object.current_period_end * 1000).toISOString() : null,
    });
  }

  await supabase.from("integration_events").update({ processed_at: new Date().toISOString() }).eq("provider", "stripe").eq("external_event_id", event.id);
  return Response.json({ accepted: true, duplicate: false });
});

async function upsertSubscription(
  supabase: any,
  metadata: Record<string, string> | undefined,
  values: Record<string, unknown>,
) {
  const organizationId = metadata?.organization_id;
  const userId = metadata?.user_id;
  const planId = metadata?.plan_id;
  if (!organizationId || !userId) throw new Error("Stripe subscription metadata is incomplete");
  const { error } = await supabase.from("member_subscriptions").upsert({
    organization_id: organizationId,
    user_id: userId,
    plan_id: planId || null,
    ...values,
  }, { onConflict: "organization_id,user_id" });
  if (error) throw error;
}

async function verifyStripeSignature(payload: string, header: string, secret: string) {
  const parts = Object.fromEntries(header.split(",").map((part) => part.split("=", 2)));
  const timestamp = Number(parts.t);
  const received = parts.v1;
  if (!timestamp || !received || Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const expected = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return timingSafeEqual(expected, received);
}

function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return result === 0;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : null;
}

function membershipStatus(status: string | null) {
  if (status === "active" || status === "trialing") return "active";
  if (status === "past_due" || status === "unpaid" || status === "paused") return "suspended";
  if (status === "canceled" || status === "incomplete_expired") return "cancelled";
  return "pending";
}

type StripeEvent = {
  id: string;
  type: string;
  data: { object: Record<string, unknown> & { id: string; metadata?: Record<string, string> } };
};
