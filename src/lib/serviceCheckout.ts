import { Capacitor } from '@capacitor/core';
import { supabase } from './backend';
import { growthServices, type GrowthServiceKey } from './growth';

export type ServiceQuote = { id: string; requestId: string; serviceKey: GrowthServiceKey; amountCents: number; currency: 'usd'; billingInterval: 'one_time' | 'month'; status: 'offered' | 'paid' | 'withdrawn'; createdAt: string; stripePriceId?: string };
export type ServiceSubscriptionStatus = 'incomplete' | 'incomplete_expired' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | 'paused';
export type ServiceOrder = { id: string; quoteId: string; serviceKey: GrowthServiceKey; amountCents: number; billingInterval: 'one_time' | 'month'; status: 'pending' | 'paid' | 'failed' | 'cancelled'; createdAt: string; subscriptionStatus?: ServiceSubscriptionStatus; cancelAtPeriodEnd?: boolean; currentPeriodEnd?: string | null };
const uuid = (value: unknown): value is string => typeof value === 'string' && value === value.trim() && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const priceId = (value: unknown): value is string => typeof value === 'string' && value === value.trim() && /^price_[A-Za-z0-9]+$/.test(value);
const quoteColumns = 'id,request_id,service_key,amount_cents,currency,billing_interval,status,created_at';
const orderColumns = 'id,quote_id,service_key,amount_cents,billing_interval,status,created_at,subscription_status,cancel_at_period_end,current_period_end';
const subscriptionStatuses = ['incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused'];
const errorMessage = 'Service payments could not load. Reconnect and try again.';
function terms(row: Record<string, unknown>) {
  const service = growthServices.find(item => item.key === row.service_key);
  return service && Number.isSafeInteger(row.amount_cents) && Number(row.amount_cents) >= service.fromCents && Number(row.amount_cents) <= service.toCents && row.billing_interval === service.billingInterval;
}
export function parseServiceQuote(row: unknown, admin = false): ServiceQuote {
  if (!row || typeof row !== 'object') throw new Error(errorMessage);
  const value = row as Record<string, unknown>;
  if (!uuid(value.id) || !uuid(value.request_id) || !terms(value) || value.currency !== 'usd' || !['offered', 'paid', 'withdrawn'].includes(String(value.status)) || typeof value.created_at !== 'string' || !Number.isFinite(Date.parse(value.created_at)) || (admin && value.stripe_price_id != null && !priceId(value.stripe_price_id))) throw new Error(errorMessage);
  return { id: value.id, requestId: value.request_id, serviceKey: value.service_key as GrowthServiceKey, amountCents: value.amount_cents as number, currency: 'usd', billingInterval: value.billing_interval as ServiceQuote['billingInterval'], status: value.status as ServiceQuote['status'], createdAt: value.created_at, ...(admin && typeof value.stripe_price_id === 'string' ? { stripePriceId: value.stripe_price_id } : {}) };
}
export function parseServiceOrder(row: unknown): ServiceOrder {
  if (!row || typeof row !== 'object') throw new Error(errorMessage);
  const value = row as Record<string, unknown>;
  if (!uuid(value.id) || !uuid(value.quote_id) || !terms(value) || !['pending', 'paid', 'failed', 'cancelled'].includes(String(value.status)) || typeof value.created_at !== 'string' || !Number.isFinite(Date.parse(value.created_at))) throw new Error(errorMessage);
  if ((value.subscription_status != null && !subscriptionStatuses.includes(String(value.subscription_status))) || (value.cancel_at_period_end !== undefined && typeof value.cancel_at_period_end !== 'boolean') || (value.current_period_end != null && (typeof value.current_period_end !== 'string' || !Number.isFinite(Date.parse(value.current_period_end))))) throw new Error(errorMessage);
  return { id: value.id, quoteId: value.quote_id, serviceKey: value.service_key as GrowthServiceKey, amountCents: value.amount_cents as number, billingInterval: value.billing_interval as ServiceOrder['billingInterval'], status: value.status as ServiceOrder['status'], createdAt: value.created_at, ...(value.subscription_status != null ? { subscriptionStatus: value.subscription_status as ServiceSubscriptionStatus } : {}), ...(typeof value.cancel_at_period_end === 'boolean' ? { cancelAtPeriodEnd: value.cancel_at_period_end } : {}), ...(value.current_period_end !== undefined ? { currentPeriodEnd: value.current_period_end as string | null } : {}) };
}
function paymentError(error: { code?: string } | null) {
  return new Error(error && ['42P01', '42883', 'PGRST202', 'PGRST205'].includes(error.code ?? '') ? 'Service payments need their database update. Ask an administrator to apply the service checkout migration.' : errorMessage);
}
async function context() {
  if (!supabase) throw new Error('Sign in online to use service payments.');
  const access = await supabase.rpc('get_academy_access_state');
  if (access.error) throw paymentError(access.error);
  if (access.data?.hasAccess !== true || !uuid(access.data.communityId)) throw new Error('Active Academy access is required.');
  const auth = await supabase.auth.getUser();
  if (auth.error || !auth.data.user || !uuid(auth.data.user.id)) throw new Error('Sign in again to continue.');
  return { client: supabase, userId: auth.data.user.id, communityId: access.data.communityId as string, canManage: access.data.canManage === true };
}
export async function loadOwnServiceQuotes(): Promise<ServiceQuote[]> {
  const { client, communityId, userId } = await context();
  // Older payable quotes must not disappear behind a busy paid/withdrawn history.
  const [offered, history] = await Promise.all([
    client.from('academy_service_quotes').select(quoteColumns).eq('academy_community_id', communityId).eq('user_id', userId).eq('status', 'offered').order('created_at', { ascending: false }).limit(250),
    client.from('academy_service_quotes').select(quoteColumns).eq('academy_community_id', communityId).eq('user_id', userId).neq('status', 'offered').order('created_at', { ascending: false }).limit(250),
  ]);
  if (offered.error || history.error) throw paymentError(offered.error || history.error);
  return [...new Map([...(offered.data ?? []), ...(history.data ?? [])].map(row => { const quote = parseServiceQuote(row); return [quote.id, quote] as const; })).values()];
}
export async function loadAdminServiceQuotes(communityId: string): Promise<ServiceQuote[]> {
  const state = await context();
  if (!state.canManage || state.communityId !== communityId) throw new Error('Administrator access is required for this Academy.');
  const { data, error } = await state.client.rpc('list_academy_service_quotes', { p_community_id: communityId });
  if (error) throw paymentError(error);
  if (!Array.isArray(data)) throw new Error(errorMessage);
  return data.map(row => parseServiceQuote(row, true));
}
export async function createServiceQuote(input: { requestId: string; stripePriceId?: string; amountCents: number; billingInterval: 'one_time' | 'month' }): Promise<ServiceQuote> {
  if (!uuid(input.requestId) || (input.stripePriceId !== undefined && !priceId(input.stripePriceId)) || !Number.isSafeInteger(input.amountCents) || input.amountCents <= 0 || !['one_time', 'month'].includes(input.billingInterval)) throw new Error('Choose valid quote terms.');
  const state = await context();
  if (!state.canManage) throw new Error('Administrator access is required.');
  const { data, error } = await state.client.rpc('create_academy_service_quote', { p_request_id: input.requestId, p_stripe_price_id: input.stripePriceId ?? null, p_amount_cents: input.amountCents, p_billing_interval: input.billingInterval });
  if (error) throw paymentError(error);
  return parseServiceQuote(data, true);
}
export async function withdrawServiceQuote(quoteId: string): Promise<void> {
  if (!uuid(quoteId)) throw new Error('Choose a valid service quote.');
  const state = await context();
  if (!state.canManage) throw new Error('Administrator access is required.');
  const { error } = await state.client.rpc('withdraw_academy_service_quote', { p_quote_id: quoteId });
  if (error) throw new Error('This quote could not be withdrawn. Pending or paid checkouts cannot be withdrawn; refresh and check its payment status.');
}
export async function loadOwnServiceOrders(): Promise<ServiceOrder[]> {
  if (!supabase) throw new Error('Sign in online to manage service payments.');
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user || !uuid(auth.user.id)) throw new Error('Sign in again to manage service payments.');
  // Load current recurring billing independently from recent order history so an
  // old ongoing subscription keeps its cancellation controls after many purchases.
  const [ongoing, history] = await Promise.all([
    supabase.from('academy_service_orders').select(orderColumns).eq('user_id', auth.user.id).eq('billing_interval', 'month').eq('status', 'paid').or('subscription_status.is.null,subscription_status.in.(active,trialing,past_due,unpaid,paused,incomplete)').order('created_at', { ascending: false }).limit(250),
    supabase.from('academy_service_orders').select(orderColumns).eq('user_id', auth.user.id).order('created_at', { ascending: false }).limit(250),
  ]);
  if (ongoing.error || history.error) throw paymentError(ongoing.error || history.error);
  return [...new Map([...(ongoing.data ?? []), ...(history.data ?? [])].map(row => { const order = parseServiceOrder(row); return [order.id, order] as const; })).values()];
}
export function serviceBillingPortalDestination(value: unknown) {
  if (typeof value !== 'string') throw new Error('Secure service billing could not open.');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'billing.stripe.com' || url.username || url.password || url.port) throw new Error('Secure service billing could not open.');
  return url.href;
}
export async function beginServiceBillingPortal(orderId: string) {
  if (Capacitor.isNativePlatform()) throw new Error('Manage service billing on the Dirty Turf website.');
  if (!supabase || !uuid(orderId)) throw new Error('Sign in online to manage service billing.');
  const auth = await supabase.auth.getUser();
  if (auth.error || !auth.data.user) throw new Error('Sign in again to manage service billing.');
  const { data, error } = await supabase.functions.invoke('create-service-billing-portal', { body: { orderId } });
  if (error) throw new Error('Service billing could not open. Please retry or contact support.');
  return serviceBillingPortalDestination(data?.url);
}
export function serviceCheckoutDestination(value: unknown) {
  if (typeof value !== 'string') throw new Error('Secure service checkout could not open.');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com' || url.username || url.password || url.port) throw new Error('Secure service checkout could not open.');
  return url.href;
}
export async function beginServiceCheckout(quoteId: string, requestId: string) {
  if (Capacitor.isNativePlatform()) throw new Error('Service checkout is available on the Dirty Turf website.');
  if (!uuid(quoteId) || !uuid(requestId)) throw new Error('Choose a valid service quote.');
  const { client } = await context();
  const { data, error } = await client.functions.invoke('create-service-checkout', { body: { quoteId, requestId } });
  if (error) throw new Error('Service checkout is not available. Retry the same quote or contact support.');
  return serviceCheckoutDestination(data?.url);
}
