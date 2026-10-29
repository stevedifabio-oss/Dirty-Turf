# Handoff verification — 29 October 2026

Source: `codex/steve-maintenance-handoff-20261029`, based on canonical `67d819c7`. This record describes local verification and distinguishes it from hosted and physical-device acceptance.

## Fresh setup and source checks

- A new isolated checkout ran `npm ci` from the committed lockfile. No existing developer checkout or dependency directory was reused.
- The first full check passed 1,488 tests. Review then corrected failed native push registration cleanup and added five regressions; final `npm run check` on **Node 22.23.4** passed **1,493 tests across 117 files**, TypeScript, secret scan, store metadata, schema contracts, production build and PWA checks.
- Schema contracts cover **56 migrations and 78 public tables**. This is source validation, not proof of hosted migration state.
- Compatible lockfile updates resolved four development-tool advisories: Vite 7.3.7, Vitest 5.0.5 and source-map-js 1.2.2. A fresh `npm ci` and audit reported **zero vulnerabilities**. No forced or major dependency upgrade was used.
- Deno checks passed for the scheduler, push worker, and Community sync entrypoints with the frozen lockfile: `deno check --node-modules-dir=none --frozen supabase/functions/academy-post-scheduler/index.ts supabase/functions/academy-push-notifications/index.ts supabase/functions/academy-community-sync/index.ts`.
- Store metadata and native source agree on the provisional queued 1.0.1/iOS18/Android13 batch. The metadata checker now accepts valid two/three-component versions while still checking each native project's version and build parity.
- `git diff --check` passed. Canonical #40 unsubscribe privacy files remain unchanged.

## Isolated database behavior

All **15 SQL harnesses passed, totaling 1,109 assertions**, using PGlite 0.3.14 and Node 24.14.0. Each creates an isolated database; none contacts a hosted database or sends mail/push.

| Harness | Assertions |
| --- | ---: |
| Apple moderation | 61 |
| Community content filter | 89 |
| Community email | 72 |
| Community moderation | 16 |
| Community photos | 59 |
| Community scheduler | 90 |
| Community snapshot | 276 |
| Community sync | 108 |
| Course sync | 44 |
| Course visibility | 57 |
| Growth services | 43 |
| Native course authoring | 24 |
| Native push | 43 |
| Pricing gates | 83 |
| Service checkout | 44 |

Five older harnesses initially failed migration loading because their synthetic `auth.users` omitted `email_confirmed_at`, `banned_until`, and `deleted_at`. Their test-only fixtures were aligned with the existing working fixtures, and all five reran successfully. No production migration was modified for those repairs. Native course authoring intentionally tests its 44-migration scope; the full-scope harnesses load all 56.

For SQL work, install the test engine outside the repository, then run the relevant harnesses:

```sh
SQL_TEST_DIR="$(mktemp -d)"
npm install --prefix "$SQL_TEST_DIR" --no-save --package-lock=false @electric-sql/pglite@0.3.14
(
  for script in scripts/test-*-sql.mjs; do
    PGLITE_MODULE="$SQL_TEST_DIR/node_modules/@electric-sql/pglite/dist/index.js" node "$script" || exit 1
  done
)
```

The scheduler harness checks duplicate-call idempotency; PGlite serializes statements, so independent-session hosted lock contention is a separate release check.

## Preview and media

`npm run dev` started successfully with Node 22 and Vite 7.3.7 at http://127.0.0.1:5173. The unconfigured preview rendered the existing Terms gate, including its unchecked consent and disabled Continue button. Its phone-sized 390×844 view was inspected. No legal agreement was accepted on Steve's behalf and no real member login/data operation was performed.

Focused shared-video and local preparation tests passed 17 tests across 2 files, including real ffmpeg fixtures. The full source suite also passed. Hook/media mocks do not establish actual Safari/WebView gesture playback; affected physical-device checks remain in the native record.

## Native, hosted and release limits

See [native evidence](native-handoff-evidence-20261029.md) for configured asset parity, iOS compilation, Android SDK/signing constraints and physical acceptance. Local compilation is not store approval.

Netlify Git CD was independently read back: existing site `9b5c6d50-2a85-4aae-9df6-f83d31b58edc`, repository `stevedifabio-oss/Dirty-Turf`, branch `main`, build `npm run build`, output `dist`, automatic builds enabled. The pre-handoff published deploy is `6adc31baaad85de176733292` (Oct 24 manual deployment, no Git commit reference).

The connected GitHub account had read-only canonical access; an actual push returned HTTP403. The existing fork accepted the tested source, and canonical PR #41 exposes it through `pull/41/head`. Publication must be verified after the canonical merge; a local build or fork push cannot establish that the website changed. No hosted database/function/schedule changes, store uploads, reviewer replies, releases, or customer writes were performed for this handoff.

Ignored local logs/artifacts are under `output/release/steve-handoff-20261029/`; private historical receipts remain in their original folders. This public record includes results and limits, not credentials or member exports.
