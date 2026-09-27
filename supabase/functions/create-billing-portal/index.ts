import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import Stripe from "npm:stripe@22.6.2";
import { billingConfiguration } from "../_shared/checkout.ts";
import { handlePreflight, jsonResponse } from "../_shared/http.ts";

Deno.serve(async (request) => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  if (request.method !== "POST") {
    return jsonResponse(request, { error: "Method not allowed" }, {
      status: 405,
    });
  }
  const appUrl = normalizedAppUrl();
  if (!appUrl || request.headers.get("origin") !== new URL(appUrl).origin) {
    return jsonResponse(request, {
      error: "Billing management is available on the web app only",
    }, { status: 403 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
  const authorization = request.headers.get("authorization");
  if (
    !supabaseUrl || !serviceRoleKey || !stripeSecret ||
    !billingConfiguration("true", Deno.env.get("STRIPE_MODE"), stripeSecret)
      .enabled
  ) {
    return jsonResponse(request, { error: "Billing is not configured" }, {
      status: 503,
    });
  }
  if (!authorization?.startsWith("Bearer ")) {
    return jsonResponse(request, { error: "Authentication required" }, {
      status: 401,
    });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await admin.auth.getUser(
    authorization.slice(7),
  );
  if (userError || !userData.user) {
    return jsonResponse(request, { error: "Invalid session" }, { status: 401 });
  }
  const { data: customer } = await admin
    .from("academy_billing_customers")
    .select("provider_customer_id")
    .eq("user_id", userData.user.id)
    .limit(1)
    .maybeSingle();
  if (!customer?.provider_customer_id) {
    return jsonResponse(request, { error: "No billing account is connected" }, {
      status: 404,
    });
  }

  try {
    const stripe = new Stripe(stripeSecret);
    const session = await stripe.billingPortal.sessions.create({
      customer: customer.provider_customer_id,
      return_url: `${appUrl}/billing`,
    });
    return jsonResponse(request, { url: session.url });
  } catch (error) {
    console.error("Stripe Billing Portal session failed", error);
    return jsonResponse(request, {
      error: "Billing portal could not be opened",
    }, { status: 502 });
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
