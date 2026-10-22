import { isUuid, stringId } from './billing.ts';
import { appOrigin } from './checkout.ts';
import type Stripe from 'npm:stripe@22.6.2';

export type ServiceTerms = { service_key: string; amount_cents: number; currency: string; billing_interval: string; stripe_price_id: string | null };
const serviceNames: Record<string, string> = { website: 'Website setup', ghl: 'GoHighLevel setup', 'seo-aeo': 'SEO / AEO setup', 'facebook-ads': 'Facebook ads management', 'website-care': 'Website care', 'ghl-subscription': 'GoHighLevel subscription' };
export function validServiceTerms(value: ServiceTerms) {
  const interval = ['website', 'ghl', 'seo-aeo'].includes(value.service_key) ? 'one_time' : 'month';
  const range = ['website', 'ghl', 'seo-aeo'].includes(value.service_key) ? [149500, 249500]
    : value.service_key === 'facebook-ads' ? [49500, 89500]
    : value.service_key === 'website-care' ? [9700, 9700]
    : value.service_key === 'ghl-subscription' ? [19700, 19700] : null;
  return Boolean(range && Number.isSafeInteger(value.amount_cents) && value.amount_cents >= range[0] && value.amount_cents <= range[1]
    && value.currency === 'usd' && value.billing_interval === interval && (value.stripe_price_id === null || (typeof value.stripe_price_id === 'string' && /^price_[A-Za-z0-9]+$/.test(value.stripe_price_id) && !/\s/.test(value.stripe_price_id))));
}
export function servicePriceMatches(terms: ServiceTerms, price: any, livemode: boolean, requireActive = true) {
  return validServiceTerms(terms) && typeof price?.id === 'string' && /^price_[A-Za-z0-9]+$/.test(price.id) && !/\s/.test(price.id) && (terms.stripe_price_id === null || price.id === terms.stripe_price_id) && (!requireActive || price.active === true)
    && price.livemode === livemode && price.unit_amount === terms.amount_cents && price.currency === 'usd'
    && price.billing_scheme === 'per_unit' && price.transform_quantity == null && price.custom_unit_amount == null
    && (terms.billing_interval === 'one_time' ? price.type === 'one_time' && price.recurring == null
      : price.type === 'recurring' && price.recurring?.interval === 'month' && price.recurring?.interval_count === 1 && price.recurring?.usage_type === 'licensed');
}
export function serviceCheckoutUrl(value: unknown) {
  if (typeof value !== 'string') throw new Error('Invalid service Checkout URL');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com' || url.port || url.username || url.password) throw new Error('Invalid service Checkout URL');
  return url.href;
}
export function serviceSessionMatches(order: any, session: any, livemode: boolean) {
  const items = session?.line_items;
  const item = items?.data?.[0];
  return validServiceTerms(order) && order.stripe_livemode === livemode && session?.livemode === livemode
    && (order.stripe_session_id == null || session.id === order.stripe_session_id)
    && session.client_reference_id === order.user_id && session.metadata?.kind === 'dirty_turf_business_service'
    && session.metadata?.service_order_id === order.id && session.metadata?.service_quote_id === order.quote_id
    && session.metadata?.academy_community_id === order.academy_community_id && session.metadata?.service_key === order.service_key
    && (order.provider_customer_id == null || stringId(session.customer) === order.provider_customer_id)
    && (order.provider_subscription_id == null || stringId(session.subscription) === order.provider_subscription_id)
    && session.mode === (order.billing_interval === 'one_time' ? 'payment' : 'subscription')
    && session.currency === 'usd' && session.amount_subtotal === order.amount_cents && session.amount_total === order.amount_cents
    && items?.has_more === false && items.data.length === 1 && item.quantity === 1
    && item.amount_subtotal === order.amount_cents && item.amount_total === order.amount_cents
    && servicePriceMatches(order, item.price, livemode, false);
}
const response = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
type Dependencies = { admin: any; stripe: Stripe; enabled: boolean; livemode: boolean; appUrl?: string; recurringEnabled?: boolean; configurationId?: string };
function servicePortalReady(configuration: any, livemode: boolean) {
  return configuration?.active === true && configuration.livemode === livemode && configuration.features?.subscription_cancel?.enabled === true && configuration.features?.subscription_update?.enabled !== true;
}

