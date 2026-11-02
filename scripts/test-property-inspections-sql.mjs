// Actual repository migrations in isolated PostgreSQL; no hosted database or Storage calls.
// PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node scripts/test-property-inspections-sql.mjs
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
const owner = uuid(), teammate = uuid(), outsider = uuid();
for (const id of [owner, teammate, outsider]) {
  await db.query('insert into auth.users(id,email) values($1,$2)', [id, id + '@example.test']);
}
const org = (await db.query('select id from organizations where created_by=$1', [owner])).rows[0].id;
const otherOrg = (await db.query('select id from organizations where created_by=$1', [outsider])).rows[0].id;
await db.query("insert into organization_members(organization_id,user_id,role) values($1,$2,'operator')", [org, teammate]);
const as = async (role, user, query, params = []) => {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user ?? '']);
  await db.exec(`set role ${role}`);
  try { return (await db.query(query, params)).rows; } finally { await db.exec('reset role'); }
};
const inspection = { turf_condition: 'fair', visible_seams: 'separating', debris_level: 'moderate', infill_level: 'low', notes: '  Front seam needs attention.  ' };
const save = async (data = inspection, user = owner, role = 'authenticated', area = '450', rate = '0.25', infillRate = '0.25') =>
  (await as(role, user, 'select public.create_infill_inspection($1,$2,$3,$4,$5,$6::jsonb) as id', ['Inspection yard', area, infillRate, rate, 'manual', JSON.stringify(data)]))[0].id;
const counts = async () => (await db.query(`select
  (select count(*) from properties)::integer as properties,
  (select count(*) from measurements)::integer as measurements,
  (select count(*) from estimates)::integer as estimates,
  (select count(*) from property_inspections)::integer as inspections`)).rows[0];

const estimate = await save();
const saved = (await as('authenticated', owner, 'select * from property_inspections where estimate_id=$1', [estimate]))[0];
eq(saved.organization_id, org, 'inspection uses the calculation organization');
eq([saved.turf_condition, saved.visible_seams, saved.debris_level, saved.infill_level, saved.notes], ['fair','separating','moderate','low','Front seam needs attention.'], 'inspection choices and trimmed notes saved');
eq((await as('authenticated', owner, 'select square_feet from job_cards where id=$1', [estimate]))[0].square_feet, '450.00', 'saved measurement remains visible through existing job cards');
eq((await as('authenticated', teammate, 'select estimate_id from property_inspections where estimate_id=$1', [estimate])).length, 1, 'same-workspace teammate can read inspection');
await as('authenticated', teammate, "update property_inspections set turf_condition='good' where estimate_id=$1", [estimate]);
eq((await as('authenticated', owner, 'select turf_condition from property_inspections where estimate_id=$1', [estimate]))[0].turf_condition, 'good', 'same-workspace teammate can update inspection');
eq((await as('authenticated', outsider, 'select estimate_id from property_inspections where estimate_id=$1', [estimate])).length, 0, 'other workspace cannot read inspection');
eq((await as('authenticated', outsider, "update property_inspections set notes='intrusion' where estimate_id=$1 returning estimate_id", [estimate])).length, 0, 'other workspace cannot update inspection');
eq((await as('authenticated', outsider, 'delete from property_inspections where estimate_id=$1 returning estimate_id', [estimate])).length, 0, 'other workspace cannot delete inspection');
await rejects(() => as('authenticated', outsider, "insert into property_inspections(estimate_id,organization_id) values($1,$2)", [estimate, org]), '42501', 'other workspace cannot insert an inspection');
await rejects(() => as('authenticated', owner, 'update property_inspections set organization_id=$1 where estimate_id=$2', [otherOrg, estimate]), '42501', 'workspace cannot be reassigned outside membership');

// Being a member of two workspaces still cannot attach an inspection to an
// estimate under a different organization. This is enforced independently of RLS.
await db.query("insert into organization_members(organization_id,user_id,role) values($1,$2,'operator')", [otherOrg, owner]);
await rejects(() => as('authenticated', owner, 'update property_inspections set organization_id=$1 where estimate_id=$2', [otherOrg, estimate]), '23503', 'composite foreign key rejects estimate/organization mismatch');
await db.query('delete from organization_members where organization_id=$1 and user_id=$2', [otherOrg, owner]);

