// Isolated PostgreSQL execution. No network or hosted database access.
// PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js node scripts/test-course-sync-sql.mjs
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role;create schema private;
create type public.content_status as enum('draft','published','archived');
create table academy_communities(id uuid primary key,owner_organization_id uuid);
create table courses(id uuid primary key default gen_random_uuid(),organization_id uuid,academy_community_id uuid,external_id text,source_provider text,title text,description text,cover_url text,instructor_name text,status content_status,updated_at timestamptz default now(),source_import_batch_id uuid,source_updated_at timestamptz,access_type text default 'open',price_cents integer,required_level integer);
create table course_modules(id uuid primary key default gen_random_uuid(),course_id uuid references courses(id),external_id text,title text,sort_order integer,group_title text,drip_after_days integer,source_import_batch_id uuid,source_updated_at timestamptz);
create table course_lessons(id uuid primary key default gen_random_uuid(),module_id uuid references course_modules(id),external_id text,title text,sort_order integer,status content_status,lesson_type text,body jsonb,video_url text,resources jsonb,updated_at timestamptz default now(),source_import_batch_id uuid,source_updated_at timestamptz,unique(module_id,external_id));
create table academy_member_lesson_progress(lesson_id uuid references course_lessons(id),progress_percent integer);
create table course_enrollments(course_id uuid references courses(id),status text);
`);
await db.exec(await readFile(new URL('../supabase/migrations/20260928165732_academy_course_sync.sql',import.meta.url),'utf8'));
const community='00000000-0000-0000-0000-000000000001',config='00000000-0000-0000-0000-000000000002';
await db.query('insert into academy_communities values ($1,$1)',[community]);
await db.query("insert into academy_course_sync_configs(id,academy_community_id,location_id,course_ids,enabled) values($1,$2,'location',array['course'],true)",[config,community]);
const snapshot=()=>({version:1,complete:true,location_id:'location',course_ids:['course'],courses:[{external_id:'course',title:'Training',description:'Body',cover_url:null,instructor_name:'Steve',modules:[{external_id:'m1',title:'One',status:'published',sort_order:0,group_title:null,drip_after_days:0},{external_id:'m2',title:'Two',status:'published',sort_order:1,group_title:null,drip_after_days:0}],lessons:[{external_id:'l1',module_external_id:'m1',title:'Lesson',sort_order:0,status:'published',lesson_type:'guide',body:{html:'First'}}]}]});
const begin=async()=> (await db.query('select begin_academy_course_sync($1) as r',[config])).rows[0].r;
const apply=async(run,s,hash)=> (await db.query('select apply_academy_course_sync($1,$2,$3) as r',[run,JSON.stringify(s),hash.repeat(64)])).rows[0].r;
const fail=run=>db.query("select fail_academy_course_sync($1,'test_failure')",[run]);
let assertions=0;function eq(a,b){assert.deepEqual(a,b);assertions++;}
let run=await begin();eq((await begin()).skipped,'busy');
eq((await apply(run.run_id,snapshot(),'a')).status,'succeeded');
const lesson=(await db.query('select * from course_lessons')).rows[0],course=(await db.query('select * from courses')).rows[0];
await db.query('insert into academy_member_lesson_progress values($1,100)',[lesson.id]);await db.query("insert into course_enrollments values($1,'completed')",[course.id]);
let changed=snapshot();changed.courses[0].lessons[0].module_external_id='m2';changed.courses[0].lessons[0].body.html='Changed';run=await begin();await apply(run.run_id,changed,'b');
let current=(await db.query('select * from course_lessons')).rows[0];eq(current.id,lesson.id);eq(current.body.html,'Changed');eq(current.module_id,(await db.query("select id from course_modules where external_id='m2'")).rows[0].id);eq((await db.query('select progress_percent from academy_member_lesson_progress')).rows[0].progress_percent,100);eq((await db.query('select status from course_enrollments')).rows[0].status,'completed');
run=await begin();eq((await apply(run.run_id,changed,'b')).status,'unchanged');
let broken=structuredClone(changed);broken.courses[0].title='MUST ROLLBACK';broken.courses[0].lessons[0].module_external_id='missing';run=await begin();await assert.rejects(apply(run.run_id,broken,'c'));assertions++;await fail(run.run_id);eq((await db.query('select title from courses')).rows[0].title,'Training');
let deleted=snapshot();deleted.courses[0].lessons=[];run=await begin();await apply(run.run_id,deleted,'d');eq((await db.query('select status from course_lessons')).rows[0].status,'archived');eq((await db.query('select count(*)::integer n from academy_member_lesson_progress')).rows[0].n,1);
run=await begin();await apply(run.run_id,changed,'e');eq((await db.query('select status from course_lessons')).rows[0].status,'published');
await db.query("update course_lessons set title='Local edit' where id=$1",[lesson.id]);eq((await db.query('select sync_owner from course_lessons')).rows[0].sync_owner,'local');run=await begin();await apply(run.run_id,snapshot(),'f');eq((await db.query('select title from course_lessons')).rows[0].title,'Local edit');
run=await begin();await assert.rejects(apply(run.run_id,{...snapshot(),complete:false},'0'));assertions++;await fail(run.run_id);
run=await begin();await assert.rejects(apply(run.run_id,{...snapshot(),course_ids:['other']},'0'));assertions++;await fail(run.run_id);
run=await begin();await db.exec("update academy_course_sync_configs set lock_until=now()-interval '1 minute'");await assert.rejects(apply(run.run_id,snapshot(),'0'));assertions++;const retry=await begin();eq((await db.query('select status from academy_course_sync_runs where id=$1',[run.run_id])).rows[0].status,'abandoned');await fail(retry.run_id);
eq((await db.query("select has_function_privilege('anon','apply_academy_course_sync(uuid,jsonb,text)','execute') p")).rows[0].p,false);eq((await db.query("select has_function_privilege('authenticated','begin_academy_course_sync(uuid)','execute') p")).rows[0].p,false);eq((await db.query("select relrowsecurity from pg_class where relname='academy_course_sync_configs'")).rows[0].relrowsecurity,true);
// A new stable source lesson can switch video/quiz/text without obsolete playback.
let media=snapshot();media.courses[0].lessons=[{...media.courses[0].lessons[0],external_id:'media',lesson_type:'video',body:{html:'<video src="https://example.com/a.mp4"></video>',sourceVideoUrl:'https://example.com/a.mp4'}}];run=await begin();await apply(run.run_id,media,'1');eq((await db.query("select video_url from course_lessons where external_id='media'")).rows[0].video_url,'https://example.com/a.mp4');
media.courses[0].lessons[0].lesson_type='quiz';media.courses[0].lessons[0].body={html:'',quiz:{questions:[]}};run=await begin();await apply(run.run_id,media,'2');let typed=(await db.query("select * from course_lessons where external_id='media'")).rows[0];eq(typed.lesson_type,'quiz');eq(typed.video_url,null);
media.courses[0].lessons[0].lesson_type='guide';media.courses[0].lessons[0].body={html:'Guide'};run=await begin();await apply(run.run_id,media,'3');typed=(await db.query("select * from course_lessons where external_id='media'")).rows[0];eq(typed.lesson_type,'guide');eq(typed.body.quiz,undefined);
// Source module drafts are persisted and empty retired source modules are hidden.
media.courses[0].modules[0].status='draft';run=await begin();await apply(run.run_id,media,'4');eq((await db.query("select source_visibility from course_modules where external_id='m1'")).rows[0].source_visibility,'draft');
media.courses[0].modules=[];media.courses[0].lessons=[];run=await begin();await apply(run.run_id,media,'5');eq((await db.query("select source_archived_at is not null archived from course_modules where external_id='m1'")).rows[0].archived,true);
// These are the exact semantic columns written by Admin Studio. Protect a local
// multimedia lesson without stopping updates to untouched source-owned lessons.
let owned=snapshot();owned.courses[0].lessons=[
 {...owned.courses[0].lessons[0],external_id:'local-media'},
 {...owned.courses[0].lessons[0],external_id:'still-source',sort_order:1,body:{html:'Original source text'}},
];run=await begin();await apply(run.run_id,owned,'6');
const ownedLesson=(await db.query("select id from course_lessons where external_id='local-media'")).rows[0].id;
const localBody={contentBlocks:[{id:'text',type:'text',text:'Steve local instructions'},{id:'video',type:'video',url:'academy-asset:verified-local-video',caption:'Local demonstration'},{id:'photo',type:'image',url:'academy-asset:verified-local-image',alt:'Local equipment',caption:''},{id:'link',type:'link',url:'https://example.com/checklist.pdf',label:'Checklist'}],html:'Steve local multimedia'};
const localResources=[{title:'Local PDF',url:'academy-asset:verified-local-pdf'}];
await db.query("update course_lessons set title='Steve lesson',body=$2::jsonb,video_url='academy-asset:verified-local-video',resources=$3::jsonb where id=$1",[ownedLesson,JSON.stringify(localBody),JSON.stringify(localResources)]);
eq((await db.query('select sync_owner from course_lessons where id=$1',[ownedLesson])).rows[0].sync_owner,'local');
owned.courses[0].lessons[0].title='GHL overwrite attempt';owned.courses[0].lessons[0].body={html:'GHL replacement'};
owned.courses[0].lessons[1].body={html:'Legitimate fresh GHL text'};
run=await begin();await apply(run.run_id,owned,'7');
let preserved=(await db.query('select title,body,video_url,resources from course_lessons where id=$1',[ownedLesson])).rows[0];
eq(preserved.title,'Steve lesson');eq(preserved.body,localBody);eq(preserved.video_url,'academy-asset:verified-local-video');eq(preserved.resources,localResources);
eq((await db.query("select body from course_lessons where external_id='still-source'")).rows[0].body,{html:'Legitimate fresh GHL text'});
// Editing a module's title/section owns that module, while untouched lessons can
// continue receiving their own source updates.
await db.query("update course_modules set title='Steve module',group_title='Local section' where external_id='m1'");
eq((await db.query("select sync_owner from course_modules where external_id='m1'")).rows[0].sync_owner,'local');
owned.courses[0].modules[0].title='GHL module overwrite';owned.courses[0].lessons[1].body={html:'Another fresh GHL lesson'};
run=await begin();await apply(run.run_id,owned,'8');
eq((await db.query("select title,group_title from course_modules where external_id='m1'")).rows[0],{title:'Steve module',group_title:'Local section'});
eq((await db.query("select body from course_lessons where external_id='still-source'")).rows[0].body,{html:'Another fresh GHL lesson'});
// Course access/pricing is a local admin decision. Taking ownership of its
// settings intentionally holds further whole-course source replacements.
await db.query("update courses set title='Steve course',access_type='purchase',price_cents=14995,required_level=null where id=$1",[course.id]);
eq((await db.query('select sync_owner from courses where id=$1',[course.id])).rows[0].sync_owner,'local');
owned.courses[0].title='GHL course overwrite';owned.courses[0].lessons[1].body={html:'Held after local course takeover'};
// This fixture has only one enrolled source course. Once Steve takes ownership
// of that whole course, the worker deliberately holds its empty source-owned
// baseline instead of silently enrolling local content back into GHL ownership.
run=await begin();await assert.rejects(apply(run.run_id,owned,'9'),/No enrolled source-owned courses/);assertions++;await fail(run.run_id);
eq((await db.query('select title,access_type,price_cents,required_level from courses where id=$1',[course.id])).rows[0],{title:'Steve course',access_type:'purchase',price_cents:14995,required_level:null});
eq((await db.query("select body from course_lessons where external_id='still-source'")).rows[0].body,{html:'Another fresh GHL lesson'});
eq((await db.query('select progress_percent from academy_member_lesson_progress')).rows[0].progress_percent,100);eq((await db.query('select status from course_enrollments')).rows[0].status,'completed');
await db.close();console.log(`Course sync SQL: ${assertions} assertions passed in isolated PostgreSQL.`);
