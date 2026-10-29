// Isolated PostgreSQL only: no hosted database, storage, or provider calls.
// PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node scripts/test-apple-moderation-sql.mjs
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planCommunitySnapshot } from "./lib/community-snapshot.mjs";

const { PGlite } = await import(process.env.PGLITE_MODULE || "@electric-sql/pglite");
const directory = await mkdtemp(join(tmpdir(), "dirty-turf-apple-moderation-"));
const migrationName = "20261022161207_clear_removed_comment_media.sql";
const placeholder = "[Removed by Academy moderator]";
let db = new PGlite(directory);
let assertions = 0;
const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); assertions++; };
const rejects = async (action, code, label) => { await assert.rejects(action, { code }, label); assertions++; };
const uuid = () => crypto.randomUUID();
const owner = uuid(), memberUser = uuid(), otherOwner = uuid();
const community = uuid(), member = uuid(), ownerMember = uuid(), configId = uuid();
const legacyPost = uuid(), legacyComment = uuid(), child = uuid();
const otherCommunity = uuid(), otherMember = uuid();
let organizationId, legacyReport;

const as = async (role, user, sql, parameters = []) => {
  assert(["anon", "authenticated", "service_role"].includes(role));
  const previous = (await db.query("select current_setting('request.jwt.claim.sub',true) subject,current_setting('request.jwt.claim.role',true) role")).rows[0];
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)", [user || "", role]);
  await db.exec(`set role ${role}`);
  try { return (await db.query(sql, parameters)).rows; }
  finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)", [previous.subject || "", previous.role || ""]);
  }
};
const comment = async id => (await db.query("select * from community_comments where id=$1", [id])).rows[0];
const feed = id => as("authenticated", memberUser, "select id,body,media from academy_comment_feed where id=$1", [id]);

async function seedLegacyRemoval() {
  for (const user of [owner, memberUser, otherOwner]) {
    await db.query("insert into auth.users(id,email) values($1,$2)", [user, `${user}@example.test`]);
  }
  organizationId = (await db.query("select id from organizations where created_by=$1", [owner])).rows[0].id;
  const otherOrganization = (await db.query("select id from organizations where created_by=$1", [otherOwner])).rows[0].id;
  for (const [id, organization, slug] of [[community, organizationId, "apple-moderation"], [otherCommunity, otherOrganization, "other-academy"]]) {
    await db.query("insert into academy_communities(id,owner_organization_id,name,slug,portal_url) values($1,$2,'Moderation test',$3,'https://example.test')", [id, organization, slug]);
  }
  for (const [id, academy, user, role] of [[member, community, memberUser, "member"], [ownerMember, community, owner, "owner"], [otherMember, otherCommunity, otherOwner, "owner"]]) {
    await db.query("insert into academy_members(id,academy_community_id,user_id,display_name,status,role) values($1,$2,$3,'Fixture member','active',$4)", [id, academy, user, role]);
  }
  await db.query("insert into academy_access_grants(academy_community_id,academy_member_id,source_type,source_key) values($1,$2,'manual','moderation-fixture')", [community, member]);
  eq((await as("authenticated", memberUser, "select get_academy_access_state() access"))[0].access.communityAccess, true, "feed fixture has an explicit current community grant");
  await db.query("insert into academy_member_links(academy_community_id,academy_member_id,external_contact_id) values($1,$2,'author')", [community, member]);
  await db.query("insert into academy_community_sync_configs(id,academy_community_id,location_id,group_id,enabled) values($1,$2,'fixture-location','fixture-group',true)", [configId, community]);
  await db.query("insert into community_posts(id,organization_id,academy_community_id,academy_author_id,title,body) values($1,$2,$3,$4,'Existing thread','Keep this discussion')", [legacyPost, organizationId, community, member]);
  await db.query("insert into community_comments(id,organization_id,academy_community_id,academy_author_id,post_id,body,media,is_answer,source_provider,external_id,sync_owner) values($1,$2,$3,$4,$5,$6,$7,true,'highlevel','legacy-removed','highlevel')", [legacyComment, organizationId, community, member, legacyPost, placeholder, [{ type: "image", url: "https://cdn.example.com/legacy.jpg" }]]);
  await db.query("insert into community_comments(id,organization_id,academy_community_id,academy_author_id,post_id,parent_id,body) values($1,$2,$3,$4,$5,$6,'Keep this child reply')", [child, organizationId, community, member, legacyPost, legacyComment]);
  legacyReport = (await as("authenticated", memberUser, "select report_academy_content('comment',$1,'Review attachment') id", [legacyComment]))[0].id;
  eq((await feed(legacyComment))[0].media.length, 1, "upgrade fixture reproduces the retained attachment");
}

