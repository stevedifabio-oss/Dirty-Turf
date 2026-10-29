# Source reconciliation — 29 October 2026

Work was assembled in a new isolated worktree from freshly verified canonical `main` at `67d819c7f8af6fc2a53bb08c8c91a364710a7996`. Original checkouts, their indexes, uncommitted files and private evidence were preserved.

## Included source

1. **October22 integration already canonical.** PR #39 (`c90d7775`) and #40 (`67d819c7`) contain the intended frontend/native source. Comparing the final 522-file candidate manifest: 519 files match exactly, the Windows Gradle wrapper differs only in line endings, and two unsubscribe files contain the later #40 improvement. No missing native candidate files were found.
2. **56 scoped scheduler/v5 paths** copied from `community-automation-local`: the union of its Oct24 live feature manifest and carried prerequisite inventory. All 48 feature hashes and the eight separate prerequisite hashes were verified before copying. The snapshot SQL test uses its newer feature hash. This preserves the source behind manual production deploy `6adc31baaad85de176733292`; publishing plain old `main` would have omitted that functionality.
3. **Five later video files** from `admin-web-live-20261021`: `CommunityMediaGallery.tsx`, its test, `src/styles.css`, and the `prepare-community-video.mjs` utility/test. These are shared UI plus a local-only media utility. Academy's `playsInline` change is already in the 56-file import.
4. **Maintenance files and current verification**, plus explicit provisional native batch versions. Native generation is reviewed separately.

The historical manifest's “without-carried-course” note was stale: direct canonical comparison proved Academy's inline playback line was still missing, so it was included.

## Preserved and excluded

| Checkout/work | Decision |
| --- | --- |
| Primary `codex/native-auth-release` / `937423ee` | Historical tracked source; duplicate `config 2.xml` / `config 3.xml` and local output stay untouched |
| `apple-release-integration`, base `31e5b4e9` | Retain historical dirty build source; do not overwrite canonical with its two older unsubscribe files |
| `apple-metadata-moderation-local` | Older moderation subset superseded by canonical; untouched |
| `admin-web-live-20261021` / `codex/member-growth-upsells` | Later ten v5/Academy changes covered by the 56-file import; five video files included separately; original unchanged |
| `community-automation-local` / `codex/community-automation-native-push` | Scoped deployed source recovered; local operations/member evidence excluded |
| `course-sync-emails` | Old dirty source copies superseded by canonical; private migration/evidence files preserved locally |
| `community-follow-pagination/Dirty Turf` | Existing staged deletions and untracked replacement tree left untouched; never staged wholesale |
| `native-login-persistence/Dirty Turf` / `9e77fe46`; `android-samsung-login/Dirty Turf` / `db69c963` | Clean historical native fixes have later equivalents in canonical integration; no duplicate cherry-picks |
| `cloud-data-integrity`, `ui-ux-audit`, `security-admin-release`, `stripe-infrastructure` | No distinct intended unpublished source found; generated/private output and dependencies excluded |
| Missing/prunable temporary navigation/store checkouts | No deletion or pruning performed |

No `.env`, signing keys, reviewer credentials, member exports, build directories, local dependencies, or private receipts belong in the handoff commit. Native artifacts remain outside tracked source. Public evidence records hashes/results without copying secrets or member data.

## Ownership and deployment

Steve's repository is canonical. PR #41 merged the prepared source into canonical `main` as `ea9ff41e5e1c7490dcb879bc7c172ba0e56155dc`; the initial fork branch is retained as a historical snapshot. Steve can use current `main` from his own Codex. No replacement canonical repository, account linking, or permission expansion was needed.

Netlify's existing project `bright-brigadeiros-df8b48` built that canonical commit using `npm run build` and published `dist` to `https://app.dirtyturf.com` as production deploy `6ae37b54a3bfe13c8b6ffbe8`. CI and all 10 public release-smoke checks passed. No Supabase migrations/functions were deployed and push activation remains held. See the release tracker for exact runtime receipts and the separate native gates.

The supplied setup prompt located as `Dirty-Turf-Codex-Prompt.md` and the user-provided working preferences informed the maintenance files. No separate attached AGENTS/quickstart/tracker pack was accessible during preparation; merge any subsequently supplied originals without discarding these verified project details.
