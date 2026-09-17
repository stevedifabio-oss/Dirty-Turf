import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (request) => {
  const appUrl = Deno.env.get("APP_URL")?.replace(/\/$/, "");
  const cors = {
    "Access-Control-Allow-Origin": appUrl ?? "",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: cors });

  const origin = request.headers.get("origin")?.replace(/\/$/, "");
  if (!appUrl || origin !== appUrl) return Response.json({ error: "Origin is not allowed" }, { status: 403, headers: cors });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
  const authorization = request.headers.get("authorization");
  if (!supabaseUrl || !anonKey || !stripeSecret || !authorization) {
    return Response.json({ error: "Checkout is not configured" }, { status: 503, headers: cors });
  }

  let body: { planId?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON payload" }, { status: 400, headers: cors });
  }
  if (!body.planId) return Response.json({ error: "planId is required" }, { status: 400, headers: cors });

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser(authorization.replace(/^Bearer\s+/i, ""));
  if (userError || !userData.user) return Response.json({ error: "Authentication required" }, { status: 401, headers: cors });

  const { data: plan, error: planError } = await supabase
    .from("membership_plans")
    .select("id,organization_id,name,stripe_price_id,interval,active")
    .eq("id", body.planId)
    .eq("active", true)
    .single();
  if (planError || !plan?.stripe_price_id) return Response.json({ error: "Membership plan is unavailable" }, { status: 404, headers: cors });

  const params = new URLSearchParams({
    mode: plan.interval === "one_time" ? "payment" : "subscription",
    "line_items[0][price]": plan.stripe_price_id,
    "line_items[0][quantity]": "1",
    success_url: `${appUrl}/?checkout=success`,
    cancel_url: `${appUrl}/?checkout=cancelled`,
    client_reference_id: userData.user.id,
    customer_email: userData.user.email ?? "",
    "metadata[user_id]": userData.user.id,
    "metadata[organization_id]": plan.organization_id,
    "metadata[plan_id]": plan.id,
  });
  if (plan.interval !== "one_time") {
    params.set("subscription_data[metadata][user_id]", userData.user.id);
    params.set("subscription_data[metadata][organization_id]", plan.organization_id);
    params.set("subscription_data[metadata][plan_id]", plan.id);
  }

  const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${stripeSecret}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const session = await stripeResponse.json();
  if (!stripeResponse.ok || !session.url) {
    console.error("Stripe Checkout session failed", session);
    return Response.json({ error: "Checkout could not be created" }, { status: 502, headers: cors });
  }
  return Response.json({ url: session.url }, { headers: cors });
});