try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz default now(),banned_until timestamptz,deleted_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),current_user::text) $$;
    select set_config('request.jwt.claim.role','service_role',false);
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
  const migrationDirectory = new URL("../supabase/migrations/", import.meta.url);
  const migrations = (await readdir(migrationDirectory)).filter(name => name.endsWith(".sql")).sort();
  assert(migrations.includes(migrationName), "moderation repair migration exists");
  for (const name of migrations) {
    if (name === migrationName) await seedLegacyRemoval();
    const sql = (await readFile(new URL(name, migrationDirectory), "utf8")).replace("create extension if not exists pgcrypto;", "");
    try { await db.exec(sql); }
    catch (error) { throw new Error(`Migration ${name}: ${error.message}`, { cause: error }); }
  }

  // Existing report/comment/reply identities survive the upgrade repair.
  const repaired = await comment(legacyComment);
  eq(repaired.body, placeholder, "legacy thread placeholder is preserved");
  eq(repaired.media, [], "legacy retained attachments are removed");
  eq(repaired.is_answer, false, "removed content is not marked as an answer");
  eq(repaired.sync_owner, "local", "legacy moderation wins over the source");
  eq(Boolean(repaired.moderated_at), true, "legacy repair is timestamped");
  eq(repaired.moderated_by, null, "unknown historical moderator is not invented");
  eq((await feed(legacyComment))[0], { id: legacyComment, body: placeholder, media: [] }, "authenticated feed exposes no legacy attachment");
  eq((await comment(child)).parent_id, legacyComment, "child reply remains attached");
  eq((await db.query("select content_id,status from content_reports where id=$1", [legacyReport])).rows[0], { content_id: legacyComment, status: "open" }, "existing report remains available for review");
  eq((await as("authenticated", owner, "select content_id,status from content_reports where id=$1", [legacyReport]))[0], { content_id: legacyComment, status: "open" }, "member report is visible to the authorized moderation queue");
  eq(await as("authenticated", otherOwner, "select id from content_reports where id=$1", [legacyReport]), [], "member report is not exposed to another Academy owner");
  eq((await db.query("select local_override from academy_community_sync_state where config_id=$1 and entity='comment' and external_id='legacy-removed'", [configId])).rows[0].local_override, true, "legacy source identity is reserved");
  await as("service_role", null, "update community_comments set body='Importer attempts legacy restoration',is_answer=true,media=$2,sync_owner='highlevel',moderated_at=null where id=$1", [legacyComment, [{ type: "image", url: "https://cdn.example.com/legacy.jpg" }]]);
  const legacyAfterImport = await comment(legacyComment);
  eq([legacyAfterImport.body, legacyAfterImport.media, legacyAfterImport.is_answer, legacyAfterImport.sync_owner, legacyAfterImport.moderated_at], [placeholder, [], false, "local", repaired.moderated_at], "direct importer writes cannot restore repaired legacy text/media or clear its audit");

  // The exposed RPC does not grant a member or an unrelated manager authority.
  await rejects(() => as("authenticated", memberUser, "select admin_remove_community_comment($1)", [child]), "42501", "ordinary member cannot moderate");
  await rejects(() => as("authenticated", otherOwner, "select admin_remove_community_comment($1)", [child]), "42501", "another Academy owner cannot moderate this tenant");
  await rejects(() => as("authenticated", owner, "select admin_remove_community_comment($1)", [uuid()]), "42501", "missing comment does not grant authority");
  await rejects(() => as("anon", null, "select admin_remove_community_comment($1)", [child]), "42501", "anonymous RPC execution remains denied");
  await rejects(() => as("authenticated", memberUser, "update community_comments set body='Restore',media='[]',moderated_at=null,moderated_by=null where id=$1", [legacyComment]), "42501", "member cannot directly restore content or clear its audit");
  await rejects(() => as("authenticated", memberUser, "insert into community_comments(organization_id,academy_community_id,academy_author_id,post_id,body,moderated_at,moderated_by) values($1,$2,$3,$4,'Forged moderation',now(),$5)", [organizationId, community, member, legacyPost, owner]), "42501", "member cannot forge a moderation audit through direct insert");
  await rejects(() => as("authenticated", memberUser, "delete from community_comments where id=$1", [legacyComment]), "42501", "member cannot delete the reserved identity");
  eq((await comment(child)).body, "Keep this child reply", "failed unauthorized calls do not mutate the target");
  const ordinaryCommentId = (await as("authenticated", memberUser, "select create_academy_comment($1,'Ordinary member reply',null,'{}'::uuid[]) id", [legacyPost]))[0].id;
  const ordinaryComment = await comment(ordinaryCommentId);
  eq([ordinaryComment.moderated_at, ordinaryComment.moderated_by], [null, null], "ordinary create RPC does not forge a moderation receipt");

  // Establish actual event + snapshot source identities before removing media.
  let sequence = 0;
  const event = (entity, externalId, extra = {}) => ({ schemaVersion: 1, eventId: `moderation-event-${++sequence}`, locationId: "fixture-location", groupId: "fixture-group", entity, operation: "upsert", externalId, sourceUpdatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)).toISOString(), sourceCreatedAt: "2026-01-01T00:00:00.000Z", authorExternalId: "author", ...(entity === "post" ? { title: "Source thread", body: "Source discussion" } : { postExternalId: "post", body: "Review this source attachment" }), ...extra });
  const applyEvent = input => as("service_role", null, "select apply_academy_community_event($1,$2) result", [configId, input]).then(rows => rows[0].result);
  eq((await applyEvent(event("post", "post"))).status, "applied", "source post fixture applies through the service boundary");
  const attachment = [{ type: "image", url: "https://cdn.example.com/review.jpg" }];
  eq((await applyEvent(event("comment", "review-comment", { media: attachment }))).status, "applied", "source comment fixture includes an attachment");
  const targetId = (await db.query("select id from community_comments where external_id='review-comment' and academy_community_id=$1", [community])).rows[0].id;
  const targetPostId = (await comment(targetId)).post_id;
  const replyId = uuid();
  await db.query("insert into community_comments(id,organization_id,academy_community_id,academy_author_id,post_id,parent_id,body) values($1,$2,$3,$4,$5,$6,'Reply survives moderation')", [replyId, organizationId, community, member, targetPostId, targetId]);
  const reportId = (await as("authenticated", memberUser, "select report_academy_content('comment',$1,'Review attachment') id", [targetId]))[0].id;
  const snapshotConfig = { capabilities: { commentMedia: true, partialRecords: true, sourceFieldHolds: true, mediaOnlyComments: true }, scope: { locationId: "fixture-location", groupId: "fixture-group" }, identities: { authors: [{ externalId: "author", handles: ["author"] }], categories: [] } };
  const observed = Date.now() - 30000;
  const capture = number => ({ schemaVersion: 1, source: "ghl-community-browser", captureId: `moderation-capture-${number}`, scope: snapshotConfig.scope, observedStartedAt: new Date(observed + number * 1000).toISOString(), observedCompletedAt: new Date(observed + number * 1000 + 100).toISOString(), coverage: { posts: "complete", comments: "complete" }, posts: [{ externalId: "post", authorExternalId: "author", title: "Source thread", body: "Source discussion", bodyComplete: true, commentsComplete: true, categoryExternalId: null, categoryComplete: true, pinnedComplete: true, pinned: false, mediaComplete: true, media: [], sourceUpdatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, number + 10)).toISOString() }], comments: [{ externalId: "review-comment", postExternalId: "post", parentExternalId: null, authorExternalId: "author", body: "Review this source attachment", bodyComplete: true, mediaComplete: true, media: attachment, sourceUpdatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, number + 10)).toISOString() }] });
  const applySnapshot = async input => {
    const lease = (await as("service_role", null, "select begin_academy_community_snapshot($1,$2) result", [configId, input.captureId]))[0].result;
    const plan = planCommunitySnapshot(lease.previousState, input, snapshotConfig);
    eq(plan.captureAccepted, true, "snapshot capture is structurally accepted");
    return (await as("service_role", null, "select apply_academy_community_snapshot($1,$2,$3,$4) result", [configId, input.captureId, lease.leaseToken, plan]))[0].result;
  };
  eq((await applySnapshot(capture(1))).conflicts, [], "initial snapshot establishes an unchanged source baseline");

  // Even an inherited source-sync setting cannot bypass this local removal.
  await db.exec("select set_config('app.academy_community_sync','on',false)");
  await as("authenticated", owner, "select admin_remove_community_comment($1)", [targetId]);
  await db.exec("select set_config('app.academy_community_sync','off',false)");
  const removed = await comment(targetId);
  eq([removed.id, removed.post_id, removed.body, removed.media, removed.is_answer, removed.sync_owner], [targetId, targetPostId, placeholder, [], false, "local"], "moderation clears attachments and preserves the thread identity");
  eq(removed.moderated_by, owner, "first moderator identity is recorded");
  eq(Boolean(removed.moderated_at), true, "first moderation time is recorded");
  eq((await feed(targetId))[0].media, [], "ordinary member feed no longer exposes attachments");
  eq((await comment(replyId)).parent_id, targetId, "nested replies survive new moderation");
  eq((await db.query("select content_id from content_reports where id=$1", [reportId])).rows[0].content_id, targetId, "reported content keeps its audit identity");
  eq((await db.query("select row_id,local_override from academy_community_sync_state where config_id=$1 and entity='comment' and external_id='review-comment'", [configId])).rows[0], { row_id: targetId, local_override: true }, "explicit override survives an inherited source setting");
  await as("authenticated", owner, "select admin_remove_community_comment($1)", [targetId]);
  const repeated = await comment(targetId);
  eq([repeated.moderated_at, repeated.moderated_by], [removed.moderated_at, removed.moderated_by], "repeat removal preserves the first audit receipt");
  const directImport = () => as("service_role", null, "update community_comments set body='Snapshot importer attempts restoration',is_answer=true,media=$2,sync_owner='highlevel',moderated_at=null,moderated_by=null where id=$1", [targetId, attachment]);
  await directImport();
  const imported = await comment(targetId);
  eq([imported.body, imported.media, imported.is_answer, imported.sync_owner, imported.moderated_at, imported.moderated_by], [placeholder, [], false, "local", removed.moderated_at, owner], "direct importer update cannot restore removed content or reset audit");

  // Exercise the existing real block RPC and RLS-backed feeds, not UI mocks.
  const blockPost = uuid(), blockComment = uuid();
  await db.query("insert into community_posts(id,organization_id,academy_community_id,academy_author_id,title,body,status) values($1,$2,$3,$4,'Owner discussion','Block fixture text','published')", [blockPost, organizationId, community, ownerMember]);
  await db.query("insert into community_comments(id,organization_id,academy_community_id,academy_author_id,post_id,body) values($1,$2,$3,$4,$5,'Owner reply')", [blockComment, organizationId, community, ownerMember, blockPost]);
  const visiblePost = () => as("authenticated", memberUser, "select id from community_feed where id=$1", [blockPost]);
  eq((await visiblePost()).length, 1, "member can read the designated author before blocking");
  eq((await feed(blockComment)).length, 1, "designated author comment is initially readable");
  eq((await as("authenticated", memberUser, "select toggle_academy_member_block($1) blocked", [ownerMember]))[0].blocked, true, "member blocks another member through the real RPC");
  eq(await visiblePost(), [], "blocked author's post is excluded by the feed");
  eq(await feed(blockComment), [], "blocked author's comment is excluded by the feed");
  eq((await as("authenticated", memberUser, "select blocked_member_id from academy_member_blocks where blocker_member_id=$1", [member]))[0].blocked_member_id, ownerMember, "the block is persisted for the authenticated member");

  // Closing and reopening a real local PostgreSQL data directory proves the
  // protection is persisted in SQL, not only in a rendered component or session.
  await db.close();
  db = new PGlite(directory);
  eq((await feed(targetId))[0].media, [], "removed media stays absent after database restart");
  const restarted = await comment(targetId);
  eq([restarted.moderated_at, restarted.moderated_by], [removed.moderated_at, owner], "moderation audit survives restart");
  eq(await visiblePost(), [], "blocked post stays hidden after database restart");
  eq(await feed(blockComment), [], "blocked comment stays hidden after database restart");
  eq((await as("authenticated", memberUser, "select toggle_academy_member_block($1) blocked", [ownerMember]))[0].blocked, false, "member can unblock the same author");
  eq((await visiblePost()).length, 1, "unblocking restores the author's readable post");
  eq((await feed(blockComment)).length, 1, "unblocking restores the author's readable comment");
  await directImport();
  eq((await feed(targetId))[0].media, [], "direct importer update after restart cannot restore attachments");
  eq((await comment(targetId)).body, placeholder, "direct importer update after restart cannot restore removed text");
  eq((await applyEvent(event("comment", "review-comment", { body: "Source attempts to restore content", media: attachment, sourceUpdatedAt: "2026-01-01T00:00:30.000Z" }))).status, "conflict", "later source event cannot restore moderated text/media");
  const next = capture(2); next.comments[0].body = "A later observed source edit";
  const replay = await applySnapshot(next);
  eq(replay.conflicts.find(item => item.externalId === "review-comment")?.reason, "local_edit_or_delete", "later source snapshot respects the local moderation override");
  eq((await as("service_role", null, "select enroll_academy_community_sync($1) result", [configId]))[0].result.comments, 0, "source enrollment cannot readopt a moderated comment");
  const afterReplay = await comment(targetId);
  eq([afterReplay.body, afterReplay.media, afterReplay.moderated_at, afterReplay.moderated_by], [placeholder, [], removed.moderated_at, owner], "source retries preserve removed content and its first audit");
  eq((await feed(targetId))[0].media, [], "authenticated feed stays clear after source retries");
  eq((await comment(replyId)).body, "Reply survives moderation", "source retries preserve local descendants");
  await as("authenticated", owner, "update content_reports set status='resolved',resolved_at=now(),resolved_by=$2 where id=$1", [reportId, owner]);
  eq((await db.query("select status,resolved_by from content_reports where id=$1", [reportId])).rows[0], { status: "resolved", resolved_by: owner }, "moderation does not prevent resolving the existing report");

  // The audit guard must not prevent Auth's legitimate ON DELETE SET NULL.
  const temporaryModerator = uuid(), temporaryMember = uuid(), temporaryComment = uuid();
  await db.query("insert into auth.users(id,email) values($1,$2)", [temporaryModerator, `${temporaryModerator}@example.test`]);
  await db.query("insert into academy_members(id,academy_community_id,user_id,display_name,status,role) values($1,$2,$3,'Temporary moderator','active','admin')", [temporaryMember, community, temporaryModerator]);
  await db.query("insert into community_comments(id,organization_id,academy_community_id,academy_author_id,post_id,body) values($1,$2,$3,$4,$5,'Moderation audit fixture')", [temporaryComment, organizationId, community, member, legacyPost]);
  await as("authenticated", temporaryModerator, "select admin_remove_community_comment($1)", [temporaryComment]);
  const beforeDeletion = await comment(temporaryComment);
  await db.query("delete from organizations where created_by=$1", [temporaryModerator]);
  await db.query("delete from auth.users where id=$1", [temporaryModerator]);
  const afterDeletion = await comment(temporaryComment);
  eq([afterDeletion.body, afterDeletion.media, afterDeletion.moderated_at, afterDeletion.moderated_by], [placeholder, [], beforeDeletion.moderated_at, null], "Auth user deletion can clear only its FK reference while retaining removal and time");

  console.log(`Apple moderation SQL: ${assertions} assertions passed against all ${migrations.length} repository migrations, including upgrade repair, tenant authorization, authenticated feed, durable restart, and source event/snapshot replay. No hosted database or provider was contacted.`);
} catch (error) {
  console.error("Apple moderation SQL failed:", error.message, error.code || "", error.where || "", error.stack?.split("\n").filter(line => line.includes("scripts/test-apple-moderation")).join("\n") || "");
  process.exitCode = 1;
} finally {
  await db.close();
  await rm(directory, { recursive: true, force: true });
}
