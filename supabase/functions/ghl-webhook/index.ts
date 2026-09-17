import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const GHL_PUBLIC_KEY_DER = "MCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg=";

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const rawBody = await request.text();
  const signature = request.headers.get("x-ghl-signature");
  if (!signature || !(await verifyGhlSignature(rawBody, signature))) {
    return Response.json({ error: "Invalid webhook signature" }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return Response.json({ error: "Server is not configured" }, { status: 503 });

  const eventId = String(payload.webhookId ?? await sha256(rawBody));
  const eventType = String(payload.type ?? "unknown");
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { error } = await supabase.from("integration_events").insert({
    provider: "ghl",
    external_event_id: eventId,
    event_type: eventType,
    payload,
  });

  if (error && error.code !== "23505") {
    console.error("Failed to store GHL webhook", error);
    return Response.json({ error: "Webhook could not be queued" }, { status: 500 });
  }

  return Response.json({ accepted: true, duplicate: error?.code === "23505" }, { status: 202 });
});

async function verifyGhlSignature(payload: string, signature: string) {
  try {
    const key = await crypto.subtle.importKey(
      "spki",
      decodeBase64(GHL_PUBLIC_KEY_DER),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      decodeBase64(signature),
      new TextEncoder().encode(payload),
    );
  } catch (error) {
    console.error("GHL signature verification failed", error);
    return false;
  }
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function decodeBase64(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}
