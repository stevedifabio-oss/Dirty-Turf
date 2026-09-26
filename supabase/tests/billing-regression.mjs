// Run with an isolated PGlite install; no database/service credentials needed.
// PGLITE_MODULE_PATH=/tmp/.../node_modules/@electric-sql/pglite/dist/index.js node supabase/tests/billing-regression.mjs
const { PGlite } = await import(process.env.PGLITE_MODULE_PATH || '@electric-sql/pglite');
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth;
create table auth.users(id uuid primary key, email text);
create table public.profiles(id uuid primary key);
create table public.academy_communities(id uuid primary key);
create table public.academy_members(id uuid primary key,academy_community_id uuid,user_id uuid,status text);
create table public.academy_member_invites(id uuid primary key,academy_member_id uuid,email text);
create table public.courses(id uuid primary key,academy_community_id uuid);
create table public.course_enrollments(
id uuid primary key default gen_random_uuid(),academy_community_id uuid,academy_member_id uuid,course_id uuid,
status text,source_provider text,external_id text,enrolled_at timestamptz,access_expires_at timestamptz,updated_at timestamptz,
unique(academy_member_id,course_id));
`);
const previous = readFileSync(`${root}/supabase/migrations/20260918080238_academy_billing_entitlements.sql`, 'utf8');
await db.exec(previous.slice(0, previous.indexOf('create or replace function public.validate_academy_billing_plan_course')));
await db.exec(readFileSync(`${root}/supabase/migrations/20260926191531_reserve_public_checkout.sql`, 'utf8'));
const uid = (i) => `10000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
const [community,user,member,plan,otherPlan,course,otherCourse] = [1,2,3,4,5,6,7].map(uid);
await db.exec(`
insert into academy_communities values('${community}');
insert into auth.users values('${user}','member@example.com');
insert into profiles values('${user}');
insert into academy_members values('${member}','${community}','${user}','active');
insert into courses values('${course}','${community}'),('${otherCourse}','${community}');
insert into academy_billing_plans(id,academy_community_id,slug,name,amount_cents,active) values
('${plan}','${community}','academy','Academy',9900,true),('${otherPlan}','${community}','course-two','Course two',9900,true);
insert into academy_billing_plan_courses values('${plan}','${course}',now()),('${otherPlan}','${otherCourse}',now());
`);
let checks = 0;
async function reserve(email,request=uid(20),p=plan) { return (await db.query('select reserve_academy_checkout($1,$2,$3) as result',[p,email,request])).rows[0].result; }
const first = await reserve('new@example.com'); assert.equal(first.blocked,false); checks++;
const retry = await reserve(' NEW@example.com '); assert.equal(retry.id,first.id); checks++;
assert.equal((await reserve('new@example.com',uid(21))).blocked,true); checks++;
await db.exec(`update academy_checkout_reservations set expires_at=now()-interval '1 minute';`);
const after = await reserve('new@example.com',uid(21)); assert.equal(after.blocked,false); assert.notEqual(after.id,first.id); checks++;
await db.exec(`insert into academy_access_grants(academy_community_id,academy_member_id,source_type,source_key,status) values('${community}','${member}','import','legacy-community','active');
insert into academy_access_grants(academy_community_id,academy_member_id,course_id,source_type,source_key,status) values('${community}','${member}','${course}','import','legacy-course','active');
insert into course_enrollments(academy_community_id,academy_member_id,course_id,status) values('${community}','${member}','${course}','completed');`);
assert.equal((await reserve('MEMBER@example.com')).blocked,true); checks++;
await db.exec('set role anon;');
await assert.rejects(reserve('anon@example.com'), (e)=>e.code==='42501'); checks++;
await db.exec('reset role;');
async function apply(p,status,end=null,source='sub_1') {
return (await db.query('select apply_academy_billing_event($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as result',[p,member,'cus_1',source,'',status,false,end,'stripe_subscription',source,'member@example.com'])).rows[0].result;
}
await apply(plan,'active','2099-01-01T00:00:00Z');
let enrolled = (await db.query('select * from course_enrollments where course_id=$1',[course])).rows[0];
assert.equal(enrolled.status,'completed'); assert.equal(enrolled.access_expires_at,null); checks++;
await apply(plan,'cancelled');
let grants = (await db.query('select source_type,status from academy_access_grants where academy_member_id=$1',[member])).rows;
assert(grants.filter(g=>g.source_type==='import').every(g=>g.status==='active'));
assert(grants.filter(g=>g.source_type==='stripe_subscription').every(g=>g.status==='revoked')); checks++;
await apply(plan,'active','2099-01-01T00:00:00Z');
await apply(otherPlan,'active','2099-01-01T00:00:00Z');
grants = (await db.query('select source_type,status,course_id from academy_access_grants where academy_member_id=$1',[member])).rows;
assert.equal(grants.find(g=>g.source_type==='stripe_subscription'&&g.course_id===course).status,'revoked');
assert.equal(grants.find(g=>g.source_type==='stripe_subscription'&&g.course_id===otherCourse).status,'active');
assert.equal(grants.find(g=>g.source_type==='import'&&g.course_id===course).status,'active'); checks++;
const late = await apply(otherPlan,'active','2000-01-01T00:00:00Z','sub_late'); assert.equal(late.status,'expired'); checks++;
await db.exec(`update academy_billing_plans set community_access=false where id='${otherPlan}';`);
await apply(otherPlan,'active','2099-01-01T00:00:00Z');
assert.equal((await db.query("select status from academy_access_grants where source_type='stripe_subscription' and source_key='sub_1' and course_id is null")).rows[0].status,'revoked'); checks++;
console.log(`${checks} PostgreSQL assertions passed: reservation, role isolation, imported access, billing cancellation, plan changes, late events.`);
await db.close();
