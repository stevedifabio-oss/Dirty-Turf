# Automatic Academy course updates

**Production activated September 29, 2026:** the allowlisted Turf Cleaning Academy course now syncs automatically every five minutes. The first live worker run succeeded at 20:29:34 UTC, applying 1 course, 36 source modules and 128 lessons. All 63 members, access grants, learning progress and lesson UUIDs were preserved. Course updates reach web, iPhone and Android through the shared database and existing foreground/resume refresh. Community posts/comments are a separate integration and are not mirrored by this worker.

The server reads the explicitly allowlisted GHL course every five minutes and atomically updates the shared Academy database. Apple, Android and web read that same database; course content updates do not require a new store binary. The frontend checks every 60 seconds in the foreground and on focus, reconnect and native resume. It defers updates while any lesson view is open, protecting paused video position, quiz answers and reading; checks resume after returning to the catalog. The initial binary containing refresh behavior still needs its normal native release.

## Supported source changes

- Course title, description, instructor and HTTPS cover image.
- Nested module titles, grouping, ordering and drip delays.
- Lesson titles, rich HTML, linked images, ordering, moves, draft/publication state and removal.
- Source-owned lesson UUIDs survive moves and retirement/restoration. Progress, enrollments, certificates, access grants, prices and billing are never written by this worker.
- A removed source lesson is archived, not deleted; removed modules receive `source_archived_at`. Both are restored if their stable source ID returns.
- Module ancestor visibility propagates to lessons. Unknown visibility, broken parents, cycles, duplicates and unsupported payloads reject the entire run.
- Source course deletion/missing allowlisted course fails for review instead of archiving an entire membership accidentally.

**Media and quiz boundary:** inline HTML images/links update when their source URL changes. HTTPS inline video/embed URLs also replace the lesson's player/link and are cleared when the source removes them. Existing separately imported video/resources/private asset mappings remain intact when the source API omits those fields. The current course has **zero opaque content IDs, zero embedded media IDs and zero separate database video URLs**; all 109 currently published lessons map successfully. The three draft quizzes are captured with full metadata/questions through the official quiz endpoints. Published ungraded single-choice quizzes are supported. Required-grading quizzes and published multiple-choice quizzes fail closed because the official question response omits answer keys and the current app supports single-choice responses. GHL's official lesson detail response repeats the opaque `contentId`/`metaData`; it provides no media URL adapter. A future opaque video replacement fails the run for review instead of silently retaining a known stale video. Video-file copying and assignments are not a complete mirror. Community data is separate.

The real September 26 read-only capture mapped successfully: 1 allowlisted course, 36 modules, 128 lessons, 109 published after ancestor visibility is applied. That is mapping evidence, not production sync evidence.

## Safety and ownership

- Two complete API reads must produce identical normalized content before the worker applies a snapshot. No caller-supplied snapshot or scope is accepted.
- Configuration has an exact GHL location/course allowlist. New unrelated GHL courses never enter the app.
- `begin_academy_course_sync` leases one configuration for ten minutes. Concurrent requests skip it; expired workers cannot apply after a replacement run obtains the lease.
- One SQL transaction applies content and the success ledger. Errors roll back every content mutation. Retries of identical content do not write it again.
- New config/run tables have RLS and service-only permissions; all three RPCs revoke public/anonymous/authenticated execute privileges. RPCs run as security invoker.
- Existing content defaults to `sync_owner='local'`. A reviewed baseline enrolls imported rows explicitly; no automatic adoption of historical local edits.
- A local edit subsequently sets that row back to `local`. The source worker skips it; new unrelated local lessons/modules remain untouched. To re-enroll after resolving an intentional override, set `sync_owner='highlevel'` and clear the configuration's `last_snapshot_hash`.
- Imported course status/access/prices are retained. Newly allowlisted courses are created as drafts, pending explicit publication and access configuration.
- Course sync sets transaction-local `app.academy_course_sync='on'`. On the initial baseline, email hooks suppress imported history. After a successful baseline, `app.academy_course_sync_notifications='on'` permits the normal deduplicated new-publication events. Identical snapshots make no writes; edits are not publication notifications.
- Logs and ledger store counts and error codes, not course HTML or credentials. Inspect failed runs and rerun after correcting the source/configuration.

