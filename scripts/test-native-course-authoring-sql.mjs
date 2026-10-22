// Execute repository SQL in isolated PostgreSQL (PGlite), never a hosted database.
// PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node scripts/test-native-course-authoring-sql.mjs
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE || "@electric-sql/pglite");
const db = new PGlite();
const migrationName = "20261021224252_allow_multiple_native_courses_and_lessons.sql";
let assertions = 0;
const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); assertions++; };
const rejects = async (action, code, label) => { await assert.rejects(action, { code }, label); assertions++; };
const uuid = () => crypto.randomUUID();

try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select current_user::text $$;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key,bucket_id text,name text,owner uuid);
    alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql as $$ select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1] $$;
    create function public.rls_auto_enable() returns event_trigger language plpgsql as $$ begin return; end $$;
    create publication supabase_realtime;
    grant usage on schema public,auth,storage to anon,authenticated,service_role;
    grant select,insert,update,delete on storage.objects to anon,authenticated,service_role;
    alter default privileges in schema public grant select,insert,update,delete on tables to anon,authenticated,service_role;
  `);
  const directory = new URL("../supabase/migrations/", import.meta.url);
  const migrations = (await readdir(directory)).filter(name => name.endsWith(".sql")).sort();
  assert(migrations.includes(migrationName), "native authoring migration exists");
  for (const name of migrations.filter(name => name < migrationName)) {
    const sql = (await readFile(new URL(name, directory), "utf8")).replace("create extension if not exists pgcrypto;", "");
    try { await db.exec(sql); } catch (error) { throw new Error(`Migration ${name}: ${error.message}`, { cause: error }); }
  }

  const owner = uuid(), memberUser = uuid(), community = uuid(), member = uuid();
  for (const id of [owner, memberUser]) await db.query("insert into auth.users(id,email) values($1,$2)", [id, `${id}@example.test`]);
  const org = (await db.query("select id from organizations where created_by=$1", [owner])).rows[0].id;
  await db.query("insert into academy_communities(id,owner_organization_id,name,slug,portal_url) values($1,$2,'Native authoring test','native-authoring-test','https://example.test')", [community, org]);
  await db.query("insert into academy_members(id,academy_community_id,user_id,display_name,status,role) values($1,$2,$3,'Member','active','member')", [member, community, memberUser]);
  const as = async (role, user, query, params = []) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user || ""]);
    await db.exec(`set role ${role}`);
    try { return (await db.query(query, params)).rows; } finally { await db.exec("reset role"); }
  };
  const insertCourse = (id, externalId = null) => as("authenticated", owner,
    "insert into courses(id,organization_id,academy_community_id,title,external_id) values($1,$2,$3,'Draft training',$4) returning id", [id, org, community, externalId]);
  const nativeCourse = uuid(), secondNativeCourse = uuid(), importedCourse = uuid(), module = uuid();
  await insertCourse(nativeCourse);
  await insertCourse(importedCourse, "ghl-course-1");
  await as("authenticated", owner, "insert into course_modules(id,course_id,title) values($1,$2,'Module')", [module, nativeCourse]);
  eq((await as("authenticated", owner, "select id from course_modules where id=$1", [module]))[0].id, module, "owner can create and then inspect a native module");
  // A separate read also exercises the visibility guard after the new row exists.
  const insertLesson = async (id, externalId = null) => {
    await as("authenticated", owner,
      "insert into course_lessons(id,module_id,title,external_id) values($1,$2,'Draft lesson',$3)", [id, module, externalId]);
    return as("authenticated", owner, "select id from course_lessons where id=$1", [id]);
  };
  const nativeLesson = uuid(), secondNativeLesson = uuid(), importedLesson = uuid();
  await insertLesson(nativeLesson);
  await insertLesson(importedLesson, "ghl-lesson-1");
  await db.query("insert into course_enrollments(academy_community_id,academy_member_id,course_id,status) values($1,$2,$3,'active')", [community, member, nativeCourse]);
  await db.query("insert into academy_member_lesson_progress(academy_member_id,lesson_id,progress_percent) values($1,$2,65)", [member, nativeLesson]);
  await db.query("insert into academy_assets(academy_community_id,course_id,lesson_id,title,asset_type,original_url) values($1,$2,$3,'Handbook','pdf','https://example.test/handbook.pdf')", [community, nativeCourse, nativeLesson]);
  const mediaBefore = (await db.query("select video_url,resources from course_lessons where id=$1", [nativeLesson])).rows[0];
  const blockAsset = uuid();
  const blockPath = `${community}/${nativeCourse}/${nativeLesson}/${uuid()}-block-video.mp4`;
  await as("authenticated", owner,
    "insert into academy_assets(id,academy_community_id,course_id,lesson_id,title,asset_type,storage_bucket,storage_path,original_url,source_provider) values($1,$2,$3,$4,'Inline video','video','academy-assets',$5,$6,'native')",
    [blockAsset, community, nativeCourse, nativeLesson, blockPath, `academy-asset:${blockPath}`]);
  eq((await as("authenticated", owner, "select id from academy_assets where id=$1", [blockAsset]))[0].id, blockAsset, "owner can register an inline asset for a draft lesson without replacing its primary media");
  eq((await db.query("select video_url,resources from course_lessons where id=$1", [nativeLesson])).rows[0], mediaBefore, "inline asset registration preserves existing primary video and resources");
  eq(await as("authenticated", memberUser, "select id from academy_assets where id=$1", [blockAsset]), [], "ordinary member cannot read draft inline asset metadata");
  await rejects(() => as("authenticated", memberUser,
    "insert into academy_assets(academy_community_id,course_id,lesson_id,title,asset_type,original_url) values($1,$2,$3,'Unauthorized','video',$4)",
    [community, nativeCourse, nativeLesson, `academy-asset:${blockPath}`]), "42501", "ordinary member cannot register lesson media");

  await rejects(() => insertCourse(secondNativeCourse), "23505", "old schema blocks a second native course in the same organization");
  await rejects(() => insertLesson(secondNativeLesson), "23505", "old schema blocks a second native lesson in the same module");
  const snapshot = async () => {
    const result = {};
    for (const table of ["courses", "course_modules", "course_lessons", "course_enrollments", "academy_member_lesson_progress", "academy_assets", "academy_members"]) {
      result[table] = (await db.query(`select to_jsonb(row) as row from ${table} row order by to_jsonb(row)::text`)).rows;
    }
    return result;
  };
  const existingRows = await snapshot();
  const policyState = async () => (await db.query("select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies where tablename in ('courses','course_modules','course_lessons') order by schemaname,tablename,policyname")).rows;
  const existingPolicies = await policyState();

  await db.exec(await readFile(new URL(migrationName, directory), "utf8"));
  eq(await snapshot(), existingRows, "migration preserves every existing row, source metadata, relationship, enrollment and learning progress");
  eq(await policyState(), existingPolicies, "migration does not weaken authorization policies");
  eq((await insertCourse(secondNativeCourse))[0].id, secondNativeCourse, "owner can create a second native course");
  eq((await insertCourse(uuid())).length, 1, "owner can create further native courses");
  eq((await insertLesson(secondNativeLesson))[0].id, secondNativeLesson, "owner can create a second native lesson in one module");
  eq((await insertLesson(uuid())).length, 1, "owner can create further native lessons");
  await rejects(() => insertCourse(uuid(), "ghl-course-1"), "23505", "duplicate imported course remains rejected");
  await rejects(() => insertLesson(uuid(), "ghl-lesson-1"), "23505", "duplicate imported lesson remains rejected");

  const upsertedCourse = await db.query("insert into courses(organization_id,academy_community_id,title,external_id) values($1,$2,'Imported revision','ghl-course-1') on conflict(organization_id,external_id) do update set title=excluded.title returning id", [org, community]);
  eq(upsertedCourse.rows[0].id, importedCourse, "column-based imported course upsert still resolves the existing identity");
  const upsertedLesson = await db.query("insert into course_lessons(module_id,title,external_id) values($1,'Imported revision','ghl-lesson-1') on conflict(module_id,external_id) do update set title=excluded.title returning id", [module]);
  eq(upsertedLesson.rows[0].id, importedLesson, "column-based imported lesson upsert still resolves the existing identity");
  const constraints = await db.query("select constraint_row.conname,index_row.indnullsnotdistinct from pg_constraint constraint_row join pg_index index_row on index_row.indexrelid=constraint_row.conindid where constraint_row.conname in ('courses_organization_id_external_id_key','course_lessons_module_id_external_id_key') order by constraint_row.conname");
  eq(constraints.rows.length, 2, "both original unique constraints are retained");
  eq(constraints.rows.every(row => row.indnullsnotdistinct === false), true, "both constraints now treat source-free IDs as distinct");
  await rejects(() => as("authenticated", memberUser, "insert into courses(organization_id,academy_community_id,title) values($1,$2,'Unauthorized')", [org, community]), "42501", "ordinary member still cannot create a course");
  await rejects(() => as("authenticated", memberUser, "insert into course_lessons(module_id,title) values($1,'Unauthorized')", [module]), "42501", "ordinary member still cannot create a lesson");
  await rejects(() => as("anon", null, "insert into courses(organization_id,academy_community_id,title) values($1,$2,'Unauthorized')", [org, community]), "42501", "anonymous creation remains forbidden");

  eq((await db.query("select count(*)::integer count from courses")).rows[0].count, 4, "all native and imported courses survive failed duplicate/unauthorized attempts");
  eq((await db.query("select count(*)::integer count from course_lessons")).rows[0].count, 4, "all native and imported lessons survive failed duplicate/unauthorized attempts");
  console.log(`Native course authoring SQL: ${assertions} assertions passed in isolated PostgreSQL with ${migrations.filter(name => name <= migrationName).length} repository migrations. No hosted schema or content was changed.`);
} finally {
  await db.close();
}
