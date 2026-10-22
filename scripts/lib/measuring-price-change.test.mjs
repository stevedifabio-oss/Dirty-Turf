import { describe, expect, it } from 'vitest';
import { measuringPriceChangeSql, measuringPricePlanId, measuringPriceVersion } from './measuring-price-change.mjs';

const communityId = 'fac17da0-bdb9-48c0-9c67-591d087e9912';
const oldPlanId = 'f2aca619-3ac5-4701-8204-b0d3eff4c507';
const fixture = () => ({ communityId, oldPlanId, oldStripePriceId: 'price_1UL6ZpRfnCxS2laIoklVoP83', mode: 'test', newStripePrice: { id: 'price_reviewedNew10', active: true, livemode: false, unit_amount: 1000, currency: 'usd', type: 'recurring', billing_scheme: 'per_unit', recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' } } });

describe('local measuring price version preparation', () => {
  it('uses one stable new identity and an exact measuring-only version mapping', () => {
    const sql = measuringPriceChangeSql(fixture());
    const newId = measuringPricePlanId(communityId);
    expect(newId).not.toBe(oldPlanId);
    expect(measuringPricePlanId(communityId.toUpperCase())).toBe(newId);
    expect(sql).toContain(`'${newId}'::uuid,'${communityId}'::uuid,'${measuringPriceVersion}'`);
    expect(sql).toContain("'subscription','month',1000,'usd',0,false,false,'tool',false");
    expect(sql).toContain(`values('${newId}'::uuid,'measuring_tool')`);
    expect(sql).toContain('old_plan.amount_cents<>2995');
    expect(sql).toContain("old_plan.currency<>'usd'");
    expect(sql).toContain('old_plan.community_access');
    expect(sql).toContain('exists(select 1 from public.academy_billing_plan_courses where plan_id=old_plan.id)');
  });
  it('is inactive by default and never rewrites a prior price or fulfillment identity', () => {
    const sql = measuringPriceChangeSql(fixture());
    expect(sql).toContain('INACTIVE BY DEFAULT');
    expect(sql).not.toMatch(/update\s|delete\s|on conflict/i);
    for (const table of ['academy_billing_subscriptions', 'academy_access_grants', 'academy_feature_grants', 'academy_members', 'course_enrollments']) expect(sql).not.toContain(table);
    expect(sql).not.toContain('http');
  });
  it('permits only explicit new-sales activation and preserves old renewal mappings', () => {
    const sql = measuringPriceChangeSql({ ...fixture(), activateNewSales: true });
    expect(sql.match(/update public.academy_billing_plans set active=/g)).toHaveLength(2);
    expect(sql).toContain(`set active=false where id='${oldPlanId}'::uuid`);
    expect(sql).toContain(`set active=true where id='${measuringPricePlanId(communityId)}'::uuid`);
    expect(sql).not.toMatch(/set\s+(stripe_price_id|metadata|amount_cents|plan_id)\s*=/i);
  });
  it('holds any mismatched rerun and never repairs or overwrites it silently', () => {
    const sql = measuringPriceChangeSql(fixture());
    expect(sql).toContain('matching_rows>1');
    expect(sql).toContain('new_plan.metadata is distinct from');
    expect(sql).toContain('existing new version does not exactly match');
    expect(sql).toContain('Exact reruns preserve the existing active flag');
    expect(sql).toContain("new_plan.stripe_price_id is distinct from 'price_reviewedNew10'");
    expect(sql).toContain("feature_key='measuring_tool'");
    expect(sql).toContain('where plan_id=new_plan.id)<>1');
  });
  it.each(['', null, 10, 'fac17da0-bdb9-48c0-9c67-591d087e9912\n', "fac17da0-bdb9-48c0-9c67-591d087e9912';drop table x;--"])(
    'rejects unsafe community or old plan IDs: %s', value => {
      expect(() => measuringPriceChangeSql({ ...fixture(), communityId: value })).toThrow('UUID');
      expect(() => measuringPriceChangeSql({ ...fixture(), oldPlanId: value })).toThrow('UUID');
    },
  );
  it.each(['', null, 10, 'price_ID\n', "price_x';drop table x;--", 'prod_wrong'])(
    'rejects unsafe Stripe IDs: %s', value => {
      expect(() => measuringPriceChangeSql({ ...fixture(), oldStripePriceId: value })).toThrow('price ID');
      const config = fixture(); config.newStripePrice.id = value;
      expect(() => measuringPriceChangeSql(config)).toThrow('price ID');
    },
  );
  it('requires a different price and an explicit mode that matches the reviewed object', () => {
    const config = fixture(); config.newStripePrice.id = config.oldStripePriceId;
    expect(() => measuringPriceChangeSql(config)).toThrow('NEW Stripe Price');
    expect(() => measuringPriceChangeSql({ ...fixture(), mode: undefined })).toThrow('mode explicitly');
    expect(() => measuringPriceChangeSql({ ...fixture(), mode: 'live' })).toThrow('selected mode');
    const live = fixture(); live.mode = 'live'; live.newStripePrice.livemode = true;
    expect(measuringPriceChangeSql(live)).toContain('Reviewed Stripe mode: live');
    expect(() => measuringPriceChangeSql({ ...fixture(), activateNewSales: 'true' })).toThrow('explicit boolean');
  });
  it.each([{ active: false }, { currency: 'eur' }, { unit_amount: 2995 }, { unit_amount: '1000' }, { billing_scheme: 'tiered' }, { type: 'one_time' }, { transform_quantity: { divide_by: 2 } }, { recurring: { interval: 'month', interval_count: 2, usage_type: 'licensed' } }, { recurring: { interval: 'month', interval_count: 1, usage_type: 'metered' } }])(
    'rejects a price that is not fixed USD 10/month: %j', patch => {
      const config = fixture(); Object.assign(config.newStripePrice, patch);
      expect(() => measuringPriceChangeSql(config)).toThrow('Expected an active fixed');
    },
  );
  it('includes no arbitrary Stripe metadata or source credentials in SQL', () => {
    const config = fixture(); config.newStripePrice.metadata = { secret: 'DO_NOT_COPY' }; config.newStripePrice.product = { description: 'DO_NOT_COPY' };
    expect(measuringPriceChangeSql(config)).not.toContain('DO_NOT_COPY');
  });
});
