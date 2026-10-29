// Real repository SQL in isolated PostgreSQL; never connects to a hosted database.
// PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node scripts/test-community-moderation-sql.mjs
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE || "@electric-sql/pglite");
const db = new PGlite();
let assertions = 0;
const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); assertions++; };
const rejects = async (action, code, label) => { await assert.rejects(action, { code }, label); assertions++; };
const uuid = () => crypto.randomUUID();
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz default now(),banned_until timestamptz,deleted_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role',true),'') $$;
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
  for (const name of (await readdir(directory)).filter(name => name.endsWith(".sql")).sort()) {
    const sql = (await readFile(new URL(name, directory), "utf8")).replace("create extension if not exists pgcrypto;", "");
    try { await db.exec(sql); } catch (error) { throw new Error(`Migration ${name}: ${error.message}`, { cause: error }); }
  }
  const as = async (role, user, sql, params = []) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user || ""]);
    await db.query("select set_config('request.jwt.claim.role',$1,false)", [role]);
    await db.exec(`set role ${role}`);
    try { return (await db.query(sql, params)).rows; } finally { await db.exec("reset role"); }
  };
  const owner = uuid(), otherOwner = uuid(), viewerUser = uuid(), authorUser = uuid(), replyUser = uuid(), outsider = uuid();
  for (const id of [owner, otherOwner, viewerUser, authorUser, replyUser, outsider]) await db.query("insert into auth.users(id,email) values($1,$2)", [id, `${id}@example.test`]);
  const org = (await db.query("select id from organizations where created_by=$1", [owner])).rows[0].id;
  const otherOrg = (await db.query("select id from organizations where created_by=$1", [otherOwner])).rows[0].id;
  const community = uuid(), otherCommunity = uuid();
  await db.query("insert into academy_communities(id,owner_organization_id,name,slug,portal_url) values($1,$2,'Moderation test','moderation-test','https://example.test'),($3,$4,'Other Academy','moderation-other','https://example.test')", [community, org, otherCommunity, otherOrg]);
  const syncConfig = uuid();
  await db.query("insert into academy_community_sync_configs(id,academy_community_id,location_id,group_id,enabled) values($1,$2,'synthetic-location','synthetic-group',false)",[syncConfig,community]);
  const viewer = uuid(), author = uuid(), replier = uuid(), otherMember = uuid();
  for (const [id, user, cid] of [[viewer,viewerUser,community],[author,authorUser,community],[replier,replyUser,community],[otherMember,otherOwner,otherCommunity]]) {
    await db.query("insert into academy_members(id,academy_community_id,user_id,display_name,status) values($1,$2,$3,'Synthetic member','active')", [id,cid,user]);
    await db.query("insert into academy_access_grants(academy_community_id,academy_member_id,source_type,source_key) values($1,$2,'manual','moderation-test')", [cid,id]);
  }
  const postIds = { published: uuid(), draft: uuid(), archived: uuid(), other: uuid() };
  for (const [name, id] of Object.entries(postIds)) {
    const foreign = name === "other";
    await as("service_role",null,"insert into community_posts(id,organization_id,academy_community_id,academy_author_id,title,body,status) values($1,$2,$3,$4,'Synthetic discussion','Synthetic body',$5)", [id,foreign?otherOrg:org,foreign?otherCommunity:community,foreign?otherMember:author,["draft","archived"].includes(name)?name:"published"]);
  }
  const commentIds = { published: uuid(), reply: uuid(), draft: uuid(), archived: uuid(), other: uuid() };
  const media = [{ type: "image", url: "https://example.test/reviewed-image.webp", storage_path: "synthetic/comment.webp" }];
  for (const [name, id] of Object.entries(commentIds)) {
    const foreign = name === "other";
    const parent = name === "reply" ? postIds.published : postIds[name];
    await db.query("insert into community_comments(id,organization_id,academy_community_id,academy_author_id,post_id,parent_id,body,is_answer,media,source_provider,external_id) values($1,$2,$3,$4,$5,$6,'Synthetic reply',true,$7,$8,$9)", [id,foreign?otherOrg:org,foreign?otherCommunity:community,foreign?otherMember:replier,parent,name==="reply"?commentIds.published:null,media,name==="published"?"highlevel":null,name==="published"?"synthetic-source-comment":null]);
  }
  const ids = async (role, user) => (await as(role,user,"select id from academy_comment_feed order by id")).map(row=>row.id);
  const sorted = values => [...values].sort();
  const snapshot = async () => {
    const value = {};
    for (const table of ["academy_members","academy_access_grants","academy_feature_grants","academy_billing_plans","academy_billing_subscriptions","course_enrollments","community_posts"]) value[table] = (await db.query(`select to_jsonb(row) as row from ${table} row order by to_jsonb(row)::text`)).rows;
    return value;
  };
  const preserved = await snapshot();
  eq(await ids("authenticated",viewerUser),sorted([commentIds.published,commentIds.reply]),"member feed excludes replies on draft/archived posts and other Academies");
  eq(await ids("authenticated",owner),sorted([commentIds.published,commentIds.reply]),"member-facing feed stays published-only for administrators");
  eq((await as("authenticated",owner,"select count(*)::int as count from community_comments"))[0].count,4,"administrators retain their direct moderation history");
  eq(await ids("authenticated",outsider),[],"unentitled account cannot read comments");
  await rejects(()=>ids("anon",null),"42501","anonymous comment feed is denied");
  await db.query("insert into academy_member_blocks(academy_community_id,blocker_member_id,blocked_member_id) values($1,$2,$3)",[community,viewer,author]);
  eq(await ids("authenticated",viewerUser),[],"blocking a post author also hides replies by other authors on that post");
  await db.query("delete from academy_member_blocks where blocker_member_id=$1",[viewer]);
  await db.query("insert into academy_member_blocks(academy_community_id,blocker_member_id,blocked_member_id) values($1,$2,$3)",[community,viewer,replier]);
  eq(await ids("authenticated",viewerUser),[],"blocking only the comment author still hides that author's comments");
  await db.query("delete from academy_member_blocks where blocker_member_id=$1",[viewer]);
  eq(await ids("authenticated",viewerUser),sorted([commentIds.published,commentIds.reply]),"unblocking restores only published visible discussions");
  await rejects(()=>as("authenticated",viewerUser,"select admin_remove_community_comment($1)",[commentIds.published]),"42501","members cannot moderate replies");
  await rejects(()=>as("authenticated",otherOwner,"select admin_remove_community_comment($1)",[commentIds.published]),"42501","other tenant owner cannot remove a reply");
  await as("authenticated",owner,"select admin_remove_community_comment($1)",[commentIds.published]);
  const removed = (await as("authenticated",viewerUser,"select id,post_id,parent_id,body,is_answer,media from academy_comment_feed where id=$1",[commentIds.published]))[0];
  eq(removed,{id:commentIds.published,post_id:postIds.published,parent_id:null,body:"[Removed by Academy moderator]",is_answer:false,media:[]},"moderation clears body and attachments while retaining the original thread identity");
  eq((await as("authenticated",viewerUser,"select parent_id from academy_comment_feed where id=$1",[commentIds.reply]))[0].parent_id,commentIds.published,"moderation preserves nested replies rather than cascading them away");
  eq((await db.query("select local_override from academy_community_sync_state where config_id=$1 and entity='comment' and external_id='synthetic-source-comment'",[syncConfig])).rows[0].local_override,true,"source updates remain held after local comment moderation");
  await as("authenticated",owner,"select admin_remove_community_comment($1)",[commentIds.published]);
  eq((await db.query("select media from community_comments where id=$1",[commentIds.published])).rows[0].media,[],"repeat moderation is idempotent");
  eq(await snapshot(),preserved,"visibility and moderation preserve posts, identities, access, enrollments and billing");
  eq((await db.query("select reloptions from pg_class where oid='public.academy_comment_feed'::regclass")).rows[0].reloptions,["security_invoker=true"],"replacement view preserves caller RLS");
  console.log(`${assertions} PostgreSQL assertions passed: published parent visibility, block boundaries, safe media removal, preserved reply identities, tenant roles and billing.`);
} finally { await db.close(); }