## Production configuration and recovery

1. Apply the migration and deploy only `academy-course-sync` with gateway JWT verification off; the function authenticates the `x-course-sync-secret` header in constant time before reading configuration. It does not accept member JWTs as scheduler authority.
2. Server-only configuration (Edge Function environment takes precedence; missing values load from Supabase Vault through a service-role-only, exact-allowlist RPC):
   - `GHL_PRIVATE_INTEGRATION_TOKEN` with `courses.readonly` for the correct location.
   - `GHL_LOCATION_ID`.
   - `GHL_COURSE_SYNC_SECRET`: independently generated random value of at least 32 characters; store in Supabase Vault as `academy_course_sync_secret` too.
   - `GHL_COURSE_SYNC_ENABLED=false` initially.
   - `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are the function runtime's existing server variables. Never add these secrets to Vite/native config.
3. Insert one configuration with `enabled=false`, the verified Academy community UUID, GHL location and exact course IDs. Compare a fresh read-only capture to the installed content. Resolve duplicate lesson IDs, protected local edits and missing media first. Run the baseline-preparation command below to produce guarded enrollment SQL locally. It compares the live export to the original import so genuine local overrides stay local. Source-only format/order changes can be enrolled from proven imported content. It does not execute SQL; existing local rows stay local.
4. Test against a staging project: create/edit/move/draft/restore/remove a source lesson; confirm source changes, local override preservation and completed-member progress in web/iPhone/Android. Test a partial GHL request and competing runs. No real member emails should send.
5. For a newly authorized deployment, configure Vault `project_url` and `academy_course_sync_secret`, set the server flag true and config enabled true, invoke one authenticated sync and check the ledger before enabling its five-minute schedule.

A schedule template is provided in `supabase/operations/academy-course-sync-schedule.sql`. It is outside migrations and **never executes during normal migration/deployment**. It uses Supabase Vault, `pg_cron` and `pg_net`; it sends no service role key over the scheduler request. The job can be disabled with `select cron.unschedule('academy-course-sync');`, or immediately paused by setting the server flag/config enabled false.

## Verification

- `npx vitest run scripts/lib/course-sync.test.mjs scripts/lib/ghl-course-reader.test.mjs`
- `deno check supabase/functions/academy-course-sync/index.ts`
- `PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js node scripts/test-course-sync-sql.mjs`

### Prepare the held baseline

```sh
node scripts/prepare-course-sync-baseline.mjs \
  --snapshot output/private/ghl-course-sync-fresh.json \
  --database output/private/course-baseline-db.json \
  --original-import /absolute/private/path/dirty-turf-academy-import.json \
  --output output/private/reviewed-course-baseline