const beforeInvalid = await counts();
for (const invalid of [[], null, { unknown: 'ignored?' }, { notes: 42 }, { turf_condition: true }, { turf_condition: 'perfect' }, { visible_seams: 'yes' }, { debris_level: 'lots' }, { infill_level: 'empty' }, { notes: 'a'.repeat(2001) }]) {
  await rejects(() => save(invalid), '22023', 'malformed inspection rejected');
}
for (const [area, rate, infill] of [['NaN','0','0.25'], ['Infinity','0','0.25'], ['-Infinity','0','0.25'], ['0','0','0.25'], ['0.001','0','0.25'], ['450','NaN','0.25'], ['450','Infinity','0.25'], ['450','-1','0.25'], ['450','0','NaN'], ['450','0','0.26']]) {
  await rejects(() => save(inspection, owner, 'authenticated', area, rate, infill), '22023', 'invalid numeric input rejected');
}
await rejects(() => save(inspection, null, 'anon'), '42501', 'anonymous caller cannot execute new RPC');
eq(await counts(), beforeInvalid, 'invalid requests do not leave partial properties or calculations');
await rejects(() => as('anon', null, 'select * from property_inspections'), '42501', 'anonymous role has no table access');

const optionalEstimate = await save({ turf_condition: '', visible_seams: null, debris_level: ' ', infill_level: null, notes: ' ' });
eq((await db.query('select estimate_id from property_inspections where estimate_id=$1', [optionalEstimate])).rows.length, 0, 'all inspection fields are optional without writing empty report');
const notesOnly = await save({ notes: 'n'.repeat(2000) });
eq((await db.query('select length(notes) as length from property_inspections where estimate_id=$1', [notesOnly])).rows[0].length, 2000, 'notes-only report accepts exact maximum length');
const oldEstimate = (await as('authenticated', owner, "select public.create_infill_calculation('Older app',100,0.25,0,'camera') as id"))[0].id;
eq((await db.query('select count(*)::integer as count from estimates where id=$1', [oldEstimate])).rows[0].count, 1, 'older client RPC remains callable and saves estimate');
eq((await db.query('select estimate_id from property_inspections where estimate_id=$1', [oldEstimate])).rows.length, 0, 'older client is not required to save an inspection');
await rejects(() => as('authenticated', owner, "insert into property_inspections(estimate_id,organization_id,turf_condition) values($1,$2,'perfect')", [oldEstimate, org]), '23514', 'direct table writes cannot bypass condition constraint');
await rejects(() => as('authenticated', owner, 'insert into property_inspections(estimate_id,organization_id,notes) values($1,$2,$3)', [oldEstimate, org, 'n'.repeat(2001)]), '23514', 'direct table writes cannot bypass notes limit');

// Force a failure after all three legacy inserts to prove the new API is atomic.
await db.exec(`create function public.test_fail_inspection() returns trigger language plpgsql as $$ begin raise exception 'forced inspection failure'; end $$;
create trigger test_fail_inspection before insert on property_inspections for each row execute function public.test_fail_inspection();`);
const beforeFailure = await counts();
await rejects(() => save(), 'P0001', 'late inspection failure reaches caller');
eq(await counts(), beforeFailure, 'late inspection failure rolls back property, measurement, estimate and inspection');
await db.exec('drop trigger test_fail_inspection on property_inspections; drop function public.test_fail_inspection();');
eq((await db.query("select prosecdef from pg_proc where oid='public.create_infill_inspection(text,numeric,numeric,numeric,public.measurement_method,jsonb)'::regprocedure")).rows[0].prosecdef, false, 'new RPC executes under caller RLS');
eq((await db.query("select relrowsecurity from pg_class where oid='public.property_inspections'::regclass")).rows[0].relrowsecurity, true, 'inspection table always has RLS enabled');
await as('authenticated', owner, 'delete from estimates where id=$1', [estimate]);
eq((await db.query('select estimate_id from property_inspections where estimate_id=$1', [estimate])).rows.length, 0, 'inspection follows calculation deletion');
console.log(`Property inspection SQL: ${assertions} assertions passed across ${migrations.length} migrations in isolated PostgreSQL. No hosted schema or member data was changed.`);
} finally { await db.close(); }
