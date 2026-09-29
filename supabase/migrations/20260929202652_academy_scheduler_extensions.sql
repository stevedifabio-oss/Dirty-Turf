-- Server-side schedules call authenticated workers using secrets in Vault.
-- No job is enabled by this migration; activation is an explicit operation.
do $$
begin
  -- Lightweight isolated PostgreSQL test runtimes do not ship hosted extensions.
  if exists(select 1 from pg_available_extensions where name='pg_cron') then
    create extension if not exists pg_cron;
  end if;
  if exists(select 1 from pg_available_extensions where name='pg_net') then
    create extension if not exists pg_net;
  end if;
end $$;
