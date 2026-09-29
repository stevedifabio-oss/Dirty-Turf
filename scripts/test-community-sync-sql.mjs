// Isolated PostgreSQL execution: no hosted database or email provider access.
// PGLITE_MODULE=/path/to/pglite/dist/index.js node scripts/test-community-sync-sql.mjs
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
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
const owner=uuid(),other=uuid(),community=uuid(),author=uuid(),cfg=uuid();
await db.query('insert into auth.users(id,email) values($1,$2)',[owner,'sync-owner@example.com']);
const org=(await db.query('select id from organizations where created_by=$1',[owner])).rows[0].id;
await db.query("insert into academy_communities(id,owner_organization_id,name,slug,portal_url) values($1,$2,'Test','sync','https://example.com')",[community,org]);
await db.query("insert into academy_members(id,academy_community_id,user_id,display_name) values($1,$2,$3,'Test Author')",[author,community,owner]);
await db.query("insert into academy_member_links(academy_community_id,academy_member_id,external_contact_id) values($1,$2,'author')",[community,author]);
await db.query("insert into academy_community_sync_configs(id,academy_community_id,location_id,group_id,enabled) values($1,$2,'location','group',true)",[cfg,community]);
await db.exec("update private.academy_email_cutover set enabled=true,enabled_at=now()");
let assertions=0;const eq=(a,b)=>{assert.deepEqual(a,b);assertions++;};
const time=n=>new Date(Date.UTC(2026,0,1,0,0,n)).toISOString();
let n=0;const event=(extra={})=>({schemaVersion:1,eventId:'event-'+(++n),locationId:'location',groupId:'group',entity:'post',operation:'upsert',externalId:'post',sourceUpdatedAt:time(n),sourceCreatedAt:time(0),title:'Source post',body:'Source body',authorExternalId:'author',...extra});
const apply=async e=>(await db.query('select apply_academy_community_event($1,$2) r',[cfg,JSON.stringify(e)])).rows[0].r;
const row=async(table,ext)=>(await db.query(`select * from ${table} where external_id=$1`,[ext])).rows[0];
const count=async table=>Number((await db.query(`select count(*) n from ${table}`)).rows[0].n);
const del=(entity,externalId,t,postExternalId)=>({schemaVersion:1,eventId:'delete-'+(++n),locationId:'location',groupId:'group',entity,operation:'delete',externalId,sourceUpdatedAt:time(t),...(postExternalId?{postExternalId}:{})});
const first=event({media:[{type:'source-asset',url:'https://example.com/image.jpg'}]});
eq((await apply(first)).status,'applied');const post=await row('community_posts','post');
eq((await apply(first)).status,'duplicate');eq(await count('community_posts'),1);eq(await count('academy_email_deliveries'),0);
// Source versions, edit identity and attachment omission.
const edit=event({body:'Edited source body'});eq((await apply(edit)).status,'applied');eq((await row('community_posts','post')).id,post.id);eq((await row('community_posts','post')).media,first.media);
eq((await apply({...first,eventId:'old-delivery'})).status,'stale');
eq((await apply({...edit,eventId:'same-version-different',body:'Unexpected rewrite'})).status,'conflict');
await assert.rejects(apply({...first,body:'Reused event attack'}),/Event identity reused/);assertions++;
// Preserve already mirrored private assets when same source URL returns.
await db.exec(`begin;select set_config('app.academy_community_sync','on',true);update community_posts set media='[{"type":"source-asset","url":"https://example.com/image.jpg","storage_bucket":"academy-private","storage_path":"copy.jpg","content_hash":"abc"}]' where external_id='post';commit;`);
eq((await apply(event({media:first.media}))).status,'applied');eq((await row('community_posts','post')).media[0].storage_path,'copy.jpg');
// Child delivered before parent is retained pending then applies to stable parent.
const reply=event({entity:'comment',externalId:'reply',postExternalId:'post',parentExternalId:'comment',body:'Nested reply'});
eq((await apply(reply)).status,'pending');eq(await count('community_comments'),0);
const comment=event({entity:'comment',externalId:'comment',postExternalId:'post',body:'Source comment'});delete comment.title;
eq((await apply(comment)).status,'applied');eq((await db.query('select retry_academy_community_events($1) r',[cfg])).rows[0].r.applied,1);eq((await apply(reply)).status,'duplicate');
const parent=await row('community_comments','comment');eq((await row('community_comments','reply')).parent_id,parent.id);eq(await count('academy_email_deliveries'),0);
// Cyclic reply trees and cross-post moves reject atomically.
await assert.rejects(apply(event({entity:'comment',externalId:'comment',postExternalId:'post',parentExternalId:'reply',body:'Cycle'})),/parent cycle/);assertions++;
await assert.rejects(apply(event({entity:'comment',externalId:'reply',postExternalId:'wrong-post',body:'Move'})),/post cannot change/);assertions++;
// Actual service role can execute the worker under default hosted table grants.
await db.exec('set role service_role');eq((await apply(event({externalId:'service-role-post'}))).status,'applied');await db.exec('reset role');
// Explicit complete empty media removes source attachments; omission did not.
eq((await apply(event({externalId:'service-role-post',media:[]}))).status,'applied');eq((await row('community_posts','service-role-post')).media,[]);
// Missing author does not create a member or widen access.
const missing=event({externalId:'unknown-author',authorExternalId:'missing'});eq((await apply(missing)).status,'pending');eq(await count('academy_members'),1);
const cross=event({entity:'comment',externalId:'cross',postExternalId:'other-post',parentExternalId:'comment',body:'Wrong parent'});eq((await apply(cross)).status,'pending');
// Moderation overrides win against both source edits and source deletes.
await db.query("update community_posts set body='Local moderation' where id=$1",[post.id]);eq((await row('community_posts','post')).sync_owner,'local');
eq((await apply(event())).status,'conflict');eq((await apply(del('post','post',50))).status,'conflict');eq((await row('community_posts','post')).body,'Local moderation');
// Non-destructive source deletion preserves local replies; delayed create is stale.
const fresh=event({externalId:'removable',sourceUpdatedAt:time(51)});eq((await apply(fresh)).status,'applied');const freshPost=await row('community_posts','removable');
const pc=event({entity:'comment',externalId:'removable-comment',postExternalId:'removable',body:'Source parent',sourceUpdatedAt:time(52)});eq((await apply(pc)).status,'applied');const pcRow=await row('community_comments','removable-comment');
await db.query("insert into community_comments(organization_id,academy_community_id,academy_author_id,post_id,parent_id,body) values($1,$2,$3,$4,$5,'Local reply')",[org,community,author,freshPost.id,pcRow.id]);
const before=await count('community_comments');eq((await apply(del('comment','removable-comment',53,'removable'))).status,'applied');eq((await row('community_comments','removable-comment')).body,'[Comment removed]');eq(await count('community_comments'),before);
eq((await apply(del('post','removable',54))).status,'applied');eq((await row('community_posts','removable')).status,'archived');eq(await count('community_comments'),before);eq((await apply({...fresh,eventId:'late-create'})).status,'stale');
// A delete received before create must still reserve the source identity.
eq((await apply(del('post','never-seen',55))).status,'applied');eq((await apply(event({externalId:'never-seen',sourceUpdatedAt:time(54)}))).status,'stale');eq(await row('community_posts','never-seen'),undefined);
// Local hard delete reserves identity even if no earlier source event state exists.
const batch=uuid();await db.query("insert into source_import_batches(id,academy_community_id,status) values($1,$2,'imported')",[batch,community]);
const imported=uuid();await db.query("insert into community_posts(id,organization_id,academy_community_id,academy_author_id,title,body,external_id,source_provider,source_import_batch_id,source_updated_at) values($1,$2,$3,$4,'Imported','Original content','imported','highlevel',$5,$6)",[imported,org,community,author,batch,time(56)]);
await db.query("insert into source_import_records(batch_id,academy_community_id,record_type,external_id,content_hash,payload,imported_id,imported_table) values($1,$2,'post','imported',repeat('a',64),$3,$4,'community_posts')",[batch,community,JSON.stringify({title:'Imported',body:'Original content',authorExternalId:'author'}),imported]);
// The archived manifest can carry storage metadata from the same mirrored URL.
const archivedMedia=[{type:'source-asset',url:'https://example.com/archive.jpg',storage_bucket:'academy-assets',storage_path:'old/path'}];
await db.exec("begin; select set_config('app.academy_community_sync','on',true)");
await db.query('update community_posts set media=$1 where id=$2',[JSON.stringify([{...archivedMedia[0],storage_path:'new/path'}]),imported]);
await db.exec('commit');
await db.query("update source_import_records set payload=payload || jsonb_build_object('media',$1::jsonb) where imported_id=$2",[JSON.stringify(archivedMedia),imported]);
eq((await db.query('select enroll_academy_community_sync($1) r',[cfg])).rows[0].r.posts,1);eq((await row('community_posts','imported')).sync_owner,'highlevel');
eq((await apply(event({externalId:'imported',sourceUpdatedAt:time(55)}))).status,'stale');eq((await row('community_posts','imported')).body,'Original content');
await db.query('delete from community_posts where id=$1',[imported]);eq((await apply(event({externalId:'imported',sourceUpdatedAt:time(57)}))).status,'conflict');eq(await row('community_posts','imported'),undefined);
// Untouched import enrolls; previously changed import remains local.
const changed=uuid();await db.query("insert into community_posts(id,organization_id,academy_community_id,academy_author_id,title,body,external_id,source_provider,source_import_batch_id) values($1,$2,$3,$4,'Imported','Locally changed','changed','highlevel',$5)",[changed,org,community,author,batch]);
await db.query("insert into source_import_records(batch_id,academy_community_id,record_type,external_id,content_hash,payload,imported_id,imported_table) values($1,$2,'post','changed',repeat('a',64),$3,$4,'community_posts')",[batch,community,JSON.stringify({title:'Imported',body:'Original content',authorExternalId:'author'}),changed]);
eq((await db.query('select enroll_academy_community_sync($1) r',[cfg])).rows[0].r.posts,0);eq((await row('community_posts','changed')).sync_owner,'local');
// Existing imported comments exercise enrollment aliases and preserve reply parents.
const importedParent=uuid(),importedReply=uuid();
for (const [id,ext,parentId,parentExt] of [[importedParent,'imported-parent',null,null],[importedReply,'imported-reply',importedParent,'imported-parent']]) {
 await db.query("insert into community_comments(id,organization_id,academy_community_id,academy_author_id,post_id,parent_id,body,external_id,source_provider,source_import_batch_id,source_updated_at) values($1,$2,$3,$4,$5,$6,'Imported comment',$7,'highlevel',$8,$9)",[id,org,community,author,post.id,parentId,ext,batch,time(56)]);
 await db.query("insert into source_import_records(batch_id,academy_community_id,record_type,external_id,content_hash,payload,imported_id,imported_table) values($1,$2,'comment',$3,repeat('c',64),$4,$5,'community_comments')",[batch,community,ext,JSON.stringify({body:'Imported comment',authorExternalId:'author',postExternalId:'post',parentExternalId:parentExt}),id]);
}
eq((await db.query('select enroll_academy_community_sync($1) r',[cfg])).rows[0].r.comments,2);
eq((await row('community_comments','imported-reply')).parent_id,importedParent);
eq((await apply(event({entity:'comment',externalId:'imported-reply',postExternalId:'post',sourceUpdatedAt:time(55),body:'Delayed'}))).status,'stale');

