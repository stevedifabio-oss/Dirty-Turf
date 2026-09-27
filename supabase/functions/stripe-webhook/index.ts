import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2.116.0";
import Stripe from "npm:stripe@22.6.2";
import { billingConfiguration } from "../_shared/checkout.ts";
import {
  errorMessage,
  isUuid,
  looksLikeEmail,
  normalizeBillingEmail,
  normalizeStripeSubscriptionStatus,
  stringId,
  unixTimestamp,
} from "../_shared/billing.ts";

type BillingPlan = {
  id: string;
  academy_community_id: string;
  stripe_price_id: string;
  billing_type: "subscription" | "one_time";
};

type Buyer = {
  userId: string;
  memberId: string;
  email: string;
};

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const signature = request.headers.get("stripe-signature");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (
    !signature || !webhookSecret || !stripeSecret || !supabaseUrl ||
    !serviceRoleKey
  ) {
    return Response.json({ error: "Webhook is not configured" }, {
      status: 503,
    });
  }

  const stripe = new Stripe(stripeSecret);
  let event: Stripe.Event;
  try {
    const payload = await request.text();
    event = await stripe.webhooks.constructEventAsync(
      payload,
      signature,
      webhookSecret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch (error) {
    console.error("Stripe signature validation failed", error);
    return Response.json({ error: "Invalid webhook signature" }, {
      status: 400,
    });
  }

  const config = billingConfiguration(
    "true",
    Deno.env.get("STRIPE_MODE"),
    stripeSecret,
  );
  if (!config.enabled || event.livemode !== config.livemode) {
    return Response.json(
      { error: "Webhook mode does not match configuration" },
      { status: 400 },
    );
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  const { error: eventError } = await admin.from("integration_events").insert({
    provider: "stripe",
    external_event_id: event.id,
    event_type: event.type,
    payload: event,
  });
  if (eventError?.code === "23505") {
    const { data: existing } = await admin
      .from("integration_events")
      .select("processed_at")
      .eq("provider", "stripe")
      .eq("external_event_id", event.id)
      .maybeSingle();
    if (existing?.processed_at) {
      return Response.json({ accepted: true, duplicate: true });
    }
  } else if (eventError) {
    console.error("Failed to store Stripe event", eventError);
    return Response.json({ error: "Webhook could not be queued" }, {
      status: 500,
    });
  }

  try {
    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      await processCheckout(admin, stripe, event.data.object);
    } else if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      await processSubscription(admin, stripe, event.data.object);
    } else if (
      event.type === "invoice.paid" || event.type === "invoice.payment_failed"
    ) {
      const invoice = await stripe.invoices.retrieve(event.data.object.id);
      const subscriptionId = stringId(
        invoice.parent?.subscription_details?.subscription,
      );
      if (subscriptionId) {
        await processSubscription(
          admin,
          stripe,
          { id: subscriptionId } as Stripe.Subscription,
        );
      }
    } else if (event.type === "charge.refunded") {
      await processRefund(admin, stripe, event.data.object);
    }

    const { error } = await admin.from("integration_events").update({
      processed_at: new Date().toISOString(),
      error_message: null,
    }).eq("provider", "stripe").eq("external_event_id", event.id);
    if (error) throw error;
    return Response.json({ accepted: true, duplicate: false });
  } catch (error) {
    const message = errorMessage(error).slice(0, 1000);
    console.error("Stripe event processing failed", event.id, message);
    await admin.from("integration_events").update({ error_message: message })
      .eq("provider", "stripe")
      .eq("external_event_id", event.id);
    return Response.json({ error: "Webhook processing failed" }, {
      status: 500,
    });
  }
});

async function processCheckout(
  admin: SupabaseClient,
  stripe: Stripe,
  object: Stripe.Event.Data.Object,
) {
  if (!("id" in object) || typeof object.id !== "string") {
    throw new Error("Checkout event has no session ID");
  }
  const session = await stripe.checkout.sessions.retrieve(object.id, {
    expand: ["line_items.data.price", "customer", "subscription"],
  });
  if (
    session.payment_status !== "paid" &&
    session.payment_status !== "no_payment_required"
  ) {
    throw new Error("Checkout is not paid");
  }

  const priceId = stringId(session.line_items?.data[0]?.price);
  const plan = await resolvePlan(admin, session.metadata?.plan_id, priceId);
  if (!plan) return;
  let email = normalizeBillingEmail(
    session.metadata?.buyer_email || session.customer_details?.email ||
      (typeof session.customer === "object" && session.customer &&
          !("deleted" in session.customer)
        ? session.customer.email
        : ""),
  );
  const customerId = stringId(session.customer);
  email = await knownBuyerEmail(admin, customerId, email);
  if (!looksLikeEmail(email) || !customerId) {
    throw new Error("Checkout buyer identity is incomplete");
  }

  const buyer = await ensureBuyer(
    admin,
    plan.academy_community_id,
    email,
    session.customer_details?.name || "",
  );
  if (session.mode === "subscription") {
    const subscriptionId = stringId(session.subscription);
    if (!subscriptionId) throw new Error("Checkout subscription is missing");
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    await applyBillingEvent(admin, {
      plan,
      buyer,
      customerId,
      subscriptionId,
      checkoutSessionId: session.id,
      status: normalizeStripeSubscriptionStatus(subscription.status),
      cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
      currentPeriodEnd: subscriptionPeriodEnd(subscription),
      sourceType: "stripe_subscription",
      sourceKey: subscriptionId,
    });
    return;
  }

  await applyBillingEvent(admin, {
    plan,
    buyer,
    customerId,
    subscriptionId: "",
    checkoutSessionId: session.id,
    status: await oneTimePaymentStatus(stripe, session),
    cancelAtPeriodEnd: false,
    currentPeriodEnd: null,
    sourceType: "stripe_payment",
    sourceKey: session.id,
  });
}

