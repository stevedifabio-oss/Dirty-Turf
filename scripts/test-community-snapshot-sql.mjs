// Isolated PostgreSQL execution: no hosted database or email provider access.
// PGLITE_MODULE=/path/to/pglite/dist/index.js node scripts/test-community-sync-sql.mjs
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { planCommunitySnapshot } from './lib/community-snapshot.mjs';
process.on('uncaughtException', e=>{console.error(e.message, e.where || '', e.query || '', e.stack?.split('\n').slice(-3).join('\n'));process.exit(1);});
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
alter default privileges in schema public grant all on tables to service_role;
create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$ select 'service_role'::text $$;
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
const owner=uuid(),community=uuid(),author=uuid(),cfg=uuid();
await db.query('insert into auth.users(id,email) values($1,$2)',[owner,'snapshot-owner@example.com']);
const org=(await db.query('select id from organizations where created_by=$1',[owner])).rows[0].id;
await db.query("insert into academy_communities(id,owner_organization_id,name,slug,portal_url) values($1,$2,'Snapshot','snapshot','https://example.com')",[community,org]);
await db.query("insert into academy_members(id,academy_community_id,user_id,display_name) values($1,$2,$3,'Author')",[author,community,owner]);
await db.query("insert into academy_member_links(academy_community_id,academy_member_id,external_contact_id) values($1,$2,'author')",[community,author]);
await db.query("insert into academy_community_sync_configs(id,academy_community_id,location_id,group_id,enabled) values($1,$2,'location','group',true)",[cfg,community]);
let assertions=0;const eq=(a,b)=>{assert.deepEqual(a,b);assertions++;};
const reject=async (fn,pattern)=>{await assert.rejects(fn,pattern);assertions++;};
const row=async(table,externalId)=>(await db.query(`select * from ${table} where external_id=$1`,[externalId])).rows[0];
const config={capabilities:{commentMedia:true,partialRecords:true,sourceFieldHolds:true,mediaOnlyComments:true},scope:{locationId:'location',groupId:'group'},identities:{authors:[{externalId:'author',handles:['author']}],categories:[]}};
const time=Date.now()-120000;
const capture=(n)=>({schemaVersion:1,source:'ghl-community-browser',captureId:'capture-'+n,scope:config.scope,
 observedStartedAt:new Date(time+n*1000).toISOString(),observedCompletedAt:new Date(time+n*1000+100).toISOString(),coverage:{posts:'complete',comments:'complete'},
 posts:[{externalId:'post',authorExternalId:'author',title:'Question',body:'Initial source',bodyComplete:true,commentsComplete:true,categoryExternalId:null,categoryComplete:true,pinnedComplete:true,pinned:false,mediaComplete:true,media:[{type:'image',url:'https://cdn.example.com/photo.jpg'}]}],
 comments:[{externalId:'comment',postExternalId:'post',parentExternalId:null,authorExternalId:'author',body:'Comment',bodyComplete:true,mediaComplete:true,media:[{type:'file',url:'https://cdn.example.com/guide.pdf',name:'Guide'}]},
 {externalId:'reply',postExternalId:'post',parentExternalId:'comment',authorExternalId:'author',body:'Reply',bodyComplete:true,mediaComplete:true,media:[]}]});
