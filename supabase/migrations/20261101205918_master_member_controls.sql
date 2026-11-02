-- Member administration belongs only to Steve's verified master owner account.
-- This migration does not activate billing, grant access, or send invitations.
create or replace function private.can_manage_academy_members(target_community_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_academy_owner(target_community_id) and exists (
    select 1 from auth.users u where u.id = (select auth.uid())
      and u.id = '87e83b6e-c072-43f9-bb8d-002b17d8a368'::uuid
      and lower(u.email) = 'steve@dirtyturf.com' and u.email_confirmed_at is not null
      and u.deleted_at is null and (u.banned_until is null or u.banned_until < now())
  );
$$;
revoke all on function private.can_manage_academy_members(uuid) from public, anon;
grant execute on function private.can_manage_academy_members(uuid) to authenticated;
create or replace function public.admin_can_manage_members(p_community_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select private.can_manage_academy_members(p_community_id);
$$;
revoke all on function public.admin_can_manage_members(uuid) from public, anon;
grant execute on function public.admin_can_manage_members(uuid) to authenticated;

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
  if not (select private.can_manage_academy_members(p_academy_community_id)) then
    raise exception 'Master owner access required' using errcode = '42501';
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

create or replace function public.admin_update_academy_member(
  p_member_id uuid,
  p_role public.academy_role default null,
  p_status public.membership_status default null,
  p_level integer default null,
  p_points integer default null,
  p_display_name text default null,
  p_company_name text default null,
  p_location text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.academy_members%rowtype;
  next_role public.academy_role;
  next_status public.membership_status;
  target_is_organization_owner boolean := false;
begin
  select * into target from public.academy_members where id = p_member_id for update;
  if target.id is null or not (select private.can_manage_academy_members(target.academy_community_id)) then
    raise exception 'Master owner access required' using errcode = '42501';
  end if;

  select exists (
    select 1
    from public.academy_communities community
    join public.organization_members organization_member
      on organization_member.organization_id = community.owner_organization_id
    where community.id = target.academy_community_id
      and organization_member.user_id = target.user_id
      and organization_member.role = 'owner'
  ) into target_is_organization_owner;

  if target_is_organization_owner and (p_role is not null or p_status is not null) then
    raise exception 'The organization owner role and access are protected' using errcode = '42501';
  end if;
  if (target.role = 'owner' or p_role = 'owner')
     and not (select private.is_academy_owner(target.academy_community_id)) then
    raise exception 'Only an Academy owner can change an owner account' using errcode = '42501';
  end if;

  next_role := coalesce(p_role, target.role);
  next_status := coalesce(p_status, target.status);

  if target.role = 'owner' and target.status = 'active'
     and (next_role <> 'owner' or next_status <> 'active')
     and not exists (
       select 1 from public.academy_members member
       where member.academy_community_id = target.academy_community_id
         and member.id <> target.id and member.role = 'owner' and member.status = 'active'
     ) then
    raise exception 'The final active Academy owner cannot be demoted or suspended' using errcode = '23514';
  end if;

  if target.role in ('owner', 'admin') and target.status = 'active'
     and (next_role not in ('owner', 'admin') or next_status <> 'active')
     and not exists (
       select 1 from public.academy_members member
       where member.academy_community_id = target.academy_community_id
         and member.id <> target.id and member.role in ('owner', 'admin') and member.status = 'active'
     ) then
    raise exception 'The final active Academy manager cannot be demoted or suspended' using errcode = '23514';
  end if;

  update public.academy_members set
    role = next_role,
    status = next_status,
    level = case when p_level is null then level else greatest(1, p_level) end,
    points = case when p_points is null then points else greatest(0, p_points) end,
    display_name = case when p_display_name is null then display_name else trim(p_display_name) end,
    company_name = case when p_company_name is null then company_name else trim(p_company_name) end,
    location = case when p_location is null then location else trim(p_location) end
  where id = target.id;
end;
$$;

create or replace function public.admin_set_member_course_access(
  p_member_id uuid,
  p_course_id uuid,
  p_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_row public.academy_members%rowtype;
  course_row public.courses%rowtype;
  grant_source_key text := 'manual:' || p_course_id::text;
begin
  select * into member_row from public.academy_members where id = p_member_id;
  select * into course_row from public.courses where id = p_course_id;
  if member_row.id is null or course_row.id is null
     or member_row.academy_community_id is distinct from course_row.academy_community_id then
    raise exception 'Member and course must belong to the same Academy';
  end if;
  if not (select private.can_manage_academy_members(member_row.academy_community_id)) then
    raise exception 'Master owner access required' using errcode = '42501';
  end if;

  if p_enabled then
    delete from public.academy_course_access_denials
    where academy_member_id = member_row.id and course_id = course_row.id;
    insert into public.course_enrollments (
      academy_community_id, academy_member_id, course_id, status, enrolled_at
    ) values (
      member_row.academy_community_id, member_row.id, course_row.id, 'active', now()
    ) on conflict (academy_member_id, course_id) do update
      set status = 'active', access_expires_at = null, updated_at = now();
    insert into public.academy_access_grants (
      academy_community_id, academy_member_id, course_id, source_type, source_key, status
    ) values (
      member_row.academy_community_id, member_row.id, course_row.id,
      'manual', grant_source_key, 'active'
    ) on conflict (academy_member_id, course_id, source_type, source_key)
      where course_id is not null do update
      set status = 'active', ends_at = null, updated_at = now();
  else
    insert into public.academy_course_access_denials (
      academy_community_id, academy_member_id, course_id, denied_by, reason
    ) values (
      member_row.academy_community_id, member_row.id, course_row.id,
      (select auth.uid()), 'Revoked by Academy administrator'
    ) on conflict (academy_member_id, course_id) do update
      set denied_by = excluded.denied_by, reason = excluded.reason, created_at = now();
    update public.course_enrollments set status = 'cancelled', updated_at = now()
      where academy_member_id = member_row.id and course_id = course_row.id;
    update public.academy_access_grants set status = 'revoked', updated_at = now()
      where academy_member_id = member_row.id and course_id = course_row.id
        and source_type = 'manual' and source_key = grant_source_key;
  end if;
end;
$$;

-- Direct enrollment writes cannot bypass the restricted administrative RPC.
revoke insert, update, delete on public.course_enrollments from authenticated;
drop policy if exists academy_invites_admin_select on public.academy_member_invites;
create policy academy_invites_master_select on public.academy_member_invites
for select to authenticated using (private.can_manage_academy_members(academy_community_id));
