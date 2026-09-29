import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pricingCatalogSql } from './pricing-catalog.mjs';

const community = 'fac17da0-bdb9-48c0-9c67-591d087e9912';
const fixture = () => JSON.parse(readFileSync(new URL('../../docs/academy-pricing.draft.json', import.meta.url), 'utf8'));
describe('held pricing catalog preparation', () => {
  it('retains reviewed price IDs without enabling checkout or offers', () => {
    const draft = fixture();
    const sql = pricingCatalogSql(draft, community);
    for (const offer of draft.offers.slice(0, 5)) expect(sql).toContain(`false,false,'${offer.stripePriceId}'`);
    expect(sql).toContain('pricing_gates_enabled=false');
    expect(sql).toContain('Pricing drafts already exist');
    expect(sql).not.toContain("'seo-tools'");
    expect(sql).not.toContain("'turf-cleaning-crm'");
  });
  it('still accepts unassigned price IDs for offline drafts', () => {
    const draft = fixture();
    draft.offers.forEach(offer => { offer.stripePriceId = null; });
    expect(pricingCatalogSql(draft, community).match(/false,false,null/g)).toHaveLength(5);
  });
  it.each([undefined, '', 'price_', 'price_bad;drop', "price_bad'", 'price_valid\n', 123, 'prod_wrong'])(
    'rejects an invalid price ID %s before producing SQL', value => {
      const draft = fixture(); draft.offers[0].stripePriceId = value;
      expect(() => pricingCatalogSql(draft, community)).toThrow('Invalid or active');
    },
  );
  it('rejects shared price IDs across offers', () => {
    const draft = fixture(); draft.offers[1].stripePriceId = draft.offers[0].stripePriceId;
    expect(() => pricingCatalogSql(draft, community)).toThrow('Invalid or active');
  });
  it('rejects active offers and enabled checkout', () => {
    const draft = fixture(); draft.offers[0].active = true;
    expect(() => pricingCatalogSql(draft, community)).toThrow('Invalid or active');
    draft.offers[0].active = false; draft.checkoutEnabled = true;
    expect(() => pricingCatalogSql(draft, community)).toThrow('disabled USD');
  });
});