const begin=async (id)=> (await db.query('select begin_academy_community_snapshot($1,$2) r',[cfg,id])).rows[0].r;
const apply=async (id,token,plan)=> (await db.query('select apply_academy_community_snapshot($1,$2,$3,$4) r',[cfg,id,token,JSON.stringify(plan)])).rows[0].r;
let accepted=null;
async function run(n,mutate=()=>{}) { const input=capture(n);mutate(input);const lease=await begin(input.captureId); const plan=planCommunitySnapshot(lease.previousState,input,config);eq(plan.captureAccepted,true);const result=await apply(input.captureId,lease.leaseToken,plan);accepted=plan.nextState;return {input,lease,plan,result}; }
// Actual PostgreSQL hashes match the planner, including sorted Unicode keys/text.
const canonical={z:'Escape \n and “Unicode”',a:{b:2,a:[true,null,'é']}};
const hash=(await import('node:crypto')).createHash('sha256').update(JSON.stringify({a:{a:[true,null,'é'],b:2},z:canonical.z})).digest('hex');
eq((await db.query('select private.community_snapshot_hash($1) h',[canonical])).rows[0].h,hash);
const first=await run(1);eq(first.result.added,3);eq(first.result.conflicts,[]);
const post=await row('community_posts','post'),comment=await row('community_comments','comment'),reply=await row('community_comments','reply');
eq(comment.media,[{type:'file',url:'https://cdn.example.com/guide.pdf',name:'Guide'}]);eq(reply.parent_id,comment.id);eq(comment.post_id,post.id);
eq(post.source_updated_at,null);eq(comment.source_created_at,null);eq((await db.query('select count(*) n from academy_email_deliveries')).rows[0].n,0);
eq((await apply('capture-1',first.lease.leaseToken,first.plan)).status,'duplicate');
const altered=structuredClone(first.plan);altered.nextState.records[0].content.body='Tampered';await reject(()=>apply('capture-1',first.lease.leaseToken,altered),/Capture identity reused/);
eq((await begin('capture-1')).status,'duplicate');
// Reaction rows and app-local replies survive all source edits.
await db.query('insert into academy_post_reactions(post_id,academy_member_id) values($1,$2)',[post.id,author]);
await db.query("insert into community_comments(organization_id,academy_community_id,academy_author_id,post_id,parent_id,body) values($1,$2,$3,$4,$5,'Local reply')",[org,community,author,post.id,comment.id]);
const second=await run(2,s=>{s.posts[0].body='Edited source';s.comments[0].body='Edited comment';});eq(second.result.updated,2);eq((await row('community_posts','post')).id,post.id);eq((await row('community_comments','comment')).id,comment.id);
eq((await db.query('select count(*) n from academy_post_reactions where post_id=$1',[post.id])).rows[0].n,1);eq((await db.query("select count(*) n from community_comments where body='Local reply'")).rows[0].n,1);
// Metadata enrichment does not alter content ownership/fingerprint; retained by URL.
await db.exec("select set_config('app.academy_community_sync','on',false)");
await db.query("update community_posts set media=$1 where id=$2",[[{type:'image',url:'https://cdn.example.com/photo.jpg',storage_bucket:'academy-media',storage_path:'saved.jpg',mime_type:'image/jpeg'}],post.id]);
await db.exec("select set_config('app.academy_community_sync','off',false)");
const third=await run(3,s=>{s.posts[0].body='Media preserved';s.comments[0].body='Edited comment';});eq(third.result.updated,1);eq((await row('community_posts','post')).media[0].storage_path,'saved.jpg');
// Missing identities produce review only and never remove source or local comments.
const fourth=await run(4,s=>{s.posts[0].body='Media preserved';s.comments=[];});eq(fourth.result.missingReviewOnly.length,2);eq((await row('community_comments','comment')).body,'Edited comment');eq((await row('community_comments','reply')).parent_id,comment.id);
// Local moderator edit reserves the source identity and wins over later captures.
await db.query("update community_posts set body='Moderator corrected' where id=$1",[post.id]);
const fifth=await run(5,s=>{s.posts[0].body='Source edit after moderation';s.comments[0].body='Edited comment';});eq((await row('community_posts','post')).body,'Moderator corrected');eq(fifth.result.conflicts[0].reason,'local_edit_or_delete');
const sixth=await run(6,s=>{s.posts[0].body='Source edit after moderation';s.comments[0].body='Edited comment';});eq(sixth.result.conflicts[0].reason,'local_edit_or_delete');
// Busy lease, failed lease release and replay cannot overwrite a later observation.
const busy=await begin('capture-busy');eq(busy.status,'capturing');eq((await begin('capture-other')).status,'busy');
eq((await db.query('select renew_academy_community_snapshot($1,$2,$3) r',[cfg,'capture-busy',busy.leaseToken])).rows[0].r,true);
eq((await db.query('select fail_academy_community_snapshot($1,$2,$3,$4) r',[cfg,'capture-busy',busy.leaseToken,'reader_incomplete'])).rows[0].r,true);
eq((await db.query('select renew_academy_community_snapshot($1,$2,$3) r',[cfg,'capture-busy',busy.leaseToken])).rows[0].r,false);
const invalid=capture(7);invalid.captureId='capture-invalid';invalid.posts[0].body='Valid but rollback';const lease=await begin(invalid.captureId);const plan=planCommunitySnapshot(accepted,invalid,config);plan.changes[0].expectedPreviousContentHash='f'.repeat(64);
await reject(()=>apply(invalid.captureId,lease.leaseToken,plan),/Previous source hash mismatch/);eq((await row('community_posts','post')).body,'Moderator corrected');eq((await row('community_comments','comment')).body,'Edited comment');
await db.query('select fail_academy_community_snapshot($1,$2,$3,$4)',[cfg,invalid.captureId,lease.leaseToken,'invalid_plan']);
// Current-target fingerprint detects bypassed owner edits and versioned events.
await db.exec("select set_config('app.academy_community_sync','on',false)");await db.query("update community_comments set body='Separate source event' where id=$1",[comment.id]);await db.exec("select set_config('app.academy_community_sync','off',false)");
const target=await run(8,s=>{s.posts[0].body='Source edit after moderation';s.comments[0].body='Browser older comment';});eq(target.result.conflicts.find(r=>r.externalId==='comment').reason,'target_changed_since_capture');eq((await row('community_comments','comment')).body,'Separate source event');
// Deleting locally never resurrects a source record or cascades imported parents on replay.
await db.query('delete from community_comments where id=$1',[reply.id]);
const removed=await run(9,s=>{s.posts[0].body='Source edit after moderation';s.comments[0].body='Browser older comment';});eq(removed.result.conflicts.find(r=>r.externalId==='reply').reason,'local_edit_or_delete');eq(await row('community_comments','reply'),undefined);
// Access scope and privilege checks, unrelated tenant untouched.
const wrong=capture(10);wrong.captureId='wrong-scope';const wrongLease=await begin(wrong.captureId);const wrongPlan=planCommunitySnapshot(accepted,wrong,config);wrongPlan.nextState.scope.groupId='different-group';await reject(()=>apply(wrong.captureId,wrongLease.leaseToken,wrongPlan),/Invalid accepted allowlisted snapshot/);
await db.query('select fail_academy_community_snapshot($1,$2,$3,$4)',[cfg,wrong.captureId,wrongLease.leaseToken,'wrong_scope']);
const privileges=(await db.query("select has_function_privilege('authenticated','public.apply_academy_community_snapshot(uuid,text,uuid,jsonb)','execute') a,has_function_privilege('anon','public.begin_academy_community_snapshot(uuid,text,integer)','execute') b,has_table_privilege('authenticated','public.academy_community_snapshot_records','select') c,has_function_privilege('service_role','public.apply_academy_community_snapshot(uuid,text,uuid,jsonb)','execute') d")).rows[0];eq(privileges,{a:false,b:false,c:false,d:true});
// Context provides reconciled IDs without leaking a lease token or bypassing roles.
const context=(await db.query('select get_academy_community_snapshot_context($1,$2) r',[cfg,'capture-1'])).rows[0].r;
eq(context.identities,{authors:[{externalId:'author'}],categories:[]});eq(context.capabilities.commentMedia,true);eq(context.run.status,'applied');eq(context.run.captureHash,first.plan.nextState.captureHash);eq(JSON.stringify(context).includes('leaseToken'),false);
eq((await db.query('select get_academy_community_snapshot_context($1,$2,$3) r',[cfg,'capture-1',first.lease.leaseToken])).rows[0].r.run.status,'applied');
eq((await db.query("select has_function_privilege('authenticated','public.get_academy_community_snapshot_context(uuid,text,uuid)','execute') p")).rows[0].p,false);
// A SQL error midway through processing rolls back every prior write in the batch.
const crash=capture(11);crash.captureId='capture-crash';crash.posts.push({...crash.posts[0],externalId:'atomic-post',title:'Atomic post',body:'Must rollback'});
const crashLease=await begin(crash.captureId);const crashPlan=planCommunitySnapshot(accepted,crash,config);
crashPlan.nextState.records.find(r=>r.externalId==='comment').source.sourceCreatedAt='infinity';
await reject(()=>apply(crash.captureId,crashLease.leaseToken,crashPlan),/Invalid source creation time/);eq(await row('community_posts','atomic-post'),undefined);
await db.query('select fail_academy_community_snapshot($1,$2,$3,$4)',[cfg,crash.captureId,crashLease.leaseToken,'invalid_source_time']);
// Versioned explicit deletion/attachment events remain idempotent and soft; they never delete local replies.
const event={schemaVersion:1,eventId:'verified-media',locationId:'location',groupId:'group',entity:'comment',operation:'upsert',externalId:'versioned-comment',postExternalId:'post',parentExternalId:null,sourceUpdatedAt:'2026-10-03T01:00:00.000Z',authorExternalId:'author',body:'Versioned attachment',media:[{type:'image',url:'https://cdn.example.com/comment.png'}]};
const eventApply=async e=>(await db.query('select apply_academy_community_event($1,$2) r',[cfg,e])).rows[0].r;
eq((await eventApply(event)).status,'applied');eq((await row('community_comments','versioned-comment')).media,event.media);
eq((await eventApply({...event,eventId:'verified-edit',sourceUpdatedAt:'2026-10-03T01:01:00.000Z',body:'Edited attachment',media:undefined})).status,'applied');eq((await row('community_comments','versioned-comment')).media,event.media);
eq((await eventApply({...event,eventId:'verified-delete',sourceUpdatedAt:'2026-10-03T01:02:00.000Z',operation:'delete'})).status,'applied');eq((await row('community_comments','versioned-comment')).media,[]);eq((await row('community_comments','versioned-comment')).body,'[Comment removed]');
// First observations safely adopt rows enrolled from an older import, keeping dates/IDs.
await db.exec("select set_config('app.academy_community_sync','on',false)");
await db.query("insert into community_posts(organization_id,academy_community_id,academy_author_id,external_id,source_provider,sync_owner,title,body,source_created_at,source_updated_at,created_at) values($1,$2,$3,'legacy-post','highlevel','highlevel','Legacy','Imported old body','2025-01-01Z','2025-01-02Z','2025-01-01Z')",[org,community,author]);
const legacy=await row('community_posts','legacy-post');
await db.query("insert into academy_community_sync_state(config_id,entity,external_id,row_id,source_version) values($1,'post','legacy-post',$2,'2025-01-02Z')",[cfg,legacy.id]);
await db.exec("select set_config('app.academy_community_sync','off',false)");
const adoption=await run(12,s=>{s.posts.push({...s.posts[0],externalId:'legacy-post',title:'Legacy',body:'Updated on source'});});
const adopted=await row('community_posts','legacy-post');eq(adopted.id,legacy.id);eq(adopted.created_at,legacy.created_at);eq(adopted.source_created_at,legacy.source_created_at);eq(adopted.source_updated_at,legacy.source_updated_at);eq(adopted.body,'Updated on source');
// Superseded/expired leases cannot replay stale browser observations.
const expired=await begin('capture-expired');await db.query("update academy_community_sync_configs set snapshot_lease_until=now()-interval '1 second' where id=$1",[cfg]);
const newer=await begin('capture-newer');eq(newer.status,'capturing');eq(newer.observationSequence>expired.observationSequence,true);
const expiredInput=capture(13);expiredInput.captureId='capture-expired';const expiredPlan=planCommunitySnapshot(accepted,expiredInput,config);
await reject(()=>apply('capture-expired',expired.leaseToken,expiredPlan),/Capture lease lost/);
eq((await db.query("select status from academy_community_snapshot_runs where capture_id='capture-expired'")).rows[0].status,'superseded');
await db.query('select fail_academy_community_snapshot($1,$2,$3,$4)',[cfg,'capture-newer',newer.leaseToken,'reader_incomplete']);
// Service invokes the functions with actual table/RLS privileges, without definer elevation.
await db.exec('set role service_role');
eq((await db.query('select get_academy_community_snapshot_context($1) r',[cfg])).rows[0].r.scope,config.scope);
const serviceCapture=capture(14);serviceCapture.captureId='capture-service';const serviceLease=await begin(serviceCapture.captureId);
const servicePlan=planCommunitySnapshot(serviceLease.previousState,serviceCapture,config);
eq((await apply(serviceCapture.captureId,serviceLease.leaseToken,servicePlan)).status,'partial');
await db.exec('reset role');
// Partial capture: preserve every held target and retry the same source hash when complete.
const partialCommunity=uuid(),partialAuthor=uuid(),partialCfg=uuid();
await db.query("insert into academy_communities(id,owner_organization_id,name,slug,portal_url) values($1,$2,'Partial','partial','https://example.com')",[partialCommunity,org]);
await db.query("insert into academy_members(id,academy_community_id,user_id,display_name) values($1,$2,$3,'Partial Author')",[partialAuthor,partialCommunity,owner]);
await db.query("insert into academy_member_links(academy_community_id,academy_member_id,external_contact_id) values($1,$2,'author')",[partialCommunity,partialAuthor]);
await db.query("insert into academy_community_sync_configs(id,academy_community_id,location_id,group_id,enabled) values($1,$2,'partial-location','partial-group',true)",[partialCfg,partialCommunity]);
const partialConfig={...config,scope:{locationId:'partial-location',groupId:'partial-group'}};
const partialBegin=async id=>(await db.query('select begin_academy_community_snapshot($1,$2) r',[partialCfg,id])).rows[0].r;
const partialApply=async(id,token,plan)=>(await db.query('select apply_academy_community_snapshot($1,$2,$3,$4) r',[partialCfg,id,token,plan])).rows[0].r;
const partialCapture=n=>({...capture(n),captureId:'partial-'+n,scope:partialConfig.scope});
let partialPrevious=null;
const held=[{entity:'post',externalId:'post',reason:'unobserved_media'},{entity:'comment',externalId:'comment',reason:'held_post'},{entity:'comment',externalId:'reply',reason:'held_parent'}];
async function partialRun(n,holds=[],mutate=()=>{}){const input=partialCapture(n);mutate(input);const lease=await partialBegin(input.captureId);const plan=planCommunitySnapshot(lease.previousState,input,partialConfig);eq(plan.captureAccepted,true);plan.held=holds;plan.nextState.held=holds;const result=await partialApply(input.captureId,lease.leaseToken,plan);partialPrevious=plan.nextState;return{input,lease,plan,result};}
const withheld=await partialRun(20,held);eq(withheld.result.status,'partial');eq(withheld.result.fullSync,false);eq(withheld.result.held,held);eq(withheld.result.conflicts,[]);eq(withheld.result.added,0);
eq((await db.query('select count(*) n from community_posts where academy_community_id=$1',[partialCommunity])).rows[0].n,0);
eq((await db.query('select status,target_fingerprint,error_code from academy_community_snapshot_records where config_id=$1 and entity=$2',[partialCfg,'post'])).rows[0],{status:'conflict',target_fingerprint:null,error_code:'unobserved_media'});
const recovered=await partialRun(21);eq(recovered.plan.changes,[]);eq(recovered.result.status,'applied');eq(recovered.result.fullSync,true);eq(recovered.result.added,3);
const partialPost=(await db.query('select * from community_posts where academy_community_id=$1',[partialCommunity])).rows[0];
// Hold an existing post even when its source hash is unchanged; storage metadata and IDs survive.
const beforeHeld=(await db.query("select target_fingerprint from academy_community_snapshot_records where config_id=$1 and entity='post'",[partialCfg])).rows[0].target_fingerprint;
const heldExisting=await partialRun(22,held);eq(heldExisting.result.unchanged,0);eq((await db.query("select target_fingerprint from academy_community_snapshot_records where config_id=$1 and entity='post'",[partialCfg])).rows[0].target_fingerprint,beforeHeld);
const recoveredExisting=await partialRun(23);eq(recoveredExisting.plan.changes,[]);eq(recoveredExisting.result.updated,3);eq((await db.query('select id from community_posts where academy_community_id=$1',[partialCommunity])).rows[0].id,partialPost.id);
// A held known identity cannot smuggle a destructive relationship change or unknown reason.
const invalidHeldInput=partialCapture(24);const invalidHeldLease=await partialBegin(invalidHeldInput.captureId);const invalidHeldPlan=planCommunitySnapshot(partialPrevious,invalidHeldInput,partialConfig);invalidHeldPlan.held=[{entity:'post',externalId:'post',reason:'delete_everything'}];
await reject(()=>partialApply(invalidHeldInput.captureId,invalidHeldLease.leaseToken,invalidHeldPlan),/Invalid held source identity/);
invalidHeldPlan.held=[{entity:'post',externalId:'missing',reason:'unobserved_media'}];await reject(()=>partialApply(invalidHeldInput.captureId,invalidHeldLease.leaseToken,invalidHeldPlan),/Invalid held source identity/);
invalidHeldPlan.held=[held[0],held[0]];await reject(()=>partialApply(invalidHeldInput.captureId,invalidHeldLease.leaseToken,invalidHeldPlan),/Invalid held source identity/);
await db.query('select fail_academy_community_snapshot($1,$2,$3,$4)',[partialCfg,invalidHeldInput.captureId,invalidHeldLease.leaseToken,'invalid_held']);
const partialContext=(await db.query('select get_academy_community_snapshot_context($1) r',[partialCfg])).rows[0].r;eq(partialContext.capabilities,{commentMedia:true,partialRecords:true,sourceFieldHolds:true,mediaOnlyComments:true});
// Actual planner holds an unmapped stable source author and its dependent comments.
const unknownCapture=partialCapture(25);
unknownCapture.posts.push({...unknownCapture.posts[0],externalId:'unknown-post',authorExternalId:'unknown-source-member',title:'Unmapped source author'});
unknownCapture.comments.push({...unknownCapture.comments[0],externalId:'unknown-comment',postExternalId:'unknown-post',parentExternalId:null});
const unknownLease=await partialBegin(unknownCapture.captureId);const unknownPlan=planCommunitySnapshot(unknownLease.previousState,unknownCapture,partialConfig);
eq(unknownPlan.captureAccepted,true);eq(unknownPlan.held.find(r=>r.externalId==='unknown-post').reason,'unknown_author');eq(unknownPlan.held.find(r=>r.externalId==='unknown-comment').reason,'held_post');
const unknownResult=await partialApply(unknownCapture.captureId,unknownLease.leaseToken,unknownPlan);eq(unknownResult.status,'partial');eq(unknownResult.fullSync,false);eq(await row('community_posts','unknown-post'),undefined);
// Reconciled independent ID mapping releases the prior hold despite unchanged source hash.
const linkedMember=uuid();await db.query("insert into academy_members(id,academy_community_id,display_name) values($1,$2,'Reconciled member')",[linkedMember,partialCommunity]);
await db.query("insert into academy_member_links(academy_community_id,academy_member_id,external_contact_id) values($1,$2,'unknown-source-member')",[partialCommunity,linkedMember]);
const mappedConfig=structuredClone(partialConfig);mappedConfig.identities.authors.push({externalId:'unknown-source-member'});
const mappedCapture={...unknownCapture,captureId:'partial-26',observedStartedAt:partialCapture(26).observedStartedAt,observedCompletedAt:partialCapture(26).observedCompletedAt};
const mappedLease=await partialBegin(mappedCapture.captureId);const mappedPlan=planCommunitySnapshot(mappedLease.previousState,mappedCapture,mappedConfig);eq(mappedPlan.changes,[]);eq(mappedPlan.held,[]);
const mappedResult=await partialApply(mappedCapture.captureId,mappedLease.leaseToken,mappedPlan);eq(mappedResult.status,'applied');eq(mappedResult.added,2);eq((await row('community_posts','unknown-post')).academy_author_id,linkedMember);
// Unknown media on a previously applied row holds that row and retains every attachment.
const mediaCapture={...mappedCapture,captureId:'partial-27',observedStartedAt:partialCapture(27).observedStartedAt,observedCompletedAt:partialCapture(27).observedCompletedAt,posts:mappedCapture.posts.map(p=>p.externalId==='post'?{...p,mediaComplete:false,media:undefined}:p)};
const mediaLease=await partialBegin(mediaCapture.captureId);const mediaPlan=planCommunitySnapshot(mediaLease.previousState,mediaCapture,mappedConfig);eq(mediaPlan.held.find(r=>r.externalId==='post').reason,'unobserved_media');
const mediaResult=await partialApply(mediaCapture.captureId,mediaLease.leaseToken,mediaPlan);eq(mediaResult.status,'partial');eq((await db.query('select media from community_posts where id=$1',[partialPost.id])).rows[0].media,partialPost.media);
// A missing row carries the prior unresolved field hold; absence never releases it.
const missingCapture={...mediaCapture,captureId:'partial-28',observedStartedAt:partialCapture(28).observedStartedAt,observedCompletedAt:partialCapture(28).observedCompletedAt,posts:mediaCapture.posts.filter(p=>p.externalId!=='post'),comments:mediaCapture.comments.filter(c=>c.postExternalId!=='post')};
const missingLease=await partialBegin(missingCapture.captureId);const missingPlan=planCommunitySnapshot(missingLease.previousState,missingCapture,mappedConfig);eq(missingPlan.held.find(r=>r.externalId==='post').reason,'unobserved_media');
const badMissingPlan=structuredClone(missingPlan);badMissingPlan.held=[];badMissingPlan.nextState.held=[];
await reject(()=>partialApply(missingCapture.captureId,missingLease.leaseToken,badMissingPlan),/Missing source hold cannot be released/);
const missingResult=await partialApply(missingCapture.captureId,missingLease.leaseToken,missingPlan);eq(missingResult.status,'partial');eq(missingResult.fullSync,false);
// Unknown stable source channel is held without moving content to a public fallback.
const categoryCapture={...mappedCapture,captureId:'partial-29',observedStartedAt:partialCapture(29).observedStartedAt,observedCompletedAt:partialCapture(29).observedCompletedAt,posts:mappedCapture.posts.map(p=>p.externalId==='unknown-post'?{...p,categoryExternalId:'unmapped-source-channel'}:p)};
const categoryLease=await partialBegin(categoryCapture.captureId);const categoryPlan=planCommunitySnapshot(categoryLease.previousState,categoryCapture,mappedConfig);eq(categoryPlan.captureAccepted,true);eq(categoryPlan.held.find(r=>r.externalId==='unknown-post').reason,'unknown_category');
const categoryResult=await partialApply(categoryCapture.captureId,categoryLease.leaseToken,categoryPlan);eq(categoryResult.status,'partial');eq((await row('community_posts','unknown-post')).category_id,null);
// Unobserved actual author IDs are represented as unknown, never invented aliases.
const authorMissingCapture={...mappedCapture,captureId:'partial-30',observedStartedAt:partialCapture(30).observedStartedAt,observedCompletedAt:partialCapture(30).observedCompletedAt,comments:[...mappedCapture.comments,{externalId:'unobserved-author-comment',postExternalId:'post',parentExternalId:null,authorComplete:false,body:'Source text remains exact',bodyComplete:true,mediaComplete:true,media:[]}]};
const authorMissingLease=await partialBegin(authorMissingCapture.captureId);const authorMissingPlan=planCommunitySnapshot(authorMissingLease.previousState,authorMissingCapture,mappedConfig);eq(authorMissingPlan.captureAccepted,true);
const unknownRecord=authorMissingPlan.nextState.records.find(r=>r.externalId==='unobserved-author-comment');eq(unknownRecord.authorComplete,false);eq(Object.hasOwn(unknownRecord.content,'authorExternalId'),false);eq(unknownRecord.unobservedFields.includes('authorExternalId'),true);
const unheldAuthor=structuredClone(authorMissingPlan);unheldAuthor.held=[];unheldAuthor.nextState.held=[];await reject(()=>partialApply(authorMissingCapture.captureId,authorMissingLease.leaseToken,unheldAuthor),/Unobserved author must be held/);
const missingAuthorAnnotation=structuredClone(unheldAuthor);delete missingAuthorAnnotation.nextState.records.find(r=>r.externalId==='unobserved-author-comment').authorComplete;
await reject(()=>partialApply(authorMissingCapture.captureId,authorMissingLease.leaseToken,missingAuthorAnnotation),/Invalid snapshot record/);
const authorMissingResult=await partialApply(authorMissingCapture.captureId,authorMissingLease.leaseToken,authorMissingPlan);eq(authorMissingResult.status,'partial');eq(await row('community_comments','unobserved-author-comment'),undefined);
const authorResolvedCapture={...authorMissingCapture,captureId:'partial-31',observedStartedAt:partialCapture(31).observedStartedAt,observedCompletedAt:partialCapture(31).observedCompletedAt,comments:authorMissingCapture.comments.map(c=>c.externalId==='unobserved-author-comment'?{...c,authorComplete:true,authorExternalId:'author'}:c)};
const authorResolvedLease=await partialBegin(authorResolvedCapture.captureId);const authorResolvedPlan=planCommunitySnapshot(authorResolvedLease.previousState,authorResolvedCapture,mappedConfig);eq(authorResolvedPlan.held,[]);
eq((await partialApply(authorResolvedCapture.captureId,authorResolvedLease.leaseToken,authorResolvedPlan)).status,'applied');eq((await row('community_comments','unobserved-author-comment')).academy_author_id,partialAuthor);
// Unknown author on an existing comment retains its already verified owner and body.
const authorReheldCapture={...authorResolvedCapture,captureId:'partial-32',observedStartedAt:partialCapture(32).observedStartedAt,observedCompletedAt:partialCapture(32).observedCompletedAt,comments:authorResolvedCapture.comments.map(c=>c.externalId==='unobserved-author-comment'?{...c,authorComplete:false,authorExternalId:undefined,body:'Do not overwrite'}:c)};
const authorReheldLease=await partialBegin(authorReheldCapture.captureId);const authorReheldPlan=planCommunitySnapshot(authorReheldLease.previousState,authorReheldCapture,mappedConfig);
eq((await partialApply(authorReheldCapture.captureId,authorReheldLease.leaseToken,authorReheldPlan)).status,'partial');eq((await row('community_comments','unobserved-author-comment')).body,'Source text remains exact');eq((await row('community_comments','unobserved-author-comment')).academy_author_id,partialAuthor);
// Attachment-only source comments retain a real blank body with validated durable media.
const imageOnlyCapture={...authorResolvedCapture,captureId:'partial-33',observedStartedAt:partialCapture(33).observedStartedAt,observedCompletedAt:partialCapture(33).observedCompletedAt,comments:[...authorResolvedCapture.comments,{externalId:'image-only',postExternalId:'post',parentExternalId:null,authorExternalId:'author',body:'',bodyComplete:true,mediaComplete:true,media:[{type:'image',url:'https://cdn.example.com/source-only.jpg'}]},{externalId:'unknown-media-only',postExternalId:'post',parentExternalId:null,authorExternalId:'author',body:'',bodyComplete:true,mediaComplete:false}]};
const imageOnlyLease=await partialBegin(imageOnlyCapture.captureId);const imageOnlyPlan=planCommunitySnapshot(imageOnlyLease.previousState,imageOnlyCapture,mappedConfig);eq(imageOnlyPlan.captureAccepted,true);
eq((await partialApply(imageOnlyCapture.captureId,imageOnlyLease.leaseToken,imageOnlyPlan)).status,'partial');eq((await row('community_comments','image-only')).body,'');eq((await row('community_comments','image-only')).media,[{type:'image',url:'https://cdn.example.com/source-only.jpg'}]);eq(await row('community_comments','unknown-media-only'),undefined);
await reject(()=>db.query("insert into community_comments(organization_id,academy_community_id,academy_author_id,post_id,body,media) values($1,$2,$3,$4,'',$5)",[org,partialCommunity,partialAuthor,partialPost.id,[{type:'image',url:'https://cdn.example.com/local.jpg'}]]),/community_comments_body_check/);
// The same pending blank body becomes a real source media comment after attachment recovery.
const recoveredMediaCapture={...imageOnlyCapture,captureId:'partial-34',observedStartedAt:partialCapture(34).observedStartedAt,observedCompletedAt:partialCapture(34).observedCompletedAt,comments:imageOnlyCapture.comments.map(c=>c.externalId==='unknown-media-only'?{...c,mediaComplete:true,media:[{type:'video',url:'https://cdn.example.com/recovered.mp4'}]}:c)};
const recoveredMediaLease=await partialBegin(recoveredMediaCapture.captureId);const recoveredMediaPlan=planCommunitySnapshot(recoveredMediaLease.previousState,recoveredMediaCapture,mappedConfig);
eq((await partialApply(recoveredMediaCapture.captureId,recoveredMediaLease.leaseToken,recoveredMediaPlan)).status,'applied');eq((await row('community_comments','unknown-media-only')).body,'');eq((await row('community_comments','unknown-media-only')).media[0].type,'video');
// Body omission is explicit and held; an existing app body and all attachments remain untouched.
const noBodyCapture={...recoveredMediaCapture,captureId:'partial-35',observedStartedAt:partialCapture(35).observedStartedAt,observedCompletedAt:partialCapture(35).observedCompletedAt,comments:recoveredMediaCapture.comments.map(c=>{if(c.externalId!=='image-only')return c;const{body,...rest}=c;return{...rest,bodyComplete:false};})};
noBodyCapture.comments.push({externalId:'new-unknown-body',postExternalId:'post',parentExternalId:null,authorExternalId:'author',bodyComplete:false,mediaComplete:true,media:[]});
const noBodyLease=await partialBegin(noBodyCapture.captureId);const noBodyPlan=planCommunitySnapshot(noBodyLease.previousState,noBodyCapture,mappedConfig);eq(noBodyPlan.captureAccepted,true);eq(noBodyPlan.held.find(r=>r.externalId==='new-unknown-body').reason,'unobserved_body');
const unheldBody=structuredClone(noBodyPlan);unheldBody.held=[];unheldBody.nextState.held=[];await reject(()=>partialApply(noBodyCapture.captureId,noBodyLease.leaseToken,unheldBody),/Unobserved body must be held/);
eq((await partialApply(noBodyCapture.captureId,noBodyLease.leaseToken,noBodyPlan)).status,'partial');eq(await row('community_comments','new-unknown-body'),undefined);eq((await row('community_comments','image-only')).body,'');eq((await row('community_comments','image-only')).media[0].url,'https://cdn.example.com/source-only.jpg');
// Post bodies may also be unobservable; hold the post and every dependent reply.
const noPostBodyCapture={...recoveredMediaCapture,captureId:'partial-36',observedStartedAt:partialCapture(36).observedStartedAt,observedCompletedAt:partialCapture(36).observedCompletedAt,posts:recoveredMediaCapture.posts.map(p=>{if(p.externalId!=='post')return p;const{body,...rest}=p;return{...rest,bodyComplete:false};})};
noPostBodyCapture.posts.push({externalId:'new-unknown-post-body',authorExternalId:'author',title:'Source title',bodyComplete:false,commentsComplete:true,mediaComplete:true,media:[],categoryComplete:true,categoryExternalId:null,pinnedComplete:true,pinned:false});
noPostBodyCapture.comments.push({externalId:'unknown-post-body-comment',postExternalId:'new-unknown-post-body',parentExternalId:null,authorExternalId:'author',body:'Verified reply',bodyComplete:true,mediaComplete:true,media:[]});
const noPostBodyLease=await partialBegin(noPostBodyCapture.captureId);const noPostBodyPlan=planCommunitySnapshot(noPostBodyLease.previousState,noPostBodyCapture,mappedConfig);eq(noPostBodyPlan.captureAccepted,true);eq(noPostBodyPlan.held.find(r=>r.externalId==='post').reason,'unobserved_body');eq(noPostBodyPlan.held.find(r=>r.externalId==='comment').reason,'held_post');eq(noPostBodyPlan.held.find(r=>r.externalId==='reply').reason,'held_post');eq(noPostBodyPlan.held.find(r=>r.externalId==='unknown-post-body-comment').reason,'held_post');
const invalidPostBodyHold=structuredClone(noPostBodyPlan);invalidPostBodyHold.held.find(r=>r.externalId==='post').reason='empty_body';invalidPostBodyHold.nextState.held=invalidPostBodyHold.held;await reject(()=>partialApply(noPostBodyCapture.captureId,noPostBodyLease.leaseToken,invalidPostBodyHold),/Invalid held source identity/);
eq((await partialApply(noPostBodyCapture.captureId,noPostBodyLease.leaseToken,noPostBodyPlan)).status,'partial');eq((await db.query('select body,media from community_posts where id=$1',[partialPost.id])).rows[0],{body:partialPost.body,media:partialPost.media});eq(await row('community_posts','new-unknown-post-body'),undefined);eq(await row('community_comments','unknown-post-body-comment'),undefined);
// Preserve mirrored bytes for the exact known GHL asset through allowed display transforms.
const licenseBase='https://assetsdrm.clientclub.net/images/communities/lid_6ab52de750ca3dc70ee22366';
const gcsBase='https://assetsdrm.clientclub.net/images/communities/gcs_revex-communities-production/eqVZcs8fro8qiGD2sgoG/6a5ff7019b8d5f3bf162a694/posts/photo.jpg';
const mergedMedia=async(newUrl,oldUrl)=>(await db.query('select private.community_snapshot_media($1,$2) m',[[{type:'image',url:newUrl}],[{type:'image',url:oldUrl,storage_bucket:'academy-media',storage_path:'retained.webp',mime_type:'image/webp',byte_size:22,content_hash:'retained'}]])).rows[0].m[0];
for(const base of[licenseBase,gcsBase]){const merged=await mergedMedia(base+'?fmt=webp&qlt=90&rsz=fit',base+'?fmt=webp&qlt=85&wdt=960&hgt=640&rsz=fill');eq(merged.storage_path,'retained.webp');eq(merged.mime_type,'image/webp');eq(merged.url,base+'?fmt=webp&qlt=90&rsz=fit');}
eq((await mergedMedia(licenseBase+'?fmt=png',licenseBase)).storage_path,'retained.webp');
for(const[url,old]of[
 [licenseBase+'?fmt=webp&token=secret',licenseBase+'?fmt=webp'],
 [licenseBase+'?fmt=webp&fmt=png',licenseBase+'?fmt=webp'],
 [licenseBase+'?wdt=0',licenseBase+'?wdt=960'],
 [licenseBase+'?qlt=101',licenseBase+'?qlt=85'],
 [licenseBase+'#other',licenseBase],
 [licenseBase.replace('6ab52de750ca3dc70ee22366','6ab52de750ca3dc70ee22367'),licenseBase],
 [gcsBase.replace('/posts/','/comments/'),gcsBase],
 ['https://cdn.example.com/photo.jpg?fmt=webp','https://cdn.example.com/photo.jpg?fmt=png'],
 ['https://assetsdrm.clientclub.net.evil.example/images/communities/lid_6ab52de750ca3dc70ee22366?fmt=png',licenseBase],
 ])eq((await mergedMedia(url,old)).storage_path,undefined);
