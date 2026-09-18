create table public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  reason text,
  status text not null default 'requested' check (status in ('requested', 'in_review', 'completed', 'declined')),
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz,
  processed_by uuid references auth.users(id) on delete set null,
  internal_note text,
  check (reason is null or char_length(reason) <= 1000)
);

alter table public.account_deletion_requests enable row level security;

create policy account_deletion_requests_select_own
  on public.account_deletion_requests
  for select
  to authenticated
  using (user_id = auth.uid());

create policy account_deletion_requests_insert_own
  on public.account_deletion_requests
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and status = 'requested'
    and processed_at is null
    and processed_by is null
    and internal_note is null
  );

revoke all on table public.account_deletion_requests from public, anon, authenticated;
grant select on table public.account_deletion_requests to authenticated;
grant insert (user_id, reason) on table public.account_deletion_requests to authenticated;

create index account_deletion_requests_status_requested_at_idx
  on public.account_deletion_requests (status, requested_at);

