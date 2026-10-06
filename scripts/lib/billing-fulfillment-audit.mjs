import { createHash } from 'node:crypto';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const id = (value) => typeof value === 'string' ? value : value?.id;
const email = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';
const stamp = (value) => typeof value === 'number' ? value * 1000 : Date.parse(value);
const sameTime = (left, right) => left == null && right == null || stamp(left) === stamp(right);
const liveGrant = (row, now) => row.status === 'active' && stamp(row.starts_at) <= now &&
  (row.ends_at == null || stamp(row.ends_at) > now);

export const billingAuditExpectations = ['active', 'cancel_at_period_end', 'cancelled', 'refunded', 'unpaid'];

// This is an evidence evaluator, not a payment simulator. The CLI supplies fresh
// exact-ID provider/database reads. Never retain provider objects in its result.
export function auditBillingFulfillment(evidence, { expected, mode, checkedAt, previous } = {}) {
  if (!billingAuditExpectations.includes(expected) || !['test', 'live'].includes(mode)) {
    throw new Error('Invalid billing audit options');
  }
  const now = Date.parse(checkedAt);
  if (!Number.isFinite(now)) throw new Error('Invalid billing audit time');
  const { account, session = {}, price = {}, plan = {}, customer, member, subscription,
    payment, billingRows = [], grants = [], featureGrants = [], events = [], buyer } = evidence;
  const checks = [];
  const check = (name, passed, pending = false) => checks.push({ name, status: passed ? 'passed' : pending ? 'unverified' : 'failed' });
  const livemode = mode === 'live';
  const isSubscription = session.mode === 'subscription';
  const sourceType = isSubscription ? 'stripe_subscription' : 'stripe_payment';
  const sourceKey = isSubscription ? id(session.subscription) : session.id;
  const items = session.line_items?.data;
  const courses = plan.academy_billing_plan_courses?.map((row) => row.course_id) ?? [];
  const features = plan.academy_billing_plan_features?.map((row) => row.feature_key) ?? [];
  const scoped = (row) => row.academy_member_id === member?.id && row.academy_community_id === plan.academy_community_id;
  const sourceRow = (row) => row.source_type === sourceType && row.source_key === sourceKey;
  const sourceGrants = grants.filter(sourceRow);
  const sourceFeatures = featureGrants.filter(sourceRow);
  const paid = session.status === 'complete' && session.payment_status === 'paid' &&
    Number.isInteger(session.amount_total) && session.amount_total > 0;
  const identity = hash([account?.id, session.id, plan.id, customer?.provider_customer_id, member?.id, member?.user_id]);

  check('provider_mode_and_account', Boolean(account?.id) && account.id === evidence.expectedAccountId &&
    session.livemode === livemode && price.livemode === livemode && (!subscription || subscription.livemode === livemode) &&
    (!payment || payment.livemode === livemode));
  check('exact_checkout_and_plan', /^cs_[A-Za-z0-9_]+$/.test(session.id ?? '') && session.id === evidence.expectedSessionId && uuid.test(plan.id ?? '') &&
    session.metadata?.plan_id === plan.id && session.metadata?.academy_community_id === plan.academy_community_id &&
    ['subscription', 'payment'].includes(session.mode) &&
    plan.billing_type === (isSubscription ? 'subscription' : 'one_time') &&
    Array.isArray(items) && items.length === 1 && !session.line_items.has_more &&
    items[0].quantity === 1 && id(items[0].price) === plan.stripe_price_id && price.id === plan.stripe_price_id &&
    price.unit_amount === plan.amount_cents && price.currency === plan.currency && session.currency === plan.currency &&
    (isSubscription ? price.type === 'recurring' && price.recurring?.interval === plan.billing_interval &&
      price.recurring?.interval_count === 1 : price.type === 'one_time'));
  check('plan_entitlement_mapping', ['membership', 'course', 'tool'].includes(plan.offer_kind) &&
    (plan.offer_kind === 'membership' ? plan.community_access === true && courses.length > 0 && features.length === 0 :
      plan.offer_kind === 'course' ? plan.community_access === false && courses.length > 0 && features.length === 0 :
        plan.community_access === false && courses.length === 0 && features.length > 0) &&
    new Set(courses).size === courses.length && new Set(features).size === features.length);

  let billingStatus = isSubscription ? ({ canceled: 'cancelled', unpaid: 'past_due', incomplete: 'pending',
    incomplete_expired: 'expired' }[subscription?.status] ?? subscription?.status) : payment?.latest_charge?.refunded ? 'cancelled' : 'active';
  const periodEnd = isSubscription ? (subscription?.current_period_end ??
    Math.max(...(subscription?.items?.data ?? []).map((row) => row.current_period_end ?? 0))) || null : null;
  if (isSubscription && ['active', 'trialing'].includes(billingStatus) && periodEnd && stamp(periodEnd) <= now) billingStatus = 'expired';
  const grantStatus = ['active', 'trialing'].includes(billingStatus) ? 'active' :
    billingStatus === 'cancelled' ? 'revoked' : billingStatus === 'expired' ? 'expired' : 'suspended';
  const expectationMatches = expected === 'active' ? billingStatus === 'active' && !subscription?.cancel_at_period_end :
    expected === 'cancel_at_period_end' ? isSubscription && billingStatus === 'active' && subscription.cancel_at_period_end === true && stamp(periodEnd) > now :
    expected === 'cancelled' ? isSubscription && billingStatus === 'cancelled' :
    expected === 'refunded' ? !isSubscription && payment?.latest_charge?.refunded === true : session.payment_status === 'unpaid';
  check('expected_provider_state', expectationMatches, expected !== 'unpaid' && !paid);
  check('paid_checkout', expected === 'unpaid' ? !paid : paid, expected !== 'unpaid' && !paid);

  if (expected === 'unpaid') {
    check('unpaid_has_no_stripe_access', !sourceGrants.some((row) => liveGrant(row, now)) && !sourceFeatures.some((row) => liveGrant(row, now)) &&
      !billingRows.some((row) => ['active', 'trialing'].includes(row.status)));
  } else {
    check('exact_buyer_binding', Boolean(customer && member && member.user_id) && customer.provider_customer_id === id(session.customer) &&
      customer.academy_community_id === plan.academy_community_id && customer.academy_member_id === member.id &&
      customer.user_id === member.user_id && member.academy_community_id === plan.academy_community_id && member.status === 'active' &&
      email(customer.email) !== '' && email(customer.email) === email(session.metadata?.buyer_email), !customer || !member);
    check('subscription_price_and_customer', !isSubscription || Boolean(subscription && subscription.id === sourceKey &&
      id(subscription.customer) === id(session.customer) && subscription.items?.data?.length === 1 && !subscription.items.has_more &&
      subscription.items.data[0].quantity === 1 && id(subscription.items.data[0].price) === plan.stripe_price_id));
    check('one_time_payment_binding', isSubscription || Boolean(payment && payment.id === id(session.payment_intent) &&
      payment.status === 'succeeded' && id(payment.customer) === id(session.customer)), !isSubscription && !payment);
    check('exact_billing_record', billingRows.length === 1 && scoped(billingRows[0]) && sourceRow(billingRows[0]) &&
      billingRows[0].plan_id === plan.id && billingRows[0].provider_customer_id === id(session.customer) &&
      billingRows[0].checkout_session_id === session.id && billingRows[0].status === billingStatus &&
      billingRows[0].cancel_at_period_end === Boolean(subscription?.cancel_at_period_end) &&
      sameTime(billingRows[0].current_period_end, periodEnd), billingRows.length === 0);
    const resources = new Set([...(plan.community_access ? ['community'] : []), ...courses.map((value) => `course:${value}`)]);
    const matches = (row) => scoped(row) && row.status === grantStatus && sameTime(row.ends_at, grantStatus === 'active' ? periodEnd : null) &&
      (grantStatus !== 'active' || liveGrant(row, now));
    const accessResources = sourceGrants.map((row) => row.course_id ? `course:${row.course_id}` : 'community');
    check('exact_source_access_grants', resources.size === accessResources.length && new Set(accessResources).size === accessResources.length &&
      accessResources.every((value) => resources.has(value)) && sourceGrants.every(matches), resources.size > 0 && sourceGrants.length === 0);
    check('exact_source_feature_grants', features.length === sourceFeatures.length && new Set(sourceFeatures.map((row) => row.feature_key)).size === sourceFeatures.length &&
      sourceFeatures.every((row) => features.includes(row.feature_key) && matches(row)), features.length > 0 && sourceFeatures.length === 0);
    const relevant = events.filter((row) => row.object_id === session.id || row.object_id === sourceKey ||
      expected === 'refunded' && row.object_id === id(payment?.latest_charge));
    const lifecycle = expected === 'refunded' ? relevant.filter((row) => row.event_type === 'charge.refunded') :
      expected === 'cancelled' || expected === 'cancel_at_period_end' ? relevant.filter((row) => row.object_id === sourceKey &&
        ['customer.subscription.updated', 'customer.subscription.deleted'].includes(row.event_type)) :
        relevant.filter((row) => row.object_id === session.id && ['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(row.event_type));
    check('processed_exact_lifecycle_webhook', lifecycle.some((row) => row.processed_at && !row.error_message), true);
  }

  const preserved = [...grants.map((row) => ['access', row]), ...featureGrants.map((row) => ['feature', row])]
    .filter(([, row]) => ['import', 'manual'].includes(row.source_type) && scoped(row))
    .map(([kind, row]) => hash([kind, row.id, row.course_id ?? row.feature_key ?? null, row.source_type, row.source_key, row.status, row.starts_at, row.ends_at, row.metadata]))
    .sort();
  const isEnding = ['cancel_at_period_end', 'cancelled', 'refunded'].includes(expected);
  if (previous) {
    check('same_member_baseline', previous.identityBinding === identity && previous.mode === mode &&
      previous.kind === 'read_only_billing_fulfillment_audit' && previous.paidCheckoutVerified === true &&
      previous.currentFulfillmentVerified === true && Date.parse(previous.checkedAt) <= now);
    check('imported_and_manual_grants_preserved', Array.isArray(previous.independentGrantFingerprints) &&
      previous.independentGrantFingerprints.every((fingerprint) => preserved.includes(fingerprint)));
  } else if (isEnding) {
    check('preservation_baseline_available', false, true);
  }
  if (buyer) {
    const access = buyer.access;
    const expectedCommunity = grants.some((row) => scoped(row) && row.course_id == null && liveGrant(row, now));
    const expectedCourses = courses.filter((course) => grants.some((row) => scoped(row) && row.course_id === course && liveGrant(row, now)));
    const expectedFeatures = features.filter((feature) => featureGrants.some((row) => scoped(row) && row.feature_key === feature && liveGrant(row, now)));
    const expectedAny = grants.some((row) => scoped(row) && liveGrant(row, now)) || featureGrants.some((row) => scoped(row) && liveGrant(row, now));
    check('authenticated_buyer_identity', buyer.userId === member?.user_id && access?.memberId === member?.id &&
      access.communityId === plan.academy_community_id && access.canManage === false && access.pricingGatesEnabled === true);
    check('authenticated_buyer_access', access?.authenticated === true && access.hasAccess === expectedAny && access.communityAccess === expectedCommunity &&
      Array.isArray(access.courseIds) && courses.every((course) => access.courseIds.includes(course) === expectedCourses.includes(course)) &&
      Array.isArray(access.features) && features.every((feature) => access.features.includes(feature) === expectedFeatures.includes(feature)));
  } else {
    check('authenticated_buyer_access', false, true);
  }
  const failed = checks.some((row) => row.status === 'failed');
  const pending = checks.some((row) => row.status === 'unverified');
  return {
    schemaVersion: 1, kind: 'read_only_billing_fulfillment_audit', checkedAt, expected, mode,
    status: failed ? 'mismatch' : pending ? 'unverified' : 'verified', checks,
    paidCheckoutVerified: paid && checks.slice(0, 3).every((row) => row.status === 'passed'),
    currentFulfillmentVerified: !failed && !pending,
    fullPurchaseLifecycleVerified: false,
    physicalDeviceAccessVerified: false,
    identityBinding: identity, independentGrantFingerprints: preserved,
  };
}
