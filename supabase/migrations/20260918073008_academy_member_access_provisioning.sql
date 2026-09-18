-- Provision imported Academy members before launch without sending email, then
-- let a verified auth session claim the matching membership on first sign-in.

alter table public.academy_member_invites
  drop constraint if exists academy_member_invites_status_check;

alter table public.academy_member_invites
  add constraint academy_member_invites_status_check
  check (status in ('pending', 'provisioned', 'sent', 'accepted', 'failed', 'cancelled')),
  add column if not exists provisioned_at timestamptz,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists attempt_count integer not null default 0 check (attempt_count >= 0),
  add column if not exists delivery_count integer not null default 0 check (delivery_count >= 0),
  add column if not exists last_action text check (last_action in ('provision', 'notify', 'claim'));

alter table public.academy_member_invites
  drop constraint if exists academy_member_invites_invited_user_id_fkey;

alter table public.academy_member_invites
  add constraint academy_member_invites_invited_user_id_fkey
  foreign key (invited_user_id) references public.profiles(id) on delete set null;

create index if not exists academy_member_invites_status_idx
  on public.academy_member_invites(academy_community_id, status, created_at);

create or replace function public.ensure_academy_user_workspace(
  target_user_id uuid,
  target_full_name text default '',
  target_company_name text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  workspace_id uuid;
  workspace_name text;
  workspace_slug text;
begin
  if target_user_id is null or not exists (
    select 1 from auth.users where id = target_user_id
  ) then
    raise exception 'Auth user is required' using errcode = '23503';
  end if;

  insert into public.profiles (id, full_name)
  values (target_user_id, coalesce(target_full_name, ''))
  on conflict (id) do update
    set full_name = case
      when public.profiles.full_name = '' then excluded.full_name
      else public.profiles.full_name
    end;

  select organization_id into workspace_id
  from public.organization_members
  where user_id = target_user_id
  order by created_at
  limit 1;

  if workspace_id is not null then
    return workspace_id;
  end if;

  workspace_name := coalesce(nullif(trim(target_company_name), ''), 'My turf company');
  workspace_slug := trim(both '-' from lower(regexp_replace(workspace_name, '[^a-zA-Z0-9]+', '-', 'g')));
  if workspace_slug = '' then workspace_slug := 'turf-company'; end if;
  workspace_slug := workspace_slug || '-' || left(target_user_id::text, 8);

  select id into workspace_id
  from public.organizations
  where slug = workspace_slug and created_by = target_user_id
  limit 1;

  if workspace_id is null then
    insert into public.organizations (name, slug, created_by)
    values (workspace_name, workspace_slug, target_user_id)
    returning id into workspace_id;
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (workspace_id, target_user_id, 'owner')
  on conflict (organization_id, user_id) do nothing;

  return workspace_id;
end;
$$;

revoke all on function public.ensure_academy_user_workspace(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.ensure_academy_user_workspace(uuid, text, text)
  to service_role;

create or replace function public.claim_academy_memberships()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_email text;
  claimed_count integer := 0;
  membership_count integer := 0;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select lower(email) into current_email
  from auth.users
  where id = current_user_id and email_confirmed_at is not null;

  if current_email is null then
    raise exception 'A verified email is required' using errcode = '42501';
  end if;

  update public.academy_members member
  set user_id = current_user_id,
      last_seen_at = now()
  from public.academy_member_invites invite
  where invite.academy_member_id = member.id
    and lower(invite.email) = current_email
    and invite.status <> 'cancelled'
    and (invite.invited_user_id is null or invite.invited_user_id = current_user_id)
    and member.status = 'active'
    and (member.user_id is null or member.user_id = current_user_id);

  update public.academy_member_invites invite
  set invited_user_id = current_user_id,
      status = 'accepted',
      provisioned_at = coalesce(invite.provisioned_at, now()),
      accepted_at = coalesce(invite.accepted_at, now()),
      last_attempt_at = now(),
      last_action = 'claim',
      error_message = null
  from public.academy_members member
  where invite.academy_member_id = member.id
    and lower(invite.email) = current_email
    and invite.status <> 'cancelled'
    and (invite.invited_user_id is null or invite.invited_user_id = current_user_id)
    and member.status = 'active'
    and member.user_id = current_user_id;
  get diagnostics claimed_count = row_count;

  select count(*) into membership_count
  from public.academy_members
  where user_id = current_user_id and status = 'active';

  return jsonb_build_object(
    'claimed', claimed_count,
    'memberships', membership_count
  );
end;
$$;

revoke all on function public.claim_academy_memberships()
  from public, anon;
grant execute on function public.claim_academy_memberships()
  to authenticated;
