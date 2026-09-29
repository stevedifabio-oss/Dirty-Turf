// Isolated PostgreSQL execution: no hosted database or email provider access.
// PGLITE_MODULE=/path/to/pglite/dist/index.js node scripts/test-community-email-sql.mjs
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
process.on('uncaughtException', e=>{console.error(e.message, e.where || '', e.query || '', e.stack?.split('\n').slice(-3).join('\n'));process.exit(1);});
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
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
const uuid=()=>crypto.randomUUID();
const owner=uuid(), user=uuid(), otherUser=uuid(), community=uuid(), member=uuid(), other=uuid(), ownerMember=uuid();
for(const id of [owner,user,otherUser]) await db.query("insert into auth.users(id,email) values($1,$2)",[id,id+'@example.com']);
const org=(await db.query('select id from organizations where created_by=$1',[owner])).rows[0].id;
await db.query("insert into academy_communities(id,owner_organization_id,name,slug,portal_url) values($1,$2,'7 Figure Turf Cleaning','test','https://example.com')",[community,org]);
for(const [id,uid,role] of [[ownerMember,owner,'owner'],[member,user,'member'],[other,otherUser,'member']]) {
 await db.query("insert into academy_members(id,academy_community_id,user_id,display_name,role) values($1,$2,$3,'Test Member',$4)",[id,community,uid,role]);
 await db.query("insert into academy_access_grants(academy_community_id,academy_member_id,source_type,source_key) values($1,$2,'manual','test')",[community,id]);
}
let assertions=0; const eq=(a,b)=>{assert.deepEqual(a,b);assertions++;};
const count=async(where='true',params=[]) => (await db.query('select count(*)::integer n from academy_email_deliveries where '+where,params)).rows[0].n;
const event=async(startHours=24,level=null) => {
 const id=uuid();await db.query("insert into academy_events(id,organization_id,academy_community_id,title,starts_at,ends_at,meeting_url,required_level,status) values($1,$2,$3,'Turf Clean call',now()+make_interval(hours=>$4),now()+make_interval(hours=>$4+1),'https://example.com/meeting',$5,'published')",[id,org,community,startHours,level]);return id;
};
await event();eq(await count(),0); // Default-off cutover queues no backlog.
await db.exec("update private.academy_email_cutover set enabled=true,enabled_at=now()");
const eid=await event();eq(await count("template_key='new_event' and target_id=$1",[eid]),3);
const locked=uuid();
const first=(await db.query('select * from claim_academy_email_deliveries(1,$1)',[locked])).rows;
eq(first.length,1);
const claimedUser=first[0].recipient_id;
await db.query('insert into notification_preferences(user_id,email_enabled) values($1,false) on conflict(user_id) do update set email_enabled=false',[claimedUser]);
eq((await db.query('select * from prepare_academy_email_delivery($1,$2)',[first[0].id,locked])).rows.length,0);
await db.query('update notification_preferences set email_enabled=true where user_id=$1',[claimedUser]);
await db.query("insert into academy_member_event_rsvps(event_id,academy_member_id) values($1,$2)",[eid,member]);
eq(await count("template_key='event_rsvp' and target_id=$1",[eid]),1);
await db.query("update academy_member_event_rsvps set status='going' where event_id=$1",[eid]);
eq(await count("template_key='event_rsvp' and target_id=$1",[eid]),1);
await db.exec('select queue_academy_scheduled_notifications(now())');await db.exec('select queue_academy_scheduled_notifications(now())');
eq(await count("template_key='event_reminder' and target_id=$1",[eid]),1);
await db.query("update academy_events set starts_at=starts_at+interval '1 day',ends_at=ends_at+interval '1 day' where id=$1",[eid]);
eq(await count("template_key='event_updated' and target_id=$1",[eid]),1);
eq(await count("template_key='event_reminder' and target_id=$1 and status='cancelled'",[eid]),1);
await db.query("delete from academy_member_event_rsvps where event_id=$1",[eid]);
await db.query('select * from claim_academy_email_deliveries(100,$1)',[uuid()]);
eq(await count("template_key='event_updated' and target_id=$1 and status='cancelled'",[eid]),1);
await db.query('insert into academy_member_event_rsvps(event_id,academy_member_id) values($1,$2)',[eid,member]);
await db.query("update academy_events set status='archived' where id=$1",[eid]);
eq(await count("template_key='event_cancelled' and target_id=$1",[eid]),1);
const oneHour=await event(1);await db.query('insert into academy_member_event_rsvps(event_id,academy_member_id) values($1,$2)',[oneHour,member]);await db.exec('select queue_academy_scheduled_notifications(now())');
eq(await count("template_key='event_reminder' and target_id=$1 and payload->>'hoursBefore'='1'",[oneHour]),1);
const gated=await event(48,10);eq(await count("template_key='new_event' and target_id=$1",[gated]),1); // Owner only.
await db.query('delete from academy_events where id=$1',[oneHour]);eq(await count("template_key='event_cancelled' and target_id=$1",[oneHour]),1);
// Followed-author posts only; duplicate generic email replaced by mention.
await db.query('insert into academy_member_follows values($1,$2,$3,now())',[community,member,ownerMember]);
await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
const post=uuid();await db.query("insert into community_posts(id,organization_id,author_id,academy_community_id,academy_author_id,title,body,status) values($1,$2,$3,$4,$5,'Pricing','Useful example','published')",[post,org,owner,community,ownerMember]);
eq(await count("template_key='new_post' and target_id=$1",[post]),1);
await db.query('insert into academy_content_mentions(academy_community_id,actor_member_id,mentioned_member_id,post_id) values($1,$2,$3,$4)',[community,ownerMember,member,post]);
eq(await count("template_key='new_post' and target_id=$1 and status='cancelled'",[post]),1);
eq(await count("template_key='mention' and target_id=$1",[post]),1);
// Service-only lifecycle queue deduplicates stable event IDs and enforces admin recipients.
const queue=async(target,template,key='fixed')=>db.query("select queue_academy_lifecycle_email($1,$2,$3,$4,'Example','Synthetic')",[community,target,template,key]);
await queue(member,'content_reported_admin');eq(await count("template_key='content_reported_admin'"),0);
await queue(ownerMember,'content_reported_admin');await queue(ownerMember,'content_reported_admin');eq(await count("template_key='content_reported_admin'"),1);
await db.query("insert into content_reports(organization_id,reporter_id,content_type,content_id,reason) values($1,$2,'post',$3,'Review please')",[org,user,post]);eq(await count("template_key='content_reported_admin'"),2);
// Direct member admin transition produces member + admin mail. No notification on unchanged writes.
await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
await db.query("update academy_members set status='suspended' where id=$1",[member]);
eq(await count("template_key='membership_removed'"),1);eq(await count("template_key='membership_removed_admin'"),1);
await db.query("update academy_members set status='suspended' where id=$1",[member]);eq(await count("template_key='membership_removed'"),1);
await db.query("update academy_members set status='active' where id=$1",[member]);eq(await count("template_key='membership_approved'"),1);
await db.exec("select set_config('request.jwt.claim.sub','',false)");
// Course source baseline is silent; one newly published lesson after baseline is delivered once.
const course=uuid(), module=uuid(), lesson=uuid();
await db.query("insert into courses(id,organization_id,academy_community_id,title,status,access_type) values($1,$2,$3,'Training','published','open')",[course,org,community]);
await db.query("insert into course_modules(id,course_id,title) values($1,$2,'Basics')",[module,course]);
await db.exec("select set_config('app.academy_course_sync','on',false)");
await db.query("insert into course_lessons(id,module_id,title,status) values($1,$2,'First','published')",[lesson,module]);eq(await count("template_key='lesson_published'"),0);
await db.exec("select set_config('app.academy_course_sync_notifications','on',false)");
const lesson2=uuid();await db.query("insert into course_lessons(id,module_id,title,external_id,status) values($1,$2,'Second','second','published')",[lesson2,module]);eq(await count("template_key='lesson_published'"),3);
await db.query("update course_lessons set title='Edited' where id=$1",[lesson2]);eq(await count("template_key='lesson_published'"),3);
await db.query("update course_lessons set status='draft' where id=$1",[lesson2]);await db.query("update course_lessons set status='published' where id=$1",[lesson2]);eq(await count("template_key='lesson_published'"),3);
await db.exec("select set_config('app.academy_course_sync','off',false)");
// Changing auth email prevents sending the old address; expired access also cancels.
await db.query("update auth.users set email='changed@example.com' where id=$1",[user]);await db.query('select * from claim_academy_email_deliveries(100,$1)',[uuid()]);
eq(await count("recipient_member_id=$1 and status='pending'",[member]),0);
await assert.rejects(db.query("insert into notification_preferences(user_id,timezone) values($1,'Not/AZone') on conflict(user_id) do update set timezone='Not/AZone'",[user]));assertions++;
// Queued engagement mail must honor a later unfollow/block or deleted comment.
await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
await db.query('insert into academy_member_follows values($1,$2,$3,now())',[community,other,ownerMember]);
const laterPost=uuid();await db.query("insert into community_posts(id,organization_id,author_id,academy_community_id,academy_author_id,title,body,status) values($1,$2,$3,$4,$5,'Later post','Example','published')",[laterPost,org,owner,community,ownerMember]);
eq(await count("template_key='new_post' and target_id=$1 and recipient_member_id=$2 and status='pending'",[laterPost,other]),1);
await db.query('delete from academy_member_follows where follower_member_id=$1',[other]);
await db.query('select * from claim_academy_email_deliveries(100,$1)',[uuid()]);
eq(await count("template_key='new_post' and target_id=$1 and recipient_member_id=$2 and status='cancelled'",[laterPost,other]),1);
await db.query('insert into academy_content_mentions(academy_community_id,actor_member_id,mentioned_member_id,post_id) values($1,$2,$3,$4)',[community,ownerMember,other,laterPost]);
await db.query('insert into academy_member_blocks(academy_community_id,blocker_member_id,blocked_member_id) values($1,$2,$3)',[community,other,ownerMember]);
await db.query('select * from claim_academy_email_deliveries(100,$1)',[uuid()]);
eq(await count("template_key='mention' and target_id=$1 and recipient_member_id=$2 and status='cancelled'",[laterPost,other]),1);
await db.query('delete from academy_member_blocks where blocker_member_id=$1',[other]);
const comment=uuid();await db.query("insert into community_comments(id,organization_id,post_id,author_id,academy_community_id,academy_author_id,body) values($1,$2,$3,$4,$5,$6,'Example reply')",[comment,org,laterPost,owner,community,ownerMember]);
await db.query('insert into academy_content_mentions(academy_community_id,actor_member_id,mentioned_member_id,comment_id) values($1,$2,$3,$4)',[community,ownerMember,other,comment]);
await db.query('delete from community_comments where id=$1',[comment]);
await db.query('select * from claim_academy_email_deliveries(100,$1)',[uuid()]);
eq(await count("template_key='mention' and payload->>'commentId'=$1 and status='cancelled'",[comment]),1);
const lateEvent=await event(2);await db.query("update academy_events set starts_at=now()-interval '1 minute' where id=$1",[lateEvent]);
await db.query('select * from claim_academy_email_deliveries(100,$1)',[uuid()]);
eq(await count("template_key='new_event' and target_id=$1 and status in ('pending','processing')",[lateEvent]),0);
// Revoked current access invalidates queued content even if member status stays active.
const beforeRevoke=await event(3);await db.query("update academy_access_grants set status='revoked' where academy_member_id=$1",[other]);
await db.query('select * from claim_academy_email_deliveries(100,$1)',[uuid()]);
eq(await count("template_key='new_event' and target_id=$1 and recipient_member_id=$2 and status='cancelled'",[beforeRevoke,other]),1);
for(const signature of ['queue_academy_lifecycle_email(uuid,uuid,text,text,text,text,text,uuid,jsonb)','prepare_academy_email_delivery(uuid,uuid)','claim_academy_email_deliveries(integer,uuid)']) {
 eq((await db.query("select has_function_privilege('anon',$1,'execute') allowed",[signature])).rows[0].allowed,false);
 eq((await db.query("select has_function_privilege('authenticated',$1,'execute') allowed",[signature])).rows[0].allowed,false);
}
eq((await db.query("select relrowsecurity from pg_class where relname='academy_email_cutover'")).rows[0].relrowsecurity,true);
await db.close();console.log(`Community email SQL: ${assertions} behavioral assertions passed against all repository migrations in isolated PostgreSQL.`);
