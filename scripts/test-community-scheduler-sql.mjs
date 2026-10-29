// Real isolated PostgreSQL via PGlite. No hosted calls, publications or mail sends.
// PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node scripts/test-community-scheduler-sql.mjs
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
process.on('uncaughtException',error=>{console.error(error.message,error.where??'');process.exit(1);});
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz default now(),banned_until timestamptz,deleted_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'service_role') $$;
create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key,bucket_id text,name text,owner uuid);
create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/') $$;
create function public.rls_auto_enable() returns event_trigger language plpgsql as $$ begin return; end $$;
create publication supabase_realtime;`);
for(const name of (await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort()) {
  const sql=(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8')).replace('create extension if not exists pgcrypto;','');
  try { await db.exec(sql); } catch(error) { throw new Error(`Migration ${name}: ${error.message}`); }
}
let assertions=0;
const eq=(actual,expected)=>{assert.deepEqual(actual,expected);assertions++;};
const rejects=async(promise,pattern)=>{await assert.rejects(promise,pattern);assertions++;};
const uuid=()=>crypto.randomUUID();
const owner=uuid(),user=uuid(),otherAdmin=uuid(),community=uuid(),author=uuid(),member=uuid(),otherAuthor=uuid(),category=uuid(),general=uuid();
for(const id of [owner,user,otherAdmin]) await db.query('insert into auth.users(id,email) values($1,$2)',[id,`${id}@example.test`]);
const org=(await db.query('select id from organizations where created_by=$1',[owner])).rows[0].id;
await db.query("insert into academy_communities(id,owner_organization_id,name,slug,portal_url) values($1,$2,'Scheduler test','scheduler-test','https://example.test')",[community,org]);
for(const [id,uid,role] of [[author,owner,'owner'],[member,user,'member']]) {
  await db.query("insert into academy_members(id,academy_community_id,user_id,display_name,role,status) values($1,$2,$3,'Scheduler member',$4,'active')",[id,community,uid,role]);
  await db.query("insert into academy_access_grants(academy_community_id,academy_member_id,source_type,source_key) values($1,$2,'manual','scheduler-fixture')",[community,id]);
}
for(const [id,name,allowed] of [[category,'Announcements',false],[general,'General',true]])
  await db.query('insert into community_categories(id,organization_id,academy_community_id,name,member_can_post) values($1,$2,$3,$4,$5)',[id,org,community,name,allowed]);
await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
const base={communityId:community,authorMemberId:author,categoryId:category,title:'Prepared update',body:'Approved training announcement content.',kind:'once',timeZone:'America/New_York',startsOn:'2030-01-07',localTime:'12:00',weekdays:[]};
const save=async(overrides={})=>(await db.query('select save_academy_post_schedule($1::jsonb) r',[JSON.stringify({...base,...(!overrides.id?{clientRequestId:uuid()}:{}),...overrides})])).rows[0].r;
const activateFixture=async(id)=>db.query("update academy_post_schedules set state='active',active_since='2029-01-01Z' where id=$1",[id]);
const publish=async(now='2030-01-07T17:01:00Z',limit=100)=>(await db.query('select publish_due_academy_posts($1,$2) r',[limit,now])).rows[0].r;
const count=async(table,where='true',params=[])=>(await db.query(`select count(*)::int n from ${table} where ${where}`,params)).rows[0].n;
const occurrences=async(id)=>(await db.query('select * from academy_post_schedule_occurrences where schedule_id=$1 order by local_date',[id])).rows;

// Draft-by-default and two independent switches: DB gate cannot publish by default.
const draft=await save();eq(draft.state,'draft');eq(draft.is_announcement,true);eq(draft.revision,1);
await rejects(save({state:'active'}),/Publishing is disabled/);
await rejects(db.query('select set_academy_post_schedule_state($1,$2,$3)',[draft.id,'active',1]),/Publishing is disabled/);
await activateFixture(draft.id);eq((await publish()).enabled,false);eq(await count('community_posts'),0);
await db.exec('update private.academy_post_scheduler_settings set enabled=true');
await db.exec('update private.academy_email_cutover set enabled=true,enabled_at=now()');
const alertsAtStart=await count('notifications');
const first=await publish();eq(first.published,1);eq((await occurrences(draft.id))[0].state,'published');
eq(await count('notifications'),alertsAtStart+1);eq(await count('academy_email_deliveries'),1);
eq((await publish()).published,0);eq(await count('community_posts'),1);eq(await count('notifications'),alertsAtStart+1);
eq((await db.query('select state from academy_post_schedules where id=$1',[draft.id])).rows[0].state,'paused');
eq((await occurrences(draft.id))[0].approved_snapshot.title,'Prepared update');
// Two overlapping caller promises still yield exactly one native post/occurrence.
const concurrent=await save({title:'Concurrent request'});await activateFixture(concurrent.id);
const duplicateResults=await Promise.all([publish(),publish()]);eq(duplicateResults.reduce((n,r)=>n+r.published,0),1);
eq((await occurrences(concurrent.id)).length,1);

// Manager authorization, identity/channel scope, shape, timezone and revision fences.
await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
await rejects(save(),/administrator access/);
await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
await rejects(save({authorMemberId:member}),/own active/);
await rejects(save({timeZone:'Mars/Olympus'}),/IANA timezone/);
await rejects(save({isAnnouncement:false}),/Announcement audience/);
await rejects(save({localTime:'25:30'}),/minute precision/);
await rejects(save({localTime:'12:00:01'}),/minute precision/);
await rejects(save({kind:'weekly',weekdays:[]}),/check constraint/);
await rejects(save({kind:'weekly',weekdays:[8]}),/check constraint/);
await rejects(save({authorMemberId:null}),/own active/);
await rejects(save({categoryId:null}),/Channel is unavailable/);
await rejects(save({startsOn:'infinity'}),/check constraint/);
await rejects(save({extra:'unsupported'}),/Unsupported schedule field/);
const editable=await save({title:'Revision test'});
// Replaying the same create request returns the original row; changed payload
// with the same request ID fails instead of producing a second activation.
const requestId=uuid(),createRequest={title:'Idempotent draft',clientRequestId:requestId};
const idempotent=await save(createRequest);eq((await save(createRequest)).id,idempotent.id);
await rejects(save({...createRequest,title:'Changed draft'}),/already used for different content/);
await db.query("insert into academy_members(id,academy_community_id,user_id,display_name,role,status) values($1,$2,$3,'Other admin','admin','active')",[otherAuthor,community,otherAdmin]);
await db.query("select set_config('request.jwt.claim.sub',$1,false)",[otherAdmin]);
await rejects(save({id:editable.id,expectedRevision:1,authorMemberId:otherAuthor}),/Only the schedule author/);
eq((await db.query('select set_academy_post_schedule_state($1,$2,$3) r',[editable.id,'paused',1])).rows[0].r.state,'paused');
await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
await db.query('delete from academy_members where id=$1',[otherAuthor]);
await rejects(save({id:editable.id,expectedRevision:1}),/Schedule changed/);
const currentEditable=(await db.query('select revision from academy_post_schedules where id=$1',[editable.id])).rows[0].revision;
await rejects(save({id:editable.id,expectedRevision:0}),/Schedule changed/);
const edited=await save({id:editable.id,expectedRevision:currentEditable,title:'Updated revision'});eq(edited.revision,3);
await rejects(db.query('select set_academy_post_schedule_state($1,$2,$3)',[edited.id,'active',1]),/Schedule changed/);
const cancelled=(await db.query('select set_academy_post_schedule_state($1,$2,$3) r',[edited.id,'cancelled',3])).rows[0].r;eq(cancelled.state,'cancelled');
await rejects(db.query('select set_academy_post_schedule_state($1,$2,$3)',[edited.id,'active',4]),/Invalid schedule state/);
eq((await db.query('select get_academy_post_scheduler_status($1) r',[community])).rows[0].r.workerActivationVerified,false);

// Weekly inclusive date bounds, selected weekdays, exact UTC conversion, future untouched.
const weekly=await save({kind:'weekly',startsOn:'2030-01-07',endsOn:'2030-01-14',weekdays:[1],title:'Weekly training'});await activateFixture(weekly.id);
eq((await publish()).published,1);eq((await occurrences(weekly.id))[0].scheduled_for.toISOString(),'2030-01-07T17:00:00.000Z');
eq((await publish('2030-01-08T17:00:00Z')).published,0);
eq((await publish('2030-01-14T17:00:00Z')).published,1);
eq((await publish('2030-01-21T17:00:00Z')).published,0);eq((await occurrences(weekly.id)).length,2);
const future=await save({startsOn:'2030-02-01',title:'Future post'});await activateFixture(future.id);eq((await publish()).published,0);eq((await occurrences(future.id)).length,0);

// Expired once schedules, paused/cancelled rules and pre-activation occurrences do not catch up.
const late=await save({title:'Too late'});await activateFixture(late.id);await publish('2030-01-07T17:16:00Z');eq((await occurrences(late.id))[0].reason_code,'catchup_expired');
const paused=await save({state:'paused',title:'Paused post'});await publish();eq((await occurrences(paused.id)).length,0);
const before=await save({state:'active',title:'Activated later'});await db.query("update academy_post_schedules set active_since='2030-01-07T17:00:01Z' where id=$1",[before.id]);await publish();eq((await occurrences(before.id))[0].reason_code,'before_activation');

// Channel rename and lost author role fail closed at publication time.
const renamed=await save({title:'Channel safety'});await activateFixture(renamed.id);
await db.query("update community_categories set name='Updates' where id=$1",[category]);await publish();eq((await occurrences(renamed.id))[0].reason_code,'channel_changed');
await db.query("update community_categories set name='Announcements' where id=$1",[category]);
const denied=await save({title:'Lost author access'});await activateFixture(denied.id);
await db.query("update academy_members set status='suspended' where id=$1",[author]);await publish();eq((await occurrences(denied.id))[0].reason_code,'author_access_changed');
await db.query("update academy_members set status='active' where id=$1",[author]);

// Final post-text trigger rejects prohibited text atomically, with no post/alert leak.
const rejected=await save({title:'Rejected content',body:'I will kill you'});await activateFixture(rejected.id);
const postsBefore=await count('community_posts'),alertsBefore=await count('notifications');
eq((await publish()).failed,1);eq((await occurrences(rejected.id))[0].reason_code,'publication_rejected');
eq(await count('community_posts'),postsBefore);eq(await count('notifications'),alertsBefore);
eq((await publish()).failed,0); // A failed occurrence requires explicit human review, not blind replay.

// Spring-forward wall time is skipped; fall-back wall time publishes once at later instant.
const spring=await save({startsOn:'2030-03-10',localTime:'02:30',title:'DST gap'});await activateFixture(spring.id);
await publish('2030-03-10T07:31:00Z');eq((await occurrences(spring.id))[0].reason_code,'nonexistent_local_time');
const fall=await save({startsOn:'2030-11-03',localTime:'01:30',title:'DST repeat'});await activateFixture(fall.id);
await publish('2030-11-03T05:31:00Z');eq((await occurrences(fall.id)).length,0);
await publish('2030-11-03T06:31:00Z');eq((await occurrences(fall.id))[0].state,'published');
eq((await occurrences(fall.id))[0].scheduled_for.toISOString(),'2030-11-03T06:30:00.000Z');
eq((await publish('2030-11-03T06:32:00Z')).published,0);
const phoenix=await save({timeZone:'America/Phoenix',kind:'weekly',startsOn:'2030-01-07',endsOn:'2030-01-11',localTime:'09:00',weekdays:[1,3,5],title:'Phoenix training'});
await activateFixture(phoenix.id);await publish('2030-01-07T16:00:00Z');
eq((await occurrences(phoenix.id))[0].scheduled_for.toISOString(),'2030-01-07T16:00:00.000Z');
await publish('2030-01-09T16:15:00Z');eq((await occurrences(phoenix.id)).filter(o=>o.state==='published').length,2);

// Ordinary posts follow authors, announcements reach eligible non-followers.
const generic=await save({categoryId:general,title:'Ordinary discussion'});await activateFixture(generic.id);
const genericBefore=await count('notifications');await publish();eq(await count('notifications'),genericBefore);
const genericPost=(await occurrences(generic.id))[0].post_id;eq(await count('academy_email_deliveries','target_id=$1',[genericPost]),0);
await db.query('insert into academy_member_follows(academy_community_id,follower_member_id,followed_member_id) values($1,$2,$3)',[community,member,author]);
const followed=await save({categoryId:general,title:'Followed discussion'});await activateFixture(followed.id);
await db.exec('set role service_role');eq((await publish()).published,1);await db.exec('reset role');
eq(await count('notifications'),genericBefore+1);
const followedPost=(await occurrences(followed.id))[0].post_id;eq(await count('academy_email_deliveries','target_id=$1',[followedPost]),1);
await publish();eq(await count('academy_email_deliveries','target_id=$1',[followedPost]),1);

// A bounded batch rotates through active schedules instead of repeatedly scanning
// finished one-time rules. Three independent due schedules publish with limit 1.
await db.exec("update academy_post_schedules set state='paused',active_since=null where state='active'");
const fair=[];
for(let i=0;i<3;i++) { const row=await save({title:`Fair batch ${i}`});await activateFixture(row.id);fair.push(row.id); }
for(let i=0;i<3;i++) eq((await publish(undefined,1)).published,1);
for(const id of fair) eq((await occurrences(id)).length,1);
eq((await publish(undefined,1)).examined,0);
await rejects(save({id:fair[0],expectedRevision:2}),/one-time schedule has finished/);

// Actual grants/RLS: clients can read their admin scope, cannot mutate or invoke worker.
for(const role of ['anon','authenticated']) {
  eq((await db.query("select has_function_privilege($1,'public.publish_due_academy_posts(integer,timestamptz)','execute') ok",[role])).rows[0].ok,false);
  for(const table of ['academy_post_schedules','academy_post_schedule_occurrences'])
    eq((await db.query("select has_table_privilege($1,$2,'insert,update,delete') ok",[role,table])).rows[0].ok,false);
}
await db.exec('set role authenticated');
eq((await count('academy_post_schedules'))>0,true);
await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);eq(await count('academy_post_schedules'),0);
await db.exec('reset role');
await db.exec('update private.academy_post_scheduler_settings set enabled=false');eq((await publish()).enabled,false);
await rejects(publish(undefined,101),/Invalid scheduler batch/);
console.log(JSON.stringify({ok:true,assertions,migrations:(await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).length,localOnly:true,concurrencyLimit:'PGlite serializes submitted statements; duplicate-call invariant tested; live independent-session lock contention remains a deployment check.'}));
await db.close();