```

The protected database export contains only the scoped community ID/course/module/lesson content, no member accounts or credentials. The planner compares source differences separately from local changes against the original import. Unknown differences require the exact report hash via `--approve-differences`; known local changes are always excluded. Generated SQL checks content fingerprints again, refuses an active sync lease, resets the baseline notification state and creates/updates a **disabled** configuration. Apply only for an explicitly authorized initial enrollment. Do not reapply after active synchronization without reviewing current content.

The real baseline audit found all 128 database lesson bodies canonically identical to the original import, with zero local overrides. It prepares 150 guarded row enrollments (1 course, 21 modules, 128 lessons). There are 148 source differences, primarily HTML serialization, the old batched-import ordering bug, null-to-zero drip defaults, current GHL course metadata, and the synthetic `:direct` parent moving back to its stable source category. GHL has 36 categories versus the original 21 imported modules: 15 empty categories were previously omitted; the synthetic direct-lessons module is retired after moving its lesson without changing the lesson UUID. The planner prepares source-owned rows; the worker creates newly represented categories at the first successful run.

Fresh read-only capture took 3.1 seconds for 9 GETs including all three quizzes; two matching reads cost 18 GETs per run. At five-minute intervals that is 216 GETs/hour. No source writes or hosted mutations occurred.

The SQL harness creates an isolated PostgreSQL database and executes the migration, not a mocked SQL string. It checks lesson moves preserve IDs/progress/enrollments; rollback; unchanged snapshots; archive/restore; local ownership; incomplete scope; leases; RLS and execute permissions. No hosted project is contacted.

References: [Supabase scheduled functions](https://supabase.com/docs/guides/functions/schedule-functions), [GHL September 24 Courses API](https://marketplace.gohighlevel.com/docs/Changelog/), [official lesson detail schema](https://marketplace.gohighlevel.com/docs/ghl/courses/get-lesson).

## Local combined verification (September 28, 2026)

- `npm run check`: 239 tests in 45 files, TypeScript, schema/store/secret checks, production build and PWA manifest passed.
- Isolated PostgreSQL: 29 course-sync, 43 email and 33 visibility assertions passed. The latter two load all 29 actual migrations.
- Deno checked both changed workers.
- Android debug APK and unsigned iOS simulator app built successfully. All 44 web output files matched the bytes inside both native builds. These are local artifacts, not uploaded store releases or physical-device acceptance.
- 38 synthetic email previews generated; event launch checked at desktop and 375px phone width with no horizontal overflow. No messages sent.
- Fresh read-only GHL capture and protected database export produced `output/private/course-baseline-ready.sql`: 150 fingerprint-guarded row enrollments, zero local overrides, config disabled. It has not been applied.
- Backend migrations/functions must be verified before the held GitHub push: the new frontend queries source visibility columns. No production writes, pushes, store uploads, remote schedules or emails were performed for this work.

## Production activation evidence (September 29, 2026)

- The current official API capture matched the previously reviewed content: 1 course, 36 categories, 128 lessons; canonical source hash `c98938e64f19675a4344d9777ccbfe2a25b1c0d15ee4c71fa5061b387c4beeb2`.
- Enrolled 150 existing rows with guards that compared every reviewed source field, hashing long HTML/text strings before comparison. No local content differences were present.
- Config `91c025b3-f9ab-4b96-8a52-0da050837120` is enabled for only GHL course `0a9ea28f-eaa0-4b4f-a1eb-4b6bc23df18b`, location `eqVZcs8fro8qiGD2sgoG`.
- `academy-course-sync` version 2 is deployed and authenticates the scheduler secret before fetching source data. Secrets are stored in Vault; no credential was committed or embedded in clients.
- The first run succeeded after two complete matching official API reads. Stored counts: 1 course, 36 modules, 128 lessons, 0 locally owned rows skipped. Existing lesson UUIDs, member progress, access-grant rows and member count were unchanged.
- The first automatic scheduled run started at 20:30:03 UTC and finished at 20:30:09 UTC with `unchanged`; pg_net recorded HTTP 200, no timeout and no error. This confirms the enabled schedule actually invoked the authenticated worker and a second read made no content writes.
- Cron job `academy-course-sync` runs `*/5 * * * *` using Vault's `project_url` and `academy_course_sync_secret`; no service-role key is sent by the schedule. Disable using `select cron.unschedule('academy-course-sync');` or set the scoped configuration's `enabled=false`.
- Verification: 31 reader/mapping/baseline tests; 29 isolated PostgreSQL sync assertions; 33 visibility assertions across all current migrations; Deno typecheck. These verify moves, edits, retirement/restoration, local overrides and rollback without modifying live GHL content. A new physical-device editing walkthrough has not been performed.
