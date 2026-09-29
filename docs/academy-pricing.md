# Academy pricing — September 28 owner requirements

Source: the owner's supplied pricing screenshot. Amounts are recorded as USD; the existing matching Stripe prices are USD. This is a held configuration draft, not an active catalog or a database migration. Machine-readable values are in `academy-pricing.draft.json`.

| Offering | Price | Includes |
| --- | --- | --- |
| Existing members | Free | Community conversations and Turf Cleaning Academy certification |
| New members | $39.99/month | Community conversations and Turf Cleaning Academy certification |
| Full turf cleaning course | $149.95 once | Separate course upgrade, available to existing and new members |
| Tile and grout cleaning | $149.95 once | Separate course upgrade |
| Pavers and travertine cleaning | $149.95 once | One combined course upgrade |
| Measuring tool | $29.95/month extra | Separate tool subscription |
| SEO tools | $149.95/month extra | Separate tool subscription |
| Turf cleaning CRM | $189.99/month, future | Do not publish or sell until built and approved |

## Access rules to implement before activation

- Establish the reviewed existing-member roster at cutover. Do not make newly created accounts free by treating every active member as grandfathered.
- Preserve prior imported/manual course grants. The new upgrade prices do not authorize revoking courses members already own or cancelling existing payment agreements.
- Base membership grants community and certification content only. It must not accidentally unlock all paid courses or tools.
- The current imported catalog has one combined course, Turf Cleaning Academy (`a0238fea-1bfd-46de-978d-f476492edec8`, GHL `0a9ea28f-eaa0-4b4f-a1eb-4b6bc23df18b`). The owner must identify certification content versus the paid full course before the split can be mapped. Do not map both offers to the same course-wide grant.
- Existing-member upgrade checkout needs implementation: `create-checkout` currently rejects any active grant or related purchase/subscription in the community. Replace those broad checks with authorized, offer-specific ownership checks while retaining duplicate-payment protection and checkout reservations. Never remove the protection without its replacement.
- Tool entitlements need server enforcement as well as web/iOS/Android UI states. The current billing grant model covers community and courses, not individual tools. A Stripe price alone cannot gate the measuring or SEO tools.
- Recurring cancellation/revocation affects only that purchase's grants. Course purchases and grandfathered access remain independent. Decide whether paid upgrades require a continuing base membership; the screenshot does not settle that policy.
- Keep native checkout links disabled while the existing web payment integration is completed. Do not infer store approval from this pricing plan.

## Read-only Stripe audit

The supplied live key successfully listed all six active prices on September 28. Four are $39.99/month USD; their IDs, product names and nicknames are recorded in the JSON draft. Several product names are `Communities - undefined`, so amount alone is not a reliable plan mapping. The remaining two prices are $300/month with the nickname `Test`; they were left untouched.

No matching $149.95 one-time, $29.95/month, $149.95/month or $189.99/month active prices were found. No products/prices were created or changed. Existing subscriptions and payment links must be reconciled before selecting a membership price, and absent upgrade prices should be created only after their content/tool mapping is settled. [Stripe price-list API](https://docs.stripe.com/api/prices/list)

## Release status

All draft offers are inactive with unmapped Stripe IDs. Checkout stays disabled. No hosted data, member access, subscriptions, emails, app releases or deployments were changed. The live key is private and ignored by Git; it must be replaced before production because it appeared in the conversation. Sandbox purchase/access/cancellation testing still needs separate test credentials and an isolated backend.
