import { describe, expect, it } from 'vitest';
import { auditBillingFulfillment } from './billing-fulfillment-audit.mjs';

const time = '2026-10-05T12:00:00.000Z';
const earlier = '2026-10-05T11:00:00.000Z';
const until = '2026-11-05T12:00:00.000Z';
const planId = '11111111-1111-4111-8111-111111111111';
const community = '22222222-2222-4222-8222-222222222222';
const course = '33333333-3333-4333-8333-333333333333';
const memberId = '44444444-4444-4444-8444-444444444444';
const userId = '55555555-5555-4555-8555-555555555555';
const grant = (resource = null, source = 'stripe_subscription', key = 'sub_fixture') => ({
  id: `grant-${resource ?? 'community'}-${source}`, academy_member_id: memberId, academy_community_id: community,
  course_id: resource, source_type: source, source_key: key, status: 'active', starts_at: earlier,
  ends_at: source === 'stripe_subscription' ? until : null,
});
function fixture() {
  return {
    expectedAccountId: 'acct_fixture', expectedSessionId: 'cs_fixture', account: { id: 'acct_fixture' },
    session: { id: 'cs_fixture', livemode: false, status: 'complete', payment_status: 'paid', amount_total: 3999,
      currency: 'usd', mode: 'subscription', customer: 'cus_fixture', subscription: 'sub_fixture',
      metadata: { plan_id: planId, academy_community_id: community, buyer_email: 'fixture@example.invalid' },
      line_items: { data: [{ price: { id: 'price_fixture' }, quantity: 1 }], has_more: false } },
    plan: { id: planId, academy_community_id: community, stripe_price_id: 'price_fixture', amount_cents: 3999,
      currency: 'usd', billing_type: 'subscription', billing_interval: 'month', offer_kind: 'membership',
      community_access: true, academy_billing_plan_courses: [{ course_id: course }], academy_billing_plan_features: [] },
    price: { id: 'price_fixture', livemode: false, unit_amount: 3999, currency: 'usd', type: 'recurring',
      recurring: { interval: 'month', interval_count: 1 } },
    subscription: { id: 'sub_fixture', customer: 'cus_fixture', livemode: false, status: 'active',
      cancel_at_period_end: false, items: { data: [{ quantity: 1, price: { id: 'price_fixture' }, current_period_end: Date.parse(until) / 1000 }], has_more: false } },
    customer: { academy_community_id: community, academy_member_id: memberId, user_id: userId,
      provider_customer_id: 'cus_fixture', email: 'fixture@example.invalid' },
    member: { id: memberId, user_id: userId, academy_community_id: community, status: 'active' },
    billingRows: [{ academy_member_id: memberId, academy_community_id: community, plan_id: planId,
      source_type: 'stripe_subscription', source_key: 'sub_fixture', provider_customer_id: 'cus_fixture',
      checkout_session_id: 'cs_fixture', status: 'active', cancel_at_period_end: false, current_period_end: until }],
    grants: [grant(), grant(course)], featureGrants: [],
    events: [{ event_type: 'checkout.session.completed', object_id: 'cs_fixture', processed_at: earlier, error_message: null }],
    buyer: { userId, access: { authenticated: true, memberId, communityId: community, hasAccess: true,
      communityAccess: true, canManage: false, pricingGatesEnabled: true, courseIds: [course], features: [] } },
  };
}
const audit = (evidence, expected = 'active', previous) => auditBillingFulfillment(evidence, { expected, mode: 'test', checkedAt: time, previous });
const failing = (report, name) => report.checks.find((row) => row.name === name)?.status;
function cancelled(evidence) {
  evidence.subscription.status = 'canceled';
  evidence.billingRows[0].status = 'cancelled';
  evidence.grants.filter((row) => row.source_type === 'stripe_subscription').forEach((row) => { row.status = 'revoked'; row.ends_at = null; });
  evidence.events.push({ event_type: 'customer.subscription.deleted', object_id: 'sub_fixture', processed_at: time, error_message: null });
  evidence.buyer.access.communityAccess = evidence.grants.some((row) => row.source_type === 'import' && row.course_id === null);
  evidence.buyer.access.courseIds = evidence.grants.some((row) => row.source_type === 'import' && row.course_id === course) ? [course] : [];
  evidence.buyer.access.hasAccess = evidence.buyer.access.communityAccess || evidence.buyer.access.courseIds.length > 0;
  return evidence;
}

