import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationDirectory = path.join(root, "supabase", "migrations");
const migrationNames = (await readdir(migrationDirectory))
  .filter((name) => name.endsWith(".sql"))
  .sort();
const migrations = await Promise.all(migrationNames.map(async (name) => ({
  name,
  sql: await readFile(path.join(migrationDirectory, name), "utf8"),
})));
const allSql = migrations.map(({ sql }) => sql).join("\n");
const failures = [];

const academySql = migration("20260917165624_separate_academy_tenancy_and_import_ledger.sql");
const infillSql = migration("20260917203000_infill_calculator.sql");
const nativeAcademySql = migration("20260917223000_native_academy_cutover.sql");
const progressSql = migration("20260918010000_preserve_imported_course_progress.sql");
const memberAccessSql = migration("20260918073008_academy_member_access_provisioning.sql");
const billingSql = migration("20260918080238_academy_billing_entitlements.sql");

requireFragments(academySql, "schema", [
  "create table public.academy_communities",
  "owner_organization_id uuid references public.organizations",
  "create table public.academy_members",
  "create table public.source_import_batches",
  "create table public.source_import_records",
  "foreign key (academy_community_id, academy_member_id)",
  "foreign key (academy_community_id, follower_member_id)",
  "foreign key (academy_community_id, followed_member_id)",
  "foreign key (academy_community_id, batch_id)",
  "create or replace function private.can_access_academy_lesson_progress",
  "create or replace function private.can_access_academy_event_rsvp",
]);

requireFragments(infillSql, "infill schema", [
  "infill_rate numeric(4,2)",
  "total_infill_pounds numeric(12,2)",
  "bag_count_40 integer",
  "bag_count_50 integer",
  "service_rate numeric(10,2)",
  "create or replace function public.create_infill_calculation",
  "security invoker",
  "revoke execute on function public.create_infill_calculation",
  "grant execute on function public.create_infill_calculation",
]);

requireFragments(nativeAcademySql, "native Academy schema", [
  "create table public.course_enrollments",
  "create table public.academy_assets",
  "create table public.academy_member_invites",
  "create table public.academy_post_reactions",
  "create table public.academy_comment_reactions",
  "create table public.academy_post_bookmarks",
  "add column if not exists group_title text",
  "create or replace function private.can_access_course",
  "create or replace function public.create_academy_comment",
  "create or replace function public.set_academy_lesson_completion",
  "create or replace function public.toggle_academy_post_reaction",
  "create or replace function public.toggle_academy_post_bookmark",
  "create or replace function public.toggle_academy_event_rsvp",
  "Post title must be between 1 and 120 characters",
  "Comment body must be between 1 and 5000 characters",
  "revoke all on function public.notify_post_author_on_comment() from public, anon, authenticated;",
  "values ('academy-assets', 'academy-assets', false",
]);

requireFragments(progressSql, "course progress schema", [
  "add column if not exists source_progress_percent integer",
  "add column if not exists source_login_count integer",
  "add column if not exists source_last_login_at timestamptz",
  "source_progress_percent is null or source_progress_percent between 0 and 100",
]);

requireFragments(memberAccessSql, "member access schema", [
  "'pending', 'provisioned', 'sent', 'accepted', 'failed', 'cancelled'",
  "add column if not exists provisioned_at timestamptz",
  "add column if not exists attempt_count integer",
  "create or replace function public.ensure_academy_user_workspace",
  "create or replace function public.claim_academy_memberships",
  "where id = current_user_id and email_confirmed_at is not null",
  "grant execute on function public.ensure_academy_user_workspace(uuid, text, text)",
  "to service_role",
  "grant execute on function public.claim_academy_memberships()",
  "to authenticated",
]);

requireFragments(billingSql, "Academy billing schema", [
  "create table public.academy_billing_plans",
  "create table public.academy_billing_customers",
  "create table public.academy_billing_subscriptions",
  "create table public.academy_access_grants",
  "'import', 'manual', 'stripe_subscription', 'stripe_payment'",
  "create or replace function private.has_active_academy_grant",
  "create or replace function public.get_academy_access_state",
  "create or replace function public.get_academy_billing_overview",
  "create or replace function public.upsert_academy_import_access_grant",
  "create or replace function public.apply_academy_billing_event",
  "on conflict (academy_member_id, source_type, source_key) where course_id is null",
  "revoke all on function public.upsert_academy_import_access_grant",
  "revoke all on function public.apply_academy_billing_event",
  "to service_role",
]);

requireFragments(allSql, "security hardening", [
  "revoke all on all tables in schema public from anon;",
  "revoke execute on all functions in schema public from public, anon;",
  "revoke create on schema public from public, anon, authenticated;",
]);

const publicTables = new Set(matches(allSql, /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z0-9_]+)/gi));
for (const table of publicTables) {
  const rls = new RegExp(`alter\\s+table\\s+(?:if\\s+exists\\s+)?public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, "i");
  if (!rls.test(allSql)) failures.push(`RLS is not enabled for public.${table}`);
}

for (const { name, sql } of migrations) {
  const viewPattern = /create\s+(?:or\s+replace\s+)?view\s+public\.([a-z0-9_]+)([\s\S]*?)\bas\b/gi;
  for (const match of sql.matchAll(viewPattern)) {
    if (!/with\s*\(\s*security_invoker\s*=\s*true\s*\)/i.test(match[0])) {
      failures.push(`Public view ${match[1]} in ${name} is missing security_invoker = true`);
    }
  }

  const functionPattern = /create\s+or\s+replace\s+function\s+([^\s(]+)[\s\S]*?\$\$\s*;/gi;
  for (const match of sql.matchAll(functionPattern)) {
    if (/security\s+definer/i.test(match[0]) && !/set\s+search_path\s*=/i.test(match[0])) {
      failures.push(`SECURITY DEFINER function ${match[1]} in ${name} has no fixed search_path`);
    }
  }

  if (/\bservice_role\b\s*[:=]|private integration token\s*[:=]|pit-[a-z0-9-]{10,}/i.test(sql)) {
    failures.push(`Migration ${name} contains a credential-like value`);
  }
}

if (/\bfor\s+all\s+to\s+authenticated\b/i.test(academySql)) {
  failures.push("Academy policies must declare select/insert/update/delete explicitly");
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`Schema contracts passed across ${migrations.length} migrations and ${publicTables.size} public tables.`);

function migration(name) {
  const found = migrations.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`Missing migration ${name}`);
  return found.sql;
}

function requireFragments(sql, label, fragments) {
  for (const fragment of fragments) {
    if (!sql.includes(fragment)) failures.push(`Missing ${label} contract: ${fragment}`);
  }
}

function matches(value, pattern) {
  return Array.from(value.matchAll(pattern), (match) => match[1]);
}
