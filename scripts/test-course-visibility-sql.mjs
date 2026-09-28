// Actual repository migrations in isolated PostgreSQL; no hosted database or Storage calls.
// PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node scripts/test-course-visibility-sql.mjs
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$ select current_user::text $$;
create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key,bucket_id text,name text,owner uuid);
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
const owner=uuid(), memberUser=uuid(), outsider=uuid(), staff=uuid(), community=uuid(), member=uuid();
for(const id of [owner,memberUser,outsider,staff]) await db.query('insert into auth.users(id,email) values($1,$2)',[id,id+'@example.test']);
const org=(await db.query('select id from organizations where created_by=$1',[owner])).rows[0].id;
await db.query("insert into organization_members(organization_id,user_id,role) values($1,$2,'operator')",[org,staff]);
await db.query("insert into academy_communities(id,owner_organization_id,name,slug,portal_url) values($1,$2,'Visibility test','visibility-test','https://example.test')",[community,org]);
await db.query("insert into academy_members(id,academy_community_id,user_id,display_name,status,role) values($1,$2,$3,'Member','active','member')",[member,community,memberUser]);
await db.query("insert into academy_access_grants(academy_community_id,academy_member_id,source_type,source_key) values($1,$2,'manual','visibility-test')",[community,member]);
const course=uuid(), hiddenCourse=uuid();
for(const [id,status] of [[course,'published'],[hiddenCourse,'draft']]) await db.query("insert into courses(id,organization_id,academy_community_id,title,status,access_type,external_id) values($1::uuid,$2,$3,'Training',$4,'open',$1::text)",[id,org,community,status]);
const publicModule=uuid(), draftModule=uuid(), archivedModule=uuid(), localModule=uuid(), hiddenCourseModule=uuid();
for(const [id,cid,visibility,archived,ownership] of [[publicModule,course,'published',null,'highlevel'],[draftModule,course,'draft',null,'highlevel'],[archivedModule,course,'published','2026-09-28T00:00:00Z','highlevel'],[localModule,course,'draft',null,'local'],[hiddenCourseModule,hiddenCourse,'published',null,'highlevel']]) {
 await db.query("insert into course_modules(id,course_id,title,sync_owner,source_visibility,source_archived_at) values($1,$2,'Module',$3,$4,$5)",[id,cid,ownership,visibility,archived]);
}
const published=uuid(),draft=uuid(),archived=uuid(),hiddenParent=uuid(),retiredParent=uuid(),localOverride=uuid(),hiddenCourseLesson=uuid();
const lessonFixtures=[[published,publicModule,'published'],[draft,publicModule,'draft'],[archived,publicModule,'archived'],[hiddenParent,draftModule,'published'],[retiredParent,archivedModule,'published'],[localOverride,localModule,'published'],[hiddenCourseLesson,hiddenCourseModule,'published']];
for(const [id,mid,status] of lessonFixtures) await db.query("insert into course_lessons(id,module_id,title,status,external_id,body) values($1::uuid,$2,'Lesson',$3,$1::text,'{\"html\":\"private lesson body\"}')",[id,mid,status]);
const objectNames=new Map();
for(const [id] of lessonFixtures) {
 const cid=id===hiddenCourseLesson?hiddenCourse:course;
 const path=`${community}/${cid}/${id}.mp4`;objectNames.set(id,path);
 await db.query("insert into academy_assets(id,academy_community_id,course_id,lesson_id,title,asset_type,storage_bucket,storage_path) values($1,$2,$3,$1,'Video','video','academy-assets',$4)",[id,community,cid,path]);
 await db.query("insert into storage.objects(id,bucket_id,name) values($1,'academy-assets',$2)",[id,path]);
}
const shared=uuid(),orphan=uuid(),unrelated=uuid();
const sharedPath=`${community}/shared/handbook.pdf`,orphanPath=`${community}/${course}/unregistered.mp4`;
await db.query("insert into academy_assets(id,academy_community_id,title,asset_type,storage_bucket,storage_path) values($1,$2,'Handbook','pdf','academy-assets',$3)",[shared,community,sharedPath]);
for(const [id,bucket,path] of [[shared,'academy-assets',sharedPath],[orphan,'academy-assets',orphanPath],[unrelated,'unrelated-bucket','document.pdf']]) await db.query('insert into storage.objects(id,bucket_id,name) values($1,$2,$3)',[id,bucket,path]);
// Show the new restrictive guard leaves an unrelated bucket's existing policy alone.
await db.exec("create policy test_unrelated_read on storage.objects for select to authenticated using(bucket_id='unrelated-bucket')");
let assertions=0;
const eq=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);assertions++;};
const as=async(role,user,query,params=[])=>{
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user??'']);
 await db.exec(`set role ${role}`);
 try { return (await db.query(query,params)).rows; } catch(error) { error.message = `${role}: ${query}: ${error.message}`; throw error; } finally { await db.exec('reset role'); }
};
const ids=async(role,user,table)=> (await as(role,user,`select id from ${table} order by id`)).map(r=>r.id);
const sorted=a=>[...a].sort();
eq(await ids('authenticated',memberUser,'course_modules'),sorted([publicModule,localModule]),'member module visibility');
eq(await ids('authenticated',memberUser,'course_lessons'),sorted([published,localOverride]),'member direct lesson reads');
eq(await ids('authenticated',memberUser,'academy_assets'),sorted([published,localOverride,shared]),'member private asset catalog');
eq(await ids('authenticated',memberUser,'storage.objects'),sorted([published,localOverride,shared,unrelated]),'member Storage SELECT/sign eligibility');
for(const user of [outsider,staff]) {
 eq(await ids('authenticated',user,'course_modules'),[],'other user and legacy organization-member policy cannot bypass module access');
 eq(await ids('authenticated',user,'course_lessons'),[],'other user and legacy organization-member policy cannot bypass lesson access');
 eq(await ids('authenticated',user,'academy_assets'),[],'asset tenancy/access');
 eq(await ids('authenticated',user,'storage.objects'),[unrelated],'Storage tenancy/access');
}
for(const table of ['course_modules','course_lessons','academy_assets']) { await assert.rejects(ids('anon',null,table), {code:'42501'}); assertions++; }
eq(await ids('anon',null,'storage.objects'),[],'anonymous Storage access');
eq((await ids('authenticated',owner,'course_modules')).length,5,'admin can inspect draft/archived modules');
eq((await ids('authenticated',owner,'course_lessons')).length,7,'admin can inspect draft/archived lessons');
eq((await ids('authenticated',owner,'academy_assets')).length,8,'admin asset management');
eq((await ids('authenticated',owner,'storage.objects')).length,10,'admin can inspect orphan uploads');
eq((await as('authenticated',owner,"update course_lessons set title='Admin revised draft' where id=$1 returning id",[draft])).length,1,'admin draft editing retained');
eq((await as('authenticated',memberUser,"update course_lessons set title='Forbidden edit' where id=$1 returning id",[draft])).length,0,'member cannot update hidden lesson');
// Simulate an atomic sync retirement. Previously visible assets lose new signing eligibility.
await db.query("update course_lessons set status='archived' where id=$1",[published]);
eq(await ids('authenticated',memberUser,'course_lessons'),[localOverride],'retirement removes body access');
eq(await ids('authenticated',memberUser,'academy_assets'),sorted([localOverride,shared]),'retirement removes asset metadata access');
eq(await ids('authenticated',memberUser,'storage.objects'),sorted([localOverride,shared,unrelated]),'retirement removes direct Storage SELECT');
// Explicit course denial and inactive membership remain authoritative.
await db.query('insert into academy_course_access_denials(academy_member_id,course_id,academy_community_id) values($1,$2,$3)',[member,course,community]);
eq(await ids('authenticated',memberUser,'course_lessons'),[],'course denial');
eq(await ids('authenticated',memberUser,'storage.objects'),sorted([shared,unrelated]),'course denial preserves shared library');
await db.query("update academy_members set status='suspended' where id=$1",[member]);
eq(await ids('authenticated',memberUser,'academy_assets'),[],'suspended member');
eq(await ids('authenticated',memberUser,'storage.objects'),[unrelated],'suspended member storage');
for(const helper of ['private.can_read_academy_module(uuid)','private.can_read_academy_lesson(uuid)']) {
 eq((await db.query("select has_function_privilege('anon',$1,'execute') as allowed",[helper])).rows[0].allowed,false,'private helper inaccessible anonymously');
}
const guards=await db.query("select polname,polpermissive from pg_policy where polname in ('modules_visibility_guard','lessons_visibility_guard','academy_assets_lesson_visibility_guard','academy_storage_lesson_visibility_guard')");
eq(guards.rows.length,4,'all exact guard policies installed');eq(guards.rows.every(p=>!p.polpermissive),true,'guards must be restrictive');
await db.close();
console.log(`Course visibility SQL: ${assertions} assertions passed against ${migrations.length} actual migrations. Storage signing authorization tested through its SELECT policies; no live signing or delivery performed.`);