// Alias candidates never combine conflicting or complementary mirrored metadata.
const aliasMedia=async(newUrl,existing)=>(await db.query('select private.community_snapshot_media($1,$2) m',[[{type:'image',url:newUrl}],existing])).rows[0].m[0];
const assetA={type:'image',url:licenseBase+'?fmt=webp&qlt=85',storage_path:'a.webp',mime_type:'image/webp',content_hash:'a'};
const assetB={type:'image',url:licenseBase+'?fmt=png&qlt=90',storage_path:'b.png',mime_type:'image/png',content_hash:'b'};
const newAssetUrl=licenseBase+'?fmt=jpg&qlt=95';
eq(await aliasMedia(newAssetUrl,[assetA,assetB]),assetA);
const complementaryA={type:'image',url:assetA.url,mime_type:'image/webp'},complementaryB={type:'image',url:assetB.url,storage_path:'b.png'};
eq(await aliasMedia(newAssetUrl,[complementaryA,complementaryB]),complementaryA);
eq((await aliasMedia(newAssetUrl,[assetA,{...assetA,url:assetB.url}])).storage_path,'a.webp');
eq((await aliasMedia(assetA.url,[assetB,assetA])).storage_path,'a.webp');
eq(await aliasMedia(assetA.url,[assetA,{...assetB,url:assetA.url}]),assetA);
eq((await db.query('select private.community_snapshot_media_conflict($1,$2) c',[[{type:'image',url:newAssetUrl}],[assetA,assetB]])).rows[0].c,true);
eq((await db.query('select private.community_snapshot_media_conflict($1,$2) c',[[{type:'image',url:assetA.url}],[assetB,assetA]])).rows[0].c,false);
// A live source row with conflicting mirrors is held without changing body or media.
const mediaBeforeCapture={...noPostBodyCapture,captureId:'partial-37',observedStartedAt:partialCapture(37).observedStartedAt,observedCompletedAt:partialCapture(37).observedCompletedAt,posts:[...noPostBodyCapture.posts,{...capture(37).posts[0],externalId:'ambiguous-mirror-post',media:[{type:'image',url:assetA.url},{type:'image',url:assetB.url}]}]};
const mediaBeforeLease=await partialBegin(mediaBeforeCapture.captureId);const mediaBeforePlan=planCommunitySnapshot(mediaBeforeLease.previousState,mediaBeforeCapture,mappedConfig);eq(mediaBeforePlan.captureAccepted,true);await partialApply(mediaBeforeCapture.captureId,mediaBeforeLease.leaseToken,mediaBeforePlan);
const ambiguousPost=await row('community_posts','ambiguous-mirror-post');await db.exec("select set_config('app.academy_community_sync','on',false)");await db.query('update community_posts set media=$1 where id=$2',[[assetA,assetB],ambiguousPost.id]);await db.exec("select set_config('app.academy_community_sync','off',false)");
const mediaConflictCapture={...mediaBeforeCapture,captureId:'partial-38',observedStartedAt:partialCapture(38).observedStartedAt,observedCompletedAt:partialCapture(38).observedCompletedAt,posts:mediaBeforeCapture.posts.map(p=>p.externalId==='ambiguous-mirror-post'?{...p,body:'Should stay held',media:[{type:'image',url:newAssetUrl}]}:p)};
const mediaConflictLease=await partialBegin(mediaConflictCapture.captureId);const mediaConflictPlan=planCommunitySnapshot(mediaConflictLease.previousState,mediaConflictCapture,mappedConfig);eq(mediaConflictPlan.captureAccepted,true);const mediaConflictResult=await partialApply(mediaConflictCapture.captureId,mediaConflictLease.leaseToken,mediaConflictPlan);eq(mediaConflictResult.status,'partial');eq(mediaConflictResult.conflicts.find(r=>r.externalId==='ambiguous-mirror-post').reason,'ambiguous_media_metadata');eq((await row('community_posts','ambiguous-mirror-post')).body,ambiguousPost.body);eq((await row('community_posts','ambiguous-mirror-post')).media,[assetA,assetB]);
// Correct an old import's five post images to their actual two comment owners.
// Mirrors must be captured before the post's now-verified empty media is applied.
const equipmentPostId='6a8be38156dc05a848a0060f',equipmentCommentA='6a991c3b8aecfc465baa2dcd',equipmentCommentB='6a914e4f48b5e12293dfb7b4';
const equipmentAssets=[...Array.from({length:4},(_,i)=>({type:'image',url:licenseBase.slice(0,-1)+i+'?fmt=webp&qlt=85'})),{type:'image',url:gcsBase.replace('/posts/','/comments/').replace('photo.jpg','equipment.jpg')+'?fmt=webp&qlt=85'}];
const equipmentMirrors=equipmentAssets.map((a,i)=>({...a,storage_bucket:'academy-media',storage_path:'equipment-'+i+'.webp',mime_type:'image/webp',byte_size:i+11,content_hash:'equipment-'+i}));
const wrongOwnerCapture={...mediaConflictCapture,captureId:'partial-39',observedStartedAt:partialCapture(39).observedStartedAt,observedCompletedAt:partialCapture(39).observedCompletedAt,posts:[...mediaConflictCapture.posts,{...capture(39).posts[0],externalId:equipmentPostId,media:equipmentAssets}],comments:[...mediaConflictCapture.comments,...[equipmentCommentA,equipmentCommentB].map(externalId=>({externalId,postExternalId:equipmentPostId,parentExternalId:null,authorExternalId:'author',body:'Source comment',bodyComplete:true,mediaComplete:true,media:[]}))]};
const wrongOwnerLease=await partialBegin(wrongOwnerCapture.captureId);const wrongOwnerPlan=planCommunitySnapshot(wrongOwnerLease.previousState,wrongOwnerCapture,mappedConfig);eq(wrongOwnerPlan.captureAccepted,true);await partialApply(wrongOwnerCapture.captureId,wrongOwnerLease.leaseToken,wrongOwnerPlan);
const equipmentPost=await row('community_posts',equipmentPostId),equipmentOldA=await row('community_comments',equipmentCommentA),equipmentOldB=await row('community_comments',equipmentCommentB);
await db.exec("select set_config('app.academy_community_sync','on',false)");await db.query('update community_posts set media=$1 where id=$2',[equipmentMirrors,equipmentPost.id]);await db.exec("select set_config('app.academy_community_sync','off',false)");
// Neither another community's registration nor app-owned media may be borrowed.
await db.query("insert into community_posts(organization_id,academy_community_id,academy_author_id,external_id,source_provider,sync_owner,title,body,media) values($1,$2,$3,'other-group-mirror','highlevel','highlevel','Other group','Do not borrow',$4)",[org,community,author,[{...equipmentMirrors[0],storage_path:'cross-group.webp'}]]);
await db.query("insert into community_posts(organization_id,academy_community_id,academy_author_id,title,body,media) values($1,$2,$3,'Native media','Do not borrow',$4)",[org,partialCommunity,partialAuthor,[{...equipmentMirrors[0],storage_path:'native-only.webp'}]]);
const correctedAssets=equipmentAssets.map(a=>({...a,url:a.url.replace('qlt=85','qlt=90')}));
const correctOwnerCapture={...wrongOwnerCapture,captureId:'partial-40',observedStartedAt:partialCapture(40).observedStartedAt,observedCompletedAt:partialCapture(40).observedCompletedAt,posts:wrongOwnerCapture.posts.map(p=>p.externalId===equipmentPostId?{...p,media:[]}:p),comments:wrongOwnerCapture.comments.map(c=>c.externalId===equipmentCommentA?{...c,media:correctedAssets.slice(0,4)}:c.externalId===equipmentCommentB?{...c,media:correctedAssets.slice(4)}:c)};
const correctOwnerLease=await partialBegin(correctOwnerCapture.captureId);const correctOwnerPlan=planCommunitySnapshot(correctOwnerLease.previousState,correctOwnerCapture,mappedConfig);eq(correctOwnerPlan.captureAccepted,true);const correctOwnerResult=await partialApply(correctOwnerCapture.captureId,correctOwnerLease.leaseToken,correctOwnerPlan);eq(correctOwnerResult.conflicts.some(c=>[equipmentPostId,equipmentCommentA,equipmentCommentB].includes(c.externalId)),false);
eq((await row('community_posts',equipmentPostId)).media,[]);const correctA=await row('community_comments',equipmentCommentA),correctB=await row('community_comments',equipmentCommentB);eq(correctA.id,equipmentOldA.id);eq(correctB.id,equipmentOldB.id);eq([...correctA.media,...correctB.media].map(a=>a.storage_path),equipmentMirrors.map(a=>a.storage_path));eq([...correctA.media,...correctB.media].map(a=>a.url),correctedAssets.map(a=>a.url));eq([...correctA.media,...correctB.media].map(a=>a.mime_type),Array(5).fill('image/webp'));
eq((await db.query('select private.community_snapshot_media($1,$2,$3) m',[[{type:'image',url:newAssetUrl}],[assetA],[assetB]])).rows[0].m[0].storage_path,'a.webp');
// A SQL conflict without a target cannot retry from missing cached source data.
// The context's author mapping can disappear between planning and SQL apply.
const raceConfig=structuredClone(mappedConfig);raceConfig.identities.authors.push({externalId:'mapping-race-author'});
const conflictCapture={...correctOwnerCapture,captureId:'partial-41',observedStartedAt:partialCapture(41).observedStartedAt,observedCompletedAt:partialCapture(41).observedCompletedAt,posts:[...correctOwnerCapture.posts,{...capture(41).posts[0],externalId:'cached-conflict-post',authorExternalId:'mapping-race-author',body:'Real source read before mapping conflict'}]};
const conflictLease=await partialBegin(conflictCapture.captureId);const conflictPlan=planCommunitySnapshot(conflictLease.previousState,conflictCapture,raceConfig);eq(conflictPlan.captureAccepted,true);eq(conflictPlan.held.some(r=>r.externalId==='cached-conflict-post'),false);
const conflictResult=await partialApply(conflictCapture.captureId,conflictLease.leaseToken,conflictPlan);eq(conflictResult.conflicts.find(r=>r.externalId==='cached-conflict-post').reason,'unknown_or_ambiguous_author');eq(await row('community_posts','cached-conflict-post'),undefined);
const conflictBaseline=(await db.query("select * from academy_community_snapshot_records where config_id=$1 and external_id='cached-conflict-post'",[partialCfg])).rows[0];
const recoveredAuthor=uuid();await db.query("insert into academy_members(id,academy_community_id,display_name,status) values($1,$2,'Verified source author','pending')",[recoveredAuthor,partialCommunity]);await db.query("insert into academy_member_links(academy_community_id,academy_member_id,external_member_id) values($1,$2,'mapping-race-author')",[partialCommunity,recoveredAuthor]);
const absentCapture={...conflictCapture,captureId:'partial-42',observedStartedAt:partialCapture(42).observedStartedAt,observedCompletedAt:partialCapture(42).observedCompletedAt,posts:conflictCapture.posts.filter(p=>p.externalId!=='cached-conflict-post')};
const absentLease=await partialBegin(absentCapture.captureId);const absentPlan=planCommunitySnapshot(absentLease.previousState,absentCapture,raceConfig);eq(absentPlan.captureAccepted,true);eq(absentPlan.missing.some(r=>r.externalId==='cached-conflict-post'),true);
const invalidMissing=structuredClone(absentPlan);invalidMissing.missing.find(r=>r.externalId==='cached-conflict-post').action='delete';await reject(()=>partialApply(absentCapture.captureId,absentLease.leaseToken,invalidMissing),/Invalid missing review identity/);
const alteredMissing=structuredClone(absentPlan);alteredMissing.nextState.records.find(r=>r.externalId==='cached-conflict-post').source.sourceUrl='https://example.com/tampered-cache';await reject(()=>partialApply(absentCapture.captureId,absentLease.leaseToken,alteredMissing),/Invalid missing review identity/);
const absentResult=await partialApply(absentCapture.captureId,absentLease.leaseToken,absentPlan);eq(absentResult.status,'partial');eq(absentResult.fullSync,false);eq(await row('community_posts','cached-conflict-post'),undefined);eq((await db.query("select * from academy_community_snapshot_records where config_id=$1 and external_id='cached-conflict-post'",[partialCfg])).rows[0],conflictBaseline);
// A later actual fresh observation may retry the same source hash successfully.
const returnedCapture={...conflictCapture,captureId:'partial-43',observedStartedAt:partialCapture(43).observedStartedAt,observedCompletedAt:partialCapture(43).observedCompletedAt};const returnedLease=await partialBegin(returnedCapture.captureId);const returnedPlan=planCommunitySnapshot(returnedLease.previousState,returnedCapture,raceConfig);eq(returnedPlan.changes.some(r=>r.externalId==='cached-conflict-post'),false);await partialApply(returnedCapture.captureId,returnedLease.leaseToken,returnedPlan);eq((await row('community_posts','cached-conflict-post')).academy_author_id,recoveredAuthor);eq((await row('community_posts','cached-conflict-post')).body,'Real source read before mapping conflict');
// An existing conflicted target also stays untouched when its conflict resolves
// while the source row is absent. Metadata repair alone is not a fresh read.
const repairedMirrors=[assetA,{...assetA,url:assetB.url}];await db.exec("select set_config('app.academy_community_sync','on',false)");await db.query('update community_posts set media=$1 where id=$2',[repairedMirrors,ambiguousPost.id]);await db.exec("select set_config('app.academy_community_sync','off',false)");
const beforeAbsentTarget=(await db.query("select * from academy_community_snapshot_records where config_id=$1 and external_id='ambiguous-mirror-post'",[partialCfg])).rows[0];
const absentTargetCapture={...returnedCapture,captureId:'partial-44',observedStartedAt:partialCapture(44).observedStartedAt,observedCompletedAt:partialCapture(44).observedCompletedAt,posts:returnedCapture.posts.filter(p=>p.externalId!=='ambiguous-mirror-post')};const absentTargetLease=await partialBegin(absentTargetCapture.captureId);const absentTargetPlan=planCommunitySnapshot(absentTargetLease.previousState,absentTargetCapture,raceConfig);eq(absentTargetPlan.missing.some(r=>r.externalId==='ambiguous-mirror-post'),true);await partialApply(absentTargetCapture.captureId,absentTargetLease.leaseToken,absentTargetPlan);eq((await row('community_posts','ambiguous-mirror-post')).body,ambiguousPost.body);eq((await row('community_posts','ambiguous-mirror-post')).media,repairedMirrors);eq((await db.query("select * from academy_community_snapshot_records where config_id=$1 and external_id='ambiguous-mirror-post'",[partialCfg])).rows[0],beforeAbsentTarget);
const returnedTargetCapture={...returnedCapture,captureId:'partial-45',observedStartedAt:partialCapture(45).observedStartedAt,observedCompletedAt:partialCapture(45).observedCompletedAt};const returnedTargetLease=await partialBegin(returnedTargetCapture.captureId);const returnedTargetPlan=planCommunitySnapshot(returnedTargetLease.previousState,returnedTargetCapture,raceConfig);await partialApply(returnedTargetCapture.captureId,returnedTargetLease.leaseToken,returnedTargetPlan);eq((await row('community_posts','ambiguous-mirror-post')).body,'Should stay held');eq((await row('community_posts','ambiguous-mirror-post')).media[0].storage_path,'a.webp');
console.log(`Community snapshot SQL: ${assertions} assertions passed against ${migrations.length} actual migrations. No hosted writes.`);
await db.close();
