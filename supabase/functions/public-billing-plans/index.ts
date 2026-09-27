import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import Stripe from "npm:stripe@22.6.2";
import {
  billingConfiguration,
  type CheckoutPlan,
  checkoutPlanColumns,
  priceMatchesPlan,
} from "../_shared/checkout.ts";
import { handlePreflight, jsonResponse } from "../_shared/http.ts";

Deno.serve(async (request) => {
  const preflight = handlePreflight(request, "GET, OPTIONS");
  if (preflight) return preflight;
  if (request.method !== "GET") {
    return jsonResponse(request, { error: "Method not allowed" }, {
      status: 405,
    }, "GET, OPTIONS");
  }
  const secret = Deno.env.get("STRIPE_SECRET_KEY");
  const config = billingConfiguration(
    Deno.env.get("STRIPE_CHECKOUT_ENABLED"),
    Deno.env.get("STRIPE_MODE"),
    secret,
  );
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!config.enabled || !secret || !url || !key) {
    return jsonResponse(
      request,
      { enabled: false, plans: [] },
      {},
      "GET, OPTIONS",
    );
  }
  try {
    const admin = createClient(url, key, { auth: { persistSession: false } });
    const { data, error } = await admin.from("academy_billing_plans").select(
      checkoutPlanColumns,
    ).eq("active", true).order("amount_cents");
    if (error) throw error;
    const stripe = new Stripe(secret);
    const plans = await Promise.all(
      (data as CheckoutPlan[]).map(async (plan) => {
        if (!plan.stripe_price_id) throw new Error("Unmapped plan");
        const price = await stripe.prices.retrieve(plan.stripe_price_id);
        if (!priceMatchesPlan(plan, price, config.livemode)) {
          throw new Error("Plan and Stripe price do not match");
        }
        return {
          id: plan.id,
          name: plan.name,
          description: plan.description,
          amountCents: plan.amount_cents,
          currency: plan.currency,
          billingInterval: plan.billing_interval,
          trialDays: plan.trial_days,
        };
      }),
    );
    return jsonResponse(request, { enabled: plans.length > 0, plans }, {
      headers: { "Cache-Control": "no-store" },
    }, "GET, OPTIONS");
  } catch {
    console.error("Billing catalog validation failed");
    return jsonResponse(
      request,
      { error: "Membership options are temporarily unavailable" },
      { status: 503 },
      "GET, OPTIONS",
    );
  }
});
