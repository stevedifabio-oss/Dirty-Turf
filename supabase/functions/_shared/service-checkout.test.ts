import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createServiceCheckoutHandler, createServicePortalHandler, createServiceWebhookHandler, servicePriceMatches, serviceSessionMatches } from './service-checkout';

const userId = '6f332edd-a662-4e5a-ab75-4cb23e85a292';
const quoteId = '6f332edd-a662-4e5a-ab75-4cb23e85a293';
const orderId = '6f332edd-a662-4e5a-ab75-4cb23e85a294';
const requestId = '6f332edd-a662-4e5a-ab75-4cb23e85a295';
const communityId = '6f332edd-a662-4e5a-ab75-4cb23e85a296';
const price = { id: 'price_service', active: true, livemode: false, unit_amount: 149500, currency: 'usd', billing_scheme: 'per_unit', type: 'one_time', recurring: null };
const quote = { id: quoteId, user_id: userId, academy_community_id: communityId, service_key: 'website', stripe_price_id: price.id, amount_cents: 149500, currency: 'usd', billing_interval: 'one_time', status: 'offered' };
const order = { ...quote, id: orderId, quote_id: quoteId, status: 'pending', stripe_livemode: false, stripe_session_id: null, expires_at: new Date(Date.now() + 3600000).toISOString() };
const session = () => ({ id: 'cs_test_service', livemode: false, status: 'complete', payment_status: 'paid', mode: 'payment', currency: 'usd', client_reference_id: userId, metadata: { kind: 'dirty_turf_business_service', service_order_id: orderId, service_quote_id: quoteId, service_key: 'website', academy_community_id: communityId }, amount_subtotal: 149500, amount_total: 149500, line_items: { has_more: false, data: [{ price: { ...price }, quantity: 1, amount_subtotal: 149500, amount_total: 149500 }] }, customer: 'cus_service', payment_intent: 'pi_service', url: 'https://checkout.stripe.com/c/pay/cs_test_service' });
const recurringPrice = () => ({ ...price, unit_amount: 9700, type: 'recurring', recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' } });
const recurringOrder = () => ({ ...order, status: 'paid', billing_interval: 'month', service_key: 'website-care', amount_cents: 9700, provider_customer_id: 'cus_service', provider_subscription_id: 'sub_service' });
const subscription = () => ({ id: 'sub_service', customer: 'cus_service', livemode: false, status: 'active', cancel_at_period_end: false, metadata: { kind: 'dirty_turf_business_service', service_order_id: orderId, service_quote_id: quoteId, service_key: 'website-care', academy_community_id: communityId }, items: { has_more: false, data: [{ price: recurringPrice(), quantity: 1, current_period_end: 1800000000 }] } });
const invoice = () => ({ id: 'in_service', customer: 'cus_service', livemode: false, status: 'paid', parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_service' } } });
let admin: any, stripe: any, rows: Record<string, any>, event: any;
const checkoutRequest = (body: any = { quoteId, requestId }, origin = 'https://app.dirtyturf.com') => new Request('https://edge.test/create-service-checkout', { method: 'POST', headers: { Origin: origin, Authorization: 'Bearer verified-user', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const hookRequest = (signature = 'signed-fixture') => new Request('https://edge.test/service-stripe-webhook', { method: 'POST', headers: signature ? { 'stripe-signature': signature } : {}, body: 'exact-raw-body' });
const checkout = (patch: any = {}) => createServiceCheckoutHandler({ admin, stripe, enabled: true, livemode: false, appUrl: 'https://app.dirtyturf.com', ...patch });
const webhook = () => createServiceWebhookHandler({ admin, stripe, enabled: true, livemode: false, signingSecret: 'fixture-signing-secret' });
beforeEach(() => {
  rows = { academy_service_quotes: { ...quote }, academy_service_orders: { ...order }, academy_billing_plans: null };
  admin = { auth: { getUser: vi.fn(async () => ({ data: { user: { id: userId, email: 'verified@example.test' } }, error: null })) },
    from: vi.fn((table: string) => { const filters: [string, unknown][] = []; const builder: any = { select: () => builder, eq: (key: string, value: unknown) => { filters.push([key, value]); return builder; }, maybeSingle: async () => ({ data: rows[table] && filters.every(([key, value]) => rows[table][key] === value) ? rows[table] : null, error: null }) }; return builder; }),
    rpc: vi.fn(async (name: string) => ({ data: name === 'reserve_academy_service_checkout' ? { ...order } : null, error: null })) };
  event = { id: 'evt_service', livemode: false, type: 'checkout.session.completed', data: { object: { id: 'cs_test_service', metadata: { kind: 'dirty_turf_business_service' } } } };
  stripe = { prices: { retrieve: vi.fn(async () => ({ ...price })) }, checkout: { sessions: { create: vi.fn(async () => ({ id: 'cs_test_service', url: 'https://checkout.stripe.com/c/pay/cs_test_service' })), retrieve: vi.fn(async () => session()) } }, webhooks: { constructEventAsync: vi.fn(async () => event) }, subscriptions: { retrieve: vi.fn(async () => subscription()) }, invoices: { retrieve: vi.fn(async () => invoice()) }, customers: { retrieve: vi.fn(async () => ({ id: 'cus_service', livemode: false })) }, billingPortal: { configurations: { retrieve: vi.fn(async () => ({ active: true, livemode: false, features: { subscription_cancel: { enabled: true }, subscription_update: { enabled: false } } })) }, sessions: { create: vi.fn(async () => ({ url: 'https://billing.stripe.com/p/session/fixture' })) } } };
});

describe('isolated service Checkout', () => {
  it('is disabled by default and rejects native origin without creating payment', async () => {
    expect((await checkout({ enabled: false })(checkoutRequest())).status).toBe(503);
    expect((await checkout()(checkoutRequest(undefined, 'capacitor://localhost'))).status).toBe(403);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
  it('charges only the server quote, with verified email and a stable persisted idempotency key', async () => {
    expect((await checkout()(checkoutRequest())).status).toBe(200);
    const [params, options] = stripe.checkout.sessions.create.mock.calls[0];
    expect(params.line_items).toEqual([{ price: 'price_service', quantity: 1 }]);
    expect(params.customer_email).toBe('verified@example.test');
    expect(params.metadata.kind).toBe('dirty_turf_business_service');
    expect(params.metadata.plan_id).toBeUndefined();
    expect(params.success_url).toBe('https://app.dirtyturf.com/?view=grow&service_checkout=return');
    expect(params.payment_method_types).toBeUndefined();
    expect(options.idempotencyKey).toBe(`dirty-turf-service:${orderId}`);
    expect(admin.rpc).toHaveBeenCalledWith('reserve_academy_service_checkout', { p_quote_id: quoteId, p_user_id: userId, p_request_id: requestId, p_livemode: false });
  });
  it('creates inline service pricing only from immutable DB terms, with no Price or Product API calls', async () => {
    rows.academy_service_quotes.stripe_price_id = null;
    admin.rpc.mockImplementation(async (name: string) => ({ data: name === 'reserve_academy_service_checkout' ? { ...order, stripe_price_id: null } : null, error: null }));
    expect((await checkout()(checkoutRequest())).status).toBe(200);
    expect(stripe.prices.retrieve).not.toHaveBeenCalled();
    expect(stripe.checkout.sessions.create.mock.calls[0][0].line_items).toEqual([{ quantity: 1, price_data: { currency: 'usd', unit_amount: 149500, product_data: { name: 'Website setup', metadata: { kind: 'dirty_turf_business_service' } } } }]);
  });
  it('refuses client-supplied price, amount, email or quantity', async () => {
    for (const extra of [{ email: 'attacker@example.test' }, { stripePriceId: 'price_attacker' }, { amount: 1 }, { quantity: 2 }]) expect((await checkout()(checkoutRequest({ quoteId, requestId, ...extra }))).status).toBe(422);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
  it('refuses invalid sessions and quote owners', async () => {
    admin.auth.getUser.mockResolvedValueOnce({ error: 'expired', data: { user: null } });
    expect((await checkout()(checkoutRequest())).status).toBe(401);
    rows.academy_service_quotes.user_id = requestId;
    expect((await checkout()(checkoutRequest())).status).toBe(409);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
  it.each([{ unit_amount: 149499 }, { livemode: true }, { id: 'price_wrong' }, { active: false }, { currency: 'eur' }, { billing_scheme: 'tiered' }])('holds wrong Stripe pricing %j', async patch => {
    stripe.prices.retrieve.mockResolvedValue({ ...price, ...patch });
    expect((await checkout()(checkoutRequest())).status).toBe(503);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
  it('blocks a service price that is also an Academy grant product', async () => {
    rows.academy_billing_plans = { id: 'academy-plan', stripe_price_id: price.id };
    expect((await checkout()(checkoutRequest())).status).toBe(409);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
  it('resumes the same authoritative open session across client retry IDs', async () => {
    admin.rpc.mockResolvedValue({ data: { ...order, stripe_session_id: 'cs_test_service' }, error: null });
    stripe.checkout.sessions.retrieve.mockResolvedValue({ ...session(), status: 'open', payment_status: 'unpaid' });
    expect((await checkout()(checkoutRequest({ quoteId, requestId: crypto.randomUUID() }))).status).toBe(200);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
  it('never opens another session when payment awaits webhook confirmation', async () => {
    admin.rpc.mockResolvedValue({ data: { ...order, stripe_session_id: 'cs_test_service' }, error: null });
    expect((await checkout()(checkoutRequest())).status).toBe(409);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
  it('fails closed when active access or the DB reservation is denied', async () => {
    admin.rpc.mockResolvedValue({ data: null, error: 'access denied' });
    expect((await checkout()(checkoutRequest())).status).toBe(409);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
  it('holds recurring service sales until their separate readiness flag is enabled', async () => {
    rows.academy_service_quotes = { ...quote, service_key: 'website-care', amount_cents: 9700, billing_interval: 'month' };
    expect((await checkout()(checkoutRequest())).status).toBe(503);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
});

describe('service-only authoritative webhook', () => {
  it('validates the exact raw signed body before reading order data', async () => {
    stripe.webhooks.constructEventAsync.mockRejectedValueOnce(new Error('signature'));
    expect((await webhook()(hookRequest())).status).toBe(400);
    expect(admin.from).not.toHaveBeenCalled();
    expect(stripe.webhooks.constructEventAsync).toHaveBeenCalledWith('exact-raw-body', 'signed-fixture', 'fixture-signing-secret');
    expect((await webhook()(hookRequest(''))).status).toBe(400);
  });
  it('rejects the wrong mode before database mutations', async () => {
    event.livemode = true;
    expect((await webhook()(hookRequest())).status).toBe(400);
    expect(admin.rpc).not.toHaveBeenCalled();
  });
  it('processes complete paid payment and async success through only the service RPC', async () => {
    for (const type of ['checkout.session.completed', 'checkout.session.async_payment_succeeded']) {
      event.type = type;
      expect((await webhook()(hookRequest())).status).toBe(200);
    }
    expect(admin.rpc).toHaveBeenCalledTimes(2);
    expect(admin.rpc.mock.calls.every(([name]: string[]) => name === 'apply_academy_service_checkout')).toBe(true);
    expect(admin.rpc.mock.calls[0][1]).toMatchObject({ p_order_id: orderId, p_status: 'paid', p_customer_id: 'cus_service', p_payment_intent_id: 'pi_service' });
  });
  it('never considers an unpaid completed session paid', async () => {
    stripe.checkout.sessions.retrieve.mockResolvedValue({ ...session(), payment_status: 'unpaid' });
    expect((await webhook()(hookRequest())).status).toBe(200);
    expect(admin.rpc).not.toHaveBeenCalled();
  });
  it.each(['owner', 'price', 'amount', 'quantity', 'metadata', 'pagination'])('refuses authoritative session mismatch: %s', async mismatch => {
    const value = session();
    if (mismatch === 'owner') value.client_reference_id = requestId;
    if (mismatch === 'price') value.line_items.data[0].price.id = 'price_other';
    if (mismatch === 'amount') value.amount_total = 1;
    if (mismatch === 'quantity') value.line_items.data[0].quantity = 2;
    if (mismatch === 'metadata') value.metadata.service_quote_id = requestId;
    if (mismatch === 'pagination') value.line_items.has_more = true;
    stripe.checkout.sessions.retrieve.mockResolvedValue(value);
    expect((await webhook()(hookRequest())).status).toBe(500);
    expect(admin.rpc).not.toHaveBeenCalled();
  });
  it('ignores unrelated Academy or third-party Checkout events', async () => {
    event.data.object.metadata.kind = 'academy';
    expect((await webhook()(hookRequest())).status).toBe(200);
    expect(stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
    expect(admin.rpc).not.toHaveBeenCalled();
  });
  it('does not require a price to remain for sale when fulfilling a prior paid checkout', () => {
    expect(servicePriceMatches(order, { ...price, active: false }, false)).toBe(false);
    const value = session(); value.line_items.data[0].price.active = false;
    expect(serviceSessionMatches(order, value, false)).toBe(true);
  });
  it('validates amount, type and mode even when Checkout generated the inline Price ID', () => {
    const inline = { ...order, stripe_price_id: null };
    const value = session();
    expect(serviceSessionMatches(inline, value, false)).toBe(true);
    value.line_items.data[0].price.unit_amount = 1;
    expect(serviceSessionMatches(inline, value, false)).toBe(false);
    value.line_items.data[0].price = { ...price, type: 'recurring' };
    expect(serviceSessionMatches(inline, value, false)).toBe(false);
    value.line_items.data[0].price = { ...price, livemode: true };
    expect(serviceSessionMatches(inline, value, false)).toBe(false);
  });
  it('reconciles subscription status and cancellation independently from Academy billing', async () => {
    rows.academy_service_orders = recurringOrder();
    event = { ...event, type: 'customer.subscription.updated', created: 1790000000, data: { object: { id: 'sub_service', metadata: { kind: 'dirty_turf_business_service' } } } };
    expect((await webhook()(hookRequest())).status).toBe(200);
    expect(admin.rpc).toHaveBeenCalledWith('apply_academy_service_subscription', expect.objectContaining({ p_order_id: orderId, p_subscription_id: 'sub_service', p_customer_id: 'cus_service', p_status: 'active', p_cancel_at_period_end: false, p_event_created: 1790000000 }));
  });
  it('refuses subscription customer, price and metadata reassignment', async () => {
    rows.academy_service_orders = recurringOrder();
    event = { ...event, type: 'customer.subscription.deleted', created: 1790000000, data: { object: { id: 'sub_service', metadata: { kind: 'dirty_turf_business_service' } } } };
    stripe.subscriptions.retrieve.mockResolvedValue({ ...subscription(), customer: 'cus_attacker' });
    expect((await webhook()(hookRequest())).status).toBe(500);
    expect(admin.rpc).not.toHaveBeenCalled();
  });
  it('reconciles renewal invoices through the current invoice-parent subscription relationship', async () => {
    rows.academy_service_orders = recurringOrder();
    event = { ...event, type: 'invoice.paid', created: 1790000000, data: { object: { id: 'in_service', subscription: 'sub_payload_untrusted', metadata: { service_order_id: requestId } } } };
    expect((await webhook()(hookRequest())).status).toBe(200);
    expect(stripe.invoices.retrieve).toHaveBeenCalledWith('in_service');
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith('sub_service', { expand: ['items.data.price'] });
    expect(admin.rpc).toHaveBeenCalledOnce();
    expect(admin.rpc).toHaveBeenCalledWith('apply_academy_service_subscription', expect.objectContaining({ p_order_id: orderId, p_subscription_id: 'sub_service', p_status: 'active', p_event_created: 1790000000 }));
    expect(rows.academy_service_orders.status).toBe('paid');
  });
  it('uses current subscription state after a failed invoice and never fabricates payment or Academy access', async () => {
    rows.academy_service_orders = { ...recurringOrder(), status: 'pending' };
    event = { ...event, type: 'invoice.payment_failed', created: 1790000001, data: { object: { id: 'in_service', status: 'paid' } } };
    stripe.invoices.retrieve.mockResolvedValue({ ...invoice(), status: 'open' });
    stripe.subscriptions.retrieve.mockResolvedValue({ ...subscription(), status: 'past_due' });
    expect((await webhook()(hookRequest())).status).toBe(200);
    expect(admin.rpc).toHaveBeenCalledWith('apply_academy_service_subscription', expect.objectContaining({ p_status: 'past_due', p_event_created: 1790000001 }));
    expect(admin.rpc.mock.calls.every(([name]: string[]) => name === 'apply_academy_service_subscription')).toBe(true);
    expect(rows.academy_service_orders.status).toBe('pending');
  });
  it('replays and out-of-order invoice deliveries forward the original ordering boundary and current state', async () => {
    rows.academy_service_orders = recurringOrder();
    event = { ...event, type: 'invoice.paid', created: 1790000002, data: { object: { id: 'in_service' } } };
    expect((await webhook()(hookRequest())).status).toBe(200);
    expect((await webhook()(hookRequest())).status).toBe(200);
    event = { ...event, type: 'invoice.payment_failed', created: 1790000000 };
    expect((await webhook()(hookRequest())).status).toBe(200);
    expect(admin.rpc.mock.calls.map(([, args]: [string, any]) => [args.p_event_created, args.p_status])).toEqual([[1790000002, 'active'], [1790000002, 'active'], [1790000000, 'active']]);
    expect(admin.rpc.mock.calls.every(([name]: string[]) => name === 'apply_academy_service_subscription')).toBe(true);
  });
  it('can reconcile the initial service invoice before Checkout records the provider relationship', async () => {
    rows.academy_service_orders = { ...recurringOrder(), status: 'pending', provider_customer_id: null, provider_subscription_id: null };
    event = { ...event, type: 'invoice.paid', created: 1790000000, data: { object: { id: 'in_service' } } };
    expect((await webhook()(hookRequest())).status).toBe(200);
    expect(admin.rpc).toHaveBeenCalledWith('apply_academy_service_subscription', expect.objectContaining({ p_order_id: orderId, p_status: 'active' }));
    expect(rows.academy_service_orders.status).toBe('pending');
  });
  it('accepts an expanded parent subscription only by its ID and rereads its current state', async () => {
    rows.academy_service_orders = recurringOrder();
    event = { ...event, type: 'invoice.paid', created: 1790000000, data: { object: { id: 'in_service' } } };
    stripe.invoices.retrieve.mockResolvedValue({ ...invoice(), parent: { type: 'subscription_details', subscription_details: { subscription: { id: 'sub_service', status: 'canceled' } } } });
    expect((await webhook()(hookRequest())).status).toBe(200);
    expect(admin.rpc).toHaveBeenCalledWith('apply_academy_service_subscription', expect.objectContaining({ p_status: 'active' }));
  });
  it('ignores a non-subscription invoice and unrelated Academy subscription invoices', async () => {
    event = { ...event, type: 'invoice.paid', created: 1790000000, data: { object: { id: 'in_service', subscription: 'sub_service' } } };
    stripe.invoices.retrieve.mockResolvedValueOnce({ ...invoice(), parent: null });
    expect((await webhook()(hookRequest())).status).toBe(200);
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    stripe.subscriptions.retrieve.mockResolvedValue({ ...subscription(), metadata: { kind: 'academy', plan_id: requestId } });
    expect((await webhook()(hookRequest())).status).toBe(200);
    expect(admin.rpc).not.toHaveBeenCalled();
  });
  it.each(['invoice-id', 'invoice-mode', 'invoice-customer', 'subscription-id', 'subscription-mode', 'subscription-customer', 'price', 'metadata', 'order-subscription', 'timestamp'])(
    'holds mismatched invoice ownership or subscription terms: %s', async mismatch => {
      rows.academy_service_orders = recurringOrder();
      event = { ...event, type: 'invoice.paid', created: 1790000000, data: { object: { id: 'in_service' } } };
      const invoiceValue = invoice(), subscriptionValue = subscription();
      if (mismatch === 'invoice-id') invoiceValue.id = 'in_other';
      if (mismatch === 'invoice-mode') invoiceValue.livemode = true;
      if (mismatch === 'invoice-customer') invoiceValue.customer = 'cus_other';
      if (mismatch === 'subscription-id') subscriptionValue.id = 'sub_other';
      if (mismatch === 'subscription-mode') subscriptionValue.livemode = true;
      if (mismatch === 'subscription-customer') subscriptionValue.customer = 'cus_other';
      if (mismatch === 'price') subscriptionValue.items.data[0].price.unit_amount = 1;
      if (mismatch === 'metadata') subscriptionValue.metadata.service_order_id = requestId;
      if (mismatch === 'order-subscription') rows.academy_service_orders.provider_subscription_id = 'sub_other';
      if (mismatch === 'timestamp') event.created = -1;
      stripe.invoices.retrieve.mockResolvedValue(invoiceValue);
      stripe.subscriptions.retrieve.mockResolvedValue(subscriptionValue);
      expect((await webhook()(hookRequest())).status).toBe(500);
      expect(admin.rpc).not.toHaveBeenCalled();
    },
  );
  it('holds a saved service subscription with stripped service metadata rather than treating it as unrelated', async () => {
    rows.academy_service_orders = recurringOrder();
    event = { ...event, type: 'invoice.payment_failed', created: 1790000000, data: { object: { id: 'in_service' } } };
    stripe.subscriptions.retrieve.mockResolvedValue({ ...subscription(), metadata: {} });
    expect((await webhook()(hookRequest())).status).toBe(500);
    expect(admin.rpc).not.toHaveBeenCalled();
  });
  it('leaves a transient invoice lookup failure retryable without recording payment', async () => {
    rows.academy_service_orders = recurringOrder();
    event = { ...event, type: 'invoice.paid', created: 1790000000, data: { object: { id: 'in_service' } } };
    stripe.invoices.retrieve.mockRejectedValueOnce(new Error('temporary provider failure'));
    expect((await webhook()(hookRequest())).status).toBe(500);
    expect(admin.rpc).not.toHaveBeenCalled();
    expect((await webhook()(hookRequest())).status).toBe(200);
    expect(admin.rpc).toHaveBeenCalledOnce();
  });
});

describe('auth-owned service billing portal', () => {
  const portalRequest = () => new Request('https://edge.test/create-service-billing-portal', { method: 'POST', headers: { Origin: 'https://app.dirtyturf.com', Authorization: 'Bearer valid' }, body: JSON.stringify({ orderId }) });
  const portal = () => createServicePortalHandler({ admin, stripe, enabled: true, livemode: false, appUrl: 'https://app.dirtyturf.com', configurationId: 'bpc_service' });
  it('opens for the verified service owner without depending on Academy membership', async () => {
    rows.academy_service_orders = recurringOrder();
    const result = await portal()(portalRequest());
    expect(result.status).toBe(200);
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith({ customer: 'cus_service', configuration: 'bpc_service', return_url: 'https://app.dirtyturf.com/billing' });
  });
  it('refuses wrong owner, customer mode, and subscription reassignment', async () => {
    rows.academy_service_orders = { ...recurringOrder(), user_id: requestId };
    expect((await portal()(portalRequest())).status).toBe(404);
    rows.academy_service_orders = recurringOrder();
    stripe.customers.retrieve.mockResolvedValueOnce({ id: 'cus_service', livemode: true });
    expect((await portal()(portalRequest())).status).toBe(502);
    stripe.subscriptions.retrieve.mockResolvedValueOnce({ ...subscription(), customer: 'cus_attacker' });
    expect((await portal()(portalRequest())).status).toBe(502);
    expect(stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
  });
  it('requires cancellation to be enabled and unapproved plan switching disabled', async () => {
    rows.academy_service_orders = recurringOrder();
    stripe.billingPortal.configurations.retrieve.mockResolvedValueOnce({ active: true, livemode: false, features: { subscription_cancel: { enabled: false } } });
    expect((await portal()(portalRequest())).status).toBe(503);
    stripe.billingPortal.configurations.retrieve.mockResolvedValueOnce({ active: true, livemode: false, features: { subscription_cancel: { enabled: true }, subscription_update: { enabled: true } } });
    expect((await portal()(portalRequest())).status).toBe(503);
    expect(stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
  });
});
