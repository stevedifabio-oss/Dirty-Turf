import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import Stripe from "npm:stripe@22.6.2";
import { isUuid } from "../_shared/billing.ts";
import { corsHeaders, handlePreflight, jsonResponse } from "../_shared/http.ts";

type CheckoutRequest = {
  planId?: string;
  requestId?: string;
};

Deno.serve(async (request) => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  if (request.method !== "POST") {
    return jsonResponse(request, { error: "Method not allowed" }, { status: 405 });
  }
  if (!isExactWebOrigin(request)) {
    return jsonResponse(request, { error: "Checkout is available on the web app only" }, { status: 403 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
  const appUrl = normalizedAppUrl();
  const authorization = request.headers.get("authorization");
  if (!supabaseUrl || !serviceRoleKey || !stripeSecret || !appUrl) {
    return jsonResponse(request, { error: "Checkout is not configured" }, { status: 503 });
  }
  if (!authorization?.startsWith("Bearer ")) {
    return jsonResponse(request, { error: "Authentication required" }, { status: 401 });
  }

  let body: CheckoutRequest;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(request, { error: "Invalid JSON payload" }, { status: 400 });
  }
  if (!isUuid(body.planId) || !isUuid(body.requestId)) {
    return jsonResponse(request, { error: "A valid planId and requestId are required" }, { status: 422 });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await admin.auth.getUser(
    authorization.slice(7),
  );
  if (userError || !userData.user?.email) {
    return jsonResponse(request, { error: "Invalid session" }, { status: 401 });
  }

  const { data: member } = await admin
    .from("academy_members")
    .select("id,academy_community_id,status")
    .eq("user_id", userData.user.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (!member) {
    return jsonResponse(request, { error: "Academy membership is required" }, { status: 403 });
  }

  const { data: plan } = await admin
    .from("academy_billing_plans")
    .select("id,academy_community_id,name,stripe_price_id,billing_type,trial_days,active")
    .eq("id", body.planId)
    .eq("academy_community_id", member.academy_community_id)
    .eq("active", true)
    .maybeSingle();
  if (!plan?.stripe_price_id) {
    return jsonResponse(request, { error: "Billing plan is unavailable" }, { status: 404 });
  }

  const { data: existingBillingRows, error: existingBillingError } = await admin
    .from("academy_billing_subscriptions")
    .select("plan_id,source_type")
    .eq("academy_member_id", member.id)
    .in("status", ["trialing", "active", "past_due", "paused"])
    .limit(20);
  if (existingBillingError) {
    return jsonResponse(request, { error: "Billing status could not be verified" }, { status: 503 });
  }
  const existingBilling = (existingBillingRows ?? []).some((row) =>
    plan.billing_type === "subscription"
      ? row.source_type === "stripe_subscription"
      : row.plan_id === plan.id
  );
  if (existingBilling) {
    return jsonResponse(request, { error: "Manage the existing billing account instead" }, { status: 409 });
  }

  const { data: customer } = await admin
    .from("academy_billing_customers")
    .select("provider_customer_id")
    .eq("academy_member_id", member.id)
    .maybeSingle();

  const stripe = new Stripe(stripeSecret);
  const metadata = {
    user_id: userData.user.id,
    academy_member_id: member.id,
    academy_community_id: member.academy_community_id,
    plan_id: plan.id,
  };
  const subscriptionData: Stripe.Checkout.SessionCreateParams.SubscriptionData | undefined =
    plan.billing_type === "subscription"
      ? {
        metadata,
        ...(plan.trial_days > 0 ? { trial_period_days: plan.trial_days } : {}),
      }
      : undefined;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: plan.billing_type === "one_time" ? "payment" : "subscription",
      line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
      success_url: `${appUrl}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/?checkout=cancelled`,
      client_reference_id: userData.user.id,
      customer: customer?.provider_customer_id || undefined,
      customer_email: customer?.provider_customer_id ? undefined : userData.user.email,
      metadata,
      subscription_data: subscriptionData,
      allow_promotion_codes: true,
    }, {
      idempotencyKey: `academy:${userData.user.id}:${plan.id}:${body.requestId}`,
    });
    if (!session.url) throw new Error("Stripe returned no Checkout URL");
    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders(request), "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Stripe Checkout session failed", error);
    return jsonResponse(request, { error: "Checkout could not be created" }, { status: 502 });
  }
});

function normalizedAppUrl() {
  const value = Deno.env.get("APP_URL")?.replace(/\/$/, "");
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.hostname === "localhost"
      ? url.toString().replace(/\/$/, "")
      : null;
  } catch {
    return null;
  }
}

function isExactWebOrigin(request: Request) {
  const appUrl = normalizedAppUrl();
  const origin = request.headers.get("origin");
  if (!appUrl || !origin) return false;
  return new URL(appUrl).origin === origin;
}
