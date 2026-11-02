// Actual repository migrations in isolated PostgreSQL; no hosted database or Storage calls.
// PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node scripts/test-course-visibility-sql.mjs
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz default now(),banned_until timestamptz,deleted_at timestamptz);
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
try {
const uuid = () => crypto.randomUUID();
let assertions = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); assertions++; };
const rejects = async (action, code, message) => { await assert.rejects(action, { code }, message); assertions++; };
const owner=uuid(), memberUser=uuid(), outsider=uuid(), member=uuid(), community=uuid();
for (const id of [owner,memberUser,outsider]) await db.query('insert into auth.users(id,email) values($1,$2)',[id,id+'@example.test']);
const org=(await db.query('select id from organizations where created_by=$1',[owner])).rows[0].id;
await db.query("insert into academy_communities(id,owner_organization_id,name,slug,portal_url) values($1,$2,'Order test','order-test','https://example.test')",[community,org]);
await db.query("insert into academy_members(id,academy_community_id,user_id,display_name,status,role) values($1,$2,$3,'Member','active','member')",[member,community,memberUser]);
await db.query("insert into academy_access_grants(academy_community_id,academy_member_id,source_type,source_key) values($1,$2,'manual','order-test')",[community,member]);
const course=uuid(), otherCourse=uuid(), a=uuid(), b=uuid(), hidden=uuid(), archived=uuid(), otherModule=uuid();
for (const id of [course,otherCourse]) await db.query("insert into courses(id,organization_id,academy_community_id,title,status,access_type,external_id) values($1::uuid,$2,$3,'Course','published','open',$1::text)",[id,org,community]);
for (const [id,cid,position,visibility,archivedAt] of [[a,course,0,'published',null],[b,course,1,'published',null],[hidden,course,2,'draft',null],[archived,course,3,'published','2026-09-28'],[otherModule,otherCourse,0,'published',null]]) {
  await db.query("insert into course_modules(id,course_id,title,sort_order,sync_owner,source_visibility,source_archived_at) values($1,$2,'Module',$3,'highlevel',$4,$5)",[id,cid,position,visibility,archivedAt]);
}
const one=uuid(), two=uuid(), three=uuid(), hiddenLesson=uuid();
for (const [id,mid,position] of [[one,a,0],[two,a,1],[three,b,0],[hiddenLesson,hidden,0]]) await db.query("insert into course_lessons(id,module_id,title,status,sort_order,sync_owner,body,video_url,resources) values($1,$2,'Lesson','published',$3,'highlevel','{\"html\":\"original body\"}','https://example.test/video.mp4','[\"resource\"]')",[id,mid,position]);
await db.query('insert into academy_member_lesson_progress(academy_member_id,lesson_id,progress_percent) values($1,$2,65)',[member,two]);
const as=async(role,user,query,params=[])=>{
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user??'']);
  await db.exec(`set role ${role}`);
  try { return (await db.query(query,params)).rows; } finally { await db.exec('reset role'); }
};
const order = async () => {
  const modules=(await db.query('select id,sort_order from course_modules where course_id=$1 order by sort_order,id',[course])).rows;
  for (const module of modules) {
    module.sortOrder=module.sort_order; delete module.sort_order;
    module.lessons=(await db.query('select id,sort_order as "sortOrder" from course_lessons where module_id=$1 order by sort_order,id',[module.id])).rows;
  }
  return modules;
};
const clone = value => structuredClone(value);
const save = (original,next,user=owner,role='authenticated') => as(role,user,'select public.save_academy_course_order($1,$2::jsonb,$3::jsonb)',[course,JSON.stringify(original),JSON.stringify(next)]);
const original=await order();
const beforeContent=(await db.query('select id,title,body,video_url,resources,status from course_lessons order by id')).rows;
const next=clone(original);
next.splice(0,2,next[1],next[0]); next[0].sortOrder=0; next[1].sortOrder=1;
next[0].lessons.push(next[1].lessons.pop()); next[0].lessons[1].sortOrder=1;
await rejects(()=>save(original,next,memberUser),'42501','member cannot save order');
await rejects(()=>save(original,next,outsider),'42501','other organization cannot save order');
await rejects(()=>save(original,next,null,'anon'),'42501','anon cannot execute order API');
eq(await order(),original,'unauthorized calls make no changes');
await save(original,next);
eq(await order(),next,'atomic reorder and same-course lesson move saved');
eq((await db.query('select id,title,body,video_url,resources,status from course_lessons order by id')).rows,beforeContent,'content, status, media and resources preserved');
eq((await db.query('select progress_percent from academy_member_lesson_progress where lesson_id=$1',[two])).rows[0].progress_percent,65,'lesson progress survives a move');
eq((await db.query('select sync_owner from course_lessons where id=$1',[two])).rows[0].sync_owner,'local','moved lesson becomes locally owned');
eq((await db.query('select sync_owner from course_lessons where id=$1',[one])).rows[0].sync_owner,'highlevel','untouched lesson remains source-owned');
eq((await db.query('select sync_owner from course_modules where id=$1',[hidden])).rows[0].sync_owner,'highlevel','hidden module stays source-owned');
await rejects(()=>save(original,original),'40001','stale original cannot overwrite another save');

