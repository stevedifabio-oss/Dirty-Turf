const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";

// Preparation only: never creates Stripe resources, connects to a DB, or enables sales.
export function pricingCatalogSql(draft, communityId) {
  if (!uuid.test(communityId)) throw new Error("A valid reviewed Academy community UUID is required.");
  if (draft?.checkoutEnabled !== false || draft?.currency !== 'usd' || !Array.isArray(draft.offers)) throw new Error('Expected a disabled USD pricing draft.');
  const offers = draft.offers.filter(offer => offer.kind !== 'future' && offer.slug !== 'seo-tools');
  const slugs = new Set();
  for (const offer of offers) {
    if (!/^[a-z][a-z0-9-]{1,80}$/.test(offer.slug) || slugs.has(offer.slug) ||
        typeof offer.name !== 'string' || !offer.name || !Number.isSafeInteger(offer.amountCents) || offer.amountCents <= 0 ||
        !['membership', 'course_upgrade', 'tool_addon'].includes(offer.kind) ||
        !['month', 'one_time'].includes(offer.billingInterval) || offer.active !== false || offer.stripePriceId !== null ||
        (offer.kind === 'course_upgrade' && offer.billingInterval !== 'one_time') ||
        (offer.kind === 'tool_addon' && offer.slug !== 'measuring-tool')) throw new Error('Invalid or active pricing draft offer.');
    slugs.add(offer.slug);
  }
  if (offers.length !== 5) throw new Error('Expected membership, three course upgrades, and the measuring tool.');
  return `-- Prepared locally. Review before applying; all offers remain INACTIVE.
-- Certification and paid course mappings must be resolved before activation.
begin;
do $pricing$ begin
  if not exists(select 1 from public.academy_communities where id=${quote(communityId)}::uuid and pricing_gates_enabled=false) then
    raise exception 'Expected a reviewed community with pricing gates disabled';
  end if;
  if exists(select 1 from public.academy_billing_plans where academy_community_id=${quote(communityId)}::uuid and slug in (${offers.map(o => quote(o.slug)).join(',')})) then
    raise exception 'Pricing drafts already exist; review them instead of overwriting';
  end if;
end $pricing$;
${offers.map(offer => {
  const kind = { membership: 'membership', course_upgrade: 'course', tool_addon: 'tool' }[offer.kind];
  const description = offer.kind === 'membership'
    ? 'Community conversations and Turf Cleaning Academy certification.'
    : offer.kind === 'tool_addon' ? 'Map and camera measurement tools. A separate monthly subscription.' : 'A separate one-time course purchase.';
  return `insert into public.academy_billing_plans(academy_community_id,slug,name,description,amount_cents,currency,billing_type,billing_interval,community_access,offer_kind,requires_membership,active,stripe_price_id,metadata)
values(${quote(communityId)}::uuid,${quote(offer.slug)},${quote(offer.name)},${quote(description)},${offer.amountCents},'usd',${quote(offer.billingInterval === 'one_time' ? 'one_time' : 'subscription')},${quote(offer.billingInterval)},${kind === 'membership'},${quote(kind)},false,false,null,'{"pricing_draft":true,"content_mapping_review_required":true}'::jsonb);`;
}).join('\n')}
insert into public.academy_billing_plan_features(plan_id,feature_key)
select id,'measuring_tool' from public.academy_billing_plans where academy_community_id=${quote(communityId)}::uuid and slug='measuring-tool' and active=false;
-- SEO is not implemented and CRM is future-only, so neither is seeded for sale.
commit;
`;
}
