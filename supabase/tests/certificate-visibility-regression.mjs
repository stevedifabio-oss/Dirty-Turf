// Isolated PostgreSQL regression; never connects to a Supabase project.
// PGLITE_MODULE_PATH=/tmp/.../node_modules/@electric-sql/pglite/dist/index.js node supabase/tests/certificate-visibility-regression.mjs
const { PGlite } = await import(process.env.PGLITE_MODULE_PATH || '@electric-sql/pglite');
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite();
const migration = (name) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
const functionSql = (sql, name) => {
  const start = sql.indexOf(`create or replace function ${name}(`);
  assert.notEqual(start, -1, `Missing ${name}`);
  const end = sql.indexOf('\n$$;', start);
  assert.notEqual(end, -1, `Missing function terminator for ${name}`);
  return sql.slice(start, end + 4);
};
const uid = (value) => `10000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
let nextId = 10;
let checks = 0;
const community = uid(1);
const otherCommunity = uid(2);

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema private;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.user_id', true), '')::uuid;
    $$;
    create table public.academy_members (
      id uuid primary key, academy_community_id uuid, user_id uuid,
      status text default 'active', display_name text default 'Test Member'
    );
    create table public.courses (id uuid primary key, academy_community_id uuid, title text default 'Test Course');
    create table public.course_modules (
      id uuid primary key, course_id uuid, sync_owner text default 'highlevel',
      source_visibility text default 'published', source_archived_at timestamptz
    );
    create table public.course_lessons (id uuid primary key, module_id uuid, status text default 'published');
    create table public.academy_member_lesson_progress (
      academy_member_id uuid, lesson_id uuid, completed_at timestamptz, progress_percent integer,
      primary key (academy_member_id, lesson_id)
    );
    create table public.course_enrollments (
      academy_member_id uuid, course_id uuid, status text, source_progress_percent integer
    );
    create table public.academy_certificate_templates (
      id uuid primary key, academy_community_id uuid, active boolean,
      title text, description text, signatory_name text, signatory_title text,
      created_at timestamptz default now(), updated_at timestamptz default now()
    );
    create table public.academy_certificates (
      id uuid primary key default gen_random_uuid(), academy_community_id uuid,
      academy_member_id uuid, course_id uuid, template_id uuid, recipient_name text,
      course_title text, metadata jsonb, status text default 'active'
    );
    create table private.test_course_access (user_id uuid, course_id uuid);
    create function private.can_access_course(course_id uuid) returns boolean
      language sql stable security definer set search_path = '' as $$
        select exists (select 1 from private.test_course_access access
          where access.user_id = auth.uid() and access.course_id = $1);
      $$;
    grant usage on schema private, auth to authenticated, anon;
  `);
  const oldFunction = functionSql(migration('20260920130000_admin_security_release_hardening.sql'), 'private.issue_academy_certificate');
  await db.exec(oldFunction);
  await db.exec(functionSql(migration('20260920113000_academy_admin_and_certificates.sql'), 'public.issue_my_academy_certificate'));
  await db.exec(`
    revoke all on function private.issue_academy_certificate(uuid, uuid, boolean, text) from public, anon, authenticated;
    revoke all on function public.issue_my_academy_certificate(uuid) from public, anon;
    grant execute on function public.issue_my_academy_certificate(uuid) to authenticated;
  `);

  async function fixture(lessons) {
    const [member, user, course] = [nextId++, nextId++, nextId++].map(uid);
    await db.query('insert into academy_members(id, academy_community_id, user_id) values ($1, $2, $3)', [member, community, user]);
    await db.query('insert into courses(id, academy_community_id) values ($1, $2)', [course, community]);
    await db.query('insert into private.test_course_access values ($1, $2)', [user, course]);
    const rows = [];
    for (const options of lessons) {
      const module = uid(nextId++), lesson = uid(nextId++);
      await db.query('insert into course_modules(id, course_id, sync_owner, source_visibility, source_archived_at) values ($1, $2, $3, $4, $5)',
        [module, course, options.owner ?? 'highlevel', options.visibility ?? 'published', options.archived ? '2026-01-01T00:00:00Z' : null]);
      await db.query('insert into course_lessons(id, module_id, status) values ($1, $2, $3)', [lesson, module, options.status ?? 'published']);
      if (options.complete) await complete(member, lesson);
      rows.push({ module, lesson });
    }
    return { member, user, course, rows };
  }
  async function complete(member, lesson, percentOnly = false) {
    await db.query(`insert into academy_member_lesson_progress values ($1, $2, $3, 100)
      on conflict (academy_member_id, lesson_id) do update set completed_at = excluded.completed_at, progress_percent = 100`,
    [member, lesson, percentOnly ? null : '2026-01-01T00:00:00Z']);
  }
  async function issue(item, forced = false) {
    return (await db.query('select private.issue_academy_certificate($1, $2, $3) as id', [item.member, item.course, forced])).rows[0].id;
  }
  async function importProgress(item, status, percent) {
    await db.query('insert into course_enrollments values ($1, $2, $3, $4)', [item.member, item.course, status, percent]);
  }

  const hidden = await fixture([{ complete: true }, { visibility: 'draft' }, { archived: true }]);
  assert.equal(await issue(hidden), null, 'Before fix, hidden published lessons block completion'); checks++;
  await db.exec(migration('20261007193610_academy_certificate_visible_lessons.sql'));
  const issued = await issue(hidden);
  assert(issued, 'Only the visible published lesson should be required'); checks++;
  assert.equal(await issue(hidden), issued, 'Repeated issuance must return the existing certificate'); checks++;
  const certificate = (await db.query('select * from academy_certificates where id = $1', [issued])).rows[0];
  assert.deepEqual(certificate.metadata, { source: 'automatic', certificateTitle: 'Certificate of Completion',
    certificateDescription: 'has successfully completed the course', signatoryName: 'Steve DiFabio', signatoryTitle: 'Dirty Turf Academy' }); checks++;
  assert.equal(certificate.academy_community_id, community); checks++;

  const republished = await fixture([{ complete: true }, { visibility: 'draft' }]);
  await db.query("update course_modules set source_visibility = 'published' where id = $1", [republished.rows[1].module]);
  assert.equal(await issue(republished), null, 'A republished source module becomes required'); checks++;
  await complete(republished.member, republished.rows[1].lesson, true);
  assert(await issue(republished), 'Progress at 100% remains sufficient without completed_at'); checks++;

  const hiddenComplete = await fixture([{ complete: false }, { visibility: 'draft', complete: true }]);
  assert.equal(await issue(hiddenComplete), null, 'Hidden completion must not count toward an unfinished visible lesson'); checks++;
  const local = await fixture([{ complete: true }, { owner: 'local', visibility: 'draft' }]);
  assert.equal(await issue(local), null, 'Local modules remain visible even when source_visibility is draft'); checks++;
  await complete(local.member, local.rows[1].lesson);
  assert(await issue(local)); checks++;
  const archivedLocal = await fixture([{ complete: true }, { owner: 'local', archived: true }]);
  assert(await issue(archivedLocal), 'The library excludes archived local modules too'); checks++;
  const draftLesson = await fixture([{ complete: true }, { status: 'draft' }]);
  assert(await issue(draftLesson), 'Unpublished lessons remain excluded'); checks++;

  const imported = await fixture([{}]);
  await importProgress(imported, 'active', 100);
  assert(await issue(imported), 'Verified imported 100% completion remains accepted'); checks++;
  const importedStatus = await fixture([{}]);
  await importProgress(importedStatus, 'completed', 0);
  assert(await issue(importedStatus), 'Imported completed enrollment status remains accepted'); checks++;
  const incompleteImport = await fixture([{}]);
  await importProgress(incompleteImport, 'active', 99);
  assert.equal(await issue(incompleteImport), null); checks++;
  const noVisibleLessons = await fixture([{ visibility: 'draft' }]);
  await importProgress(noVisibleLessons, 'completed', 100);
  assert.equal(await issue(noVisibleLessons), null, 'Empty visible courses cannot auto-issue'); checks++;
  assert(await issue(noVisibleLessons, true), 'Existing administrator override semantics remain available privately'); checks++;

  const mismatch = await fixture([{ complete: true }]);
  await db.query('update courses set academy_community_id = $1 where id = $2', [otherCommunity, mismatch.course]);
  await assert.rejects(issue(mismatch), /Member and course must belong to the same Academy/); checks++;
  const ordinary = await fixture([{ complete: true }, { visibility: 'draft' }]);
  await db.query("select set_config('test.user_id', $1, false)", [ordinary.user]);
  await db.exec('set role authenticated;');
  await assert.rejects(issue(ordinary), (error) => error.code === '42501', 'Ordinary users cannot directly call or force the private issuer'); checks++;
  const ordinaryId = (await db.query('select public.issue_my_academy_certificate($1) as id', [ordinary.course])).rows[0].id;
  assert(ordinaryId, 'Authorized active member can use the existing checked wrapper'); checks++;
  await assert.rejects(db.query('select public.issue_my_academy_certificate($1)', [hidden.course]), /Course is not available/); checks++;
  await db.exec('reset role;');
  await db.query("update academy_members set status = 'suspended' where id = $1", [ordinary.member]);
  await db.exec('set role authenticated;');
  await assert.rejects(db.query('select public.issue_my_academy_certificate($1)', [ordinary.course]), /Course is not available/); checks++;
  await db.exec('reset role; set role anon;');
  await assert.rejects(db.query('select public.issue_my_academy_certificate($1)', [ordinary.course]), (error) => error.code === '42501'); checks++;
  await assert.rejects(issue(ordinary), (error) => error.code === '42501'); checks++;
  await db.exec('reset role;');
  const security = (await db.query("select prosecdef, proconfig from pg_proc where oid = 'private.issue_academy_certificate(uuid,uuid,boolean,text)'::regprocedure")).rows[0];
  assert.equal(security.prosecdef, true); checks++;
  assert.deepEqual(security.proconfig, ['search_path=""']); checks++;
  console.log(`${checks} PostgreSQL assertions passed: visible lesson completion, republishing, local/archived content, imported progress, tenant checks and role isolation.`);
} finally {
  await db.close();
}