const invalid=clone(next); invalid[0].lessons[0].id=one;
await rejects(()=>save(next,invalid),'22023','duplicate lesson rejected');
const missing=clone(next); missing[0].lessons.pop();
await rejects(()=>save(next,missing),'22023','omitted lesson rejected');
const crossCourse=clone(next); crossCourse[0].id=otherModule;
await rejects(()=>save(next,crossCourse),'22023','cross-course destination rejected');
const reveal=clone(next); reveal[2].sortOrder=4; reveal[3].sortOrder=5;
await rejects(()=>save(next,reveal),'22023','hidden source module cannot become local through order changes');
const hiddenMove=clone(next); hiddenMove[0].lessons.push(hiddenMove[2].lessons.pop()); hiddenMove[0].lessons[2].sortOrder=2;
await rejects(()=>save(next,hiddenMove),'22023','hidden source lesson cannot be moved into visible module');
const archiveMove=clone(next); archiveMove[3].lessons.push(archiveMove[0].lessons.pop()); archiveMove[3].lessons[0].sortOrder=0;
await rejects(()=>save(next,archiveMove),'22023','cannot move lesson into source-archived module');
const malformed=clone(next); malformed[0].lessons=null;
await rejects(()=>save(next,malformed),'22023','invalid JSON structure rejected');
eq(await order(),next,'all failed operations roll back without partial writes');
// Existing imported IDs remain unique inside their destination module. A late
// constraint failure must also undo module updates earlier in this transaction.
await db.query("update course_lessons set external_id='same-import-id' where id=any($1::uuid[])",[[one,three]]);
const colliding=clone(next);
colliding.splice(0,2,colliding[1],colliding[0]); colliding[0].sortOrder=0; colliding[1].sortOrder=1;
colliding[1].lessons.push(colliding[0].lessons.pop()); colliding[1].lessons[2].sortOrder=2;
await rejects(()=>save(next,colliding),'23505','destination imported identity collision rejects move');
eq(await order(),next,'late lesson constraint failure also rolls back earlier module updates');
const visible = await as('authenticated',memberUser,'select id from course_lessons order by id');
eq(visible.some(row=>row.id===hiddenLesson),false,'hidden lesson remains unreadable to members');
eq((await db.query("select prosecdef from pg_proc where oid='public.save_academy_course_order(uuid,jsonb,jsonb)'::regprocedure")).rows[0].prosecdef,false,'RPC runs as caller under RLS');
console.log(`Course ordering SQL: ${assertions} assertions passed in isolated PostgreSQL. No hosted schema or content was changed.`);
} finally { await db.close(); }
