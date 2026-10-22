import { beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => {
  const state = { native: false, manager: false, access: true, data: [] as unknown, error: null as null | { code: string } };
  const query: any = {};
  for (const method of ['select', 'eq', 'neq', 'or', 'order', 'limit']) query[method] = vi.fn(() => query);
  query.then = (resolve: any, reject: any) => Promise.resolve({ data: state.data, error: state.error }).then(resolve, reject);
  const rpc = vi.fn(async (name: string) => ({ data: name === 'get_academy_access_state' ? { hasAccess: state.access, canManage: state.manager, communityId: '10000000-0000-4000-8000-000000000001' } : state.data, error: null }));
  const invoke = vi.fn(async () => ({ data: { url: 'https://checkout.stripe.com/c/pay/fixture' }, error: null }));
  return { state, query, rpc, invoke, from: vi.fn(() => query), getUser: vi.fn(async () => ({ data: { user: { id: '10000000-0000-4000-8000-000000000002' } }, error: null })) };
});
vi.mock('./backend', () => ({ supabase: { rpc: fixture.rpc, from: fixture.from, auth: { getUser: fixture.getUser }, functions: { invoke: fixture.invoke } } }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => fixture.state.native } }));
import { beginServiceBillingPortal, beginServiceCheckout, createServiceQuote, loadAdminServiceQuotes, loadOwnServiceOrders, loadOwnServiceQuotes, parseServiceOrder, parseServiceQuote, serviceBillingPortalDestination, serviceCheckoutDestination, withdrawServiceQuote } from './serviceCheckout';
const community = '10000000-0000-4000-8000-000000000001';
const quoteId = '10000000-0000-4000-8000-000000000003';
const requestId = '10000000-0000-4000-8000-000000000004';
const row = () => ({ id: quoteId, request_id: requestId, service_key: 'website', amount_cents: 149500, currency: 'usd', billing_interval: 'one_time', status: 'offered', created_at: '2026-10-22T15:00:00Z', stripe_price_id: null });
beforeEach(() => { vi.clearAllMocks(); fixture.state.native = false; fixture.state.manager = false; fixture.state.access = true; fixture.state.data = []; fixture.state.error = null; });
describe('service payment client boundaries', () => {
  it('loads only safe own quote columns in the active community and user scope', async () => {
    fixture.state.data = [{ ...row(), stripe_price_id: 'price_privateAdvanced' }];
    const result = await loadOwnServiceQuotes();
    expect(result[0].stripePriceId).toBeUndefined();
    expect(fixture.query.select.mock.calls[0][0]).not.toContain('stripe_price_id');
    expect(fixture.query.eq).toHaveBeenCalledWith('academy_community_id', community);
    expect(fixture.query.eq).toHaveBeenCalledWith('user_id', '10000000-0000-4000-8000-000000000002');
    expect(fixture.query.eq).toHaveBeenCalledWith('status', 'offered');
    expect(fixture.query.neq).toHaveBeenCalledWith('status', 'offered');
    expect(result).toHaveLength(1);
  });
  it('denies admin quote access to peers and wrong tenants before the admin RPC', async () => {
    await expect(loadAdminServiceQuotes(community)).rejects.toThrow('Administrator');
    fixture.state.manager = true;
    await expect(loadAdminServiceQuotes(quoteId)).rejects.toThrow('Administrator');
    expect(fixture.rpc.mock.calls.some(([name]) => name === 'list_academy_service_quotes')).toBe(false);
  });
  it('accepts a nontechnical amount-only admin quote without a Stripe Price ID', async () => {
    fixture.state.manager = true; fixture.state.data = row();
    const result = await createServiceQuote({ requestId, amountCents: 149500, billingInterval: 'one_time' });
    expect(result.id).toBe(quoteId);
    expect(fixture.rpc).toHaveBeenCalledWith('create_academy_service_quote', { p_request_id: requestId, p_stripe_price_id: null, p_amount_cents: 149500, p_billing_interval: 'one_time' });
  });
  it('does not create quotes as a member or accept injectable advanced price IDs', async () => {
    await expect(createServiceQuote({ requestId, amountCents: 149500, billingInterval: 'one_time' })).rejects.toThrow('Administrator');
    await expect(createServiceQuote({ requestId, stripePriceId: "price_x';drop table x;--", amountCents: 149500, billingInterval: 'one_time' })).rejects.toThrow('valid quote');
  });
  it('rejects malformed, off-range, wrong-cadence or invented statuses in server rows', () => {
    for (const patch of [{ id: 'bad' }, { amount_cents: 149499 }, { billing_interval: 'month' }, { currency: 'eur' }, { status: 'success' }, { created_at: 'unknown' }]) expect(() => parseServiceQuote({ ...row(), ...patch })).toThrow();
    expect(() => parseServiceOrder({ ...row(), quote_id: quoteId, status: 'success' })).toThrow();
  });
  it('only opens trusted HTTPS Stripe URLs', () => {
    for (const value of ['http://checkout.stripe.com/pay', 'https://checkout.stripe.com.attacker.test/pay', 'https://user@checkout.stripe.com/pay', 'https://checkout.stripe.com:444/pay', '/?paid=true']) expect(() => serviceCheckoutDestination(value)).toThrow();
    expect(serviceCheckoutDestination('https://checkout.stripe.com/c/pay/fixture')).toBe('https://checkout.stripe.com/c/pay/fixture');
  });
  it('sends only quote and retry identity; native Checkout remains disabled', async () => {
    expect(await beginServiceCheckout(quoteId, requestId)).toContain('https://checkout.stripe.com/');
    expect(fixture.invoke).toHaveBeenCalledWith('create-service-checkout', { body: { quoteId, requestId } });
    fixture.state.native = true;
    await expect(beginServiceCheckout(quoteId, requestId)).rejects.toThrow('website');
    expect(fixture.invoke).toHaveBeenCalledTimes(1);
  });
  it('uses server payment status for orders and never claims success from a return URL', async () => {
    fixture.state.data = [{ ...row(), quote_id: quoteId, status: 'pending' }];
    expect((await loadOwnServiceOrders())[0].status).toBe('pending');
    fixture.state.data = [{ ...row(), quote_id: quoteId, status: 'paid' }];
    expect((await loadOwnServiceOrders())[0].status).toBe('paid');
  });
  it('fails closed without active access and explains missing migrations', async () => {
    fixture.state.access = false;
    await expect(loadOwnServiceQuotes()).rejects.toThrow('Active Academy');
    fixture.state.access = true; fixture.state.error = { code: 'PGRST205' };
    await expect(loadOwnServiceQuotes()).rejects.toThrow('database update');
  });
  it('allows auth-owned order history after Academy access expires', async () => {
    fixture.state.access = false; fixture.state.data = [{ ...row(), quote_id: quoteId, status: 'paid', billing_interval: 'month', service_key: 'website-care', amount_cents: 9700, subscription_status: 'active', cancel_at_period_end: false, current_period_end: '2026-11-22T15:00:00Z' }];
    expect((await loadOwnServiceOrders())[0].subscriptionStatus).toBe('active');
    expect(fixture.query.eq).toHaveBeenCalledWith('billing_interval', 'month');
    expect(fixture.query.or).toHaveBeenCalledWith('subscription_status.is.null,subscription_status.in.(active,trialing,past_due,unpaid,paused,incomplete)');
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it('allows only admin withdrawal through the guarded RPC', async () => {
    await expect(withdrawServiceQuote(quoteId)).rejects.toThrow('Administrator');
    fixture.state.manager = true;
    await withdrawServiceQuote(quoteId);
    expect(fixture.rpc).toHaveBeenCalledWith('withdraw_academy_service_quote', { p_quote_id: quoteId });
  });
  it('can open the service billing portal after Academy access expires', async () => {
    fixture.state.access = false;
    fixture.invoke.mockResolvedValueOnce({ data: { url: 'https://billing.stripe.com/p/session/fixture' }, error: null });
    expect(await beginServiceBillingPortal(quoteId)).toBe('https://billing.stripe.com/p/session/fixture');
    expect(fixture.invoke).toHaveBeenCalledWith('create-service-billing-portal', { body: { orderId: quoteId } });
    expect(fixture.rpc).not.toHaveBeenCalled();
    expect(() => serviceBillingPortalDestination('https://billing.stripe.com.attacker.test/')).toThrow();
    expect(() => serviceBillingPortalDestination('http://billing.stripe.com/')).toThrow();
  });
});
