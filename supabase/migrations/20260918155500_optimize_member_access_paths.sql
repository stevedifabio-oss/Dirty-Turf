drop policy if exists account_deletion_requests_select_own
  on public.account_deletion_requests;
create policy account_deletion_requests_select_own
  on public.account_deletion_requests
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists account_deletion_requests_insert_own
  on public.account_deletion_requests;
create policy account_deletion_requests_insert_own
  on public.account_deletion_requests
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'requested'
    and processed_at is null
    and processed_by is null
    and internal_note is null
  );

create index if not exists academy_members_user_lookup_idx
  on public.academy_members (user_id)
  where user_id is not null;

create index if not exists academy_billing_customers_member_idx
  on public.academy_billing_customers (academy_member_id);

create index if not exists academy_billing_customers_user_idx
  on public.academy_billing_customers (user_id);