export function serviceSubscriptionMatches(order: any, subscription: any, livemode: boolean) {
  const item = subscription?.items?.data?.[0];
  return order.billing_interval === 'month' && order.stripe_livemode === livemode && subscription.livemode === livemode
    && subscription.metadata?.kind === 'dirty_turf_business_service' && subscription.metadata?.service_order_id === order.id
    && subscription.metadata?.service_quote_id === order.quote_id && subscription.metadata?.academy_community_id === order.academy_community_id
    && subscription.metadata?.service_key === order.service_key && Boolean(stringId(subscription.customer))
    && (order.provider_customer_id == null || stringId(subscription.customer) === order.provider_customer_id)
    && (order.provider_subscription_id == null || subscription.id === order.provider_subscription_id)
    && subscription.items?.has_more === false && subscription.items.data.length === 1 && item.quantity === 1
    && servicePriceMatches(order, item.price, livemode, false);
}

export function createServicePortalHandler({ admin, stripe, enabled, livemode, appUrl, configurationId }: Dependencies & { configurationId?: string }) {
  return async (request: Request) => {
    if (request.method !== 'POST') return response({ error: 'Method not allowed' }, 405);
    const origin = appOrigin(appUrl);
    if (!origin || request.headers.get('origin') !== origin) return response({ error: 'Service billing is available on the web app only' }, 403);
    if (!enabled || !configurationId || !/^bpc_[A-Za-z0-9]+$/.test(configurationId)) return response({ error: 'Service billing is not configured' }, 503);
    const bearer = request.headers.get('authorization');
    if (!bearer?.startsWith('Bearer ')) return response({ error: 'Sign in to manage service billing' }, 401);
    let body: any;
    try { body = await request.json(); } catch { return response({ error: 'Invalid payload' }, 400); }
    if (!body || !isUuid(body.orderId) || Object.keys(body).some(key => key !== 'orderId')) return response({ error: 'Choose a valid service order' }, 422);
    try {
      const auth = await admin.auth.getUser(bearer.slice(7));
      if (auth.error || !auth.data?.user) return response({ error: 'Sign in again' }, 401);
      const found = await admin.from('academy_service_orders').select('*').eq('id', body.orderId).eq('user_id', auth.data.user.id).maybeSingle();
      const order = found.data;
      if (found.error || !order || order.user_id !== auth.data.user.id || order.billing_interval !== 'month' || order.status !== 'paid' || !order.provider_customer_id || !order.provider_subscription_id || order.stripe_livemode !== livemode) return response({ error: 'No service billing account is connected to this order' }, 404);
      const customer = await stripe.customers.retrieve(order.provider_customer_id);
      if (customer.deleted || customer.id !== order.provider_customer_id || customer.livemode !== livemode) throw new Error('Customer mismatch');
      const subscription = await stripe.subscriptions.retrieve(order.provider_subscription_id, { expand: ['items.data.price'] });
      if (!serviceSubscriptionMatches(order, subscription, livemode)) throw new Error('Subscription mismatch');
      const configuration = await stripe.billingPortal.configurations.retrieve(configurationId);
      if (!servicePortalReady(configuration, livemode)) return response({ error: 'Service cancellation is not configured. Contact support.' }, 503);
      const session = await stripe.billingPortal.sessions.create({ customer: customer.id, configuration: configurationId, return_url: `${origin}/billing` });
      const url = new URL(session.url);
      if (url.protocol !== 'https:' || url.hostname !== 'billing.stripe.com' || url.port || url.username || url.password) throw new Error('Portal URL mismatch');
      return response({ url: url.href });
    } catch { return response({ error: 'Service billing could not open. Please retry or contact support.' }, 502); }
  };
}

