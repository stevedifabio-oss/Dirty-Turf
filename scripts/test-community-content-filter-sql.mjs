// Isolated PostgreSQL only. Never connects to Supabase or another hosted service.
// PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node scripts/test-community-content-filter-sql.mjs
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE || "@electric-sql/pglite");
const db = new PGlite();
const migrationName = "20261022161326_community_prohibited_text_filter.sql";
const rejection = "This content cannot be posted under the Community Rules. Please revise it or contact support.";
let assertions = 0;
const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); assertions++; };
const rejects = async (action, code, label) => { await assert.rejects(action, { code }, label); assertions++; };
const filtered = async (action, label) => { await assert.rejects(action, { code: "23514", message: rejection }, label); assertions++; };
const uuid = () => crypto.randomUUID();

try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz default now(),banned_until timestamptz,deleted_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role',true) $$;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key,bucket_id text,name text,owner uuid,metadata jsonb);
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
  assert(migrations.includes(migrationName), "content-filter migration exists");
  const apply = async name => {
    const sql = (await readFile(new URL(name, directory), "utf8")).replace("create extension if not exists pgcrypto;", "");
    try { await db.exec(sql); } catch (error) { throw new Error(`Migration ${name}: ${error.message}`, { cause: error }); }
  };
  for (const name of migrations.filter(name => name < migrationName)) await apply(name);

  const owner = uuid(), memberUser = uuid(), community = uuid(), ownerMember = uuid(), member = uuid();
  for (const id of [owner, memberUser]) await db.query("insert into auth.users(id,email) values($1,$2)", [id, `${id}@example.test`]);
  const org = (await db.query("select id from organizations where created_by=$1", [owner])).rows[0].id;
  await db.query("insert into academy_communities(id,owner_organization_id,name,slug,portal_url) values($1,$2,'Filter test','filter-test','https://example.test')", [community, org]);
  for (const [id, user, role] of [[ownerMember, owner, "owner"], [member, memberUser, "member"]]) {
    await db.query("insert into academy_members(id,academy_community_id,user_id,display_name,status,role) values($1,$2,$3,'Test member','active',$4)", [id, community, user, role]);
    await db.query("insert into academy_access_grants(academy_community_id,academy_member_id,source_type,source_key) values($1,$2,'manual','filter-test')", [community, id]);
  }
  const category = uuid();
  await db.query("insert into community_categories(id,organization_id,academy_community_id,name,member_can_post) values($1,$2,$3,'Filter general',true)", [category, org, community]);
  const as = async (role, user, sql, params = []) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)", [user || "", role]);
    await db.exec(`set role ${role}`);
    try { return (await db.query(sql, params)).rows; } finally { await db.exec("reset role"); }
  };
  const insertPost = (title, body, extra = {}) => as("service_role", null,
    "insert into community_posts(organization_id,academy_community_id,academy_author_id,category_id,title,body,external_id,source_provider) values($1,$2,$3,$4,$5,$6,$7,$8) returning id",
    [org, community, member, category, title, body, extra.externalId || null, extra.source || "native"]);
  const insertComment = (post, body) => as("service_role", null,
    "insert into community_comments(organization_id,academy_community_id,academy_author_id,post_id,body) values($1,$2,$3,$4,$5) returning id", [org, community, member, post, body]);
  const legacy = (await insertPost("kill yourself", "i will kill you"))[0].id;
  const legacyComment = (await insertComment(legacy, "kill yourself"))[0].id;
  const before = (await db.query("select id,title,body from community_posts where id=$1", [legacy])).rows;
  for (const name of migrations.filter(name => name >= migrationName)) await apply(name);
  eq((await db.query("select id,title,body from community_posts where id=$1", [legacy])).rows, before, "migration leaves legacy text unchanged");
  eq((await db.query("select phrase,normalized_phrase,enabled from private.community_prohibited_text_rules order by phrase")).rows,
    [{ phrase: "i will kill you", normalized_phrase: "i will kill you", enabled: true }, { phrase: "kill yourself", normalized_phrase: "kill yourself", enabled: true }], "only the two narrow seed rules are enabled");

  const post = (await insertPost("Turf care", "Power broom the clean artificial turf before adding infill."))[0].id;
  const comment = (await insertComment(post, "Use 0.5 lb per square foot, then round up the bag count."))[0].id;
  for (const body of ["kill yourself", "KILL YOURSELF", "Please, kill---yourself!", "\ti will\n KILL\t you!!!", "I.WILL.KILL.YOU"]) {
    await filtered(() => insertPost("Job question", body), "post body is screened across case, whitespace and punctuation");
    await filtered(() => insertComment(post, body), "comment body is screened across case, whitespace and punctuation");
  }
  await filtered(() => insertPost("KILL—YOURSELF!", "Otherwise ordinary turf copy."), "title is screened independently");
  for (const body of ["skill yourself up with Academy training", "kill yourselves is a different phrase", "kill yourself2 is a different token", "ékill yourself is a different token", "kill yourselfé is a different token", "I will kill young weeds", "A drill will kill your turf fibers", "Artificial turf cleaning: remove pet odor; add 40-pound infill bags."]) {
    eq((await insertPost("Training notes", body)).length, 1, "whole-phrase boundaries preserve nonmatching turf copy");
  }
  eq((await insertPost("Kill", "yourself is a word in a separate field.")).length, 1, "separate title and body do not create an invented phrase");

  await filtered(() => as("service_role", null, "update community_posts set body=$1 where id=$2", ["i will kill you", post]), "post body edits are screened");
  await filtered(() => as("service_role", null, "update community_posts set title=$1 where id=$2", ["kill yourself", post]), "post title edits are screened");
  await filtered(() => as("service_role", null, "update community_comments set body=$1 where id=$2", ["kill yourself", comment]), "comment edits are screened");
  eq((await db.query("select body from community_comments where id=$1", [comment])).rows[0].body, "Use 0.5 lb per square foot, then round up the bag count.", "failed edit preserves saved content");
  await as("service_role", null, "update community_posts set title=title,body=body,is_pinned=true where id=$1", [legacy]);
  await as("service_role", null, "update community_comments set body=body,is_answer=true where id=$1", [legacyComment]);
  eq((await db.query("select body,is_pinned from community_posts where id=$1", [legacy])).rows[0], { body: "i will kill you", is_pinned: true }, "unchanged legacy text does not block repair/moderation metadata writes");
  await as("service_role", null, "update community_posts set is_pinned=false,media='[]'::jsonb where id=$1", [legacy]);
  await as("service_role", null, "update community_comments set is_answer=false,media='[]'::jsonb where id=$1", [legacyComment]);
  eq((await db.query("select body,is_answer from community_comments where id=$1", [legacyComment])).rows[0], { body: "kill yourself", is_answer: false }, "metadata-only comment repairs do not rescreen old text");
  await as("service_role", null, "update community_posts set title='Legacy corrected title' where id=$1", [legacy]);
  await as("service_role", null, "update community_posts set body='Legacy corrected body' where id=$1", [legacy]);
  await as("service_role", null, "update community_comments set body='[Comment removed]' where id=$1", [legacyComment]);
  eq((await db.query("select body from community_comments where id=$1", [legacyComment])).rows[0].body, "[Comment removed]", "removal/repair can replace old prohibited text");

  // Web and native use these same existing authenticated RPCs; the database
  // trigger also protects imports and syncs that bypass client-side controls.
  const memberPost = (await as("authenticated", memberUser, "select create_community_post($1,$2,$3,'{}'::uuid[]) id", ["Turf question", "How much infill should I apply?", "Filter general"]))[0].id;
  eq(Boolean(memberPost), true, "ordinary member RPC accepts valid content");
  await filtered(() => as("authenticated", memberUser, "select create_community_post($1,$2,$3,'{}'::uuid[])", ["Turf question", "kill yourself", "Filter general"]), "member post RPC cannot bypass screening");
  await filtered(() => as("authenticated", memberUser, "select create_academy_comment($1,$2,null,'{}'::uuid[])", [memberPost, "i will kill you"]), "member comment RPC cannot bypass screening");
  await filtered(() => as("authenticated", owner, "select create_community_post($1,$2,$3,'{}'::uuid[])", ["kill yourself", "Owner-written content", "Filter general"]), "manager RPC does not bypass screening");
  await rejects(() => as("authenticated", memberUser, "insert into community_posts(organization_id,title,body) values($1,'Direct','Bypass attempt')", [org]), "42501", "direct member writes remain forbidden");
  await rejects(() => as("anon", null, "select create_community_post('Direct','Anonymous attempt','Filter general','{}'::uuid[])"), "42501", "anonymous RPC remains forbidden");

  for (const role of ["anon", "authenticated"]) {
    for (const privilege of ["select", "insert", "update", "delete", "truncate"]) {
      eq((await db.query("select has_table_privilege($1,'private.community_prohibited_text_rules',$2) allowed", [role, privilege])).rows[0].allowed, false, `${role} cannot ${privilege} private rules`);
    }
    await rejects(() => as(role, role === "authenticated" ? owner : null, "select * from private.community_prohibited_text_rules"), "42501", `${role} cannot read rule contents even as an app administrator`);
    await rejects(() => as(role, null, "update private.community_prohibited_text_rules set enabled=false"), "42501", `${role} cannot disable rules`);
    for (const fn of ["private.normalize_community_filter_text(text)", "private.screen_community_prohibited_text()"]) {
      eq((await db.query("select has_function_privilege($1,$2,'execute') allowed", [role, fn])).rows[0].allowed, false, "filter helpers are not client-callable");
    }
  }
  eq((await db.query("select relrowsecurity from pg_class where oid='private.community_prohibited_text_rules'::regclass")).rows[0].relrowsecurity, true, "private rule table has RLS defense in depth");
  eq((await db.query("select prosecdef,proconfig from pg_proc where oid='private.screen_community_prohibited_text()'::regprocedure")).rows[0], { prosecdef: true, proconfig: ['search_path=""'] }, "internal trigger uses a fixed empty search path for its private lookup");
  eq((await as("service_role", null, "select count(*)::integer count from private.community_prohibited_text_rules"))[0].count, 2, "service role can administer private rules");
  eq((await db.query("select has_function_privilege('service_role','private.screen_community_prohibited_text()','execute') allowed")).rows[0].allowed, false, "even service callers cannot invoke the internal trigger as an API");
  await as("service_role", null, "update private.community_prohibited_text_rules set enabled=false where phrase='kill yourself'");
  eq((await insertComment(post, "kill yourself")).length, 1, "disabled rule no longer matches");
  await as("service_role", null, "update private.community_prohibited_text_rules set enabled=true where phrase='kill yourself'");
  await filtered(() => insertComment(post, "kill yourself"), "re-enabled rule applies immediately");
  await as("service_role", null, "insert into private.community_prohibited_text_rules(phrase) values('  CUSTOM---literal RULE!  ')");
  await filtered(() => insertPost("Rule test", "custom literal rule"), "service-configured phrases normalize consistently");
  await rejects(() => as("service_role", null, "insert into private.community_prohibited_text_rules(phrase) values('CUSTOM literal rule')"), "23505", "normalized duplicates are rejected");
  await rejects(() => as("service_role", null, "insert into private.community_prohibited_text_rules(phrase) values('.*')"), "23514", "punctuation-only rule cannot become a match-all pattern");
  await as("service_role", null, "delete from private.community_prohibited_text_rules where normalized_phrase='custom literal rule'");
  eq((await insertComment(post, "custom literal rule")).length, 1, "removing a private rule is effective without code changes");

  await db.exec("select set_config('app.academy_community_sync','on',false)");
  await filtered(() => insertPost("Imported", "kill yourself", { source: "highlevel", externalId: "blocked-import" }), "service/import write and sync setting cannot bypass screening");
  await db.exec("select set_config('app.academy_community_sync','off',false)");
  const config = uuid();
  await as("service_role", null, "insert into academy_member_links(academy_community_id,academy_member_id,external_contact_id) values($1,$2,'filter-author')", [community, member]);
  await as("service_role", null, "insert into academy_community_sync_configs(id,academy_community_id,location_id,group_id,enabled) values($1,$2,'filter-location','filter-group',true)", [config, community]);
  const event = { schemaVersion: 1, eventId: "blocked-filter-event", locationId: "filter-location", groupId: "filter-group", entity: "post", operation: "upsert", externalId: "blocked-sync-post", sourceUpdatedAt: new Date().toISOString(), authorExternalId: "filter-author", title: "Imported turf post", body: "i will kill you" };
  await filtered(() => as("service_role", null, "select apply_academy_community_event($1,$2::jsonb)", [config, JSON.stringify(event)]), "actual sync RPC cannot bypass screening");
  eq((await db.query("select count(*)::integer count from community_posts where external_id in ('blocked-import','blocked-sync-post')")).rows[0].count, 0, "failed service/import/sync writes persist no prohibited content");
  eq((await db.query("select count(*)::integer count from academy_community_sync_events where config_id=$1", [config])).rows[0].count, 0, "rejected sync transaction does not claim successful event processing");

  // The completed web app adds authenticated native photo posts. Their final
  // reservation and final insert must use the same text boundary, while
  // unpublished uploads stay private. This does not screen image contents.
  if (migrations.includes("20261022161911_native_community_photo_posts.sql")) {
    assert(migrations.includes("20261022175007_screen_community_photo_drafts.sql"), "photo-draft text boundary is included");
    const descriptor = { sha256: "a".repeat(64), mimeType: "image/png", extension: "png", size: 57, width: 1, height: 1 };
    const photoPayload = { title: "Turf photo question", body: "Photographs of cleaned turf", category: "Filter general", mentionedMemberIds: [], photos: [descriptor] };
    const reserve = async (id, payload) => (await as("service_role", null, "select reserve_community_photo_post($1,$2,$3) result", [memberUser, id, payload]))[0].result;
    const finalize = async (id, lease) => (await as("service_role", null, "select finalize_community_photo_post($1,$2,$3) result", [memberUser, id, lease]))[0].result;
    const release = async (id, lease) => (await as("service_role", null, "select release_community_photo_upload($1,$2,$3) released", [memberUser, id, lease]))[0].released;
    const photoRequest = async id => (await db.query("select status,lease_token,lease_expires_at,attempt_count from academy_community_photo_requests where id=$1", [id])).rows[0];
    const put = async (id, reservation) => {
      const path = `${reservation.communityId}/${reservation.memberId}/${id}/${reservation.leaseToken}/1-${descriptor.sha256}.png`;
      await db.query("insert into storage.objects(id,bucket_id,name,owner,metadata) values($1,'community-photos',$2,$3,$4)", [uuid(), path, memberUser, { mimetype: "image/png", size: 57 }]);
      return path;
    };
    for (const payload of [{ ...photoPayload, body: "KILL---YOURSELF!" }, { ...photoPayload, title: "i will kill you" }]) {
      const blockedId = uuid();
      await filtered(() => reserve(blockedId, payload), "photo text is rejected before issuing a reservation or upload lease");
      eq(await photoRequest(blockedId), undefined, "rejected draft leaves no photo request row");
    }
    eq((await db.query("select count(*)::integer count from storage.objects where bucket_id='community-photos'")).rows[0].count, 0, "blocked reservations require no uploaded objects");

    // Expired-attempt renewal rechecks current rules without burning an attempt
    // or replacing its lease. A failed-attempt transition must remain available.
    const retryId = uuid();
    const retryPayload = { ...photoPayload, body: "Details covered by temporary photo rule" };
    const firstLease = await reserve(retryId, retryPayload);
    await as("service_role", null, "update academy_community_photo_requests set lease_expires_at=now()-interval '1 minute' where id=$1", [retryId]);
    const expired = await photoRequest(retryId);
    await as("service_role", null, "insert into private.community_prohibited_text_rules(phrase) values('temporary photo rule')");
    await filtered(() => reserve(retryId, retryPayload), "retry renewal cannot bypass a newly enabled phrase rule");
    eq(await photoRequest(retryId), expired, "rejected retry retains its previous lease and attempt count");
    eq(await release(retryId, firstLease.leaseToken), true, "blocked draft can still release its failed attempt for cleanup");
    eq((await photoRequest(retryId)).status, "failed", "failed cleanup is not blocked by text screening");

    // A rule enabled after valid reservation/upload is still enforced by the
    // final post insert; the entire publish operation must roll back.
    const requestId = uuid();
    const laterBlockedPayload = { ...photoPayload, body: "Details covered by second photo rule" };
    const reservation = await reserve(requestId, laterBlockedPayload);
    const path = await put(requestId, reservation);
    await as("service_role", null, "insert into private.community_prohibited_text_rules(phrase) values('second photo rule')");
    const postsBefore = (await db.query("select count(*)::integer count from community_posts")).rows[0].count;
    await filtered(() => finalize(requestId, reservation.leaseToken), "photo finalizer cannot bypass a rule changed after upload");
    eq((await db.query("select count(*)::integer count from community_posts")).rows[0].count, postsBefore, "rejected photo text publishes no post");
    eq((await db.query("select status='published' published from academy_community_photo_requests where id=$1", [requestId])).rows[0].published, false, "rejected photo finalization never claims publication");
    eq(await as("authenticated", memberUser, "select name from storage.objects where bucket_id='community-photos' and name=$1", [path]), [], "unpublished photo cannot be signed by a member");
    eq(await release(requestId, reservation.leaseToken), true, "known final text rejection can release an unpublished upload for cleanup");

    // Rule changes never turn an already committed receipt into an uncertain
    // publish result or require uploading a second copy of the same photos.
    const publishedId = uuid();
    const publishedPayload = { ...photoPayload, body: "Details covered by completed photo rule" };
    const publishedLease = await reserve(publishedId, publishedPayload);
    await put(publishedId, publishedLease);
    const receipt = await finalize(publishedId, publishedLease.leaseToken);
    eq(receipt.status, "published", "allowed photo draft still publishes normally");
    await as("service_role", null, "insert into private.community_prohibited_text_rules(phrase) values('completed photo rule')");
    eq(await reserve(publishedId, publishedPayload), receipt, "completed reservation retry retains its original receipt despite later rules");
    eq(await finalize(publishedId, publishedLease.leaseToken), receipt, "completed finalizer retry never republishes or misreports rejection");
    await as("service_role", null, "update academy_community_photo_requests set updated_at=now() where id=$1", [publishedId]);
    eq((await photoRequest(publishedId)).status, "published", "published-row repair is not re-screened");
    for (const role of ["anon", "authenticated", "service_role"]) {
      eq((await db.query("select has_function_privilege($1,'private.screen_community_photo_draft_text()','execute') allowed", [role])).rows[0].allowed, false, "photo filter helper is not callable by client or service APIs");
    }
    eq((await db.query("select prosecdef,proconfig from pg_proc where oid='private.screen_community_photo_draft_text()'::regprocedure")).rows[0], { prosecdef: true, proconfig: ['search_path=""'] }, "photo guard's private lookup has a fixed empty search path");
  }

  console.log(`Community content filter SQL: ${assertions} assertions passed against ${migrations.length} repository migrations in isolated PostgreSQL. No hosted schema or content changed.`);
} finally {
  await db.close();
}
