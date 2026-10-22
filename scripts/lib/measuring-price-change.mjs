import { createHash } from 'node:crypto';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const pricePattern = /^price_[A-Za-z0-9]+$/;
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
export const measuringPriceVersion = 'measuring-tool-10-monthly-v2';

function reviewedId(value, pattern, label) {
  if (typeof value !== 'string' || value !== value.trim() || !pattern.test(value)) {
    throw new Error(`A valid reviewed ${label} is required.`);
  }
  return pattern === uuidPattern ? value.toLowerCase() : value;
}

// Stable across preparation reruns: the version gets one new identity per community.
export function measuringPricePlanId(communityId) {
  const community = reviewedId(communityId, uuidPattern, 'community UUID');
  const bytes = createHash('sha256').update(`${community}:${measuringPriceVersion}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Offline preparation only. The supplied Price must be an intentionally reviewed
// Stripe Price response; an ID alone cannot establish its amount or mode.
export function measuringPriceChangeSql({ communityId, oldPlanId, oldStripePriceId, newStripePrice, mode, activateNewSales = false }) {
  const community = reviewedId(communityId, uuidPattern, 'community UUID');
  const oldPlan = reviewedId(oldPlanId, uuidPattern, 'old plan UUID');
  const oldPrice = reviewedId(oldStripePriceId, pricePattern, 'old Stripe price ID');
  if (!['live', 'test'].includes(mode)) throw new Error('Choose Stripe mode explicitly: live or test.');
  if (typeof activateNewSales !== 'boolean') throw new Error('Activation must be an explicit boolean.');
  const newPrice = reviewedId(newStripePrice?.id, pricePattern, 'new Stripe price ID');
  if (oldPrice === newPrice) throw new Error('A NEW Stripe Price is required; preserve the old price mapping.');
  if (newStripePrice.active !== true || newStripePrice.livemode !== (mode === 'live') ||
      newStripePrice.currency !== 'usd' || newStripePrice.unit_amount !== 1000 ||
      newStripePrice.type !== 'recurring' || newStripePrice.billing_scheme !== 'per_unit' ||
      newStripePrice.recurring?.interval !== 'month' || newStripePrice.recurring?.interval_count !== 1 ||
      newStripePrice.recurring?.usage_type !== 'licensed' ||
      newStripePrice.transform_quantity != null || newStripePrice.custom_unit_amount != null) {
    throw new Error('Expected an active fixed USD 10/month Stripe Price in the explicitly selected mode.');
  }
  const newPlan = measuringPricePlanId(community);
  if (newPlan === oldPlan) throw new Error('The new version cannot reuse the old plan identity.');
  const name = 'Measuring Tool';
  const description = 'Map and camera measurement tools. A separate $10 monthly subscription.';
  const metadata = JSON.stringify({ offer_version: measuringPriceVersion, supersedes_plan_id: oldPlan, supersedes_stripe_price_id: oldPrice, stripe_mode: mode, existing_subscriptions_unchanged: true });
  return `-- LOCAL PREPARATION ONLY. No Stripe or database action was performed.
-- Reviewed Stripe mode: ${mode}. Price JSON must come from that Stripe account.
-- New sales only. Preserve the old plan/price mapping for its existing purchases.
-- ${activateNewSales ? 'EXPLICIT NEW-SALES ACTIVATION REQUESTED.' : 'INACTIVE BY DEFAULT. No checkout cutover is included.'}
begin;
lock table public.academy_billing_plans in share row exclusive mode;
lock table public.academy_billing_plan_features in share row exclusive mode;
lock table public.academy_billing_plan_courses in share row exclusive mode;
do $measuring_version$
declare
  old_plan public.academy_billing_plans%rowtype;
  new_plan public.academy_billing_plans%rowtype;
  matching_rows integer;
begin
  select * into old_plan from public.academy_billing_plans where id=${quote(oldPlan)}::uuid for update;
  if old_plan.id is null
    or old_plan.academy_community_id<>${quote(community)}::uuid
    or old_plan.slug<>'measuring-tool'
    or old_plan.stripe_price_id is distinct from ${quote(oldPrice)}
    or old_plan.amount_cents<>2995 or old_plan.currency<>'usd'
    or old_plan.billing_type<>'subscription' or old_plan.billing_interval<>'month'
    or old_plan.offer_kind<>'tool' or old_plan.community_access
    or old_plan.requires_membership or old_plan.trial_days<>0
    or (select count(*) from public.academy_billing_plan_features where plan_id=old_plan.id)<>1
    or not exists(select 1 from public.academy_billing_plan_features where plan_id=old_plan.id and feature_key='measuring_tool')
    or exists(select 1 from public.academy_billing_plan_courses where plan_id=old_plan.id)
  then raise exception 'Hold: old measuring plan identity, pricing or entitlement mapping has changed'; end if;

  select count(*) into matching_rows from public.academy_billing_plans
    where id=${quote(newPlan)}::uuid
      or (academy_community_id=${quote(community)}::uuid and slug=${quote(measuringPriceVersion)})
      or stripe_price_id=${quote(newPrice)};
  if matching_rows>1 then raise exception 'Hold: conflicting new version identities'; end if;
  if matching_rows=1 then
    select * into new_plan from public.academy_billing_plans
      where id=${quote(newPlan)}::uuid
        or (academy_community_id=${quote(community)}::uuid and slug=${quote(measuringPriceVersion)})
        or stripe_price_id=${quote(newPrice)} for update;
    if new_plan.id<>${quote(newPlan)}::uuid
      or new_plan.academy_community_id<>${quote(community)}::uuid
      or new_plan.slug<>${quote(measuringPriceVersion)}
      or new_plan.stripe_price_id is distinct from ${quote(newPrice)}
      or new_plan.name<>${quote(name)} or new_plan.description<>${quote(description)}
      or new_plan.amount_cents<>1000 or new_plan.currency<>'usd'
      or new_plan.billing_type<>'subscription' or new_plan.billing_interval<>'month'
      or new_plan.offer_kind<>'tool' or new_plan.community_access
      or new_plan.requires_membership or new_plan.trial_days<>0
      or new_plan.metadata is distinct from ${quote(metadata)}::jsonb
      or (select count(*) from public.academy_billing_plan_features where plan_id=new_plan.id)<>1
      or not exists(select 1 from public.academy_billing_plan_features where plan_id=new_plan.id and feature_key='measuring_tool')
      or exists(select 1 from public.academy_billing_plan_courses where plan_id=new_plan.id)
    then raise exception 'Hold: existing new version does not exactly match the reviewed preparation'; end if;
    -- Exact reruns preserve the existing active flag; they never reset a cutover.
  else
    insert into public.academy_billing_plans(id,academy_community_id,slug,name,description,stripe_price_id,billing_type,billing_interval,amount_cents,currency,trial_days,community_access,active,offer_kind,requires_membership,metadata)
    values(${quote(newPlan)}::uuid,${quote(community)}::uuid,${quote(measuringPriceVersion)},${quote(name)},${quote(description)},${quote(newPrice)},'subscription','month',1000,'usd',0,false,false,'tool',false,${quote(metadata)}::jsonb);
    insert into public.academy_billing_plan_features(plan_id,feature_key)
      values(${quote(newPlan)}::uuid,'measuring_tool');
  end if;
${activateNewSales ? `  -- Only catalog availability changes; existing renewals keep their old identity.
  update public.academy_billing_plans set active=true where id=${quote(newPlan)}::uuid;
  update public.academy_billing_plans set active=false where id=${quote(oldPlan)}::uuid;
` : ''}end $measuring_version$;
commit;
`;
}
