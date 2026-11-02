// Isolated PostgreSQL acceptance against the actual release migrations. No hosted calls.
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
process.on('uncaughtException', error => { console.error(error.message, error.where || '', error.query || ''); process.exit(1); });
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create table auth.users(id uuid primary key,created_at timestamptz default now(),email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz default now(),banned_until timestamptz,deleted_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$ select current_user::text $$;
create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key,bucket_id text,name text,owner uuid,metadata jsonb);
alter table storage.objects enable row level security;
create function storage.foldername(text) returns text[] language sql as $$ select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1] $$;
create function public.rls_auto_enable() returns event_trigger language plpgsql as $$ begin return; end $$;
create publication supabase_realtime;
grant usage on schema public,auth,storage to anon,authenticated,service_role;
grant select,insert,update,delete on storage.objects to anon,authenticated,service_role;
alter default privileges in schema public grant select,insert,update,delete on tables to anon,authenticated,service_role;
`);
const migrations=(await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(name=>name.endsWith('.sql')).sort();
for(const name of migrations) await db.exec((await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8')).replace('create extension if not exists pgcrypto;',''));
const owner='87e83b6e-c072-43f9-bb8d-002b17d8a368', first=crypto.randomUUID(), second=crypto.randomUUID();
for(const [id,email] of [[owner,'steve@dirtyturf.com'],[first,'first@example.test'],[second,'second@example.test']]) await db.query('insert into auth.users(id,email) values($1,$2)',[id,email]);
const org=(await db.query('select id from organizations where created_by=$1',[owner])).rows[0].id;
const community=crypto.randomUUID(), one=crypto.randomUUID(), two=crypto.randomUUID();
await db.query("insert into academy_communities(id,owner_organization_id,name,slug,portal_url,pricing_gates_enabled) values($1,$2,'Owner test','owner-test','https://example.test',true)",[community,org]);
for(const [mid,uid] of [[one,first],[two,second]]) await db.query("insert into academy_members(id,academy_community_id,user_id,display_name,status,role) values($1,$2,$3,'Test member','active','member')",[mid,community,uid]);
const course=crypto.randomUUID(), foreignCommunity=crypto.randomUUID(), foreignCourse=crypto.randomUUID();
await db.query("insert into academy_communities(id,owner_organization_id,name,slug,portal_url) values($1,$2,'Other','other-test','https://example.test')",[foreignCommunity,org]);
for(const [cid,scope] of [[course,community],[foreignCourse,foreignCommunity]]) await db.query("insert into courses(id,organization_id,academy_community_id,title,status,access_type,external_id) values($1::uuid,$2,$3,'Test course','published','open',$1::text)",[cid,org,scope]);
let assertions=0;
const equal=(value,expected)=>{assert.deepEqual(value,expected);assertions++;};
const as=async(role,uid,sql,params=[])=>{
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid??'']); await db.exec(`set role ${role}`);
  try { return (await db.query(sql,params)).rows; } finally { await db.exec('reset role'); }
};
const reject=async(p)=>{await assert.rejects(p);assertions++;};
const set=(mid,resource,enabled=true,ends=null,actor=owner)=>as('authenticated',actor,'select admin_set_free_access($1,$2,$3,$4)',[mid,resource,enabled,ends]);
const state=async(uid)=>(await as('authenticated',uid,'select get_academy_access_state() as value'))[0].value;
equal((await as('authenticated',owner,'select admin_can_manage_members($1) as allowed',[community]))[0].allowed,true);
await set(one,'community');
equal((await state(first)).communityAccess,true);
equal((await state(first)).courseIds,[]); // Complimentary Community never grants Academy.
equal((await state(first)).features,[]);
equal((await state(second)).hasAccess,false);
await set(one,'measuring_tool');
equal((await state(first)).features,['measuring_tool']);
equal((await state(second)).features,[]);
await set(one,course);
equal((await state(first)).courseIds,[course]);
equal((await state(second)).courseIds,[]);
await set(one,'measuring_tool',false);
equal((await state(first)).features,[]);
equal((await state(first)).communityAccess,true);
equal((await state(first)).courseIds,[course]);
await db.query("insert into academy_access_grants(academy_community_id,academy_member_id,course_id,source_type,source_key) values($1,$2,$3,'import','preserved-course')",[community,one,course]);
await set(one,course,false);
equal((await state(first)).courseIds,[course]);
const future=new Date(Date.now()+86400000).toISOString();
await set(one,'measuring_tool',true,future);
equal((await as('authenticated',owner,'select admin_get_free_access($1) as grants',[one]))[0].grants.find(item=>item.resource==='measuring_tool').endsAt,future.replace('Z','+00:00'));
await reject(set(one,'measuring_tool',true,'2000-01-01'));
await reject(set(one,foreignCourse));
await reject(set(two,'community',true,null,first));
await reject(as('anon',null,'select admin_get_free_access($1)',[one]));
await reject(as('authenticated',first,'select admin_get_free_access($1)',[one]));
await db.query("update academy_members set role='owner' where id=$1",[two]);
equal((await as('authenticated',second,'select admin_can_manage_members($1) as allowed',[community]))[0].allowed,false);
await reject(set(one,'community',true,null,second));
await reject(as('authenticated',second,'delete from course_enrollments where academy_member_id=$1',[one]));
await db.query('update auth.users set email_confirmed_at=null where id=$1',[owner]);
await reject(set(one,'community'));
await db.query("update auth.users set email_confirmed_at=now(),banned_until=now()+interval '1 day' where id=$1",[owner]);
await reject(set(one,'community'));
await db.query('update auth.users set banned_until=null where id=$1',[owner]);
// Legacy membership remains unchanged even when a complimentary Community grant is removed.
await db.query("insert into academy_access_grants(academy_community_id,academy_member_id,source_type,source_key) values($1,$2,'import','legacy-membership')",[community,one]);
await set(one,'community',false);
equal((await state(first)).communityAccess,true);
equal((await state(first)).courseIds,[course]);
equal((await db.query("select status from academy_access_grants where source_key='legacy-membership'")).rows[0].status,'active');
for(const name of ['admin_set_free_access(uuid,text,boolean,timestamptz)','admin_get_free_access(uuid)']) {
  equal((await db.query('select prosecdef from pg_proc where oid=$1::regprocedure',[name])).rows[0].prosecdef,false);
}
await db.close();
console.log(`Owner access SQL: ${assertions} assertions passed against ${migrations.length} release migrations. No live changes.`);