export function createServiceCheckoutHandler({ admin, stripe, enabled, livemode, appUrl, recurringEnabled = false, configurationId }: Dependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return response({ error: 'Method not allowed' }, 405);
    const origin = appOrigin(appUrl);
    if (!origin || request.headers.get('origin') !== origin) return response({ error: 'Service checkout is available on the web app only' }, 403);
    if (!enabled) return response({ error: 'Service checkout is not open yet' }, 503);
    const bearer = request.headers.get('authorization');
    if (!bearer?.startsWith('Bearer ')) return response({ error: 'Sign in to continue' }, 401);
    let body: any;
    try { body = await request.json(); } catch { return response({ error: 'Invalid JSON payload' }, 400); }
    if (!body || !isUuid(body.quoteId) || !isUuid(body.requestId) || Object.keys(body).some(key => !['quoteId', 'requestId'].includes(key))) return response({ error: 'A quote and request ID are required' }, 422);
    try {
      const auth = await admin.auth.getUser(bearer.slice(7));
      const user = auth.data?.user;
      if (auth.error || !user?.email || !isUuid(user.id)) return response({ error: 'Sign in again to continue' }, 401);
      const found = await admin.from('academy_service_quotes').select('*').eq('id', body.quoteId).eq('user_id', user.id).maybeSingle();
      if (found.error) throw found.error;
      const quote = found.data;
      if (!quote || quote.user_id !== user.id || quote.status !== 'offered') return response({ error: 'This quote is unavailable or already paid' }, 409);
      if (quote.billing_interval === 'month' && !recurringEnabled) return response({ error: 'Recurring services are not open yet' }, 503);
      if (quote.billing_interval === 'month') {
        if (!configurationId || !/^bpc_[A-Za-z0-9]+$/.test(configurationId) || !servicePortalReady(await stripe.billingPortal.configurations.retrieve(configurationId), livemode)) return response({ error: 'Service cancellation must be configured before subscribing' }, 503);
      }
      if (!validServiceTerms(quote)) return response({ error: 'The service quote needs administrator review' }, 503);
      if (quote.stripe_price_id !== null) {
        const academy = await admin.from('academy_billing_plans').select('id').eq('stripe_price_id', quote.stripe_price_id).maybeSingle();
        if (academy.error || academy.data) throw new Error('Service price must be separate from Academy access');
        const price = await stripe.prices.retrieve(quote.stripe_price_id);
        if (!servicePriceMatches(quote, price, livemode)) return response({ error: 'The service price needs administrator review' }, 503);
      }
      const reserved = await admin.rpc('reserve_academy_service_checkout', { p_quote_id: quote.id, p_user_id: user.id, p_request_id: body.requestId, p_livemode: livemode });
      if (reserved.error) throw reserved.error;
      const order = reserved.data;
      if (!order || !isUuid(order.id) || order.user_id !== user.id || order.quote_id !== quote.id || order.status !== 'pending') return response({ error: 'A checkout is unavailable or already paid' }, 409);
      if (order.stripe_session_id) {
        const existing = await stripe.checkout.sessions.retrieve(order.stripe_session_id, { expand: ['line_items.data.price'] });
        if (!serviceSessionMatches(order, existing, livemode)) throw new Error('Service session identity conflict');
        if (existing.payment_status === 'paid') return response({ error: 'Payment received; waiting for payment confirmation', code: 'payment_pending_confirmation' }, 409);
        if (existing.status === 'open') return response({ url: serviceCheckoutUrl(existing.url) });
        if (existing.status === 'expired') {
          const cancelled = await admin.rpc('apply_academy_service_checkout', { p_order_id: order.id, p_session_id: existing.id, p_event_id: `checkout-expiry:${existing.id}`, p_status: 'cancelled', p_customer_id: null, p_subscription_id: null, p_payment_intent_id: null });
          if (cancelled.error) throw cancelled.error;
          return response({ error: 'The previous checkout expired. Select Pay again to open a fresh checkout.' }, 409);
        }
        return response({ error: 'Payment is still processing. Refresh your orders shortly.' }, 409);
      }
      const expiresAt = Math.floor(Date.parse(order.expires_at) / 1000);
      if (!Number.isSafeInteger(expiresAt) || expiresAt < Math.floor(Date.now() / 1000) + 31 * 60) return response({ error: 'Checkout recovery needs administrator review. Please do not open a second payment.' }, 409);
      const metadata = { kind: 'dirty_turf_business_service', service_order_id: order.id, service_quote_id: order.quote_id, academy_community_id: order.academy_community_id, service_key: order.service_key };
      const session = await stripe.checkout.sessions.create({
        mode: order.billing_interval === 'one_time' ? 'payment' : 'subscription',
        line_items: [{ ...(order.stripe_price_id ? { price: order.stripe_price_id } : { price_data: { currency: 'usd', unit_amount: order.amount_cents, product_data: { name: serviceNames[order.service_key], metadata: { kind: 'dirty_turf_business_service' } }, ...(order.billing_interval === 'month' ? { recurring: { interval: 'month' } } : {}) } }), quantity: 1 }], customer_email: user.email,
        client_reference_id: user.id, metadata,
        ...(order.billing_interval === 'month' ? { subscription_data: { metadata } } : {}),
        allow_promotion_codes: false, automatic_tax: { enabled: false }, adaptive_pricing: { enabled: false },
        success_url: `${origin}/?view=grow&service_checkout=return`, cancel_url: `${origin}/?view=grow&service_checkout=cancelled`,
        expires_at: expiresAt, integration_identifier: 'dirty_turf_services_gqkmdzvr',
        branding_settings: { display_name: 'Dirty Turf', background_color: '#f4faee', button_color: '#047631', font_family: 'montserrat', logo: { type: 'url', url: `${origin}/dirty-turf-logo.png` } },
      }, { idempotencyKey: `dirty-turf-service:${order.id}` });
      const url = serviceCheckoutUrl(session.url);
      const recorded = await admin.rpc('record_academy_service_checkout', { p_order_id: order.id, p_session_id: session.id, p_url: url });
      if (recorded.error) throw recorded.error;
      return response({ url });
    } catch { return response({ error: 'Service checkout could not open. Retry the same quote; a second payment will not be created.' }, 409); }
  };
}

