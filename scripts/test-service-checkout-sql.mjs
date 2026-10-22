// Execute all repository SQL in isolated PostgreSQL (PGlite), never a hosted database.
// PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node scripts/test-service-checkout-sql.mjs
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE || "@electric-sql/pglite");
const db = new PGlite();
const migrationName = "20261022153645_academy_service_checkout.sql";
let assertions = 0;
const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); assertions++; };
const rejects = async (action, code, label) => { await assert.rejects(action, { code }, label); assertions++; };
const uuid = () => crypto.randomUUID();

try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select current_user::text $$;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key,bucket_id text,name text,owner uuid);
    alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql as $$ select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1] $$;
    create function public.rls_auto_enable() returns event_trigger language plpgsql as $$ begin return; end $$;
    create publication supabase_realtime;
    grant usage on schema public,auth,storage to anon,authenticated,service_role;
    grant select,insert,update,delete on storage.objects to anon,authenticated,service_role;
    alter default privileges in schema public grant select,insert,update,delete on tables to anon,authenticated,service_role;
  `);
  const directory = new URL("../supabase/migrations/", import.meta.url);
  const migrations = (await readdir(directory)).filter((name) => name.endsWith(".sql") && name < migrationName).sort();
  for (const name of migrations) {
    const sql = (await readFile(new URL(name, directory), "utf8")).replace("create extension if not exists pgcrypto;", "");
    try { await db.exec(sql); } catch (error) { throw new Error(`Migration ${name}: ${error.message}`, { cause: error }); }
  }
  const as = async (role,user,query,params=[])=>{
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user||'']);
    await db.exec(`set role ${role}`);
    try { return (await db.query(query,params)).rows; } finally { await db.exec('reset role'); }
  };
  const owner=uuid(),otherOwner=uuid(),user=uuid(),peerUser=uuid();
  for(const id of [owner,otherOwner,user,peerUser]) await db.query('insert into auth.users(id,email) values($1,$2)',[id,id+'@example.test']);
  const org=(await db.query('select id from organizations where created_by=$1',[owner])).rows[0].id;
  const otherOrg=(await db.query('select id from organizations where created_by=$1',[otherOwner])).rows[0].id;
  const community=uuid(),otherCommunity=uuid(),member=uuid(),peer=uuid();
  await db.query("insert into academy_communities(id,owner_organization_id,name,slug,portal_url,pricing_gates_enabled) values($1,$2,'Service test','service-test','https://example.test',true),($3,$4,'Other','other-service','https://example.test',true)",[community,org,otherCommunity,otherOrg]);
  for(const [id,uid] of [[member,user],[peer,peerUser]]) {
    await db.query("insert into academy_members(id,academy_community_id,user_id,display_name,status) values($1,$2,$3,'Member','active')",[id,community,uid]);
    await db.query("insert into academy_access_grants(academy_community_id,academy_member_id,source_type,source_key) values($1,$2,'import','preserved')",[community,id]);
  }
  const snapshot=async()=>{
    const data={};
    for(const table of ['academy_members','academy_access_grants','academy_feature_grants','academy_billing_plans','academy_billing_subscriptions','course_enrollments']) data[table]=(await db.query(`select to_jsonb(row) row from ${table} row order by to_jsonb(row)::text`)).rows;
    return data;
  };
  const preserved=await snapshot();
  await db.exec(await readFile(new URL(migrationName,directory),'utf8'));
  eq(await snapshot(),preserved,'migration does not alter Academy billing, subscriptions, membership or grants');
  const requestId=uuid();
  await as('authenticated',user,"select create_academy_growth_request('website','New site',$1)",[requestId]);
  const create=(uid=owner,amount=149500,interval='one_time',price=null,rid=requestId)=>as('authenticated',uid,'select create_academy_service_quote($1,$2,$3,$4) result',[rid,price,amount,interval]).then(rows=>rows[0].result);
  await rejects(()=>create(user),'42501','member cannot offer a quote');
  await rejects(()=>create(otherOwner),'42501','other tenant owner cannot offer quote');
  await rejects(()=>create(owner,149499),'22023','out-of-range amount denied');
  await rejects(()=>create(owner,149500,'month'),'22023','website cannot be switched to monthly');
  await rejects(()=>create(owner,149500,'one_time',"price_x';select 1;--"),'22023','unsafe price ID denied');
  const quote=await create();
  eq(quote.stripe_price_id,null,'amount-only admin quote does not require a Price ID');
  eq((await create()).id,quote.id,'retry with identical terms returns the same immutable quote');
  await rejects(()=>create(owner,150000),'22023','retry with changed amount holds instead of duplicating');
  await rejects(()=>create(owner,149500,'one_time','price_changed'),'22023','inline/configured pricing cannot silently change on retry');
  eq((await as('authenticated',user,'select id,amount_cents,status from academy_service_quotes'))[0],{id:quote.id,amount_cents:149500,status:'offered'},'member reads own safe quote fields');
  eq(await as('authenticated',peerUser,'select id from academy_service_quotes'),[],'peer cannot read quote');
  eq(await as('authenticated',otherOwner,'select id from academy_service_quotes'),[],'other tenant owner cannot read quote');
  await rejects(()=>as('authenticated',user,'select stripe_price_id from academy_service_quotes'),'42501','member cannot select admin price mapping');
  await rejects(()=>as('authenticated',user,'select list_academy_service_quotes($1)',[community]),'42501','member cannot invoke admin quote list');
  const adminQuotes=(await as('authenticated',owner,'select list_academy_service_quotes($1) result',[community]))[0].result;
  eq(adminQuotes[0].id,quote.id,'verified owner can load quote administration');
  await rejects(()=>as('authenticated',owner,"update academy_service_quotes set amount_cents=1 where id=$1",[quote.id]),'42501','terms are immutable through direct client writes');
  const reserve=(uid=user,retry=uuid())=>as('service_role',null,'select reserve_academy_service_checkout($1,$2,$3,false) result',[quote.id,uid,retry]).then(rows=>rows[0].result);
  await rejects(()=>reserve(peerUser),'42501','trusted reservation still verifies the quote owner');
  await rejects(()=>as('authenticated',user,'select reserve_academy_service_checkout($1,$2,$3,false)',[quote.id,user,uuid()]),'42501','member cannot invoke service-role checkout writer');
  const order=await reserve();
  eq((await reserve(user,uuid())).id,order.id,'different retry IDs resume the same pending order');
  eq((await db.query('select count(*)::int count from academy_service_orders')).rows[0].count,1,'only one pending order exists');
  await rejects(()=>as('authenticated',owner,'select withdraw_academy_service_quote($1)',[quote.id]),'22023','quote cannot be replaced while checkout is pending');
  await as('service_role',null,'select record_academy_service_checkout($1,$2,$3)',[order.id,'cs_test_service','https://checkout.stripe.com/c/pay/cs_test_service']);
  await rejects(()=>as('service_role',null,'select record_academy_service_checkout($1,$2,$3)',[order.id,'cs_wrong','https://checkout.stripe.com/c/pay/cs_wrong']),'22023','Checkout session cannot be reassigned');
  await rejects(()=>as('authenticated',user,"select apply_academy_service_checkout($1,'cs_test_service','evt_forged','paid',null,null,null)",[order.id]),'42501','member cannot forge payment confirmation');
  const paid=()=>as('service_role',null,"select apply_academy_service_checkout($1,'cs_test_service','evt_paid','paid','cus_service',null,'pi_service')",[order.id]);
  await paid();
  const paidRows=(await db.query('select to_jsonb(o) row from academy_service_orders o')).rows;
  await paid();
  eq((await db.query('select to_jsonb(o) row from academy_service_orders o')).rows,paidRows,'duplicate webhook does not rewrite payment or timestamps');
  eq((await db.query('select status from academy_service_quotes where id=$1',[quote.id])).rows[0].status,'paid','quote records verified payment');
  eq((await db.query('select status from academy_growth_requests where id=$1',[requestId])).rows[0].status,'contacted','paid service stays in the work queue; not delivered/closed');
  await as('service_role',null,"select apply_academy_service_checkout($1,'cs_test_service','evt_late_expiry','cancelled',null,null,null)",[order.id]);
  eq((await db.query('select status from academy_service_orders where id=$1',[order.id])).rows[0].status,'paid','late cancellation cannot downgrade a paid order');
  await rejects(()=>reserve(),'42501','paid quote cannot open another payment');
  await rejects(()=>create(),'22023','paid request cannot receive another quote');
  eq((await as('authenticated',user,'select status from academy_service_orders'))[0].status,'paid','member sees authoritative paid receipt');
  await rejects(()=>as('authenticated',user,'select provider_customer_id from academy_service_orders'),'42501','provider customer data is not a public member column');
  eq(await snapshot(),preserved,'quote/checkout/payment operations never change Academy entitlements or subscription billing');
  const monthlyRequest=uuid();
  await as('authenticated',user,"select create_academy_growth_request('website-care','Care',$1)",[monthlyRequest]);
  const monthlyQuote=await create(owner,9700,'month',null,monthlyRequest);
  const monthlyOrder=(await as('service_role',null,'select reserve_academy_service_checkout($1,$2,$3,false) result',[monthlyQuote.id,user,uuid()]))[0].result;
  await as('service_role',null,"select apply_academy_service_checkout($1,'cs_test_care','evt_care_paid','paid','cus_service','sub_service',null)",[monthlyOrder.id]);
  await as('service_role',null,"select apply_academy_service_subscription($1,'sub_service','cus_service','active',true,now()+interval '1 month',1000)",[monthlyOrder.id]);
  eq((await db.query('select status,subscription_status,cancel_at_period_end from academy_service_orders where id=$1',[monthlyOrder.id])).rows[0],{status:'paid',subscription_status:'active',cancel_at_period_end:true},'service lifecycle records cancellation schedule separately from initial paid receipt');
  await as('service_role',null,"select apply_academy_service_subscription($1,'sub_service','cus_service','past_due',false,null,999)",[monthlyOrder.id]);
  eq((await db.query('select subscription_status from academy_service_orders where id=$1',[monthlyOrder.id])).rows[0].subscription_status,'active','older lifecycle event cannot overwrite newer state');
  await as('service_role',null,"select apply_academy_service_subscription($1,'sub_service','cus_service','canceled',false,null,1001)",[monthlyOrder.id]);
  eq((await db.query('select subscription_status from academy_service_orders where id=$1',[monthlyOrder.id])).rows[0].subscription_status,'canceled','cancellation is visible without changing Academy access');
  await rejects(()=>as('service_role',null,"select apply_academy_service_subscription($1,'sub_service','cus_other','active',false,null,1002)",[monthlyOrder.id]),'22023','subscription customer cannot be reassigned');
  await rejects(()=>as('authenticated',user,"select apply_academy_service_subscription($1,'sub_service','cus_service','active',false,null,1002)",[monthlyOrder.id]),'42501','members cannot forge service lifecycle state');
  await db.exec('begin');
  await db.query("update academy_access_grants set status='revoked' where academy_member_id=$1",[member]);
  eq((await as('authenticated',user,'select id from academy_service_orders where id=$1',[monthlyOrder.id]))[0].id,monthlyOrder.id,'member retains own billing receipts after Academy access expires');
  eq(await as('authenticated',user,'select id from academy_service_quotes'),[],'expired Academy access does not expose new service quotes');
  await db.exec('rollback');
  // A mistaken quote can be withdrawn only before any pending Checkout exists.
  const seoRequest=uuid();
  await as('authenticated',user,"select create_academy_growth_request('seo-aeo','SEO',$1)",[seoRequest]);
  const seoQuote=await create(owner,149500,'one_time',null,seoRequest);
  await as('authenticated',owner,'select withdraw_academy_service_quote($1)',[seoQuote.id]);
  const corrected=await create(owner,159500,'one_time',null,seoRequest);
  eq(corrected.id!==seoQuote.id,true,'withdrawal preserves old quote and allows a fresh corrected version');
  eq((await db.query('select count(*)::int count from academy_service_quotes where request_id=$1',[seoRequest])).rows[0].count,2,'quote history is not overwritten');
  eq(await snapshot(),preserved,'subscription status/cancellation and quote replacement preserve all Academy billing and grants');
  await rejects(()=>as('authenticated',user,"select get_server_runtime_config(array['STRIPE_SERVICE_WEBHOOK_SECRET'])"),'42501','service Vault configuration cannot be read by a member');
  console.log(JSON.stringify({passed:true,assertions,scope:'isolated service quote and Checkout SQL; no hosted writes'}));
} finally { await db.close(); }
