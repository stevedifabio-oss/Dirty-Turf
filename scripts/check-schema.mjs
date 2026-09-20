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
const deletionSql = migration("20260918150000_account_deletion_requests.sql");
const notificationSql = migration("20260918154500_academy_notification_delivery.sql");
const accessPathSql = migration("20260918155500_optimize_member_access_paths.sql");
const notificationPathSql = migration("20260918161500_optimize_notification_paths.sql");
const foreignKeyPathSql = migration("20260918172137_cover_remaining_foreign_keys.sql");
const academyStorageManagerSql = migration("20260918173500_allow_academy_managers_to_read_storage.sql");
const academyStoragePathSql = migration("20260918174000_fix_academy_storage_admin_paths.sql");
const mapGeocodeSql = migration("20260918191038_map_geocoding_guardrails.sql");
const academyAdminSql = migration("20260920113000_academy_admin_and_certificates.sql");

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

requireFragments(deletionSql, "account deletion schema", [
  "create table public.account_deletion_requests",
  "user_id uuid not null unique references auth.users(id) on delete cascade",
  "create policy account_deletion_requests_select_own",
  "create policy account_deletion_requests_insert_own",
  "revoke all on table public.account_deletion_requests from public, anon, authenticated",
  "grant insert (user_id, reason) on table public.account_deletion_requests to authenticated",
]);

requireFragments(notificationSql, "Academy notification schema", [
  "create table public.academy_email_deliveries",
  "create table public.academy_content_mentions",
  "create or replace function private.queue_academy_notification",
  "create or replace function private.record_academy_mentions",
  "create or replace function public.toggle_academy_comment_reaction",
  "create trigger academy_post_notification",
  "create trigger academy_post_reaction_notification",
  "create trigger academy_comment_reaction_notification",
  "create trigger academy_mention_notification",
  "create trigger academy_event_published_notification",
  "create trigger academy_course_published_notification",
  "create trigger academy_access_grant_notification",
  "create or replace function private.notify_academy_access_granted",
  "source_import_batch_id is not null",
  "create or replace function public.queue_academy_welcome_emails",
  "create or replace function public.queue_academy_scheduled_notifications",
  "create or replace function public.claim_academy_email_deliveries",
  "create or replace function public.complete_academy_email_delivery",
  "create or replace function public.fail_academy_email_delivery",
  "grant execute on function public.claim_academy_email_deliveries(integer, uuid) to service_role",
]);

requireFragments(accessPathSql, "member access optimization", [
  "using (user_id = (select auth.uid()))",
  "academy_members_user_lookup_idx",
  "academy_billing_customers_member_idx",
  "academy_billing_customers_user_idx",
]);

requireFragments(notificationPathSql, "notification path optimization", [
  "academy_email_deliveries_community_idx",
  "academy_email_deliveries_notification_idx",
  "academy_email_deliveries_profile_idx",
  "academy_content_mentions_community_idx",
  "academy_content_mentions_actor_idx",
  "academy_content_mentions_recipient_idx",
]);

requireFragments(foreignKeyPathSql, "foreign key path optimization", [
  "constraint_row.contype = 'f'",
  "namespace.nspname = 'public'",
  "existing_index.indisvalid",
  "create index if not exists",
]);

requireFragments(academyStorageManagerSql, "Academy storage manager access", [
  "create policy \"academy_storage_admin_read\" on storage.objects",
  "bucket_id = 'academy-assets'",
  "private.can_manage_academy(c.id)",
]);

requireFragments(academyStoragePathSql, "Academy storage policy paths", [
  "drop policy if exists \"academy_storage_admin_insert\" on storage.objects",
  "storage.foldername(storage.objects.name)",
  "create policy \"academy_storage_admin_read\" on storage.objects",
  "create policy \"academy_storage_admin_insert\" on storage.objects",
  "create policy \"academy_storage_admin_update\" on storage.objects",
  "create policy \"academy_storage_admin_delete\" on storage.objects",
]);

requireFragments(mapGeocodeSql, "map geocoding guardrails", [
  "create table public.map_geocode_cache",
  "create table public.map_geocode_request_slots",
  "alter table public.map_geocode_cache enable row level security",
  "alter table public.map_geocode_request_slots enable row level security",
  "revoke all on table public.map_geocode_cache from public, anon, authenticated",
  "grant select, insert, update, delete on table public.map_geocode_cache to service_role",
]);

requireFragments(academyAdminSql, "Academy administration and certificates", [
  "create table public.academy_quiz_attempts",
  "create table public.academy_certificate_templates",
  "create table public.academy_certificates",
  "create table public.academy_member_blocks",
  "Only Academy administrators can post in this category",
  "revoke insert on public.academy_quiz_attempts from authenticated",
  "Quiz score does not match the submitted answers",
  "Pass the quiz before completing this lesson",
  "create or replace function public.report_academy_content",
  "create or replace function public.toggle_academy_member_block",
  "create or replace function public.admin_set_member_course_access",
  "create or replace function public.admin_issue_academy_certificate",
  "create or replace function public.verify_academy_certificate",
  "revoke all on function private.issue_academy_certificate",
  "grant execute on function public.report_academy_content",
]);

requireFragments(allSql, "security hardening", [
  "revoke all on all tables in schema public from anon;",
  "revoke execute on all functions in schema public from public, anon;",
  "revoke create on schema public from public, anon, authenticated;",
]);

for (const [file, fragments] of [
  ["supabase/functions/academy-import/index.ts", ["existingAsset?.storage_bucket", "existingAsset?.storage_path", "existingAsset?.content_hash", "preserveImportedPostMedia", ".select(\"id,media\")", "storage_bucket", "storage_path"]],
  ["supabase/functions/ghl-webhook/index.ts", ["x-ghl-signature", "MAX_WEBHOOK_BYTES"]],
  ["supabase/functions/ghl-status/index.ts", ["handlePreflight(request, \"GET, OPTIONS\")", "Administrator access required"]],
  ["supabase/functions/academy-notifications/index.ts", ["x-notification-secret", "claim_academy_email_deliveries", "NOTIFICATION_SIGNING_SECRET", "List-Unsubscribe=One-Click", "MAILGUN_API_KEY"]],
  ["supabase/functions/map-geocode/index.ts", ["get_academy_access_state", "map_geocode_request_slots", "DirtyTurfAcademy/1.0", "nominatim.openstreetmap.org", "Retry-After"]],
]) {
  const source = await readFile(path.join(root, file), "utf8");
  requireFragments(source, file, fragments);
}

const supabaseConfig = await readFile(path.join(root, "supabase", "config.toml"), "utf8");
requireFragments(supabaseConfig, "notification function configuration", [
  "[functions.academy-notifications]",
  "verify_jwt = false",
]);
requireFragments(supabaseConfig, "map geocoder function configuration", [
  "[functions.map-geocode]",
  "verify_jwt = true",
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
