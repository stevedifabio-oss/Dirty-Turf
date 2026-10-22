// Execute all repository SQL in isolated PostgreSQL (PGlite), never a hosted database.
// PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node scripts/test-growth-services-sql.mjs
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE || "@electric-sql/pglite");
const db = new PGlite();
const migrationName = "20261022152708_academy_growth_services.sql";
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
  const migrations = (await readdir(directory)).filter((name) => name.endsWith(".sql") && name < migrationName).sort();
  for (const name of migrations) {
    const sql = (await readFile(new URL(name, directory), "utf8")).replace("create extension if not exists pgcrypto;", "");
    try { await db.exec(sql); } catch (error) { throw new Error(`Migration ${name}: ${error.message}`, { cause: error }); }
  }
  const as = async (role, user, query, params = []) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user || ""]);
    await db.exec(`set role ${role}`);
    try { return (await db.query(query, params)).rows; } finally { await db.exec("reset role"); }
  };
  const owner = uuid(), otherOwner = uuid(), user = uuid(), peerUser = uuid(), otherUser = uuid(), noAccessUser = uuid();
  for (const id of [owner, otherOwner, user, peerUser, otherUser, noAccessUser]) await db.query("insert into auth.users(id,email) values($1,$2)", [id, `${id}@example.test`]);
  const org = (await db.query("select id from organizations where created_by=$1", [owner])).rows[0].id;
  const otherOrg = (await db.query("select id from organizations where created_by=$1", [otherOwner])).rows[0].id;
  const community = uuid(), otherCommunity = uuid();
  await db.query("insert into academy_communities(id,owner_organization_id,name,slug,portal_url,pricing_gates_enabled) values($1,$2,'Growth test','growth-test','https://example.com',true),($3,$4,'Other test','growth-other','https://example.com',true)", [community,org,otherCommunity,otherOrg]);
  const member = uuid(), peer = uuid(), otherMember = uuid(), noAccessMember = uuid();
  for (const [id, uid, cid, name] of [[member,user,community,"Verified Member"],[peer,peerUser,community,"Peer"],[otherMember,otherUser,otherCommunity,"Other"],[noAccessMember,noAccessUser,community,"No Access"]]) {
    await db.query("insert into academy_members(id,academy_community_id,user_id,display_name,company_name,status) values($1,$2,$3,$4,'Verified business','active')", [id,cid,uid,name]);
  }
  for (const [id,cid] of [[member,community],[peer,community],[otherMember,otherCommunity]]) await db.query("insert into academy_access_grants(academy_community_id,academy_member_id,source_type,source_key) values($1,$2,'import','preserved')", [cid,id]);
  const billingSnapshot = async () => {
    const snapshot = {};
    for (const table of ["academy_members","academy_access_grants","academy_feature_grants","academy_billing_plans","academy_billing_subscriptions","course_enrollments"]) snapshot[table] = (await db.query(`select to_jsonb(row) as row from ${table} row order by to_jsonb(row)::text`)).rows;
    return snapshot;
  };
  const preserved = await billingSnapshot();
  await db.exec(await readFile(new URL(migrationName,directory),"utf8"));
  eq(await billingSnapshot(),preserved,"migration does not alter member access, billing, enrollment, or grants");
  eq((await as("authenticated",user,"select service_cadences from academy_growth_settings"))[0].service_cadences,
    { website:"one_time",ghl:"one_time","seo-aeo":"one_time","facebook-ads":"month","website-care":"month","ghl-subscription":"month" },"service defaults use only confirmed billing cadences");
  eq((await as("authenticated",user,"select count(*)::int as count from academy_growth_settings"))[0].count,1,"member sees only current Academy settings");
  eq(await as("authenticated",noAccessUser,"select * from academy_growth_settings"),[],"unentitled identity cannot read settings");
  await rejects(()=>as("anon",null,"select * from academy_growth_settings"),"42501","anonymous catalog blocked");
  await rejects(()=>as("anon",null,"select create_academy_growth_request('website','', $1)",[uuid()]),"42501","anonymous request blocked");
  await rejects(()=>as("authenticated",noAccessUser,"select create_academy_growth_request('website','', $1)",[uuid()]),"42501","active identity without grants cannot submit");
  const request = uuid();
  const create = (uid,key="website",notes="Please help",id=request) => as("authenticated",uid,"select create_academy_growth_request($1,$2,$3) as result",[key,notes,id]).then(rows=>rows[0].result);
  const originalRequest = await create(user);
  const identity = (request) => ({ id: request.id, status: request.status });
  eq(identity(originalRequest),{id:request,status:"new"},"request persists with supplied retry UUID");
  eq(Object.keys(originalRequest).sort(),["id","service_key","status","notes","created_at","member_name","company_name"].sort(),"confirmation returns only canonical request fields without private identity columns");
  eq([originalRequest.service_key,originalRequest.notes,originalRequest.member_name,originalRequest.company_name],["website","Please help","Verified Member","Verified business"],"confirmation includes persisted notes and server member snapshot");
  eq(Number.isFinite(Date.parse(originalRequest.created_at)),true,"confirmation returns persisted creation time");
  eq(await create(user,"website","retry content"),originalRequest,"same retry returns original canonical notes, identity, and timestamp");
  eq(await create(user,"website","another tab",uuid()),originalRequest,"second open request returns original canonical payload instead of unpersisted new notes");
  const own = (await as("authenticated",user,"select * from academy_growth_requests"))[0];
  eq([own.member_name,own.company_name,own.user_id,own.academy_member_id,own.notes],["Verified Member","Verified business",user,member,"Please help"],"author identity comes only from verified member record; retries preserve original notes");
  eq(await as("authenticated",peerUser,"select id from academy_growth_requests"),[],"peer cannot read another member inquiry");
  eq(await as("authenticated",otherOwner,"select id from academy_growth_requests"),[],"other tenant owner cannot read inquiry");
  eq((await as("authenticated",owner,"select id from academy_growth_requests"))[0].id,request,"Academy owner can read member inquiry");
  await rejects(()=>create(peerUser,"website","",request),"22023","request UUID cannot be reassigned to another identity");
  await rejects(()=>create(user,"ghl","",request),"22023","retry UUID cannot move to another service");
  await rejects(()=>create(user,"unknown","",uuid()),"22023","unsupported service rejected on server");
  await rejects(()=>create(user,"ghl","x".repeat(2001),uuid()),"22023","server bounds request body");
  await rejects(()=>as("authenticated",user,"insert into academy_growth_requests(id,academy_community_id,academy_member_id,user_id,service_key) values($1,$2,$3,$4,'website')",[uuid(),community,member,user]),"42501","no direct insert can spoof status or identity snapshots");
  eq(await as("authenticated",user,"update academy_growth_requests set status='closed' where id=$1 returning id",[request]),[],"member cannot close own inquiry");
  eq(await as("authenticated",otherOwner,"update academy_growth_requests set status='closed' where id=$1 returning id",[request]),[],"other Academy admin cannot update inquiry");
  await rejects(()=>as("authenticated",owner,"update academy_growth_requests set notes='changed' where id=$1",[request]),"42501","admin status grant cannot modify member notes");
  await rejects(()=>as("authenticated",owner,"update academy_growth_requests set user_id=$1 where id=$2",[peerUser,request]),"42501","admin status grant cannot reassign inquiry");
  await rejects(()=>as("authenticated",owner,"update academy_growth_requests set status='invented' where id=$1",[request]),"23514","unsupported status rejected");
  await as("authenticated",owner,"update academy_growth_requests set status='contacted' where id=$1",[request]);
  eq(await create(user,"website","different uuid",uuid()),{...originalRequest,status:"contacted"},"contacted requests remain deduplicated with canonical fields");
  await as("authenticated",owner,"update academy_growth_requests set status='closed' where id=$1",[request]);
  eq(await create(user),{...originalRequest,status:"closed"},"closed retry stays closed with original persisted fields");
  const subsequent = uuid();
  eq(identity(await create(user,"website","Follow up",subsequent)),{id:subsequent,status:"new"},"explicit new UUID can create follow-up after closure");
  await rejects(()=>as("authenticated",owner,"update academy_growth_requests set status='new' where id=$1",[request]),"23505","even admin cannot create two concurrent open inquiries");
  eq(await as("authenticated",user,"update academy_growth_settings set service_cadences=service_cadences || $1 where academy_community_id=$2 returning academy_community_id",[{website:"month",ghl:"month","seo-aeo":"month","facebook-ads":"month"},community]),[],"members cannot alter service settings");
  await rejects(()=>as("authenticated",owner,"update academy_growth_settings set service_cadences=service_cadences || $1 where academy_community_id=$2",[{"seo-aeo":"month"},community]),"23514","even admin cannot silently recast a confirmed one-time service as monthly");
  await rejects(()=>as("authenticated",owner,"update academy_growth_settings set service_cadences=service_cadences || $1 where academy_community_id=$2",[{"website-care":"one_time"},community]),"23514","confirmed monthly add-on cadence cannot drift");
  await as("authenticated",owner,"update academy_growth_settings set service_cadences=service_cadences where academy_community_id=$1",[community]);
  eq((await as("authenticated",user,"select service_cadences from academy_growth_settings"))[0].service_cadences["seo-aeo"],"one_time","canonical settings remain writable without repricing approved services");
  eq(await as("authenticated",otherOwner,"update academy_growth_settings set service_cadences=service_cadences || $1 where academy_community_id=$2 returning academy_community_id",[{website:"quote",ghl:"quote","seo-aeo":"quote","facebook-ads":"month"},community]),[],"other tenant cannot alter settings");
  await rejects(()=>as("authenticated",owner,"update academy_growth_settings set service_cadences=service_cadences || $1 where academy_community_id=$2",[{website:"year",ghl:"quote","seo-aeo":"quote","facebook-ads":"month"},community]),"23514","invalid cadence cannot persist");
  await rejects(()=>as("authenticated",owner,"update academy_growth_settings set service_cadences=service_cadences || $1 where academy_community_id=$2",[{website:"quote",ghl:"quote","seo-aeo":"quote","facebook-ads":"month",other:"quote"},community]),"23514","unrecognized service settings cannot persist");
  await rejects(()=>as("authenticated",owner,"delete from academy_growth_requests where id=$1",[request]),"42501","inquiries cannot be deleted by app clients");
  eq(await billingSnapshot(),preserved,"all growth operations preserve billing and access sources");
  await db.query("update academy_members set status='suspended' where id=$1",[member]);
  await rejects(()=>create(user,"ghl","",uuid()),"42501","suspended member cannot submit despite previous grant");
  eq(await as("authenticated",user,"select id from academy_growth_requests"),[],"suspended identity cannot read old requests");
  await db.query("update academy_members set status='active' where id=$1",[member]);
  await db.query("update academy_access_grants set status='revoked' where academy_member_id=$1",[member]);
  await rejects(()=>create(user,"ghl","",uuid()),"42501","expired entitlement cannot submit");
  console.log(`${assertions} PostgreSQL assertions passed: growth inquiry idempotency, strict identity and tenant isolation, admin settings/status, preserved access and billing.`);
} finally { await db.close(); }
