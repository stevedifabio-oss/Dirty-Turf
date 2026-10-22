// Isolated PostgreSQL execution: no hosted database or email provider access.
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

// An explicit course denial must prevent content mail both when queued and after
// a previously valid delivery is claimed. Own cancellation notices are separate.
await db.query("update auth.users set email=$1 where id=$2",[user+'@example.com',user]);
await db.query("insert into academy_course_access_denials(academy_community_id,academy_member_id,course_id) values($1,$2,$3)",[community,member,course]);
eq((await db.query("select private.academy_notification_access($1,$2,'course',$3,'lesson_published') allowed",[member,community,course])).rows[0].allowed,false);
const deniedBefore=await count("recipient_member_id=$1 and template_key='lesson_published'",[member]);
const deniedLesson=uuid();await db.query("insert into course_lessons(id,module_id,title,status) values($1,$2,'Denied lesson','published')",[deniedLesson,module]);
eq(await count("recipient_member_id=$1 and template_key='lesson_published'",[member]),deniedBefore);
await db.query("delete from academy_course_access_denials where academy_member_id=$1 and course_id=$2",[member,course]);
const beforeDenialLesson=uuid();await db.query("insert into course_lessons(id,module_id,title,status) values($1,$2,'Queued before denial','published')",[beforeDenialLesson,module]);
const beforeDenialDelivery=(await db.query("select id from academy_email_deliveries where recipient_member_id=$1 and payload->>'lessonId'=$2",[member,beforeDenialLesson])).rows[0].id;
const denialLock=uuid();await db.query("select * from claim_academy_email_deliveries(100,$1)",[denialLock]);
await db.query("insert into academy_course_access_denials(academy_community_id,academy_member_id,course_id) values($1,$2,$3)",[community,member,course]);
eq((await db.query("select * from prepare_academy_email_delivery($1,$2)",[beforeDenialDelivery,denialLock])).rows.length,0);
eq(await count("id=$1 and status='cancelled'",[beforeDenialDelivery]),1);
// A cancellation email can reference this member's actual former subscription,
// even after the course is archived, grants revoked and membership suspended.
const cancelPlan=uuid();await db.query("insert into academy_billing_plans(id,academy_community_id,slug,name,amount_cents,offer_kind,community_access) values($1,$2,'cancel-test','Former course',14995,'course',false)",[cancelPlan,community]);
await db.query("insert into academy_billing_plan_courses(plan_id,course_id) values($1,$2)",[cancelPlan,course]);
await db.query("insert into academy_billing_subscriptions(academy_community_id,academy_member_id,plan_id,source_type,source_key,provider_customer_id,provider_subscription_id,status) values($1,$2,$3,'stripe_subscription','synthetic-cancel','cus_synthetic','sub_synthetic','cancelled')",[community,member,cancelPlan]);
await db.query("update academy_members set status='suspended' where id=$1",[member]);
await db.query("update academy_access_grants set status='revoked' where academy_member_id=$1",[member]);
await db.query("update courses set status='archived' where id=$1",[course]);
eq((await db.query("select private.academy_notification_access($1,$2,'course',$3,'course_subscription_cancelled') allowed",[member,community,course])).rows[0].allowed,true);
eq((await db.query("select private.academy_notification_access($1,$2,'course',$3,'lesson_published') allowed",[member,community,course])).rows[0].allowed,false);
const unrelatedCourse=uuid();await db.query("insert into courses(id,organization_id,academy_community_id,title,status,access_type) values($1,$2,$3,'Unrelated course','draft','purchase')",[unrelatedCourse,org,community]);
eq((await db.query("select private.academy_notification_access($1,$2,'course',$3,'course_subscription_cancelled') allowed",[member,community,unrelatedCourse])).rows[0].allowed,false);
eq((await db.query("select private.academy_notification_access($1,$2,'community',$2,'group_subscription_cancelled') allowed",[member,community])).rows[0].allowed,true);
eq((await db.query("select private.academy_notification_access($1,$2,'community',$3,'group_subscription_cancelled') allowed",[member,community,uuid()])).rows[0].allowed,false);
await db.query("select queue_academy_lifecycle_email($1,$2,'course_subscription_cancelled','synthetic-cancel-receipt','Course cancellation confirmed','Manage your billing','course',$3)",[community,member,course]);
eq(await count("recipient_member_id=$1 and template_key='course_subscription_cancelled'",[member]),1);

