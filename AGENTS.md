# Working preferences

- Complete requested work through implementation and appropriate verification.
- Make reasonable decisions independently. Ask when missing information materially affects scope, correctness, or authorization.
- Keep changes focused. Avoid unrelated features, refactors, dependencies, and documentation.
- Read relevant files before editing. Follow the project's architecture, conventions, and design system.
- Use available tools and skills when they improve the result. Delegate independent subtasks when useful.
- Investigate causes before fixing bugs. Run relevant checks and add regression tests where they meaningfully protect behavior.
- For UI work, consider accessibility, desktop and phone layouts, and loading, empty, and error states.
- Preserve unrelated changes, worktrees, and local evidence. Never reset, discard, stash, or commit someone else's work to clear the workspace.
- Never expose or commit secrets. Validate untrusted input at boundaries.
- Work autonomously within authorized scope. Do not infer permission to publish, deploy, send messages, or delete unrelated data.
- If an approach fails, investigate sensible alternatives and explain concrete blockers.
- Verify claims about tools, services, tests, and deployments. Report uncertainty honestly.
- Keep updates concise. Finish with the result, verification, and remaining limitations.

# Dirty Turf Academy

Canonical repository: https://github.com/stevedifabio-oss/Dirty-Turf.
Read `STEVE_QUICKSTART.md` and `RELEASE_TRACKER.md` before changing or releasing the project. Older dated release notes are historical evidence, not current status.

## Shared implementation

- Put ordinary interface and behavior changes in shared `src/` React/TypeScript code so web, iPhone, and Android use one implementation. Preserve necessary Capacitor, ARKit, ARCore, permission, and lifecycle differences.
- Keep member access, organization isolation, moderation, Terms acceptance, offline behavior, and native payment restrictions intact.
- Backend changes can affect older installed apps immediately. Preserve compatibility and distinguish source, migration, hosted function, and configuration state.
- Do not enable held push delivery, course imports, community capture/import, notification schedules, or payment controls merely to test an interface change.

## Setup and verification

- Use Node 22 (22.12 or later) and the committed npm lockfile: `npm ci`.
- Start the visual preview with `npm run dev`. Without Supabase variables it uses local device-preview data; this does not verify real sign-in or saved cloud data.
- `npm run check` runs secrets/schema/store/type/tests/build/PWA checks. It does not run isolated SQL harnesses or physical-device acceptance.
- Run relevant SQL harnesses for backend changes. Never reset production or replay the migrations directory against a hosted project. Reconcile the documented hosted migration aliases first.
- Native preparation uses `npm run native:sync` / `npm run native:verify` in the release checkout. `native:copy` alone is insufficient for a fresh plugin registry.

## Publishing and releases

- When Steve explicitly asks to publish web changes, complete checks and use the established canonical GitHub `main` → Netlify workflow. Verify the deployed commit and live site before calling it published. Do not bypass a blocked Git push with a manual production upload.
- Publishing the website does **not** update the frontend bundled in installed iPhone or Android apps. Server-fed content is separate.
- Collect ordinary mobile changes in `RELEASE_TRACKER.md` and prepare one tested release per platform when requested. Documentation commits alone must not upload or submit a store build.
- Prepare final source, unused build numbers, signed artifacts, release notes, test evidence, and affected physical-device checks before requesting any outstanding release decision. Honor prior authorization for the exact action/candidate; ask only for missing approval or access.
- Apple and Google approve independently. Report local build, signing, upload/processing, internal testing, review submission, approval, and public availability separately.
- Keep `.env*`, signing keys/passwords, provisioning credentials, private receipts, member data, and generated build output out of Git. Public `VITE_` values are bundled; server secrets must never use that prefix.
