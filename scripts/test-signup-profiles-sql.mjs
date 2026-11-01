// Actual repository migrations in isolated PostgreSQL; no hosted database or Storage calls.
// PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node scripts/test-pricing-gates-sql.mjs
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
for(const name of migrations) {
 const sql=(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8')).replace('create extension if not exists pgcrypto;','');
 try { await db.exec(sql); } catch(error) { throw new Error(`Migration ${name}: ${error.message}`,{cause:error}); }
}
const uuid=()=>crypto.randomUUID();
let assertions=0;
const eq=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);assertions++;};
const as=async(role,user,query,params=[])=>{
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user??'']); await db.exec(`set role ${role}`);
 try { return (await db.query(query,params)).rows; } finally { await db.exec('reset role'); }
};
const reject=async(p,label)=>{await assert.rejects(p,undefined,label);assertions++;};
const owner='87e83b6e-c072-43f9-bb8d-002b17d8a368',user=uuid(),other=uuid(),community=uuid(),member=uuid(),otherMember=uuid();
for(const id of [owner,user,other]) await db.query('insert into auth.users(id,email) values($1,$2)',[id,id===owner?'steve@dirtyturf.com':id+'@example.test']);
const org=(await db.query('select id from organizations where created_by=$1',[owner])).rows[0].id;
const userOrg=(await db.query('select id from organizations where created_by=$1',[user])).rows[0].id;
await db.query("insert into academy_communities(id,owner_organization_id,name,slug,portal_url) values($1,$2,'Pricing test','pricing-test','https://example.test')",[community,org]);
for(const [id,uid] of [[member,user],[otherMember,other]]) await db.query("insert into academy_members(id,academy_community_id,user_id,display_name,status,role) values($1,$2,$3,'Member','active','member')",[id,community,uid]);
const state=async(uid)=>(await as('authenticated',uid,'select get_academy_access_state() r'))[0].r;
// Signup onboarding: ownership, privacy, validation and no entitlement changes.
const ownProfile=async(uid)=>(await as('authenticated',uid,'select get_my_signup_profile() r'))[0].r;
await db.query("update auth.users set created_at=now()-interval '1 year' where id=$1",[user]);
eq((await ownProfile(user)).required,false,'existing members are not forced through new onboarding');
eq((await ownProfile(other)).required,true,'new accounts require a profile');
await reject(as('anon',null,'select get_my_signup_profile()'),'anonymous profiles cannot be queried');
await reject(as('authenticated',other,'select * from private.member_signup_profiles'),'phone table is not readable directly');
const avatar=other+'/'+uuid()+'.jpg';
await db.query("insert into storage.objects(id,bucket_id,name,metadata) values($1,'member-avatars',$2,$3)",[uuid(),avatar,{mimetype:'image/jpeg',size:100}]);
const profileSave=async(uid,name='Alex Green',phone='+1 (555) 123-4567',path=avatar,experience='under_two_years')=>as('authenticated',uid,'select save_my_signup_profile($1,$2,$3,$4,$5,$6)',[name,phone,'Phoenix, AZ, USA','I run a turf cleaning business.',path,experience]);
await reject(profileSave(user),'another account cannot use someone else’s photo');
await reject(profileSave(other,'A'),'short names fail server validation');
await reject(profileSave(other,'Alex','123'),'invalid phones fail server validation');
await reject(profileSave(other,'Alex','+1 555 123 4567',other+'/'+uuid()+'.jpg'),'missing uploaded objects fail server validation');
await reject(profileSave(other,'Alex','+1 555 123 4567',avatar,'invalid'),'unknown experience fails server validation');
const priorProfileAccess=await state(other);
await profileSave(other);
eq((await ownProfile(other)).required,false,'completed signup is remembered');
eq((await ownProfile(other)).profile.phone,'+1 (555) 123-4567','only own profile returns private phone');
eq((await ownProfile(other)).profile.experience,'under_two_years','experience answer is saved and returned');
eq((await ownProfile(user)).profile.phone,undefined,'another member cannot read the phone through RPC');
eq(await state(other),priorProfileAccess,'profile save grants no role or product access');
eq((await db.query('select display_name,about from academy_members where id=$1',[otherMember])).rows[0],{display_name:'Alex Green',about:'I run a turf cleaning business.'},'public profile mirrors only approved fields');
await reject(as('authenticated',user,"insert into storage.objects(id,bucket_id,name) values($1,'member-avatars',$2)",[uuid(),other+'/'+uuid()+'.jpg']),'storage blocks another user path');
eq((await as('authenticated',user,"delete from storage.objects where bucket_id='member-avatars' returning id")).length,0,'another member cannot delete the photo');
await db.query('update auth.users set email_confirmed_at=null where id=$1',[other]);
await reject(ownProfile(other),'unverified users cannot access profile RPC');
await reject(profileSave(other),'unverified users cannot update profile');
await db.close();
console.log(`Signup profiles SQL: ${assertions} assertions passed against ${migrations.length} actual migrations. No live changes.`);