// Digest inventory is recipient-specific, Monday-local, idempotent and based on
// native visible posts. Recheck after a block/archive change before provider I/O.
const digestCommunity=uuid(), digestUser=uuid(), authorAUser=uuid(), authorBUser=uuid(), digestMember=uuid(), authorA=uuid(), authorB=uuid();
for(const id of [digestUser,authorAUser,authorBUser]) await db.query("insert into auth.users(id,email) values($1,$2)",[id,id+'@example.test']);
await db.query("insert into academy_communities(id,owner_organization_id,name,slug,portal_url) values($1,$2,'Digest test','digest-test','https://example.test')",[digestCommunity,org]);
for(const [id,uid] of [[digestMember,digestUser],[authorA,authorAUser],[authorB,authorBUser]]) {
 await db.query("insert into academy_members(id,academy_community_id,user_id,display_name) values($1,$2,$3,'Synthetic')",[id,digestCommunity,uid]);
 await db.query("insert into academy_access_grants(academy_community_id,academy_member_id,source_type,source_key) values($1,$2,'manual','synthetic-digest')",[digestCommunity,id]);
}
await db.query("insert into notification_preferences(user_id,timezone) values($1,'UTC')",[digestUser]);
const monday=(await db.query("select (date_trunc('week',now() at time zone 'UTC')+interval '9 hours') at time zone 'UTC' monday")).rows[0].monday;
const nativeA=uuid(),nativeB=uuid(),future=uuid(),importedPost=uuid(),importBatch=uuid(),digestCategory=uuid();
await db.query("insert into community_categories(id,organization_id,academy_community_id,name,member_can_post) values($1,$2,$3,'Digest General',true)",[digestCategory,org,digestCommunity]);
await db.query("insert into source_import_batches(id,academy_community_id,status) values($1,$2,'imported')",[importBatch,digestCommunity]);
for(const [id,author,uid,batch,futurePost] of [[nativeA,authorA,authorAUser,null,false],[nativeB,authorB,authorBUser,null,false],[future,authorB,authorBUser,null,true],[importedPost,authorB,authorBUser,importBatch,false]]) {
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);
 await db.query("insert into community_posts(id,organization_id,author_id,academy_community_id,academy_author_id,title,body,status,source_import_batch_id,created_at,category_id) values($1,$2,$3,$4,$5,'Synthetic digest post','Example','published',$6,case when $8 then now()+interval '1 day' else $7::timestamptz-interval '1 day' end,$9)",[id,org,uid,digestCommunity,author,batch,monday,futurePost,digestCategory]);
}
await db.exec("select set_config('request.jwt.claim.sub','',false)");
eq((await db.query("select private.academy_visible_digest_post_count($1,$2,$3) count",[digestMember,digestCommunity,monday])).rows[0].count,2);
await db.query("insert into academy_member_blocks(academy_community_id,blocker_member_id,blocked_member_id) values($1,$2,$3)",[digestCommunity,digestMember,authorA]);
eq((await db.query("select private.academy_visible_digest_post_count($1,$2,$3) count",[digestMember,digestCommunity,monday])).rows[0].count,1);
await db.query("select queue_academy_scheduled_notifications($1)",[monday]);await db.query("select queue_academy_scheduled_notifications($1)",[monday]);
eq(await count("recipient_member_id=$1 and template_key='weekly_digest'",[digestMember]),1);
let digestRow=(await db.query("select * from academy_email_deliveries where recipient_member_id=$1 and template_key='weekly_digest'",[digestMember])).rows[0];
eq(digestRow.detail,'1 new discussion this week.');eq(digestRow.payload.postCount,1);
await db.query("delete from academy_member_blocks where academy_community_id=$1 and blocker_member_id=$2",[digestCommunity,digestMember]);
const digestLock=uuid();await db.query("select * from claim_academy_email_deliveries(100,$1)",[digestLock]);
let preparedDigest=(await db.query("select * from prepare_academy_email_delivery($1,$2)",[digestRow.id,digestLock])).rows[0];
eq(preparedDigest.payload.postCount,2);eq(preparedDigest.detail,'2 new discussions this week.');
await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
await db.query("update community_posts set status='archived' where id in ($1,$2)",[nativeA,nativeB]);
eq((await db.query("select * from prepare_academy_email_delivery($1,$2)",[digestRow.id,digestLock])).rows.length,0);
eq(await count("id=$1 and status='cancelled'",[digestRow.id]),1);
// A fresh pending notification cannot bypass a changed Auth restriction.
await db.query("update community_posts set status='published' where id=$1",[nativeB]);
await db.query("select queue_academy_lifecycle_email($1,$2,'role_changed','auth-restriction-1','Role update','Open your account')",[digestCommunity,digestMember]);
const authDelivery=(await db.query("select * from academy_email_deliveries where recipient_member_id=$1 and idempotency_key like '%auth-restriction-1%'",[digestMember])).rows[0];
eq((await db.query("select private.academy_email_eligible(d) allowed from academy_email_deliveries d where id=$1",[authDelivery.id])).rows[0].allowed,true);
for(const [column,value] of [['banned_until','2099-01-01T00:00:00Z'],['deleted_at','2026-10-01T00:00:00Z'],['email_confirmed_at',null]]) {
 await db.query(`update auth.users set ${column}=$1 where id=$2`,[value,digestUser]);
 eq((await db.query("select private.academy_email_eligible(d) allowed from academy_email_deliveries d where id=$1",[authDelivery.id])).rows[0].allowed,false);
 await db.query(`update auth.users set ${column}=$1 where id=$2`,[column==='email_confirmed_at'?new Date().toISOString():null,digestUser]);
}
// Queued snippets must not preserve text which has since been edited or removed.
// A reply also inherits visibility of its parent post's author.
await db.query("select set_config('request.jwt.claim.sub',$1,false)",[authorAUser]);
const editableComment=uuid();
await db.query("insert into community_comments(id,organization_id,post_id,author_id,academy_community_id,academy_author_id,body) values($1,$2,$3,$4,$5,$6,'Old synthetic comment')",[editableComment,org,nativeB,authorAUser,digestCommunity,authorA]);
await db.query("insert into academy_content_mentions(academy_community_id,actor_member_id,mentioned_member_id,comment_id) values($1,$2,$3,$4)",[digestCommunity,authorA,digestMember,editableComment]);
const editableDelivery=(await db.query("select id from academy_email_deliveries where recipient_member_id=$1 and payload->>'commentId'=$2",[digestMember,editableComment])).rows[0].id;
const editLock=uuid();await db.query("select * from claim_academy_email_deliveries(100,$1)",[editLock]);
await db.query("update community_comments set body='Current synthetic comment' where id=$1",[editableComment]);
await db.query("select set_config('request.jwt.claim.sub',$1,false)",[authorBUser]);
await db.query("update community_posts set title='Current synthetic title',body='Current synthetic body' where id=$1",[nativeB]);
const editPrepared=(await db.query("select * from prepare_academy_email_delivery($1,$2)",[editableDelivery,editLock])).rows[0];
eq(editPrepared.payload.excerpt,'Current synthetic comment');eq(editPrepared.detail,'Current synthetic title');
await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
await db.query("select admin_remove_community_comment($1)",[editableComment]);
eq((await db.query("select * from prepare_academy_email_delivery($1,$2)",[editableDelivery,editLock])).rows.length,0);
eq(await count("id=$1 and status='cancelled'",[editableDelivery]),1);
await db.query("select set_config('request.jwt.claim.sub',$1,false)",[authorAUser]);
const blockedParentComment=uuid();
await db.query("insert into community_comments(id,organization_id,post_id,author_id,academy_community_id,academy_author_id,body) values($1,$2,$3,$4,$5,$6,'Another synthetic comment')",[blockedParentComment,org,nativeB,authorAUser,digestCommunity,authorA]);
await db.query("insert into academy_content_mentions(academy_community_id,actor_member_id,mentioned_member_id,comment_id) values($1,$2,$3,$4)",[digestCommunity,authorA,digestMember,blockedParentComment]);
const blockedParentDelivery=(await db.query("select id from academy_email_deliveries where recipient_member_id=$1 and payload->>'commentId'=$2",[digestMember,blockedParentComment])).rows[0].id;
const parentLock=uuid();await db.query("select * from claim_academy_email_deliveries(100,$1)",[parentLock]);
await db.query("insert into academy_member_blocks(academy_community_id,blocker_member_id,blocked_member_id) values($1,$2,$3)",[digestCommunity,digestMember,authorB]);
eq((await db.query("select * from prepare_academy_email_delivery($1,$2)",[blockedParentDelivery,parentLock])).rows.length,0);
eq(await count("id=$1 and status='cancelled'",[blockedParentDelivery]),1);
await db.query("delete from academy_member_blocks where academy_community_id=$1 and blocker_member_id=$2",[digestCommunity,digestMember]);
for(const signature of ['queue_academy_lifecycle_email(uuid,uuid,text,text,text,text,text,uuid,jsonb)','prepare_academy_email_delivery(uuid,uuid)','claim_academy_email_deliveries(integer,uuid)']) {
 eq((await db.query("select has_function_privilege('anon',$1,'execute') allowed",[signature])).rows[0].allowed,false);
 eq((await db.query("select has_function_privilege('authenticated',$1,'execute') allowed",[signature])).rows[0].allowed,false);
}
eq((await db.query("select relrowsecurity from pg_class where relname='academy_email_cutover'")).rows[0].relrowsecurity,true);
await db.close();console.log(`Community email SQL: ${assertions} behavioral assertions passed against all repository migrations in isolated PostgreSQL.`);