async function processSubscription(
  admin: SupabaseClient,
  stripe: Stripe,
  object: Stripe.Event.Data.Object,
) {
  if (!("id" in object) || typeof object.id !== "string") {
    throw new Error("Subscription event has no ID");
  }
  // Delivery order is not guaranteed. Re-read the authoritative current state.
  const subscription = await stripe.subscriptions.retrieve(object.id);
  const customerId = stringId(subscription.customer);
  const priceId = stringId(subscription.items.data[0]?.price);
  const plan = await resolvePlan(
    admin,
    subscription.metadata?.plan_id,
    priceId,
  );
  if (!plan) return;
  const customer = await stripe.customers.retrieve(customerId);
  if ("deleted" in customer && customer.deleted) {
    throw new Error("Stripe customer has been deleted");
  }
  const email = await knownBuyerEmail(
    admin,
    customerId,
    normalizeBillingEmail(subscription.metadata?.buyer_email || customer.email),
  );
  if (!looksLikeEmail(email) || !customerId) {
    throw new Error("Subscription customer identity is incomplete");
  }
  const buyer = await ensureBuyer(
    admin,
    plan.academy_community_id,
    email,
    customer.name || "",
  );
  await applyBillingEvent(admin, {
    plan,
    buyer,
    customerId,
    subscriptionId: subscription.id,
    checkoutSessionId: "",
    status: normalizeStripeSubscriptionStatus(subscription.status),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    currentPeriodEnd: subscriptionPeriodEnd(subscription),
    sourceType: "stripe_subscription",
    sourceKey: subscription.id,
  });
}

async function resolvePlan(
  admin: SupabaseClient,
  metadataPlanId: string | undefined,
  priceId: string,
): Promise<BillingPlan | null> {
  if (!priceId) throw new Error("Stripe price is missing");
  let query = admin
    .from("academy_billing_plans")
    .select("id,academy_community_id,stripe_price_id,billing_type");
  query = isUuid(metadataPlanId)
    ? query.eq("id", metadataPlanId)
    : query.eq("stripe_price_id", priceId);
  const { data: plan, error } = await query.maybeSingle();
  if (!error && !plan && !isUuid(metadataPlanId)) return null;
  if (error || !plan || plan.stripe_price_id !== priceId) {
    throw new Error("Stripe price is not mapped to an Academy plan");
  }
  return plan as BillingPlan;
}