describe('read-only fulfillment evidence evaluator (synthetic fixtures, no provider calls)', () => {
  it('verifies exact paid source grants + member access without claiming devices or a whole lifecycle', () => {
    const report = audit(fixture());
    expect(report.status).toBe('verified');
    expect(report.paidCheckoutVerified).toBe(true);
    expect(report.currentFulfillmentVerified).toBe(true);
    expect(report.fullPurchaseLifecycleVerified).toBe(false);
    expect(report.physicalDeviceAccessVerified).toBe(false);
  });
  it('rejects live/test crossover and a different Stripe account', () => {
    for (const field of ['session', 'price', 'subscription']) {
      const evidence = fixture(); evidence[field].livemode = true;
      expect(failing(audit(evidence), 'provider_mode_and_account')).toBe('failed');
    }
    const evidence = fixture(); evidence.account.id = 'acct_other';
    expect(failing(audit(evidence), 'provider_mode_and_account')).toBe('failed');
  });
  it('requires actual paid completion rather than a success-page URL or zero-dollar trial', () => {
    for (const update of [{ status: 'open' }, { payment_status: 'unpaid' }, { amount_total: 0 }]) {
      const evidence = fixture(); Object.assign(evidence.session, update);
      const report = audit(evidence);
      expect(report.paidCheckoutVerified).toBe(false);
      expect(failing(report, 'paid_checkout')).toBe('unverified');
    }
  });
  it('rejects wrong price, amount, interval, duplicate item and truncated line items', () => {
    for (const mutate of [
      (e) => { e.expectedSessionId = 'cs_other'; }, (e) => { e.price.id = 'price_wrong'; }, (e) => { e.price.unit_amount = 1; },
      (e) => { e.price.recurring.interval = 'year'; }, (e) => { e.session.line_items.data[0].quantity = 2; },
      (e) => { e.session.line_items.has_more = true; },
    ]) {
      const evidence = fixture(); mutate(evidence);
      expect(failing(audit(evidence), 'exact_checkout_and_plan')).toBe('failed');
    }
  });
  it('holds an absent webhook/member mapping without claiming paid fulfillment', () => {
    const evidence = fixture(); evidence.events = []; evidence.customer = null; evidence.member = null;
    const report = audit(evidence);
    expect(report.currentFulfillmentVerified).toBe(false);
    expect(failing(report, 'exact_buyer_binding')).toBe('unverified');
    expect(failing(report, 'processed_exact_lifecycle_webhook')).toBe('unverified');
  });
  it('rejects a same-email grant on the wrong member and a moved customer identity', () => {
    const evidence = fixture(); evidence.grants[0].academy_member_id = 'wrong';
    expect(failing(audit(evidence), 'exact_source_access_grants')).toBe('failed');
    evidence.customer.user_id = 'other-user';
    expect(failing(audit(evidence), 'exact_buyer_binding')).toBe('failed');
  });
  it('requires the exact lifecycle event and rejects unprocessed/errored delivery', () => {
    for (const update of [{ object_id: 'cs_other' }, { processed_at: null }, { error_message: 'provider failure' }]) {
      const evidence = fixture(); Object.assign(evidence.events[0], update);
      expect(failing(audit(evidence), 'processed_exact_lifecycle_webhook')).toBe('unverified');
    }
  });
  it('requires the ordinary signed-in buyer rather than reviewer/manager bypass', () => {
    const evidence = fixture(); delete evidence.buyer;
    expect(failing(audit(evidence), 'authenticated_buyer_access')).toBe('unverified');
    evidence.buyer = fixture().buyer; evidence.buyer.access.canManage = true;
    expect(failing(audit(evidence), 'authenticated_buyer_identity')).toBe('failed');
  });
  it('requires both authenticated state and a correct welcome access gate', () => {
    for (const update of [{ authenticated: false }, { hasAccess: false }]) {
      const evidence = fixture(); Object.assign(evidence.buyer.access, update);
      expect(failing(audit(evidence), 'authenticated_buyer_access')).toBe('failed');
    }
    const evidence = fixture(); const previous = audit(evidence);
    cancelled(evidence); evidence.buyer.access.hasAccess = true;
    expect(failing(audit(evidence, 'cancelled', previous), 'authenticated_buyer_access')).toBe('failed');
  });
  it('detects missing source-specific grants even if grandfathered access hides them', () => {
    const evidence = fixture(); evidence.grants = [grant(null, 'import', 'legacy'), grant(course, 'import', 'legacy')];
    expect(failing(audit(evidence), 'exact_source_access_grants')).toBe('unverified');
  });
  it('keeps paid access until the period end while cancellation is scheduled', () => {
    const evidence = fixture(); const previous = audit(evidence);
    evidence.subscription.cancel_at_period_end = true; evidence.billingRows[0].cancel_at_period_end = true;
    evidence.events.push({ object_id: 'sub_fixture', event_type: 'customer.subscription.updated', processed_at: time });
    expect(audit(evidence, 'cancel_at_period_end', previous).status).toBe('verified');
  });
  it('requires a same-buyer verified preservation baseline for cancellation', () => {
    expect(failing(audit(cancelled(fixture()), 'cancelled'), 'preservation_baseline_available')).toBe('unverified');
    const previous = audit(fixture()); previous.identityBinding = 'wrong';
    expect(failing(audit(cancelled(fixture()), 'cancelled', previous), 'same_member_baseline')).toBe('failed');
  });
  it('verifies paid-source revocation while imported grants and access remain intact', () => {
    const evidence = fixture(); evidence.grants.push(grant(null, 'import', 'legacy'), grant(course, 'import', 'legacy'));
    const previous = audit(evidence);
    const report = audit(cancelled(evidence), 'cancelled', previous);
    expect(report.status).toBe('verified');
    expect(failing(report, 'imported_and_manual_grants_preserved')).toBe('passed');
    evidence.grants = evidence.grants.filter((row) => row.source_type !== 'import');
    expect(failing(audit(evidence, 'cancelled', previous), 'imported_and_manual_grants_preserved')).toBe('failed');
  });
  it('detects stale revoked grants that still confer effective app access', () => {
    const evidence = fixture(); const previous = audit(evidence);
    cancelled(evidence); evidence.buyer.access.communityAccess = true;
    expect(failing(audit(evidence, 'cancelled', previous), 'authenticated_buyer_access')).toBe('failed');
  });
  it('checks tool features independently of community/course access', () => {
    const evidence = fixture(); evidence.plan.offer_kind = 'tool'; evidence.plan.community_access = false;
    evidence.plan.academy_billing_plan_courses = []; evidence.plan.academy_billing_plan_features = [{ feature_key: 'measuring_tool' }];
    evidence.grants = []; evidence.featureGrants = [{ ...grant(), feature_key: 'measuring_tool' }];
    evidence.buyer.access.communityAccess = false; evidence.buyer.access.courseIds = []; evidence.buyer.access.features = ['measuring_tool'];
    expect(audit(evidence).status).toBe('verified');
    evidence.buyer.access.features = [];
    expect(failing(audit(evidence), 'authenticated_buyer_access')).toBe('failed');
  });
  it('verifies a full one-time refund, but does not treat partial/subscription refunds as cancellation', () => {
    const evidence = fixture(); evidence.session.mode = 'payment'; evidence.session.subscription = null; evidence.session.payment_intent = 'pi_fixture';
    evidence.plan.billing_type = 'one_time'; evidence.plan.billing_interval = 'one_time'; evidence.price.type = 'one_time';
    delete evidence.subscription;
    evidence.payment = { id: 'pi_fixture', customer: 'cus_fixture', livemode: false, status: 'succeeded', latest_charge: { id: 'ch_fixture', refunded: false } };
    evidence.billingRows[0].source_type = 'stripe_payment'; evidence.billingRows[0].source_key = 'cs_fixture'; evidence.billingRows[0].current_period_end = null;
    evidence.grants.forEach((row) => { row.source_type = 'stripe_payment'; row.source_key = 'cs_fixture'; row.ends_at = null; });
    const previous = audit(evidence); expect(previous.status).toBe('verified');
    evidence.payment.latest_charge.refunded = true; evidence.billingRows[0].status = 'cancelled';
    evidence.grants.forEach((row) => { row.status = 'revoked'; });
    evidence.buyer.access.hasAccess = false; evidence.buyer.access.communityAccess = false; evidence.buyer.access.courseIds = [];
    evidence.events.push({ object_id: 'ch_fixture', event_type: 'charge.refunded', processed_at: time });
    expect(audit(evidence, 'refunded', previous).status).toBe('verified');
    evidence.payment.latest_charge.refunded = false;
    expect(failing(audit(evidence, 'refunded', previous), 'expected_provider_state')).toBe('failed');
    expect(failing(audit(fixture(), 'refunded', audit(fixture())), 'expected_provider_state')).toBe('failed');
  });
  it('does not retain provider IDs, emails, raw events or token-like fields', () => {
    const evidence = fixture(); evidence.events[0].rawSecret = 'privatefixture';
    const output = JSON.stringify(audit(evidence));
    for (const value of [evidence.customer.email, evidence.session.id, planId, userId, 'privatefixture']) expect(output).not.toContain(value);
  });
});
