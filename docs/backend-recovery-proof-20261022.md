# Backend release recovery proof — 22 October 2026

The private preimage and local rehearsal for the October 22 backend release passed. This permits review of the additive backend release; the broader member-migration recovery gate is still open.

## What was saved and verified

- Read-only connector queries captured 89 application/private, Auth account/identity, Storage-metadata and migration-history tables: 10,498 rows. Each table has its own capture timestamp; this is not one global transactional database snapshot.
- Hosted preimages include 1,110 column definitions, 114 application/private function definitions and ACLs, 187 policies, 61 triggers, constraints, indexes, enum definitions, roles and role memberships, extension inventory and cron names/schedules. Cron commands and Vault secret values were excluded.
- Every table was restored into an isolated, in-memory PGlite database using 44 historical migrations and managed-service table stubs. No network calls, live writes, emails or payment calls were made by the restore harness.
- All restored table values matched the captured source. For 88 tables, the hosted aggregate SHA-256 matched directly. For the operational snapshot-run table, hosted/local collation changes row ordering: the original export SHA-256 matched the source, and the exact PostgreSQL row-text multiset matched after restore. No row or numeric value was waived.
- All nine October 22 migrations and the private inactive/active $10 measuring-plan SQL scripts applied successfully to that restored data.
- Eleven protected tables retained the exact values of every preexisting column: members, member links, access grants, feature grants, billing subscriptions, lesson progress, courses, modules, lessons, posts and comments. Newly added moderation audit columns were compared separately from existing content.
- The measuring-price rehearsal added one $10 monthly plan and one feature mapping. The old measuring plan changed only its new-sale `active` flag and `updated_at`; existing subscription rows and access grants were unchanged.

## Private evidence

These files are ignored by Git. The directory is mode `0700`; files and archive are mode `0600`.

- `output/private/backend-recovery-20261022/export-receipt.json`
- `output/private/backend-recovery-20261022/schema-preimages.json`
- `output/private/backend-recovery-20261022/local-restore-verification.json`
- `output/private/backend-recovery-20261022/private-file-integrity-manifest.json`
- `output/private/backend-recovery-20261022.tar.gz`
- `output/private/backend-recovery-20261022-archive-receipt.json`

The archive SHA-256 is `ae995999374a5d3ee66ec078230d01b8f7fe52bd8349651ee8e362c6f3dd6f0f` (7,820,663 bytes). Keep it private: it contains member/account records and password hashes.

## Limits and remaining migration recovery gate

The release changes no existing Storage object bytes. The 155 private Storage objects (41,252,276 recorded bytes) were inventoried, but their file bytes were not backed up here. Managed Auth/Storage services, hosted project configuration and credentials were not restored by PGlite. There is no verified off-device copy or complete hosted disaster-recovery rehearsal.

Before a bulk member migration or source-of-truth cutover, complete the database/roles/schema export, private Storage-byte backup, off-device ownership and isolated hosted restore checks in [member-migration-recovery.md](member-migration-recovery.md). Do not reset production, replay the full migration history or treat a frontend rollback as a database/payment rollback.

For a backend correction, use the saved preimages and a reviewed forward change. This exercise does not authorize live table replacement or bulk restoration over current member activity.