async function ensureBuyer(
  admin: SupabaseClient,
  communityId: string,
  email: string,
  displayName: string,
): Promise<Buyer> {
  let user = await findAuthUser(admin, email);
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      // A successful card payment is not proof of email ownership. The buyer
      // still verifies the address through the normal magic-link sign-in.
      email_confirm: false,
      user_metadata: { full_name: displayName || email.split("@")[0] },
    });
    if (error) {
      user = await findAuthUser(admin, email);
      if (!user) throw error;
    } else {
      user = data.user;
    }
  }

  const { error: workspaceError } = await admin.rpc(
    "ensure_academy_user_workspace",
    {
      target_user_id: user.id,
      target_full_name: displayName || "",
      target_company_name: "",
    },
  );
  if (workspaceError) throw workspaceError;

  const { data: linkedMember, error: linkedError } = await admin
    .from("academy_members")
    .select("id,user_id")
    .eq("academy_community_id", communityId)
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (linkedError) throw linkedError;
  let memberId = linkedMember?.id as string | undefined;

  if (!memberId) {
    const { data: invite, error: inviteError } = await admin
      .from("academy_member_invites")
      .select("academy_member_id")
      .eq("academy_community_id", communityId)
      .eq("email", email)
      .neq("status", "cancelled")
      .limit(1)
      .maybeSingle();
    if (inviteError) throw inviteError;
    if (invite?.academy_member_id) {
      const { data: claimed, error: claimError } = await admin
        .from("academy_members")
        .update({
          user_id: user.id,
          status: "active",
          last_seen_at: new Date().toISOString(),
        })
        .eq("id", invite.academy_member_id)
        .eq("academy_community_id", communityId)
        .or(`user_id.is.null,user_id.eq.${user.id}`)
        .select("id")
        .maybeSingle();
      if (claimError || !claimed) {
        throw claimError ||
          new Error("Imported Academy identity belongs to another account");
      }
      memberId = claimed.id;
    }
  }

  if (!memberId) {
    const { data: created, error: createError } = await admin
      .from("academy_members")
      .insert({
        academy_community_id: communityId,
        user_id: user.id,
        status: "active",
        display_name: displayName || email.split("@")[0],
        joined_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (createError) throw createError;
    memberId = created.id;
  }
  if (!memberId) throw new Error("Academy member could not be resolved");

  const now = new Date().toISOString();
  const { data: priorInvite, error: priorInviteError } = await admin.from(
    "academy_member_invites",
  ).select("id").eq("academy_member_id", memberId).maybeSingle();
  if (priorInviteError) throw priorInviteError;
  // Keep imported/manual attribution and invite history intact.
  if (!priorInvite) {
    const { error: inviteError } = await admin.from("academy_member_invites")
      .insert({
        academy_community_id: communityId,
        academy_member_id: memberId,
        email,
        status: "provisioned",
        invited_user_id: user.id,
        source_provider: "stripe",
        provisioned_at: now,
        last_attempt_at: now,
        last_action: "provision",
        error_message: null,
      });
    if (inviteError && inviteError.code !== "23505") throw inviteError;
  }
  return { userId: user.id, memberId, email };
}

async function findAuthUser(admin: SupabaseClient, email: string) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw error;
    const found = data.users.find((candidate) =>
      normalizeBillingEmail(candidate.email) === email
    );
    if (found) return found;
    if (data.users.length < 1000) return null;
  }
  throw new Error("Auth user lookup exceeded the supported account size");
}

async function applyBillingEvent(
  admin: SupabaseClient,
  values: {
    plan: BillingPlan;
    buyer: Buyer;
    customerId: string;
    subscriptionId: string;
    checkoutSessionId: string;
    status: string;
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: string | null;
    sourceType: "stripe_subscription" | "stripe_payment";
    sourceKey: string;
  },
) {
  const { error } = await admin.rpc("apply_academy_billing_event", {
    p_plan_id: values.plan.id,
    p_member_id: values.buyer.memberId,
    p_provider_customer_id: values.customerId,
    p_provider_subscription_id: values.subscriptionId,
    p_checkout_session_id: values.checkoutSessionId,
    p_status: values.status,
    p_cancel_at_period_end: values.cancelAtPeriodEnd,
    p_current_period_end: values.currentPeriodEnd,
    p_source_type: values.sourceType,
    p_source_key: values.sourceKey,
    p_email: values.buyer.email,
  });
  if (error) throw error;
}

function subscriptionPeriodEnd(subscription: Stripe.Subscription) {
  const raw = subscription as unknown as Record<string, unknown>;
  const direct = unixTimestamp(raw.current_period_end);
  if (direct) return direct;
  const itemPeriods = subscription.items.data
    .map((item) =>
      unixTimestamp(
        (item as unknown as Record<string, unknown>).current_period_end,
      )
    )
    .filter((value): value is string => Boolean(value));
  return itemPeriods.sort().at(-1) ?? null;
}

async function oneTimePaymentStatus(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
) {
  const paymentId = stringId(session.payment_intent);
  // Zero-total checkouts (e.g. an approved discount) can lack a payment intent.
  if (!paymentId) return "active";
  const payment = await stripe.paymentIntents.retrieve(paymentId, {
    expand: ["latest_charge"],
  });
  const charge = payment.latest_charge;
  return typeof charge === "object" && charge?.refunded
    ? "cancelled"
    : "active";
}

async function processRefund(
  admin: SupabaseClient,
  stripe: Stripe,
  object: Stripe.Event.Data.Object,
) {
  if (!("id" in object) || typeof object.id !== "string") {
    throw new Error("Refund has no charge ID");
  }
  const charge = await stripe.charges.retrieve(object.id);
  // Partial refunds do not end access. Subscription refunds do not cancel the
  // subscription; its own current status continues to determine entitlement.
  if (!charge.refunded) return;
  const paymentId = stringId(charge.payment_intent);
  if (!paymentId) return;
  const sessions = await stripe.checkout.sessions.list({
    payment_intent: paymentId,
    limit: 100,
  });
  for (const session of sessions.data) {
    if (session.mode === "payment" && isUuid(session.metadata?.plan_id)) {
      await processCheckout(admin, stripe, session);
    }
  }
}

async function knownBuyerEmail(
  admin: SupabaseClient,
  customerId: string,
  fallback: string,
) {
  const { data, error } = await admin.from("academy_billing_customers").select(
    "email",
  ).eq("provider_customer_id", customerId).maybeSingle();
  if (error) throw error;
  // A later Stripe dashboard email edit must not move an existing entitlement.
  return data?.email ? normalizeBillingEmail(data.email) : fallback;
}
