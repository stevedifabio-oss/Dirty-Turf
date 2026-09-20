-- Protect the owning organization account even when its imported Academy role
-- is labelled admin, and ensure every Academy can issue a styled certificate.

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
  if target.id is null or not (select private.can_manage_academy(target.academy_community_id)) then
    raise exception 'Academy administrator access required' using errcode = '42501';
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

insert into public.academy_certificate_templates (
  academy_community_id, name, title, description, signatory_name, signatory_title, active
)
select community.id, 'Dirty Turf Academy Completion', 'Certificate of Completion',
  'has successfully completed the course', 'Steve DiFabio', 'Dirty Turf Academy', true
from public.academy_communities community
where not exists (
  select 1 from public.academy_certificate_templates template
  where template.academy_community_id = community.id and template.active
)
on conflict (academy_community_id, lower(name)) do update
  set active = true, updated_at = now();

revoke all on function public.admin_update_academy_member(uuid, public.academy_role, public.membership_status, integer, integer, text, text, text) from public, anon;
grant execute on function public.admin_update_academy_member(uuid, public.academy_role, public.membership_status, integer, integer, text, text, text) to authenticated;