export function createServiceWebhookHandler({ admin, stripe, enabled, livemode, signingSecret, cryptoProvider }: Omit<Dependencies, 'appUrl'> & { signingSecret?: string; cryptoProvider?: ReturnType<typeof Stripe.createSubtleCryptoProvider> }) {
  const reconcileSubscription = async (subscriptionId: string, eventCreated: number, invoiceCustomerId?: string) => {
    if (!/^sub_[A-Za-z0-9]+$/.test(subscriptionId) || !Number.isSafeInteger(eventCreated) || eventCreated < 0) throw new Error('Invalid service subscription event');
    const subscription = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['items.data.price'] });
    if (subscription.id !== subscriptionId || subscription.livemode !== livemode) throw new Error('Service subscription identity conflict');
    // Prefer the saved first-class provider relationship. Metadata is a guarded
    // fallback only when the initial subscription event precedes Checkout.
    let found = await admin.from('academy_service_orders').select('*').eq('provider_subscription_id', subscriptionId).maybeSingle();
    if (found.error) throw found.error;
    if (!found.data) {
      if (subscription.metadata?.kind !== 'dirty_turf_business_service') return false;
      const orderId = subscription.metadata?.service_order_id;
      if (!isUuid(orderId)) throw new Error('Missing service order');
      found = await admin.from('academy_service_orders').select('*').eq('id', orderId).maybeSingle();
    }
    const order = found.data;
    if (found.error || !order || !serviceSubscriptionMatches(order, subscription, livemode)
      || (invoiceCustomerId !== undefined && invoiceCustomerId !== stringId(subscription.customer))) throw new Error('Service subscription mismatch');
    const end = subscription.items.data[0].current_period_end;
    // Refresh current provider state, never infer it from the event name. The
    // existing SQL timestamp guard rejects older deliveries; exact replays have
    // no payment/access side effect and cannot mark an initial order as paid.
    const result = await admin.rpc('apply_academy_service_subscription', { p_order_id: order.id, p_subscription_id: subscription.id, p_customer_id: stringId(subscription.customer), p_status: subscription.status, p_cancel_at_period_end: subscription.cancel_at_period_end === true, p_current_period_end: typeof end === 'number' && Number.isFinite(end) ? new Date(end * 1000).toISOString() : null, p_event_created: eventCreated });
    if (result.error) throw result.error;
    return true;
  };
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return response({ error: 'Method not allowed' }, 405);
    if (!enabled || !signingSecret) return response({ error: 'Service payments are not configured' }, 503);
    const signature = request.headers.get('stripe-signature');
    if (!signature) return response({ error: 'Signature required' }, 400);
    let event: any;
    try {
      const raw = await request.text();
      event = cryptoProvider ? await stripe.webhooks.constructEventAsync(raw, signature, signingSecret, undefined, cryptoProvider) : await stripe.webhooks.constructEventAsync(raw, signature, signingSecret);
    }
    catch { return response({ error: 'Invalid signature' }, 400); }
    if (event.livemode !== livemode) return response({ error: 'Wrong Stripe mode' }, 400);
    const subscriptionTypes = ['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'];
    if (subscriptionTypes.includes(event.type)) {
      try {
        await reconcileSubscription(event.data.object.id, event.created);
        return response({ received: true });
      } catch { return response({ error: 'Service subscription requires retry or review' }, 500); }
    }
    if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
      try {
        const invoice = await stripe.invoices.retrieve(event.data.object.id);
        if (invoice.id !== event.data.object.id || invoice.livemode !== livemode) throw new Error('Service invoice identity conflict');
        // Stripe 2026 invoice ownership is carried by parent subscription
        // details, not invoice metadata or the obsolete invoice.subscription.
        const subscriptionId = invoice.parent?.type === 'subscription_details' ? stringId(invoice.parent.subscription_details?.subscription) : '';
        if (!subscriptionId) return response({ received: true });
        const customerId = stringId(invoice.customer);
        if (!customerId) throw new Error('Missing service invoice customer');
        await reconcileSubscription(subscriptionId, event.created, customerId);
        return response({ received: true });
      } catch { return response({ error: 'Service invoice requires retry or review' }, 500); }
    }
    const types = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired'];
    if (!types.includes(event.type) || event.data.object.metadata?.kind !== 'dirty_turf_business_service') return response({ received: true });
    try {
      const session = await stripe.checkout.sessions.retrieve(event.data.object.id, { expand: ['line_items.data.price'] });
      const orderId = session.metadata?.service_order_id;
      if (!isUuid(orderId)) throw new Error('Missing service order');
      const found = await admin.from('academy_service_orders').select('*').eq('id', orderId).maybeSingle();
      if (found.error || !found.data || !serviceSessionMatches(found.data, session, livemode)) throw new Error('Service payment identity conflict');
      let status: string | undefined;
      if (session.status === 'complete' && session.payment_status === 'paid') status = 'paid';
      else if (event.type === 'checkout.session.expired' && session.status === 'expired') status = 'cancelled';
      else if (event.type === 'checkout.session.async_payment_failed' && session.status === 'complete' && session.payment_status === 'unpaid') status = 'failed';
      if (!status) return response({ received: true, pending: true });
      if (status === 'paid' && found.data.billing_interval === 'month' && !stringId(session.subscription)) throw new Error('Missing service subscription');
      const result = await admin.rpc('apply_academy_service_checkout', { p_order_id: orderId, p_session_id: session.id, p_event_id: event.id, p_status: status, p_customer_id: stringId(session.customer) || null, p_subscription_id: stringId(session.subscription) || null, p_payment_intent_id: stringId(session.payment_intent) || null });
      if (result.error) throw result.error;
      return response({ received: true });
    } catch { return response({ error: 'Service payment requires retry or review' }, 500); }
  };
}
