// Native push SQL checks in isolated PostgreSQL. No provider or hosted access.
// PGLITE_MODULE=/path/to/pglite/dist/index.js node scripts/test-community-email-sql.mjs
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
process.on('uncaughtException', e=>{console.error(e.message, e.where || '', e.query || '', e.stack?.split('\n').slice(-3).join('\n'));process.exit(1);});
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz default now(),banned_until timestamptz,deleted_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$ select 'authenticated'::text $$;
create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key,bucket_id text,name text,owner uuid);
create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/') $$;
create function public.rls_auto_enable() returns event_trigger language plpgsql as $$ begin return; end $$;
create publication supabase_realtime;
`);
const migrations = (await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(name=>name.endsWith('.sql')).sort();
for (const name of migrations) {
 let sql=await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
 // PGlite includes gen_random_uuid; the Supabase pgcrypto package is not needed here.
 sql=sql.replace('create extension if not exists pgcrypto;','');
 try { await db.exec(sql); } catch (error) { console.error('Migration failed:',name,error.message); process.exit(1); }
}
const uuid=()=>crypto.randomUUID(); let assertions=0;
const eq=(a,b)=>{assert.deepEqual(a,b);assertions++;};
const rejected=async(action)=>{await assert.rejects(action);assertions++;};
const owner=uuid(),user=uuid(),other=uuid(),community=uuid(),ownerMember=uuid(),member=uuid(),otherMember=uuid(),device=uuid(),secret=uuid();
for(const id of [owner,user,other]) await db.query('insert into auth.users(id,email) values($1,$2)',[id,id+'@example.test']);
const org=(await db.query('select id from organizations where created_by=$1',[owner])).rows[0].id;
await db.query("insert into academy_communities(id,owner_organization_id,name,slug,portal_url) values($1,$2,'Push test','push-test','https://example.test')",[community,org]);
for(const [id,uid,role] of [[ownerMember,owner,'owner'],[member,user,'member'],[otherMember,other,'member']]) {
 await db.query("insert into academy_members(id,academy_community_id,user_id,display_name,role) values($1,$2,$3,'Push test member',$4)",[id,community,uid,role]);
 await db.query("insert into academy_access_grants(academy_community_id,academy_member_id,source_type,source_key) values($1,$2,'manual','push-test')",[community,id]);
}
const category=uuid();await db.query("insert into community_categories(id,organization_id,academy_community_id,name) values($1,$2,$3,'Announcements')",[category,org,community]);
const claimUser=async(uid)=>db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);
const offset=((12-new Date().getUTCHours()+12)%24)-12;
const zone='Etc/GMT'+(offset>0?'-'+offset:offset<0?'+'+(-offset):'');
const token='a'.repeat(64),secondToken='b'.repeat(96);let revision=0;
const register=async(dev=device,sec=secret,tok=token,explicit=true,tz=zone)=>{const rev=++revision;await db.query('select begin_academy_push_registration($1,$2,$3)',[dev,sec,rev]);return db.query('select register_academy_push_device($1,$2,$3,$4,$5,$6,$7,$8)',[dev,sec,'ios','production',tok,explicit,tz,rev]);};
const count=async(where='true')=>(await db.query('select count(*)::integer n from private.academy_push_deliveries where '+where)).rows[0].n;
const post=async()=>{const prior=(await db.query("select current_setting('request.jwt.claim.sub',true) uid")).rows[0].uid;await claimUser(owner);const id=uuid();await db.query("insert into community_posts(id,organization_id,author_id,academy_community_id,academy_author_id,category_id,title,body,status) values($1,$2,$3,$4,$5,$6,'Synthetic announcement','Synthetic text','published')",[id,org,owner,community,ownerMember,category]);await claimUser(prior);return id;};
await claimUser(user);
eq((await db.query('select * from academy_push_readiness()')).rows[0].ready,false);
await rejected(register);eq(await count(),0);
await db.exec("update private.academy_push_settings set enabled=true,client_ready=true,enabled_at=now()");
await rejected(()=>register(device,secret,token,false));
await rejected(()=>register(device,secret,token,true,'Invalid/Zone'));
await register();await db.query('update notification_preferences set email_enabled=false where user_id=$1',[user]);
eq((await db.query('select push_enabled,push_reactions,push_new_posts from notification_preferences where user_id=$1',[user])).rows[0],{push_enabled:true,push_reactions:false,push_new_posts:false});
await rejected(()=>register(device,uuid()));
await claimUser('');await rejected(register);await claimUser(user);
const p1=await post();eq(await count(),1);eq((await db.query('select count(*)::integer n from academy_email_deliveries')).rows[0].n,0);
const n1=(await db.query('select id from notifications where target_id=$1 and recipient_id=$2',[p1,user])).rows[0].id;
await db.query("select private.queue_academy_push($1,$2,$3,'announcement','admin_announcements',$4,'{}')",[n1,community,member,ownerMember]);eq(await count(),1);
await claimUser(other);eq((await db.query('select * from resolve_academy_push_notification($1)',[n1])).rows.length,0);
await claimUser(user);eq((await db.query('select * from resolve_academy_push_notification($1)',[n1])).rows[0].target_id,p1);
await db.query('insert into academy_member_blocks(academy_community_id,blocker_member_id,blocked_member_id) values($1,$2,$3)',[community,member,ownerMember]);
eq((await db.query('select * from resolve_academy_push_notification($1)',[n1])).rows.length,0);
eq((await db.query('select * from claim_academy_push_deliveries(25,$1,$2)',[uuid(),'production'])).rows.length,0);eq(await count("status='cancelled'"),1);
await db.query('delete from academy_member_blocks where blocker_member_id=$1',[member]);
const p2=await post(); const lock=uuid();const claimed=(await db.query('select * from claim_academy_push_deliveries(25,$1,$2)',[lock,'production'])).rows;eq(claimed.length,1);
const queued=claimed[0].id;
await db.query('update notification_preferences set push_admin_announcements=false where user_id=$1',[user]);
eq((await db.query('select * from prepare_academy_push_delivery($1,$2)',[queued,lock])).rows.length,0);
await db.query('update notification_preferences set push_admin_announcements=true where user_id=$1',[user]);
const p3=await post();await register(device,secret,secondToken,false);eq(await count("status='pending'"),0);
eq((await db.query('select token from private.academy_push_devices where id=$1',[device])).rows[0].token,secondToken);
const p4=await post();await db.query('select unregister_academy_push_device($1,$2,$3)',[device,secret,++revision]);eq(await count("status='pending'"),0);
eq((await db.query('select push_enabled from notification_preferences where user_id=$1',[user])).rows[0].push_enabled,true); // Logout is device-only.
await rejected(()=>register(device,secret,secondToken,false));await register(device,secret,secondToken,true);
await claimUser(other);await register(device,secret,secondToken,true);
eq((await db.query('select user_id from private.academy_push_devices where id=$1',[device])).rows[0].user_id,other);
const priorRevision=revision;
await claimUser(user);await register(device,secret,secondToken,true);
await rejected(()=>db.query('select register_academy_push_device($1,$2,$3,$4,$5,$6,$7,$8)',[device,secret,'ios','production',token,true,zone,priorRevision]));
await db.query('select unregister_academy_push_device($1,$2,$3)',[device,secret,priorRevision]);
eq((await db.query('select enabled from private.academy_push_devices where id=$1',[device])).rows[0].enabled,true);
const p5=await post();const lock2=uuid();const q2=(await db.query('select * from claim_academy_push_deliveries(25,$1,$2)',[lock2,'production'])).rows[0];
eq((await db.query('select * from prepare_academy_push_delivery($1,$2)',[q2.id,lock2])).rows.length,1);
eq((await db.query("select finish_academy_push_delivery($1,$2,'invalid_token') done",[q2.id,lock2])).rows[0].done,true);
eq((await db.query('select enabled from private.academy_push_devices where id=$1',[device])).rows[0].enabled,false);
await register(device,secret,secondToken,true);
await post();const lock3=uuid();const q3=(await db.query('select * from claim_academy_push_deliveries(25,$1,$2)',[lock3,'production'])).rows[0];
await db.query("select finish_academy_push_delivery($1,$2,'uncertain')",[q3.id,lock3]);eq(await count("status='failed' and error_code='uncertain'"),1);
eq((await db.query('select * from claim_academy_push_deliveries(25,$1,$2)',[uuid(),'production'])).rows.length,0);
eq(Date.parse((await db.query("select private.academy_push_next_window('America/Phoenix','2026-10-24T06:00:00Z')::text t")).rows[0].t),Date.parse('2026-10-24T15:00:00Z'));
eq(Date.parse((await db.query("select private.academy_push_next_window('America/Phoenix','2026-10-24T16:00:00Z')::text t")).rows[0].t),Date.parse('2026-10-24T16:00:00Z'));
eq(Date.parse((await db.query("select private.academy_push_next_window('America/New_York','2026-11-01T03:00:00Z')::text t")).rows[0].t),Date.parse('2026-11-01T13:00:00Z'));
await post();await db.exec("update private.academy_push_settings set environment='sandbox'");eq((await db.query('select * from claim_academy_push_deliveries(25,$1,$2)',[uuid(),'production'])).rows.length,0);
await db.exec("update private.academy_push_settings set environment='production'");
await db.exec("update private.academy_push_deliveries set status='cancelled' where status='pending'");
// One comment action can create both an in-app comment and mention; push emits only the mention.
const ownPost=uuid(),comment=uuid(),general=uuid();await db.query("insert into community_categories(id,organization_id,academy_community_id,name,member_can_post) values($1,$2,$3,'General',true)",[general,org,community]);await claimUser(user);
await db.query("insert into community_posts(id,organization_id,author_id,academy_community_id,academy_author_id,category_id,title,body,status) values($1,$2,$3,$4,$5,$6,'Own discussion','Synthetic body','published')",[ownPost,org,user,community,member,general]);
await claimUser(owner);await db.query("insert into community_comments(id,post_id,organization_id,author_id,academy_community_id,academy_author_id,body) values($1,$2,$3,$4,$5,$6,'Synthetic comment')",[comment,ownPost,org,owner,community,ownerMember]);
await db.query('insert into academy_content_mentions(academy_community_id,actor_member_id,mentioned_member_id,comment_id) values($1,$2,$3,$4)',[community,ownerMember,member,comment]);
eq((await db.query("select count(*)::integer n from private.academy_push_deliveries where target_id=$1 and status='pending' and template_key='mention'",[ownPost])).rows[0].n,1);
eq((await db.query("select count(*)::integer n from private.academy_push_deliveries where target_id=$1 and status='cancelled' and error_code='superseded_by_mention'",[ownPost])).rows[0].n,1);
await db.query('select admin_remove_community_comment($1)',[comment]);await claimUser(user);
eq((await db.query('select * from claim_academy_push_deliveries(25,$1,$2)',[uuid(),'production'])).rows.length,0);
await post();await db.exec("update private.academy_push_deliveries set expires_at=now()-interval '1 second' where status='pending'");eq((await db.query('select * from claim_academy_push_deliveries(25,$1,$2)',[uuid(),'production'])).rows.length,0);
await post();await db.exec("update private.academy_push_settings set enabled=false");eq((await db.query('select * from claim_academy_push_deliveries(25,$1,$2)',[uuid(),'production'])).rows.length,0);
eq((await db.query("select has_table_privilege('authenticated','private.academy_push_devices','select') allowed")).rows[0].allowed,false);
eq((await db.query("select has_function_privilege('anon','public.register_academy_push_device(uuid,uuid,text,text,text,boolean,text,bigint)','execute') allowed")).rows[0].allowed,false);
eq((await db.query("select has_function_privilege('authenticated','public.prepare_academy_push_delivery(uuid,uuid)','execute') allowed")).rows[0].allowed,false);
console.log(JSON.stringify({passed:assertions,isolated:true,providerWrites:0}));await db.close();
