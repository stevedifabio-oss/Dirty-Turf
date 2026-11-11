// Isolated PostgreSQL acceptance of the real migrations. No hosted/provider calls.
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
process.on('uncaughtException', error => { console.error(error.message, error.where || '', error.query || ''); process.exit(1); });
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create table auth.users(id uuid primary key,created_at timestamptz default '2026-01-01',email text,
raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz default now(),banned_until timestamptz,deleted_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$ select current_user::text $$;
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key,bucket_id text,name text,owner uuid,metadata jsonb);
alter table storage.objects enable row level security;
create function storage.foldername(text) returns text[] language sql as $$ select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1] $$;
create function public.rls_auto_enable() returns event_trigger language plpgsql as $$ begin return; end $$;
create publication supabase_realtime;
grant usage on schema public,auth,storage to anon,authenticated,service_role;
grant select,insert,update,delete on storage.objects to anon,authenticated,service_role;
alter default privileges in schema public grant select,insert,update,delete on tables to anon,authenticated,service_role;
`);
const migrations = (await readdir(new URL('../supabase/migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).sort();
for (const name of migrations) {
  try { await db.exec((await readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')).replace('create extension if not exists pgcrypto;', '')); }
  catch (cause) { throw new Error(`Migration ${name}: ${cause.message}`, { cause }); }
}
let assertions = 0;
const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); assertions++; };
const reject = async (promise, label) => { await assert.rejects(promise, undefined, label); assertions++; };
const as = async (role, uid, query, args = []) => {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid || '']);
  await db.exec(`set role ${role}`);
  try { return (await db.query(query, args)).rows; } finally { await db.exec('reset role'); }
};
const user = async (email = `${crypto.randomUUID()}@example.test`) => {
  const uid = crypto.randomUUID(); await db.query('insert into auth.users(id,email) values($1,$2)', [uid, email]); return uid;
};
const owner = '87e83b6e-c072-43f9-bb8d-002b17d8a368';
await db.query("insert into auth.users(id,email) values($1,'steve@dirtyturf.com')", [owner]);
const org = (await db.query('select id from organizations where created_by=$1', [owner])).rows[0].id;
const community = 'fac17da0-bdb9-48c0-9c67-591d087e9912';
await db.query("insert into academy_communities(id,owner_organization_id,name,slug,portal_url,pricing_gates_enabled) values($1,$2,'Membership SQL','membership-sql','https://example.test',true)", [community, org]);
const academy = 'a0238fea-1bfd-46de-978d-f476492edec8', levelCourse = crypto.randomUUID(), blockedCourse = crypto.randomUUID(), draftCourse = crypto.randomUUID();
for (const [id, status, access] of [[academy, 'published', 'open'], [levelCourse, 'published', 'level'], [blockedCourse, 'published', 'open'], [draftCourse, 'draft', 'open']]) {
  await db.query("insert into courses(id,organization_id,academy_community_id,title,status,access_type,required_level,external_id) values($1::uuid,$2,$3,'Fixture',$4,$5,2,$1::text)", [id, org, community, status, access]);
}
const skus = { community: 'dirty_turf_community_monthly', scanner: 'dirty_turf_scanner_monthly', academy: 'dirty_turf_academy_monthly' };
for (const provider of ['google', 'apple']) for (const [resource, id] of Object.entries(skus)) {
  await db.query('insert into academy_store_products(provider,product_id,academy_community_id,resource_key,course_id) values($1,$2,$3,$4,$5)', [provider, id, community, resource === 'scanner' ? 'measuring_tool' : resource, resource === 'academy' ? academy : null]);
}
const member = async uid => {
  const id = crypto.randomUUID();
  await db.query("insert into academy_members(id,academy_community_id,user_id,display_name,status,level) values($1,$2,$3,'Fixture','active',2)", [id, community, uid]);
  return id;
};
const grant = async (mid, source, key, cid = null, end = null) => db.query('insert into academy_access_grants(academy_community_id,academy_member_id,course_id,source_type,source_key,ends_at) values($1,$2,$3,$4,$5,$6)', [community, mid, cid, source, key, end]);
const state = async uid => (await as('authenticated', uid, 'select get_academy_access_state() value'))[0].value;
const saveMeasurement = async (uid, method = 'manual', inspection = false) => (await as('authenticated', uid,
  inspection ? "select create_infill_inspection('Scanner SQL',100,0.25,0,$1,'{\"notes\":\"Fixture\"}'::jsonb) id"
    : "select create_infill_calculation('Scanner SQL',100,0.25,0,$1) id", [method]))[0].id;
const rights = async uid => { const s = await state(uid); return { community: s.communityAccess, courses: s.courseIds.sort(), features: s.features.sort(), access: s.hasAccess }; };
const status = async (uid, provider = 'google') => (await as('authenticated', uid, 'select get_membership_store_status($1) value', [provider]))[0].value;
const legacy = await user(), legacyMid = await member(legacy), comped = await user(), compedMid = await member(comped), paid = await user(), paidMid = await member(paid);
const future = new Date(Date.now() + 30 * 86400000).toISOString();
await grant(legacyMid, 'import', 'legacy-community');
await grant(compedMid, 'manual', 'owner-free:community');
await grant(paidMid, 'stripe_subscription', 'old-paid-community', null, future);
await db.query('insert into academy_course_access_denials(academy_community_id,academy_member_id,course_id) values($1,$2,$3)', [community, legacyMid, blockedCourse]);
const rightsFor = async users => { const result = []; for (const uid of users) result.push(await rights(uid)); return result; };
const before = await rightsFor([legacy, comped, paid]);
equal(before[0].courses, [academy, levelCourse].sort(), 'legacy fixture only sees current allowed published courses');
equal(before[1].courses, [], 'Community-only comp never implies Academy');
const countsBefore = (await db.query('select (select count(*) from academy_access_grants)::int access,(select count(*) from academy_feature_grants)::int features')).rows[0];
equal((await status(legacy)).enabled, false, 'store remains held after migration');
equal((await state(legacy)).separateAccessEnabled, false, 'held cutover projects legacy Scanner policy');
const legacyManualEstimate = await saveMeasurement(legacy);
equal(Boolean(legacyManualEstimate), true, 'held cutover preserves older manual calculation RPC');
await reject(saveMeasurement(legacy, 'camera'), 'held cutover still requires Scanner for camera');
await reject(saveMeasurement(legacy, 'map'), 'held cutover still requires Scanner for map');
await reject(as('authenticated', legacy, 'select admin_activate_separate_access($1)', [community]), 'ordinary member cannot activate cutover');
await reject(as('anon', null, 'select admin_activate_separate_access($1)', [community]), 'anonymous cannot activate cutover');
await as('authenticated', owner, 'select admin_activate_separate_access($1)', [community]);
equal(await rightsFor([legacy, comped, paid]), before, 'cutover preserves exact existing effective rights');
equal((await state(legacy)).separateAccessEnabled, true, 'explicit cutover projects all-method Scanner policy');
await reject(saveMeasurement(legacy), 'manual calculation RPC requires Scanner after cutover');
await reject(saveMeasurement(legacy, 'manual', true), 'inspection RPC cannot bypass Scanner through manual mode');
const oldMeasurement = (await db.query('select id,property_id,organization_id from measurements where id=(select measurement_id from estimates where id=$1)', [legacyManualEstimate])).rows[0];
await reject(as('authenticated', legacy, "insert into measurements(organization_id,property_id,method,square_feet,created_by) values($1,$2,'manual',100,$3)", [oldMeasurement.organization_id, oldMeasurement.property_id, legacy]), 'direct manual insert cannot bypass Scanner');
await reject(as('authenticated', legacy, 'update measurements set square_feet=101 where id=$1', [oldMeasurement.id]), 'direct manual update cannot bypass Scanner');
equal((await as('authenticated', legacy, 'select square_feet from measurements where id=$1', [oldMeasurement.id]))[0].square_feet, '100.00', 'saved manual measurements remain readable without Scanner');
equal((await db.query('select (select count(*) from academy_access_grants)::int access,(select count(*) from academy_feature_grants)::int features')).rows[0], countsBefore, 'cutover mints no access or Scanner grants');
await as('authenticated', owner, 'select admin_activate_separate_access($1)', [community]);
equal(await rightsFor([legacy, comped, paid]), before, 'cutover is idempotent');
equal((await db.query("select count(*)::int n from private.academy_legacy_access_scopes where academy_member_id=$1 and resource_key<> 'community'", [compedMid])).rows[0].n, 0, 'Community comp never gets legacy course scopes');
const laterCourse = crypto.randomUUID();
await db.query("insert into courses(id,organization_id,academy_community_id,title,status,access_type,external_id) values($1::uuid,$2,$3,'New course','published','open',$1::text)", [laterCourse, org, community]);
equal((await rights(legacy)).courses.includes(laterCourse), false, 'future published courses are not grandfathered');
await db.query("update academy_access_grants set ends_at=now()+interval '60 days' where source_key='old-paid-community'");
equal((await rights(paid)).courses, before[2].courses, 'old source renewal preserves only grandfathered course scope');
await db.query("update academy_access_grants set status='revoked' where source_key='old-paid-community'");
equal((await rights(paid)).courses, [], 'old source cancellation still ends its grandfathered courses');
const lateImport = await user(), lateMid = await member(lateImport);
await grant(lateMid, 'import', 'new-after-cutover'); await grant(lateMid, 'import', 'new-course-import', academy);
await db.query("insert into academy_feature_grants(academy_community_id,academy_member_id,feature_key,source_type,source_key) values($1,$2,'measuring_tool','import','late-feature')", [community, lateMid]);
equal((await rights(lateImport)).community, false, 'new import cannot mint free Community');
equal((await rights(lateImport)).courses, [], 'new import cannot mint free Academy');
equal((await rights(lateImport)).features, [], 'new import cannot mint free Scanner');
equal((await rights(lateImport)).access, false, 'unrecognized imported grant cannot open paid workspace');
for (const name of ['admin_set_free_access(uuid,text,boolean,timestamptz)', 'admin_get_free_access(uuid)']) equal((await db.query('select prosecdef from pg_proc where oid=$1::regprocedure', [name])).rows[0].prosecdef, false, 'master grant wrapper remains security invoker');
await reject(as('authenticated', legacy, 'select admin_set_free_access($1,$2,true,null)', [legacyMid, 'measuring_tool']), 'only master controls complimentary grants');
const newUid = await user();
equal((await status(newUid)).trialEligible, false, 'trial is held by default');
await reject(as('authenticated', newUid, 'select start_turf_scanner_trial()'), 'held trial cannot mint access');
const storeApply = async (uid, resource, key, options = {}) => {
  const args = [options.provider || 'google', key, uid, skus[resource] || resource, options.status || 'active', options.end || future,
    options.renew ?? true, options.environment || 'production', options.verifiedAt || new Date().toISOString()];
  return (await as('service_role', null, 'select apply_academy_store_entitlement($1,$2,$3,$4,$5,$6,$7,$8,$9) value', args))[0].value;
};
await reject(storeApply(newUid, 'community', 'held-key'), 'inactive products cannot fulfill new purchases');
// A Google license test can exercise Scanner while every public sale stays held.
// Only the trusted verifier supplies sandbox; allowlisting never permits production.
const sandboxUid = await user(), sandboxOther = await user();
await db.query('insert into private.academy_store_test_accounts(user_id) values($1)', [sandboxUid]);
equal((await status(sandboxUid)).enabled, true, 'allowlisted Google tester can load held Scanner catalog');
equal((await status(sandboxUid)).sandboxOnly, true, 'server identifies the sandbox-only enrollment route');
equal((await status(sandboxUid)).products, [skus.scanner], 'held tester catalog contains only exact Scanner SKU');
equal((await status(sandboxOther)).enabled, false, 'ordinary account still cannot open checkout');
equal((await status(sandboxOther)).products, [], 'ordinary account sees no public sale products');
equal((await status(sandboxOther)).sandboxOnly, false, 'ordinary account cannot request test mode');
equal((await status(sandboxUid, 'apple')).enabled, false, 'Google acceptance does not open Apple catalog');
equal((await status(sandboxUid, 'apple')).products, [], 'Apple products remain held for tester');
equal((await db.query('select store_purchases_enabled from academy_communities where id=$1', [community])).rows[0].store_purchases_enabled, false, 'test catalog never flips public purchase switch');
equal((await db.query('select count(*)::int n from academy_store_products where active')).rows[0].n, 0, 'test catalog never activates a mapping');
for (const environment of ['production', 'sandbox']) {
  await reject(storeApply(sandboxOther, 'scanner', `ordinary-held-${environment}`, { environment }), `ordinary account cannot fulfill held ${environment} Scanner`);
}
await reject(storeApply(sandboxUid, 'scanner', 'tester-held-production'), 'allowlisted tester cannot fulfill first production purchase while sales held');
for (const resource of ['community', 'academy']) {
  await reject(storeApply(sandboxUid, resource, `tester-held-${resource}`, { environment: 'sandbox' }), `test exemption cannot fulfill held ${resource}`);
}
await reject(storeApply(sandboxUid, 'scanner', 'tester-held-apple', { environment: 'sandbox', provider: 'apple' }), 'test exemption cannot fulfill Apple Scanner');
await db.query('update academy_communities set separate_access_enabled=false where id=$1', [community]);
equal((await status(sandboxUid)).enabled, false, 'test catalog requires reviewed separate-access cutover');
await reject(storeApply(sandboxUid, 'scanner', 'tester-no-cutover', { environment: 'sandbox' }), 'test fulfillment requires separate-access cutover');
await db.query('update academy_communities set separate_access_enabled=true,pricing_gates_enabled=false where id=$1', [community]);
equal((await status(sandboxUid)).enabled, false, 'test catalog requires pricing gates');
await reject(storeApply(sandboxUid, 'scanner', 'tester-no-gates', { environment: 'sandbox' }), 'test fulfillment requires pricing gates');
await db.query('update academy_communities set pricing_gates_enabled=true where id=$1', [community]);
const unverifiedSandbox = await user();
await db.query('insert into private.academy_store_test_accounts(user_id) values($1)', [unverifiedSandbox]);
await db.query('update auth.users set email_confirmed_at=null where id=$1', [unverifiedSandbox]);
await reject(status(unverifiedSandbox), 'test allowlist cannot bypass confirmed sign-in');
await reject(storeApply(unverifiedSandbox, 'scanner', 'tester-unverified', { environment: 'sandbox' }), 'test fulfillment cannot provision unverified account');
await reject(as('authenticated', sandboxUid, 'select * from private.academy_store_test_accounts'), 'tester cannot read private test identities');
await reject(as('authenticated', sandboxUid, 'insert into private.academy_store_test_accounts(user_id) values($1)', [sandboxOther]), 'tester cannot self-allowlist another account');
await reject(as('authenticated', sandboxUid, 'select apply_academy_store_entitlement($1,$2,$3,$4,$5,$6,$7,$8)', ['google', 'tester-client-forged', sandboxUid, skus.scanner, 'active', future, true, 'sandbox']), 'tester cannot supply an unverified sandbox claim directly');
equal((await storeApply(sandboxUid, 'scanner', 'scanner-license-acceptance', { environment: 'sandbox' })).applied, true, 'trusted sandbox Scanner proof fulfills with public sales held');
equal(await rights(sandboxUid), { community: false, courses: [], features: ['measuring_tool'], access: true }, 'license test grants only Scanner');
for (const method of ['manual', 'camera', 'map']) equal(Boolean(await saveMeasurement(sandboxUid, method)), true, `sandbox Scanner unlocks ${method}`);
equal((await status(sandboxUid)).restorableProducts, [skus.scanner], 'verified sandbox Scanner remains restorable for allowed tester');
const licenseVerifiedAt = Date.now();
equal((await storeApply(sandboxUid, 'scanner', 'scanner-license-acceptance', { environment: 'sandbox', verifiedAt: new Date(licenseVerifiedAt + 1000).toISOString() })).applied, true, 'verified sandbox renewal retains held mapping compatibility');
equal((await storeApply(sandboxUid, 'scanner', 'scanner-license-acceptance', { environment: 'sandbox', status: 'revoked', verifiedAt: new Date(licenseVerifiedAt - 60_000).toISOString() })).ignored, true, 'stale test event cannot overwrite current proof');
await db.query('insert into private.academy_store_test_accounts(user_id) values($1)', [sandboxOther]);
await reject(storeApply(sandboxOther, 'scanner', 'scanner-license-acceptance', { environment: 'sandbox' }), 'sandbox source cannot transfer to another allowlisted account');
await storeApply(sandboxUid, 'scanner', 'scanner-license-acceptance', { environment: 'sandbox', end: new Date(Date.now() - 1000).toISOString(), verifiedAt: new Date(licenseVerifiedAt + 2000).toISOString() });
equal((await rights(sandboxUid)).features, [], 'authoritative sandbox expiry removes Scanner');
for (const method of ['manual', 'camera', 'map']) await reject(saveMeasurement(sandboxUid, method), `expired sandbox denies ${method}`);
await storeApply(sandboxUid, 'scanner', 'scanner-license-acceptance', { environment: 'sandbox', verifiedAt: new Date(licenseVerifiedAt + 3000).toISOString() });
await db.query('update private.academy_store_test_accounts set enabled=false where user_id=$1', [sandboxUid]);
equal((await status(sandboxUid)).enabled, false, 'removing tester closes test catalog immediately');
equal((await status(sandboxUid)).products, [], 'removed tester cannot start another license purchase');
equal((await status(sandboxUid)).restorableProducts, [], 'removed tester cannot restore sandbox source');
equal((await rights(sandboxUid)).features, [], 'removing allowlist disables an unexpired sandbox grant immediately');
await reject(saveMeasurement(sandboxUid), 'removed tester cannot save manual Scanner');
await reject(storeApply(sandboxUid, 'scanner', 'scanner-license-acceptance', { environment: 'sandbox', verifiedAt: new Date(licenseVerifiedAt + 4000).toISOString() }), 'removed tester cannot renew sandbox source');
equal((await db.query('select count(*)::int n from academy_store_entitlements where user_id=$1 and environment=$2', [sandboxUid, 'production'])).rows[0].n, 0, 'test acceptance never creates a production entitlement');
equal((await db.query('select store_purchases_enabled from academy_communities where id=$1', [community])).rows[0].store_purchases_enabled, false, 'test fulfillment leaves public purchases off');
equal((await db.query('select count(*)::int n from academy_store_products where active')).rows[0].n, 0, 'test fulfillment leaves all mappings inactive');
// The verified master may test using his existing login without losing admin
// rights. Only virtual ownership is hidden; actual paid Scanner sources win.
const ownerMember = await member(owner);
const ownerRightsBeforeTest = await state(owner);
equal((await status(owner)).ownedProducts.sort(), Object.values(skus).sort(), 'unallowlisted master retains all virtual ownership');
await db.query('insert into private.academy_store_test_accounts(user_id) values($1)', [owner]);
equal((await status(owner)).products, [skus.scanner], 'allowlisted master catalog exposes only Google Scanner');
equal((await status(owner)).ownedProducts.sort(), [skus.community, skus.academy].sort(), 'held Google test hides only master virtual Scanner ownership');
equal((await status(owner, 'apple')).ownedProducts.sort(), Object.values(skus).sort(), 'master Apple ownership projection is unchanged');
equal(await state(owner), ownerRightsBeforeTest, 'test catalog overlay never changes effective master access');
for (const source of ['stripe_subscription', 'stripe_payment', 'google_subscription', 'apple_subscription']) {
  await db.query("insert into academy_feature_grants(academy_community_id,academy_member_id,feature_key,source_type,source_key,ends_at,metadata) values($1,$2,'measuring_tool',$3,$4,$5,'{\"environment\":\"production\"}')", [community, ownerMember, source, `master-paid-${source}`, future]);
  equal((await status(owner)).ownedProducts.includes(skus.scanner), true, `active ${source} prevents a duplicate master test purchase`);
  await db.query("update academy_feature_grants set starts_at=now()-interval '2 days',ends_at=now()-interval '1 second' where academy_member_id=$1 and source_type=$2 and source_key=$3", [ownerMember, source, `master-paid-${source}`]);
  equal((await status(owner)).ownedProducts.includes(skus.scanner), false, `expired ${source} does not block master license test`);
}
const otherAdmin = await user(), otherAdminMid = await member(otherAdmin);
await db.query("update academy_members set role='admin' where id=$1", [otherAdminMid]);
await db.query('insert into private.academy_store_test_accounts(user_id) values($1)', [otherAdmin]);
equal((await state(otherAdmin)).canManage, true, 'nonmaster admin fixture has ordinary administration rights');
equal((await status(otherAdmin)).ownedProducts.sort(), Object.values(skus).sort(), 'nonmaster admin receives no ownership overlay');
await db.query('update academy_communities set store_purchases_enabled=true where id=$1', [community]);
equal((await status(owner)).ownedProducts.includes(skus.scanner), true, 'normal enrollment disables master test-only ownership override');
await db.query('update academy_communities set store_purchases_enabled=false where id=$1', [community]);
equal((await storeApply(owner, 'scanner', 'master-license-acceptance', { environment: 'sandbox' })).applied, true, 'verified master test purchase can be fulfilled without changing roles');
equal((await status(owner)).ownedProducts.includes(skus.scanner), true, 'successful sandbox purchase restores master duplicate-purchase protection');
equal((await status(owner)).restorableProducts, [skus.scanner], 'master can restore his verified sandbox purchase');
equal(await state(owner), ownerRightsBeforeTest, 'sandbox verification does not masquerade as proof of a new master device unlock');
await db.query('update private.academy_store_test_accounts set enabled=false where user_id=$1', [owner]);
equal((await status(owner)).enabled, false, 'removing master allowlist closes test catalog');
equal((await status(owner)).ownedProducts.sort(), Object.values(skus).sort(), 'removing master allowlist restores ordinary ownership projection');
equal(await state(owner), ownerRightsBeforeTest, 'master retains all effective access after test allowlist removal');
await db.query('update academy_communities set store_purchases_enabled=true,scanner_trial_enabled=true where id=$1', [community]);
await db.query('update academy_store_products set active=true');
equal((await status(newUid)).enabled, true, 'explicit activation exposes mapped store products');
equal((await status(newUid)).products.sort(), Object.values(skus).sort(), 'only exact configured products are exposed');
await reject(as('anon', null, 'select get_membership_store_status($1)', ['google']), 'status requires sign-in');
await reject(as('authenticated', newUid, 'select get_membership_store_status($1)', ['other']), 'unknown provider denied');
await reject(as('authenticated', newUid, 'select * from academy_store_products'), 'clients cannot read raw store configuration');
await reject(as('authenticated', newUid, 'insert into academy_store_entitlements(provider) values($1)', ['google']), 'client cannot mint a store entitlement');
await reject(as('authenticated', newUid, 'select apply_academy_store_entitlement($1,$2,$3,$4,$5,$6)', ['google', 'forged', newUid, skus.scanner, 'active', future]), 'client cannot invoke verified fulfillment RPC');
// All seven choices, including each standalone subscription and all combinations.
for (let bits = 1; bits < 8; bits++) {
  const uid = await user();
  const chosen = ['community', 'scanner', 'academy'].filter((_, index) => bits & (1 << index));
  for (const resource of chosen) await storeApply(uid, resource, `combination-${bits}-${resource}`);
  const r = await rights(uid);
  equal(r.community, chosen.includes('community'), `combination ${bits}: Community is independent`);
  equal(r.courses, chosen.includes('academy') ? [academy] : [], `combination ${bits}: Academy is independent`);
  equal(r.features, chosen.includes('scanner') ? ['measuring_tool'] : [], `combination ${bits}: Scanner is independent`);
  equal((await status(uid)).ownedProducts.sort(), chosen.map(resource => skus[resource]).sort(), `combination ${bits}: owned SKU projection`);
  if (chosen.includes('scanner')) {
    for (const method of ['manual', 'camera', 'map']) equal(Boolean(await saveMeasurement(uid, method)), true, `combination ${bits}: Scanner unlocks ${method}`);
  } else await reject(saveMeasurement(uid), `combination ${bits}: other subscriptions do not unlock manual Scanner`);
  if (bits === 4) equal((await as('authenticated', uid, 'select course_id from course_enrollments')).map(row => row.course_id), [academy], 'Academy-only subscriber reads own enrollment');
}
// Store identity cannot transfer; an unknown SKU can never grant app access.
await reject(storeApply(await user(), 'community', 'combination-1-community'), 'stable subscription cannot move between accounts');
const firstBuyer = (await db.query("select user_id from academy_store_entitlements where source_key='combination-1-community'")).rows[0].user_id;
await reject(storeApply(firstBuyer, 'scanner', 'combination-1-community'), 'stable subscription cannot move between products');
await reject(storeApply(newUid, 'unknown_sku', 'unknown-product'), 'unmapped SKU denied');
await reject(storeApply(newUid, 'community', 'infinite-period', { end: 'infinity' }), 'infinite provider expiry denied');
await reject(storeApply(newUid, 'community', 'future-verification', { verifiedAt: new Date(Date.now() + 86400000).toISOString() }), 'unbounded future verification denied');
await reject(db.query("update academy_store_products set course_id=$1 where provider='google' and resource_key='academy'", [levelCourse]), 'purchased product cannot be remapped to additional course content');
const alreadyEnded = await user();
equal((await storeApply(alreadyEnded, 'community', 'already-ended', { end: '2000-01-01' })).status, 'expired', 'delayed active receipt is normalized to expired');
equal((await rights(alreadyEnded)).community, false, 'past provider expiry cannot create active access');
// A cancellation schedules renewal off while entitlement lasts until verified end.
const cancelling = await user();
await storeApply(cancelling, 'community', 'cancel-community', { renew: false });
equal((await rights(cancelling)).community, true, 'cancel-at-end retains paid access through period');
equal((await db.query("select auto_renew from academy_store_entitlements where source_key='cancel-community'")).rows[0].auto_renew, false, 'renewal state recorded independently');
await storeApply(cancelling, 'scanner', 'independent-scanner');
await storeApply(cancelling, 'community', 'cancel-community', { status: 'expired', verifiedAt: new Date(Date.now() + 1000).toISOString() });
equal((await rights(cancelling)).community, false, 'expired Community turns off Community');
equal((await rights(cancelling)).features, ['measuring_tool'], 'Community expiry preserves independent Scanner');
const noLongerForSale = await user();
await storeApply(noLongerForSale, 'community', 'existing-disabled-product');
await db.query("update academy_store_products set active=false where provider='google' and product_id=$1", [skus.community]);
await storeApply(noLongerForSale, 'community', 'existing-disabled-product', { verifiedAt: new Date(Date.now() + 1000).toISOString() });
equal((await rights(noLongerForSale)).community, true, 'closing new sales does not break an existing subscription renewal');
await db.query('update academy_communities set store_purchases_enabled=false where id=$1', [community]);
const heldRestoreStatus = await status(noLongerForSale);
equal(heldRestoreStatus.enabled, false, 'held enrollment hides new store purchase options');
equal(heldRestoreStatus.products, [], 'new-product purchase list stays empty while enrollment is held');
equal(heldRestoreStatus.restorableProducts, [skus.community], 'existing store SKU remains restorable despite held enrollment and inactive product');
equal((await storeApply(noLongerForSale, 'community', 'existing-disabled-product', { verifiedAt: new Date(Date.now() + 2000).toISOString() })).applied, true, 'verified existing subscription restore works during held enrollment');
await db.query('update academy_communities set store_purchases_enabled=true where id=$1', [community]);
await reject(storeApply(await user(), 'community', 'new-disabled-product'), 'closed product rejects a first-time purchase');
await db.query("update academy_store_products set active=true where provider='google' and product_id=$1", [skus.community]);
// Store refund/cancellation affects only its source, including across providers.
const bothStores = await user();
await storeApply(bothStores, 'scanner', 'google-scanner');
await storeApply(bothStores, 'scanner', 'apple-scanner', { provider: 'apple' });
await storeApply(bothStores, 'scanner', 'google-scanner', { status: 'revoked', verifiedAt: new Date(Date.now() + 2000).toISOString() });
equal((await rights(bothStores)).features, ['measuring_tool'], 'Google refund preserves Apple Scanner');
equal((await storeApply(bothStores, 'scanner', 'google-scanner', { verifiedAt: new Date(Date.now() - 1000).toISOString() })).ignored, true, 'stale verification cannot restore a refunded source');
await storeApply(bothStores, 'scanner', 'apple-scanner', { provider: 'apple', status: 'revoked', verifiedAt: new Date(Date.now() + 2000).toISOString() });
equal((await rights(bothStores)).features, [], 'refunding final source removes Scanner');
// Owner/Stripe grants remain effective after a store-specific revoke.
const manualUid = await user(), manualMid = await member(manualUid);
await as('authenticated', owner, 'select admin_set_free_access($1,$2,true,null)', [manualMid, 'measuring_tool']);
await storeApply(manualUid, 'scanner', 'manual-coexist');
await storeApply(manualUid, 'scanner', 'manual-coexist', { status: 'revoked', verifiedAt: new Date(Date.now() + 1000).toISOString() });
equal((await rights(manualUid)).features, ['measuring_tool'], 'store refund preserves owner free grant');
equal(Boolean(await saveMeasurement(manualUid)), true, 'owner complimentary Scanner unlocks manual calculations');
equal((await status(manualUid)).ownedProducts.includes(skus.scanner), true, 'owner free Scanner is owned without a paid store row');
await db.query("insert into academy_feature_grants(academy_community_id,academy_member_id,feature_key,source_type,source_key) values($1,$2,'measuring_tool','stripe_subscription','paid-stripe')", [community, manualMid]);
await as('authenticated', owner, 'select admin_set_free_access($1,$2,false,null)', [manualMid, 'measuring_tool']);
equal((await rights(manualUid)).features, ['measuring_tool'], 'removing free grant preserves Stripe Scanner');
// Sandbox never grants a regular account and never overwrites production state.
const tester = await user();
await reject(storeApply(tester, 'scanner', 'same-environment-key', { environment: 'sandbox' }), 'regular account cannot claim sandbox purchase');
await db.query('insert into private.academy_store_test_accounts(user_id) values($1)', [tester]);
await storeApply(tester, 'scanner', 'same-environment-key', { environment: 'sandbox' });
equal((await rights(tester)).features, ['measuring_tool'], 'allowlisted tester can exercise sandbox source');
await db.query('update private.academy_store_test_accounts set enabled=false where user_id=$1', [tester]);
equal((await rights(tester)).features, [], 'removing sandbox tester disables sandbox entitlement immediately');
equal((await rights(tester)).access, false, 'removed tester has no effective paid workspace access');
await storeApply(tester, 'scanner', 'same-environment-key');
equal((await rights(tester)).features, ['measuring_tool'], 'production has an independent ledger/grant namespace');
// Trial is one claim per account; it grants only Scanner and does not create billing.
const trialUid = await user();
equal((await status(trialUid)).trialEligible, true, 'new verified account can claim trial');
const claim = (await as('authenticated', trialUid, 'select start_turf_scanner_trial() value'))[0].value;
equal(claim.started, true, 'trial starts once');
equal(claim.alreadyUsed, false, 'first claim marked new');
equal((await rights(trialUid)), { community: false, courses: [], features: ['measuring_tool'], access: true }, 'trial unlocks only Scanner');
equal(Boolean(await saveMeasurement(trialUid)), true, 'active seven-day Scanner trial unlocks manual calculations');
equal((await status(trialUid)).ownedProducts, [], 'trial does not hide paid Subscribe option');
equal((await status(trialUid)).trialUsed, true, 'claim ledger survives as used');
equal((await db.query('select extract(epoch from expires_at-started_at)::int seconds from private.academy_scanner_trial_claims where user_id=$1', [trialUid])).rows[0].seconds, 7 * 86400, 'trial lasts exactly seven days');
const repeated = (await as('authenticated', trialUid, 'select start_turf_scanner_trial() value'))[0].value;
equal(repeated.expiresAt, claim.expiresAt, 'repeated claim never extends trial');
equal(repeated.alreadyUsed, true, 'repeated claim reports prior use');
const billingCounts = (await db.query('select (select count(*) from academy_billing_subscriptions)::int stripe,(select count(*) from academy_store_entitlements where user_id=$1)::int store', [trialUid])).rows[0];
equal(billingCounts, { stripe: 0, store: 0 }, 'trial creates no Stripe/store billing entry or automatic charge');
await storeApply(trialUid, 'scanner', 'subscribe-during-trial');
equal((await status(trialUid)).ownedProducts, [skus.scanner], 'member can subscribe during trial');
await db.query("update academy_feature_grants set starts_at=now()-interval '8 days',ends_at=now()-interval '1 day' where source_type='self_trial' and academy_member_id=$1", [claim.memberId]);
equal((await rights(trialUid)).features, ['measuring_tool'], 'trial expiry cannot revoke paid Scanner');
const expiredTrial = await user();
const expClaim = (await as('authenticated', expiredTrial, 'select start_turf_scanner_trial() value'))[0].value;
await db.query("update academy_feature_grants set starts_at=now()-interval '8 days',ends_at=now()-interval '1 day' where source_type='self_trial' and academy_member_id=$1", [expClaim.memberId]);
equal((await rights(expiredTrial)).features, [], 'trial stops at server expiry without a schedule');
await reject(saveMeasurement(expiredTrial), 'expired trial cannot keep saving manual Scanner calculations');
equal((await status(expiredTrial)).trialEligible, false, 'expired trial cannot be claimed again');
equal((await as('authenticated', expiredTrial, 'select start_turf_scanner_trial() value'))[0].value.alreadyUsed, true, 'server refuses to restart expired trial');
await reject(as('anon', null, 'select start_turf_scanner_trial()'), 'anonymous trial denied');
const unverified = await user(); await db.query('update auth.users set email_confirmed_at=null where id=$1', [unverified]);
await reject(as('authenticated', unverified, 'select start_turf_scanner_trial()'), 'unverified trial denied');
await reject(storeApply(unverified, 'scanner', 'unverified-account'), 'unverified account cannot receive a native grant');
const banned = await user(); await db.query("update auth.users set banned_until=now()+interval '1 day' where id=$1", [banned]);
await reject(as('authenticated', banned, 'select start_turf_scanner_trial()'), 'banned trial denied');
const suspended = await user(), suspendedMid = await member(suspended); await db.query("update academy_members set status='suspended' where id=$1", [suspendedMid]);
await reject(storeApply(suspended, 'community', 'suspended-account'), 'suspended identity cannot buy around restriction');
await reject(as('authenticated', suspended, 'select start_turf_scanner_trial()'), 'suspended identity cannot start trial');
// Minimal own context works for each paid product without opening the directory.
const ownContext = async uid => (await as('authenticated', uid, 'select private.get_own_academy_context() value'))[0].value;
const originalContextQuery = async uid => as('authenticated', uid,
  'select id,academy_community_id from academy_members where user_id=$1 limit 1', [uid]);
const academyOnly = await user(); await storeApply(academyOnly, 'academy', 'own-context-academy');
const academyOnlyMember = (await db.query('select id from academy_members where user_id=$1', [academyOnly])).rows[0].id;
equal(await ownContext(academyOnly), { id: academyOnlyMember, academy_community_id: community }, 'Academy-only subscriber resolves own context');
equal(await originalContextQuery(academyOnly), [{ id: academyOnlyMember, academy_community_id: community }], 'original direct member-context query works for Academy-only subscriber');
equal((await as('authenticated', academyOnly, 'select id from courses')).map(row => row.id), [academy], 'own context does not bypass entitled-course RLS');
equal(await as('authenticated', academyOnly, 'select id from academy_members'), [{ id: academyOnlyMember }], 'Academy-only member can read only own row, not Community directory');
const scannerOnly = await user(); await storeApply(scannerOnly, 'scanner', 'own-context-scanner');
const scannerOnlyMember = (await db.query('select id from academy_members where user_id=$1', [scannerOnly])).rows[0].id;
equal(await ownContext(scannerOnly), { id: scannerOnlyMember, academy_community_id: community }, 'Scanner-only subscriber resolves own context');
equal(await originalContextQuery(scannerOnly), [{ id: scannerOnlyMember, academy_community_id: community }], 'original direct member-context query works for Scanner-only subscriber');
equal(await as('authenticated', scannerOnly, 'select id from academy_members where user_id=$1', [academyOnly]), [], 'Scanner subscriber cannot read another subscriber member row');
const trialContextUid = await user();
const trialContextClaim = (await as('authenticated', trialContextUid, 'select start_turf_scanner_trial() value'))[0].value;
equal(await originalContextQuery(trialContextUid), [{ id: trialContextClaim.memberId, academy_community_id: community }], 'original direct member-context query works during Scanner trial');
const unpaidContextUid = await user(); await member(unpaidContextUid);
equal(await originalContextQuery(unpaidContextUid), [], 'active unpaid member row does not provide paid Academy context');
equal(await ownContext(await user()), null, 'unpaid account receives no Academy context');
equal(await ownContext(suspended), null, 'suspended member receives no Academy context');
await reject(as('authenticated', banned, 'select private.get_own_academy_context()'), 'banned account context denied');
await reject(as('authenticated', unverified, 'select private.get_own_academy_context()'), 'unverified account context denied');
await reject(as('anon', null, 'select private.get_own_academy_context()'), 'anonymous context denied');
await reject(as('authenticated', scannerOnly, 'select private.get_own_academy_context($1)', [academyOnly]), 'context helper has no caller-supplied identity argument');
// A single atomic reservation caps provider calls without per-request row growth.
const limited = await user(), independentLimit = await user();
await reject(as('anon', null, 'select reserve_store_verification($1)', [limited]), 'anonymous cannot reserve provider verifications');
await reject(as('authenticated', limited, 'select reserve_store_verification($1)', [limited]), 'ordinary account cannot bypass protected verification worker');
await db.exec('set role service_role');
let reservations;
try {
  reservations = await Promise.all(Array.from({ length: 25 }, () => db.query('select reserve_store_verification($1) value', [limited])));
} finally { await db.exec('reset role'); }
equal(reservations.filter(result => result.rows[0].value.allowed).length, 20, 'competing reservations permit at most twenty per window');
equal(reservations.filter(result => !result.rows[0].value.allowed).length, 5, 'excess reservations are refused');
const rejectedLimit = (await as('service_role', null, 'select reserve_store_verification($1) value', [limited]))[0].value;
equal(rejectedLimit.allowed, false, 'saturated window remains closed');
equal(rejectedLimit.retryAfterSeconds > 0 && rejectedLimit.retryAfterSeconds <= 60, true, 'rate response supplies bounded retry duration');
equal((await as('service_role', null, 'select reserve_store_verification($1) value', [independentLimit]))[0].value.allowed, true, 'one account cannot consume another account limit');
equal((await db.query('select count(*)::int n from private.academy_store_verification_rate_limits where user_id=$1', [limited])).rows[0].n, 1, 'rate limiter stores one row per account');
await db.query("update private.academy_store_verification_rate_limits set window_started_at=now()-interval '61 seconds' where user_id=$1", [limited]);
equal((await as('service_role', null, 'select reserve_store_verification($1) value', [limited]))[0].value.allowed, true, 'next minute starts a fresh reservation window');
equal((await db.query('select request_count from private.academy_store_verification_rate_limits where user_id=$1', [limited])).rows[0].request_count, 1, 'expired rate row is reused rather than appended');
await reject(as('service_role', null, 'select reserve_store_verification($1)', [banned]), 'banned account cannot reserve provider traffic');
const deleting = await user(); await storeApply(deleting, 'scanner', 'deleted-owner-purchase');
// The existing deletion flow cleans the account's own workspace before Auth
// because organizations.created_by intentionally references the profile.
await db.query('delete from organizations where created_by=$1', [deleting]);
await db.query('delete from auth.users where id=$1', [deleting]);
equal((await db.query('select count(*)::int n from auth.users where id=$1', [deleting])).rows[0].n, 0, 'store ledger does not block Auth account deletion');
equal((await db.query("select user_id from academy_store_entitlements where source_key='deleted-owner-purchase'")).rows[0].user_id, deleting, 'deleted account purchase retains immutable owner UUID');
await reject(storeApply(await user(), 'scanner', 'deleted-owner-purchase'), 'another account cannot reclaim a deleted owner purchase');
// App-closed Google completion resolves only a verified provider account hash.
const accountHash = uid => createHash('sha256').update(uid.toLowerCase(), 'utf8').digest('hex');
const resolvedGoogleAccount = async hash => (await as('service_role', null,
  'select resolve_google_store_account($1) value', [hash]))[0].value;
equal(await resolvedGoogleAccount(accountHash(scannerOnly)), scannerOnly, 'authoritative Google account hash resolves exact verified Auth UUID');
equal(await resolvedGoogleAccount('0'.repeat(64)), null, 'unknown account hash grants no identity');
equal(await resolvedGoogleAccount(accountHash(unverified)), null, 'unconfirmed Auth account cannot be resolved');
equal(await resolvedGoogleAccount(accountHash(banned)), null, 'currently banned Auth account cannot be resolved');
equal(await resolvedGoogleAccount(accountHash(deleting)), null, 'deleted Auth account cannot be resolved for fulfillment');
const softDeleted = await user(); await db.query('update auth.users set deleted_at=now() where id=$1', [softDeleted]);
equal(await resolvedGoogleAccount(accountHash(softDeleted)), null, 'soft-deleted Auth account cannot be resolved');
for (const hash of [null, 'not-a-hash', 'F'.repeat(64), '0'.repeat(65)]) {
  await reject(as('service_role', null, 'select resolve_google_store_account($1)', [hash]), 'malformed account hash is rejected');
}
await reject(as('anon', null, 'select resolve_google_store_account($1)', [accountHash(scannerOnly)]), 'anonymous cannot resolve store accounts');
await reject(as('authenticated', scannerOnly, 'select resolve_google_store_account($1)', [accountHash(scannerOnly)]), 'ordinary account cannot enumerate hash-bound identities');
const relinking = await user(); await storeApply(relinking, 'scanner', 'removed-member-link');
const formerMember = (await db.query("select academy_member_id from academy_store_entitlements where source_key='removed-member-link'")).rows[0].academy_member_id;
await db.query('delete from academy_members where id=$1', [formerMember]);
equal((await db.query("select academy_member_id from academy_store_entitlements where source_key='removed-member-link'")).rows[0].academy_member_id, null, 'member removal clears only store ledger member linkage');
await storeApply(relinking, 'scanner', 'removed-member-link', { verifiedAt: new Date(Date.now() + 1000).toISOString() });
const restoredMember = (await db.query("select academy_member_id from academy_store_entitlements where source_key='removed-member-link'")).rows[0].academy_member_id;
equal(typeof restoredMember === 'string' && restoredMember !== formerMember, true, 'verified original account can relink an existing subscription');
equal((await rights(relinking)).features, ['measuring_tool'], 'same-owner restore remains functional after member cleanup');
await db.query('delete from academy_members where id=$1', [expClaim.memberId]);
equal((await db.query('select academy_member_id from private.academy_scanner_trial_claims where user_id=$1', [expiredTrial])).rows[0].academy_member_id, null, 'member deletion does not block on historical trial');
equal((await as('authenticated', expiredTrial, 'select start_turf_scanner_trial() value'))[0].value.alreadyUsed, true, 'recreating a member never resets the trial claim');
// Database-level barriers and public wrapper properties remain explicit.
for (const name of ['get_membership_store_status(text)', 'start_turf_scanner_trial()', 'admin_activate_separate_access(uuid)']) equal((await db.query('select prosecdef from pg_proc where oid=$1::regprocedure', [name])).rows[0].prosecdef, false, `${name} wrapper is invoker`);
for (const table of ['academy_store_products', 'academy_store_entitlements']) equal((await db.query('select relrowsecurity from pg_class where oid=$1::regclass', [table])).rows[0].relrowsecurity, true, `${table} enables RLS`);
await reject(as('authenticated', trialUid, 'select * from private.academy_scanner_trial_claims'), 'trial claim ledger is private');
// A workspace/content cascade and full Academy-member cleanup also preserve
// the immutable purchase history without introducing deletion restrictions.
await db.query('delete from organizations where id=$1', [org]);
equal((await db.query('select count(*)::int n from courses where organization_id=$1', [org])).rows[0].n, 0, 'owning workspace content cleanup is not blocked by store products');
equal((await db.query("select count(*)::int n from academy_store_entitlements where source_key='own-context-academy'")).rows[0].n, 1, 'course/product cleanup preserves historical purchase ownership');
await db.query('delete from academy_communities where id=$1', [community]);
equal((await db.query('select count(*)::int n from academy_members where academy_community_id=$1', [community])).rows[0].n, 0, 'full Academy cleanup can cascade through its members');
equal((await db.query("select academy_member_id from academy_store_entitlements where source_key='own-context-academy'")).rows[0].academy_member_id, null, 'Academy cascade clears historical store member pointer');
equal((await db.query('select academy_member_id from private.academy_scanner_trial_claims where user_id=$1', [trialUid])).rows[0].academy_member_id, null, 'Academy cascade clears trial member pointer without blocking deletion');
await db.close();
console.log(`Independent memberships SQL: ${assertions} assertions passed against ${migrations.length} release migrations. No live changes.`);