// Worker scope is restored before a later local mutation in the SAME transaction.
await db.exec('begin');const transactionPost=event({externalId:'same-transaction',sourceUpdatedAt:time(58)});eq((await apply(transactionPost)).status,'applied');await db.exec("update community_posts set body='Local edit immediately after sync' where external_id='same-transaction'");await db.exec('commit');eq((await row('community_posts','same-transaction')).sync_owner,'local');
await db.exec('begin');await db.exec("select set_config('app.academy_community_sync','off',true)");await db.query('select enroll_academy_community_sync($1)',[cfg]);eq((await db.query("select current_setting('app.academy_community_sync',true) v")).rows[0].v,'off');await db.exec('commit');
await assert.rejects(db.query('select retry_academy_community_events($1,101)',[cfg]));assertions++;
// Validation and tenant scope failures make no partial event/state writes.
const eventsBefore=await count('academy_community_sync_events');await assert.rejects(apply(event({groupId:'foreign'})));assertions++;await assert.rejects(apply(event({body:'x'})));assertions++;eq(await count('academy_community_sync_events'),eventsBefore);
// Private ingress, RPCs, and deletion guard are not public APIs.
for(const role of ['anon','authenticated']) {
 for(const fn of ['apply_academy_community_event(uuid,jsonb)','enroll_academy_community_sync(uuid)','retry_academy_community_events(uuid,integer)']) eq((await db.query('select has_function_privilege($1,$2,\'execute\') p',[role,fn])).rows[0].p,false);
 for(const table of ['academy_community_sync_configs','academy_community_sync_events','academy_community_sync_state','academy_community_sync_inbox']) eq((await db.query('select has_table_privilege($1,$2,\'select\') p',[role,table])).rows[0].p,false);
}
for(const table of ['academy_community_sync_configs','academy_community_sync_events','academy_community_sync_state','academy_community_sync_inbox']) eq((await db.query('select relrowsecurity p from pg_class where relname=$1',[table])).rows[0].p,true);
await db.close();console.log(`Community sync SQL: ${assertions} assertions passed in isolated PostgreSQL.`);
