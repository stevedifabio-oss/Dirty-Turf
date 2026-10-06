import { createClient } from '@supabase/supabase-js';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditBillingFulfillment, billingAuditExpectations } from './lib/billing-fulfillment-audit.mjs';
import { writePrivateSnapshot } from './capture-ghl-courses.mjs';
import { preflightCommunitySnapshotReceipt } from './sync-community-snapshot.mjs';

// No Stripe writes, webhook replays, RPC mutations, sign-ins, or token refreshes.
// An optional existing buyer token permits only getUser + the read-only access RPC.
const root = fileURLToPath(new URL('../', import.meta.url));
const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log('Usage: node --env-file=.env.billing-audit.local scripts/audit-billing-fulfillment.mjs --session cs_... --expect active|cancel_at_period_end|cancelled|refunded|unpaid --receipt output/private/billing-audit.json [--previous output/private/earlier-billing-audit.json]');
  process.exit(0);
}
try { await preflightCommunitySnapshotReceipt(privatePath(options.receipt), root); }
catch { console.error('Billing audit receipt is unavailable; choose a new private receipt name'); process.exit(1); }
let report;
try {
  const mode = process.env.STRIPE_MODE;
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const expectedAccountId = process.env.STRIPE_ACCOUNT_ID;
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!['test', 'live'].includes(mode) || !new RegExp(`^[sr]k_${mode}_`).test(stripeKey ?? '') ||
    !/^acct_[A-Za-z0-9]+$/.test(expectedAccountId ?? '') || !serviceKey || !supabaseUrl ||
    !validSupabaseUrl(supabaseUrl, mode)) throw new Error('configuration_unverified');
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: boundedFetch },
  });
  const stripeGet = async (resource, expansions = []) => {
    const url = new URL(`https://api.stripe.com/v1/${resource}`);
    expansions.forEach((value) => url.searchParams.append('expand[]', value));
    const response = await fetch(url, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${stripeKey}`, 'Stripe-Version': '2026-08-26.dahlia' },
    });
    if (!response.ok) throw new Error('provider_read_unverified');
    return response.json();
  };
  const account = await stripeGet('account');
  if (account.id !== expectedAccountId) throw new Error('account_unverified');
  const session = await stripeGet(`checkout/sessions/${options.session}`, ['line_items.data.price']);
  const planId = session.metadata?.plan_id;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(planId ?? '')) {
    throw new Error('mapped_plan_unverified');
  }
  const plan = await one(admin.from('academy_billing_plans').select(
    'id,academy_community_id,stripe_price_id,amount_cents,currency,billing_type,billing_interval,offer_kind,community_access,academy_billing_plan_courses(course_id),academy_billing_plan_features(feature_key)',
  ).eq('id', planId));
  if (!plan || !/^price_[A-Za-z0-9]+$/.test(plan.stripe_price_id ?? '')) throw new Error('mapped_plan_unverified');
  const price = await stripeGet(`prices/${plan.stripe_price_id}`);
  const customerId = objectId(session.customer);
  const subscriptionId = objectId(session.subscription);
  const paymentId = objectId(session.payment_intent);
  const subscription = subscriptionId ? await stripeGet(`subscriptions/${validatedId(subscriptionId, 'sub')}`) : undefined;
  const payment = paymentId ? await stripeGet(`payment_intents/${validatedId(paymentId, 'pi')}`, ['latest_charge']) : undefined;
  const customer = customerId ? await one(admin.from('academy_billing_customers').select(
    'academy_community_id,academy_member_id,user_id,provider_customer_id,email',
  ).eq('provider_customer_id', validatedId(customerId, 'cus'))) : null;
  const member = customer ? await one(admin.from('academy_members').select('id,user_id,academy_community_id,status').eq('id', customer.academy_member_id)) : null;
  const sourceType = session.mode === 'subscription' ? 'stripe_subscription' : 'stripe_payment';
  const sourceKey = subscriptionId || session.id;
  const billingRows = await rows(admin.from('academy_billing_subscriptions').select(
    'academy_community_id,academy_member_id,plan_id,source_type,source_key,provider_customer_id,checkout_session_id,status,cancel_at_period_end,current_period_end',
  ).eq('academy_community_id', plan.academy_community_id).eq('source_type', sourceType).eq('source_key', sourceKey));
  const columns = 'id,academy_community_id,academy_member_id,source_type,source_key,status,starts_at,ends_at,metadata';
  const grants = member ? await rows(admin.from('academy_access_grants').select(`${columns},course_id`)
    .eq('academy_member_id', member.id).eq('academy_community_id', plan.academy_community_id)) : [];
  const featureGrants = member ? await rows(admin.from('academy_feature_grants').select(`${columns},feature_key`)
    .eq('academy_member_id', member.id).eq('academy_community_id', plan.academy_community_id)) : [];
  const eventIds = [...new Set([session.id, subscriptionId, objectId(payment?.latest_charge)].filter(Boolean))];
  const events = await rows(admin.from('integration_events').select(
    'event_type,processed_at,error_message,object_id:payload->data->object->>id',
  ).eq('provider', 'stripe').in('payload->data->object->>id', eventIds));
  let buyer;
  if (process.env.BILLING_BUYER_ACCESS_TOKEN) {
    const publicKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!publicKey) throw new Error('buyer_access_unverified');
    const token = process.env.BILLING_BUYER_ACCESS_TOKEN;
    const client = createClient(supabaseUrl, publicKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: boundedFetch, headers: { Authorization: `Bearer ${token}` } },
    });
    const identity = await client.auth.getUser(token);
    if (identity.error || identity.data.user?.id !== member?.user_id) throw new Error('buyer_access_unverified');
    const access = await client.rpc('get_academy_access_state');
    if (access.error) throw new Error('buyer_access_unverified');
    buyer = { userId: identity.data.user.id, access: access.data };
  }
  // A concurrent refund/cancellation must hold the report, rather than combining
  // provider state from before the action with database grants from afterward.
  const repeatSession = await stripeGet(`checkout/sessions/${options.session}`, ['line_items.data.price']);
  const repeatSubscription = subscriptionId ? await stripeGet(`subscriptions/${subscriptionId}`) : undefined;
  const repeatPayment = paymentId ? await stripeGet(`payment_intents/${paymentId}`, ['latest_charge']) : undefined;
  if (JSON.stringify(providerState(session, subscription, payment)) !==
    JSON.stringify(providerState(repeatSession, repeatSubscription, repeatPayment))) throw new Error('provider_read_unverified');
  let previous;
  if (options.previous) {
    const file = privatePath(options.previous);
    const info = await lstat(file);
    if (!info.isFile() || info.mode & 0o077 || info.size > 2 * 1024 * 1024) throw new Error('read_unverified');
    previous = JSON.parse(await readFile(file, 'utf8'));
  }
  report = auditBillingFulfillment({ account, expectedAccountId, expectedSessionId: options.session, session, plan, price, subscription,
    payment, customer, member, billingRows, grants, featureGrants, events, buyer }, {
    expected: options.expected, mode, checkedAt: new Date().toISOString(), previous,
  });
} catch (error) {
  // Provider/database errors may contain credentials, emails, or response bodies.
  // Never interpolate them. Only known, locally defined codes leave this boundary.
  const allowed = ['configuration_unverified', 'provider_read_unverified', 'database_read_unverified',
    'account_unverified', 'mapped_plan_unverified', 'buyer_access_unverified'];
  report = { schemaVersion: 1, kind: 'read_only_billing_fulfillment_audit', checkedAt: new Date().toISOString(),
    expected: options.expected, status: 'unverified', paidCheckoutVerified: false, currentFulfillmentVerified: false,
    fullPurchaseLifecycleVerified: false, physicalDeviceAccessVerified: false,
    checks: [{ name: allowed.includes(error?.message) ? error.message : 'read_unverified', status: 'unverified' }] };
}
const receipt = privatePath(options.receipt);
try { await writePrivateSnapshot(receipt, report, root); }
catch { console.error('Billing audit receipt could not be saved privately'); process.exit(1); }
console.log(JSON.stringify({ status: report.status, expected: report.expected, paidCheckoutVerified: report.paidCheckoutVerified,
  currentFulfillmentVerified: report.currentFulfillmentVerified, fullPurchaseLifecycleVerified: false,
  checks: report.checks, receiptSaved: true }, null, 2));
if (report.status !== 'verified') process.exitCode = 1;

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--help') options.help = true;
    else if (['--session', '--expect', '--receipt', '--previous'].includes(flag) && args[index + 1] && !args[index + 1].startsWith('--')) {
      const key = { '--session': 'session', '--expect': 'expected', '--receipt': 'receipt', '--previous': 'previous' }[flag];
      if (options[key]) throw new Error('Duplicate audit option');
      options[key] = args[++index];
    } else throw new Error('Invalid audit option');
  }
  if (!options.help && (!/^cs_[A-Za-z0-9_]+$/.test(options.session ?? '') ||
    !billingAuditExpectations.includes(options.expected) || !options.receipt)) throw new Error('Missing or invalid audit option; use --help');
  if (!options.help) { privatePath(options.receipt); if (options.previous) privatePath(options.previous); }
  return options;
}
function privatePath(value) {
  const resolved = path.resolve(root, value);
  const directory = path.join(root, 'output/private');
  if (path.dirname(resolved) !== directory || path.basename(resolved).startsWith('.') || path.extname(resolved) !== '.json') throw new Error('Audit receipts must be private JSON files');
  return resolved;
}
function validSupabaseUrl(value, mode) {
  try {
    const url = new URL(value);
    return !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash &&
      (url.protocol === 'https:' && /^[a-z0-9]+\.supabase\.co$/.test(url.hostname) && (!url.port || url.port === '443') ||
        mode === 'test' && url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname));
  } catch { return false; }
}
function objectId(value) { return typeof value === 'string' ? value : value?.id; }
function boundedFetch(input, init = {}) {
  return fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(20000) });
}
function validatedId(value, prefix) {
  if (!new RegExp(`^${prefix}_[A-Za-z0-9_]+$`).test(value ?? '')) throw new Error('provider_read_unverified');
  return value;
}
async function rows(query) {
  // Exact-scope queries may still exceed a REST default row limit. Explicit
  // pagination avoids treating a truncated set of grants/events as complete.
  const all = [];
  const ordered = query.order('id', { ascending: true });
  for (let offset = 0; offset < 10000; offset += 500) {
    const { data, error } = await ordered.range(offset, offset + 499);
    if (error || !Array.isArray(data)) throw new Error('database_read_unverified');
    all.push(...data);
    if (data.length < 500) return all;
  }
  throw new Error('database_read_unverified');
}
async function one(query) {
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error('database_read_unverified');
  return data;
}
function providerState(session, subscription, payment) {
  return {
    session: { id: session.id, livemode: session.livemode, status: session.status, payment_status: session.payment_status,
      amount_total: session.amount_total, currency: session.currency, mode: session.mode, customer: objectId(session.customer),
      subscription: objectId(session.subscription), payment_intent: objectId(session.payment_intent), metadata: session.metadata,
      line_items: session.line_items?.data?.map((row) => [objectId(row.price), row.quantity]), has_more: session.line_items?.has_more },
    subscription: subscription && { id: subscription.id, customer: objectId(subscription.customer), livemode: subscription.livemode,
      status: subscription.status, cancel_at_period_end: subscription.cancel_at_period_end, current_period_end: subscription.current_period_end,
      items: subscription.items?.data?.map((row) => [objectId(row.price), row.quantity, row.current_period_end]), has_more: subscription.items?.has_more },
    payment: payment && { id: payment.id, customer: objectId(payment.customer), status: payment.status, livemode: payment.livemode,
      charge: objectId(payment.latest_charge), refunded: payment.latest_charge?.refunded },
  };
}
