# Dirty Turf Academy release tracker

Maintained with each release. Canonical: https://github.com/stevedifabio-oss/Dirty-Turf.

## Handoff batch — 29 October 2026

Branch: `codex/steve-maintenance-handoff-20261029`, based on canonical `67d819c7f8af6fc2a53bb08c8c91a364710a7996` (PR #40).

| Surface | Verified position | Next gate |
| --- | --- | --- |
| Source handoff | Published via [canonical PR #41](https://github.com/stevedifabio-oss/Dirty-Turf/pull/41), head `tothemax-media:codex/steve-maintenance-handoff-20261029`; original worktrees preserved | Canonical owner/write access needed to merge |
| Website | Existing production is Oct24 manual deploy `6adc31baaad85de176733292`; Git CD targets canonical `main` | Publish verified handoff through GitHub → Netlify; record resulting commit/deploy |
| Apple current submission | Last recorded candidate iOS 1.0/build17; last authenticated review observation was Waiting for Review | Refresh App Store Connect before any new release action; no new approval/publication inferred |
| Google current production | Last verified Oct28: Android 1.0/code12, available at 100% rollout in existing one-country scope | Keep availability separate from a future candidate's status |
| Queued iPhone batch | Local preparation only; see native evidence | Store inventory, signing/capabilities, physical acceptance, outstanding exact-candidate authorization, Apple review |
| Queued Android batch | Local preparation only; see native evidence | Store inventory, upload-key verification, physical acceptance, outstanding exact-candidate authorization, Google review |

### Changes collected together

- Preserve Oct22 shared course builder, service/native payment restrictions, moderation, photo, auth/offline, and native integration already merged in PR #39/#40.
- Recover the deployed scheduler interface/worker and Community sync v5 prerequisite source that had remained uncommitted.
- Recover shared lesson inline playback and Community video tap/play, retry/fallback, background pause, keyboard focus, and single-player behavior; local video preparation utility does not upload anything.
- Carry guarded native push preparation while keeping its activation/provider/schedule gates held. Source inclusion is not proof of working push delivery.
- Add Steve's maintenance instructions, setup, reconciliation inventory and evidence.

No hosted migration, function deployment, schedule activation, capture/import, customer change, reviewer reply, store upload, or store submission is implied by this source handoff. Existing server scheduling remains governed by its prior authorization.

### Release notes for the next combined mobile batch

Draft: “Improved lesson and Community video playback, including inline viewing, clearer retry controls, and pause behavior when leaving the app. Includes shared Academy and administrator improvements.”

Do not announce push delivery as available. Before submission, tailor these notes to the exact tested candidate and preserve native purchase restrictions. The prepared version/build numbers in native evidence are provisional until current store inventories are checked.

### Verification and publication

The connected publisher (`tothemax-media`) received HTTP403 pushing to canonical `origin`; its existing fork accepted the handoff branch. PR #41 targets Steve's canonical `main`. Steve can fetch `pull/41/head` from the canonical repository using the quickstart. No merge or new website publication is claimed until its commit/deploy checks are recorded.

See [verification record](docs/handoff-verification-20261029.md), [native evidence](docs/native-handoff-evidence-20261029.md), and [source reconciliation](docs/handoff-source-reconciliation-20261029.md). Update this section with actual GitHub PR/commit, CI run, Netlify deploy ID/commit/live checks and separate store outcomes. Never turn an uploaded or internally tested build into a claim of public availability.

### Backend history caution

Do not replay all local migrations against production. Existing hosted aliases include scheduler `20261024031838` and native push/runtime `20261024032138`, while local files use `20261024022504` and `20261024022522`. Reconcile the migration ledger before any separately authorized database release. Preserve Community sync v5 and existing access/email guards.

## Historical evidence

Oct22 final candidates were iOS17/Android12. Earlier build15 rejection, build16 testing, and Android10/11 preparation notes are superseded checkpoints. Older backend/runbook documents retain their original dates and do not establish today's publication, billing, recovery, or device-test state.
