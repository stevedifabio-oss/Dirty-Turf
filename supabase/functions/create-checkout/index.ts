import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import Stripe from "npm:stripe@22.6.2";
import { isUuid } from "../_shared/billing.ts";
import {
  appOrigin,
  billingConfiguration,
  checkoutEmail,
  type CheckoutPlan,
  checkoutPlanColumns,
  priceMatchesPlan,
} from "../_shared/checkout.ts";
import { handlePreflight, jsonResponse } from "../_shared/http.ts";

Deno.serve(async (request) => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  if (request.method !== "POST") {
    return jsonResponse(request, { error: "Method not allowed" }, {
      status: 405,
    });
  }
  const appUrl = appOrigin(Deno.env.get("APP_URL"));
  if (!appUrl || request.headers.get("origin") !== appUrl) {
    return jsonResponse(request, {
      error: "Checkout is available on the web app only",
    }, { status: 403 });
  }
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const secret = Deno.env.get("STRIPE_SECRET_KEY");
  const config = billingConfiguration(
    Deno.env.get("STRIPE_CHECKOUT_ENABLED"),
    Deno.env.get("STRIPE_MODE"),
    secret,
  );
  if (!config.enabled || !url || !key || !secret) {
    return jsonResponse(request, { error: "Enrollment is not open yet" }, {
      status: 503,
    });
  }
  let body: { planId?: string; requestId?: string; email?: string };
  try {
    body = await request.json();
  } catch {
    return jsonResponse(request, { error: "Invalid JSON payload" }, {
      status: 400,
    });
  }
  if (!body || !isUuid(body.planId) || !isUuid(body.requestId)) {
    return jsonResponse(request, {
      error: "A valid planId and requestId are required",
    }, { status: 422 });
  }
  const admin = createClient(url, key, { auth: { persistSession: false } });
  let email = checkoutEmail(body.email);
  let userId: string | undefined;
  const authorization = request.headers.get("authorization");
  // Public clients use apikey only. If a session is provided it must be valid;
  // silently falling back to a supplied email could charge the wrong account.
  if (authorization) {
    if (!authorization.startsWith("Bearer ")) {
      return jsonResponse(request, { error: "Please sign in again" }, {
        status: 401,
      });
    }
    const { data, error } = await admin.auth.getUser(authorization.slice(7));
    if (error || !data.user?.email) {
      return jsonResponse(request, { error: "Please sign in again" }, {
        status: 401,
      });
    }
    email = checkoutEmail(data.user.email);
    userId = data.user.id;
  }
  if (!email) {
    return jsonResponse(request, { error: "Enter a valid email address" }, {
      status: 422,
    });
  }
  const blocked = () =>
    jsonResponse(request, {
      error:
        "Please sign in or contact support to check existing access before purchasing",
    }, { status: 409 });
  try {
    const { data: plan, error: planError } = await admin.from(
      "academy_billing_plans",
    ).select(checkoutPlanColumns).eq("id", body.planId).eq("active", true)
      .maybeSingle();
    if (planError) throw planError;
    if (!plan?.stripe_price_id) {
      return jsonResponse(request, {
        error: "Membership option is unavailable",
      }, { status: 404 });
    }
    const stripe = new Stripe(secret);
    const price = await stripe.prices.retrieve(plan.stripe_price_id);
    if (!priceMatchesPlan(plan as CheckoutPlan, price, config.livemode)) {
      throw new Error("Price configuration mismatch");
    }
    const { data: invite, error: inviteError } = await admin.from(
      "academy_member_invites",
    ).select("academy_member_id").eq(
      "academy_community_id",
      plan.academy_community_id,
    ).eq("email", email).neq("status", "cancelled").limit(1).maybeSingle();
    if (inviteError) throw inviteError;
    const { data: customer, error: customerError } = await admin.from(
      "academy_billing_customers",
    ).select("academy_member_id,provider_customer_id").eq(
      "academy_community_id",
      plan.academy_community_id,
    ).eq("email", email).limit(1).maybeSingle();
    if (customerError) throw customerError;
    const memberId = customer?.academy_member_id || invite?.academy_member_id;
    if (memberId || userId) {
      let memberQuery = admin.from("academy_members").select("id,status").eq(
        "academy_community_id",
        plan.academy_community_id,
      );
      memberQuery = memberId
        ? memberQuery.eq("id", memberId)
        : memberQuery.eq("user_id", userId!);
      const { data: member, error: memberError } = await memberQuery.limit(1)
        .maybeSingle();
      if (memberError) throw memberError;
      if (member?.status === "active") {
        const { data: grants, error: grantsError } = await admin.from(
          "academy_access_grants",
        ).select("id").eq("academy_member_id", member.id).eq("status", "active")
          .or(`ends_at.is.null,ends_at.gt.${new Date().toISOString()}`).limit(
            1,
          );
        if (grantsError) throw grantsError;
        if (grants?.length) return blocked();
      }
    }
    // Check Stripe as well: its payment may precede webhook provisioning.
    // Do not reveal old customer details in a public Checkout session.
    const matches = await stripe.customers.list({ email, limit: 100 });
    if (matches.has_more) throw new Error("Customer lookup requires review");
    const { data: communityPlans, error: communityPlansError } = await admin
      .from("academy_billing_plans").select("stripe_price_id").eq(
        "academy_community_id",
        plan.academy_community_id,
      );
    if (communityPlansError) throw communityPlansError;
    const academyPrices = new Set(
      (communityPlans || []).map((p: { stripe_price_id: string }) =>
        p.stripe_price_id
      ),
    );
    for (const existing of matches.data) {
      const subscriptions = await stripe.subscriptions.list({
        customer: existing.id,
        status: "all",
        limit: 100,
      });
      if (
        subscriptions.has_more ||
        subscriptions.data.some((s) =>
          (s.metadata?.academy_community_id === plan.academy_community_id ||
            s.items.data.some((item) => academyPrices.has(item.price.id))) &&
          !["canceled", "incomplete_expired"].includes(s.status)
        )
      ) return blocked();
      const sessions = await stripe.checkout.sessions.list({
        customer: existing.id,
        limit: 100,
      });
      if (sessions.has_more) return blocked();
      for (const previous of sessions.data) {
        if (
          previous.mode !== "payment" || previous.status !== "complete" ||
          previous.metadata?.academy_community_id !== plan.academy_community_id
        ) continue;
        const paymentId = typeof previous.payment_intent === "string"
          ? previous.payment_intent
          : previous.payment_intent?.id;
        if (!paymentId) {
          if (previous.payment_status === "no_payment_required") {
            return blocked();
          }
          continue;
        }
        const payment = await stripe.paymentIntents.retrieve(paymentId, {
          expand: ["latest_charge"],
        });
        const refunded = typeof payment.latest_charge === "object" &&
          payment.latest_charge?.refunded;
        if (
          !refunded &&
          !["canceled", "requires_payment_method"].includes(payment.status)
        ) return blocked();
      }
    }
    const { data: reservation, error: reserveError } = await admin.rpc(
      "reserve_academy_checkout",
      {
        p_plan_id: plan.id,
        p_email: email,
        p_request_id: body.requestId,
      },
    );
    if (reserveError) throw reserveError;
    if (reservation?.blocked) {
      if (reservation.reason === "checkout_in_progress") {
        return jsonResponse(request, {
          code: "checkout_in_progress",
          error:
            "A checkout is already open. Resume it using the same email and membership option, or wait up to one hour for it to expire.",
        }, { status: 409 });
      }
      return blocked();
    }
    if (!reservation?.id || !reservation.expiresAt) {
      throw new Error("Checkout reservation failed");
    }
    if (reservation.url) {
      return jsonResponse(request, { url: reservation.url }, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    const metadata = {
      academy_community_id: plan.academy_community_id,
      plan_id: plan.id,
      buyer_email: email,
    };
    const session = await stripe.checkout.sessions.create({
      mode: plan.billing_type === "one_time" ? "payment" : "subscription",
      line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
      success_url: `${appUrl}/checkout/return?checkout=success`,
      cancel_url: `${appUrl}/membership?checkout=cancelled`,
      customer_email: email,
      ...(plan.billing_type === "one_time"
        ? {
          customer_creation: "always" as const,
          payment_intent_data: { metadata },
        }
        : {
          subscription_data: {
            metadata,
            ...(plan.trial_days > 0
              ? { trial_period_days: plan.trial_days }
              : {}),
          },
        }),
      metadata,
      expires_at: reservation.expiresAt,
      allow_promotion_codes: true,
    }, { idempotencyKey: `academy-public:${reservation.id}` });
    if (!session.url) throw new Error("Missing checkout URL");
    const { error: saveError } = await admin.from(
      "academy_checkout_reservations",
    ).update({ checkout_session_id: session.id, checkout_url: session.url }).eq(
      "id",
      reservation.id,
    );
    if (saveError) throw saveError;
    return jsonResponse(request, { url: session.url }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    console.error("Stripe Checkout creation failed");
    return jsonResponse(request, {
      error: "Checkout could not be created. Please try again later",
    }, { status: 502 });
  }
});
