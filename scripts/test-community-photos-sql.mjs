// Real repository SQL in isolated PostgreSQL; never connects to a hosted database.
// PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node scripts/test-community-photos-sql.mjs
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
  const owner=uuid(),user=uuid(),peerUser=uuid(),otherOwner=uuid(),quotaUser=uuid();
  for(const id of [owner,user,peerUser,otherOwner,quotaUser]) await db.query("insert into auth.users(id,email) values($1,$2)",[id,`${id}@example.test`]);
  const org=(await db.query("select id from organizations where created_by=$1",[owner])).rows[0].id;
  const community=uuid(),foreignCommunity=uuid(),member=uuid(),peer=uuid(),quotaMember=uuid();
  await db.query("insert into academy_communities(id,owner_organization_id,name,slug,portal_url) values($1,$2,'Photo test','photo-test','https://example.test'),($3,$2,'Other photo test','photo-other','https://example.test')",[community,org,foreignCommunity]);
  for(const [id,uid] of [[member,user],[peer,peerUser],[quotaMember,quotaUser]]) {
    await db.query("insert into academy_members(id,academy_community_id,user_id,display_name,status) values($1,$2,$3,'Photo author','active')",[id,community,uid]);
    await db.query("insert into academy_access_grants(academy_community_id,academy_member_id,source_type,source_key) values($1,$2,'manual','photo-test')",[community,id]);
  }
  await db.query("insert into community_categories(organization_id,academy_community_id,name,member_can_post) values($1,$2,'General',true),($1,$2,'Announcements',false)",[org,community]);
  const photo={sha256:"a".repeat(64),mimeType:"image/png",extension:"png",size:57,width:1,height:1};
  const payload={title:"Job photos",body:"Synthetic photo details",category:"General",mentionedMemberIds:[],photos:[photo]};
  const reserve=async(uid=user,rid=uuid(),value=payload)=>(await as("service_role",null,"select reserve_community_photo_post($1,$2,$3) as result",[uid,rid,value]))[0].result;
  const finalize=async(uid,rid,lease)=>(await as("service_role",null,"select finalize_community_photo_post($1,$2,$3) as result",[uid,rid,lease]))[0].result;
  const release=async(uid,rid,lease)=>(await as("service_role",null,"select release_community_photo_upload($1,$2,$3) as result",[uid,rid,lease]))[0].result;
  const pathFor=(rid,reservation,index=1,descriptor=photo)=>`${reservation.communityId}/${reservation.memberId}/${rid}/${reservation.leaseToken}/${index}-${descriptor.sha256}.${descriptor.extension}`;
  const put=async(path,metadata={mimetype:"image/png",size:57})=>db.query("insert into storage.objects(id,bucket_id,name,owner,metadata) values($1,'community-photos',$2,$3,$4)",[uuid(),path,user,metadata]);
  const visible=async(uid)=> (await as("authenticated",uid,"select name from storage.objects where bucket_id='community-photos' order by name")).map(row=>row.name);
  const preserved={};
  for(const table of ["academy_members","academy_access_grants","academy_feature_grants","academy_billing_plans","academy_billing_subscriptions","course_enrollments"]) preserved[table]=(await db.query(`select to_jsonb(row)-'updated_at' as row from ${table} row order by to_jsonb(row)::text`)).rows;
  for(const role of ["anon","authenticated"]) {
    await rejects(()=>as(role,user,"select reserve_community_photo_post($1,$2,$3)",[user,uuid(),payload]),"42501","client cannot impersonate a photo author through service-only reservation");
    await rejects(()=>as(role,user,"select finalize_community_photo_post($1,$2,$3)",[user,uuid(),uuid()]),"42501","client cannot finalize arbitrary private media");
    await rejects(()=>as(role,user,"select release_community_photo_upload($1,$2,$3)",[user,uuid(),uuid()]),"42501","client cannot release another worker's upload");
  }
  await rejects(()=>reserve(otherOwner),"42501","authenticated identity without Community membership cannot upload");
  await rejects(()=>reserve(user,uuid(),{...payload,category:"Announcements"}),"42501","member cannot bypass administrator-only channels");
  for(const malicious of [
    {...payload,user_id:otherOwner},
    {...payload,mentionedMemberIds:[null]},
    {...payload,photos:[{...photo,mimeType:null}]},
    {...payload,photos:[{...photo,extension:null}]},
    {...payload,photos:[{...photo,size:"57"}]},
    {...payload,photos:[{...photo,size:4194305}]},
    {...payload,photos:[{...photo,width:6000,height:6000}]},
    {...payload,photos:[{...photo,mimeType:"image/svg+xml",extension:"svg"}]},
    {...payload,photos:Array(5).fill(photo)},
  ]) await rejects(()=>reserve(user,uuid(),malicious),"22023","strict server metadata validation rejects spoofed/unsupported/null fields");
  const rid=uuid(),reservation=await reserve(user,rid);
  eq(reservation.status,"uploading","verified author obtains upload lease");
  eq([reservation.memberId,reservation.communityId],[member,community],"reservation derives member and Academy identity on server");
  eq((await reserve(user,rid)).status,"busy","concurrent reservation cannot reuse the active attempt");
  await rejects(()=>reserve(peerUser,rid),"22023","request ID cannot move to a peer account");
  await rejects(()=>reserve(user,rid,{...payload,body:"Different draft"}),"22023","request ID cannot be reused for changed content");
  await rejects(()=>finalize(user,rid,uuid()),"22023","wrong lease token cannot publish");
  await rejects(()=>finalize(user,rid,reservation.leaseToken),"22023","post is not created while a verified photo object is missing");
  const path=pathFor(rid,reservation);await put(path,{mimetype:"image/png",size:56});
  await rejects(()=>finalize(user,rid,reservation.leaseToken),"22023","mismatched stored photo size cannot publish");
  await db.query("update storage.objects set metadata=$1 where name=$2",[{mimetype:"image/png",size:57},path]);
  eq(await visible(user),[],"unpublished author uploads cannot be signed by members");
  const saved=await finalize(user,rid,reservation.leaseToken);
  eq(saved.status,"published","verified photos and post publish atomically");
  const row=(await db.query("select * from community_posts where id=$1",[saved.postId])).rows[0];
  eq([row.author_id,row.academy_author_id,row.academy_community_id,row.title,row.status],[user,member,community,payload.title,"published"],"published identity and scope come from verified member");
  eq(row.media,[{type:"image",storage_bucket:"community-photos",storage_path:path,mime_type:"image/png",byte_size:57,label:"Photo 1"}],"post stores private object references without public or bearer URLs");
  const count=(await db.query("select count(*)::int as count from community_posts")).rows[0].count;
  eq(await finalize(user,rid,reservation.leaseToken),saved,"finalizer repeats return original receipt");
  eq(await reserve(user,rid),saved,"lost response is recovered without another upload");
  await db.query("update community_categories set member_can_post=false where academy_community_id=$1 and name='General'",[community]);
  eq(await reserve(user,rid),saved,"already-published exact retry stays recoverable after channel permissions change");
  await db.query("update community_categories set member_can_post=true where academy_community_id=$1 and name='General'",[community]);
  eq((await db.query("select count(*)::int as count from community_posts")).rows[0].count,count,"retries never duplicate a post");
  eq(await release(user,rid,reservation.leaseToken),false,"published attempt can never authorize cleanup");
  eq(await visible(user),[path],"author can sign their published photo");
  eq(await visible(peerUser),[path],"another entitled Community member can sign a visible photo");
  eq(await visible(otherOwner),[],"outside account cannot read private member photos");
  eq(await as("anon",null,"select name from storage.objects where bucket_id='community-photos'"),[],"anonymous Storage reads remain denied");
  await db.query("insert into academy_member_blocks(academy_community_id,blocker_member_id,blocked_member_id) values($1,$2,$3)",[community,peer,member]);
  eq(await visible(peerUser),[],"blocking an author denies new photo signatures too");
  await db.query("delete from academy_member_blocks where blocker_member_id=$1",[peer]);
  await as("authenticated",owner,"select admin_moderate_community_post($1,'archived',null)",[saved.postId]);
  eq(await visible(user),[],"archiving a post denies new photo signatures");
  await as("authenticated",owner,"select admin_moderate_community_post($1,'published',null)",[saved.postId]);
  eq(await visible(peerUser),[path],"unarchiving restores the same private photo reference");
  await db.query("update academy_access_grants set status='revoked' where academy_member_id=$1",[peer]);
  eq(await visible(peerUser),[],"revoked Community access cannot sign a known path");
  await rejects(()=>reserve(peerUser),"42501","expired Community access cannot reserve photo uploads");
  await db.query("update academy_access_grants set status='active' where academy_member_id=$1",[peer]);
  await rejects(()=>as("authenticated",user,"insert into storage.objects(id,bucket_id,name) values($1,'community-photos','spoof.png')",[uuid()]),"42501","members cannot bypass real byte validation through direct Storage insert");
  eq(await as("authenticated",user,"delete from storage.objects where name=$1 returning name",[path]),[],"members cannot remove attached photo objects directly");
  const retryId=uuid(),first=await reserve(user,retryId);await put(pathFor(retryId,first));
  eq(await release(user,retryId,first.leaseToken),true,"known pre-finalizer failure can release its own attempt");
  const second=await reserve(user,retryId);
  eq(second.leaseToken!==first.leaseToken,true,"retry uses a new isolated attempt folder");
  await rejects(()=>finalize(user,retryId,first.leaseToken),"22023","obsolete worker cannot publish another attempt");
  eq(await release(user,retryId,first.leaseToken),false,"obsolete worker cannot authorize another attempt's cleanup");
  await rejects(()=>finalize(user,retryId,second.leaseToken),"22023","new attempt cannot attach an older attempt's object");
  await db.query("update academy_members set status='suspended' where id=$1",[member]);
  await rejects(()=>finalize(user,retryId,second.leaseToken),"42501","finalizer rechecks membership after upload");
  await db.query("update academy_members set status='active' where id=$1",[member]);
  const big={...payload,photos:Array(4).fill({...photo,size:4194304})};
  for(let index=0;index<6;index++)await reserve(quotaUser,uuid(),big);
  await rejects(()=>reserve(quotaUser,uuid(),big),"54000","server daily quota bounds retained and unknown-outcome files");
  for(const [table,before] of Object.entries(preserved))eq((await db.query(`select to_jsonb(row)-'updated_at' as row from ${table} row order by to_jsonb(row)::text`)).rows,before,"photo publishing preserves member access, enrollments and all billing sources");
  const bucket=(await db.query("select public,file_size_limit,allowed_mime_types from storage.buckets where id='community-photos'")).rows[0];
  eq(bucket,{public:false,file_size_limit:4194304,allowed_mime_types:["image/jpeg","image/png","image/webp"]},"photo bucket stays private with explicit small-image limits");
  console.log(`${assertions} PostgreSQL assertions passed: photo auth/tenant isolation, byte metadata, leases, duplicate recovery, quota, private signing/moderation and preserved billing.`);
}finally{await db.close();}
