# Member migration recovery gate

Verified 22 October 2026 during the readiness audit. This is a release prerequisite, not a completed backup or restore.

Later the same day, a [private backend preimage and isolated local restore](backend-recovery-proof-20261022.md) passed for the nine October 22 migrations and measuring-price cutover. It preserves the existing application rows and schema preimages. The broader hosted recovery and member-migration gate below remains open: Storage bytes, off-device ownership and managed-service restore were not verified.

## Current evidence

- The hosted Supabase project is on the Free plan. Its Backups page states that project backups are not included.
- The old community capture/archive and today's read-only aggregate receipts are useful comparison evidence. They do not contain a complete recoverable database, Auth configuration and Storage object backup.
- The private `output/private/migration-20261022/pre-release-invariants.json` records only counts and database-computed SHA-256 fingerprints for members, member links, access grants, feature grants, billing subscriptions and lesson progress. It contains no row bodies. It cannot restore anything.
- Database archiver counters and a successful SQL query are not evidence that the owner can restore the project.

## Before inviting a pilot or changing the migration source of truth

1. Obtain a recoverable database backup in an owner-controlled private destination. Either enable an appropriate hosted backup plan, or use the documented Supabase CLI export with the existing authorized database connection. Do not paste the connection password into chat, command history, project files or Git.
2. Include database roles, schema and data. The installed CLI help confirms `db dump --role-only`, normal schema dump, and `--data-only --use-copy` as separate exports. The default schema dump is not a data backup. Follow current Supabase restore guidance for Auth and platform-owned schemas; do not assume a public-schema-only dump preserves sign-in accounts.
3. Copy private Storage object bytes separately, preserving bucket/object paths and access settings. Database backups include object metadata, not the uploaded files themselves. Include course assets, community photos and historical archive assets.
4. Record function source/version, migration history, Auth URLs/SMTP configuration, cron jobs and secret *names*. Store secret values only through the owner's existing secret manager. Do not put them into the report or backup manifest.
5. Restore into an isolated non-production project and verify account/link counts, published course/module/lesson counts, access decisions, progress, attachment bytes and path ownership. Use a controlled test account; block outbound email, production webhooks and charges in the restored environment.
6. Record backup timestamps, export hashes, private owner location, the actual restore result and who can perform recovery. No bulk invitation or cutover until the result is confirmed.

## During the approved pilot

- Save a fresh exact-member dry-run, source roster timestamp and pre-release comparison fingerprints. Review differences; normal member activity can legitimately change progress or timestamps.
- Keep GoHighLevel available for the agreed transition period. Do not delete source members, posts, courses or history.
- Use exact reviewed member IDs in small batches. Account setup and sign-in email are separate actions. A failed or uncertain email/provider operation must be reconciled before retrying.
- Stop the next batch if login, access, missing content, duplicate billing or unconfirmed delivery appears. Preserve the error and affected IDs privately.
- Turning a payment feature off stops new checkouts; it does not cancel existing subscriptions or reverse charges. Reconcile provider state separately.

## If a release fails

1. Pause additional invitations and new purchase entry points through the existing approved controls. Keep existing entitlements and subscriptions intact.
2. Identify whether the failure is frontend, function/provider configuration or stored data. A frontend rollback does not undo a database migration or external payment.
3. Prefer a reviewed forward correction for a data issue. Do not drop new tables, replay old migrations, reset production, delete accounts or overwrite active member data as a routine rollback.
4. If restoration is necessary, use the tested recovery procedure and reconcile all member activity, new accounts, emails and payments since the backup before reopening access.
5. Repeat the physical-device pilot and read-only access/billing checks before continuing the next wave.

## References

- [Supabase database backups](https://supabase.com/docs/guides/platform/backups)
- [Supabase platform export and restore](https://supabase.com/docs/guides/self-hosting/restore-from-platform)

No backup was created, no plan was upgraded and no production state was changed by this audit.
