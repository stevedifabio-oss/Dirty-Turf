import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationPath = path.join(root, "supabase", "migrations", "20260917165624_separate_academy_tenancy_and_import_ledger.sql");
const sql = await readFile(migrationPath, "utf8");

const requiredFragments = [
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
  "set search_path = ''",
  "create or replace view public.community_feed with (security_invoker = true)",
];

const rlsTables = [
  "academy_communities",
  "academy_members",
  "academy_member_links",
  "academy_member_follows",
  "source_import_batches",
  "source_import_records",
  "academy_member_lesson_progress",
  "academy_member_event_rsvps",
];

const failures = [];

for (const fragment of requiredFragments) {
  if (!sql.includes(fragment)) failures.push(`Missing schema contract: ${fragment}`);
}

for (const table of rlsTables) {
  if (!sql.includes(`alter table public.${table} enable row level security;`)) {
    failures.push(`RLS is not enabled for public.${table}`);
  }
}

if (/\bfor\s+all\s+to\s+authenticated\b/i.test(sql)) {
  failures.push("New Academy policies must declare select/insert/update/delete explicitly");
}

if (/service_role|private integration token|pit-[a-z0-9-]{10,}/i.test(sql)) {
  failures.push("Migration contains a credential-like value");
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`Schema contract passed for ${path.relative(root, migrationPath)}.`);
