# Migration readiness work session — 22 October 2026

Work window: 16:00–17:30 UTC (11:00–12:30 Bogotá). Implementation and verification complete; final handoff prepared.

## Plan

| Window | Work | Evidence |
| --- | --- | --- |
| First 15 minutes | Establish current production/local state; inventory migration, access, media and billing risks | Source inspection, read-only provider checks, baseline smoke |
| Minutes 15–50 | Fix confirmed member, course, community/session and payment issues in parallel | Focused diffs and regressions; no member or billing mutations |
| Minutes 50–70 | Walk through desktop/mobile member and administrator journeys | Browser evidence, keyboard/empty/error/loading states |
| Minutes 70–85 | Review cross-feature behavior and run release checks | Test/build/schema/secret checks and focused SQL verification |
| Last 5 minutes | Record what is ready, what requires a provider/owner action, and Steve's next steps | Final readiness report and simple handoff |

## Release boundaries

- Preserve existing subscriptions, free member access and all unrelated changes.
- No invitations, messages, real charges, account provisioning, production changes or store uploads in this session.
- New shop/service work and audit fixes remain local until an approved release.
- Native GHL Community history has no supported public sync API. Keep GHL as the discussion home until a separately approved migration date.
- Use exact source membership proof; CRM contacts alone do not establish eligibility.

## Required migration gates

1. Fresh, complete, identity-verified source member roster and approved free cohort.
2. Exact selected account preparation and invitation preview; no hidden whole-community action.
3. Verified free/base/paid-course/tool access, restricted accounts and administrator roles.
4. Published course content/media and agreed historical-community archive exceptions.
5. A 3–5 member pilot across physical iPhone, Android and web, including retained login and offline/resume.
6. Billing reconciliation, reviewed new price mapping and provider checkout/webhook/cancellation proof.
7. Owner-approved announcement, migration date, support inbox and recovery period before communication waves.

## Findings and completion

See [the completed readiness report and Steve handoff](migration-readiness-20261022.md). Final gates passed: 1,317 tests across 107 files; 418 isolated PostgreSQL assertions; TypeScript, schema, secret scan, store metadata, configured frontend build/PWA and six Deno entry points. Core member/access/progress/billing comparison fingerprints remained unchanged. All new changes are local and unpublished.

Remaining migration gates are concrete: recoverable database/Storage backup and restore, a fresh approved source roster and final history capture (the last accepted catch-up is October 6 and partial), direct email/inbox acceptance, reviewed payment activation and the physical-device pilot. No owner response was required to complete this audit.
