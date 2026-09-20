-- Create the Academy member and their sign-in invite in one transaction.
-- A duplicate or invalid invite rolls the member insert back automatically.

create or replace function private.is_academy_owner(target_community_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.academy_members member
    where member.academy_community_id = target_community_id
      and member.user_id = (select auth.uid())
      and member.status = 'active' and member.role = 'owner'
  ) or exists (
    select 1
    from public.academy_communities community
    join public.organization_members organization_member
      on organization_member.organization_id = community.owner_organization_id
    where community.id = target_community_id
      and organization_member.user_id = (select auth.uid())
      and organization_member.role = 'owner'
  );
$$;

create or replace function public.admin_create_academy_member(
  p_academy_community_id uuid,
  p_display_name text,
  p_email text,
  p_role public.academy_role
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_member_id uuid;
  normalized_email text := lower(trim(p_email));
begin
  if not (select private.can_manage_academy(p_academy_community_id)) then
    raise exception 'Academy administrator access required' using errcode = '42501';
  end if;

  if p_role = 'owner' and not (select private.is_academy_owner(p_academy_community_id)) then
    raise exception 'Only an Academy owner can create another owner' using errcode = '42501';
  end if;

  if nullif(trim(p_display_name), '') is null then
    raise exception 'Member name is required' using errcode = '22023';
  end if;

  if normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'A valid member email is required' using errcode = '22023';
  end if;

  insert into public.academy_members (
    academy_community_id,
    display_name,
    role,
    status
  ) values (
    p_academy_community_id,
    trim(p_display_name),
    p_role,
    'active'
  )
  returning id into new_member_id;

  insert into public.academy_member_invites (
    academy_community_id,
    academy_member_id,
    email,
    source_provider
  ) values (
    p_academy_community_id,
    new_member_id,
    normalized_email,
    'native'
  );

  return new_member_id;
end;
$$;

revoke all on function public.admin_create_academy_member(uuid, text, text, public.academy_role) from public;
revoke all on function private.is_academy_owner(uuid) from public, anon, authenticated;
grant execute on function public.admin_create_academy_member(uuid, text, text, public.academy_role) to authenticated;
grant execute on function public.admin_create_academy_member(uuid, text, text, public.academy_role) to service_role;
