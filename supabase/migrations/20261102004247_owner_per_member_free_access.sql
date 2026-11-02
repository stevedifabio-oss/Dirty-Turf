-- Per-person owner grants only. No billing or existing entitlement rows are changed.
-- Manual free access has its own stable source. Revoking it never edits paid/imported grants.
create function private.admin_set_free_access(p_member_id uuid,p_resource text,p_enabled boolean,p_ends_at timestamptz default null)
returns void language plpgsql security definer set search_path='' as $$
declare m public.academy_members%rowtype; cid uuid; key text; metadata_value jsonb;
begin
  select * into m from public.academy_members where id=p_member_id for update;
  if m.id is null or (select auth.uid()) is null or not private.can_manage_academy_members(m.academy_community_id) then
    raise exception 'Academy owner access required' using errcode='42501';
  end if;
  if p_enabled is null or p_resource is null or (p_enabled and p_ends_at<=now()) then raise exception 'Invalid free access selection'; end if;
  if p_resource not in ('community','measuring_tool') then
    begin cid:=p_resource::uuid; exception when invalid_text_representation then raise exception 'Invalid access resource'; end;
    if not exists(select 1 from public.courses where id=cid and academy_community_id=m.academy_community_id) then
      raise exception 'Course must belong to this Academy';
    end if;
  end if;
  key:='owner-free:'||p_resource;
  metadata_value:=jsonb_build_object('granted_by',(select auth.uid()),'free_access',true);
  if p_resource='measuring_tool' then
    insert into public.academy_feature_grants(academy_community_id,academy_member_id,feature_key,source_type,source_key,status,ends_at,metadata)
    values(m.academy_community_id,m.id,'measuring_tool','manual',key,case when p_enabled then 'active' else 'revoked' end,case when p_enabled then p_ends_at else null end,metadata_value)
    on conflict(academy_member_id,feature_key,source_type,source_key) do update
      set status=excluded.status,starts_at=now(),ends_at=excluded.ends_at,metadata=excluded.metadata;
  else
    if cid is not null and p_enabled and exists(select 1 from public.academy_course_access_denials where academy_member_id=m.id and course_id=cid) then
      raise exception 'This course is blocked. Review its existing access restriction first.';
    end if;
    if cid is null then
      insert into public.academy_access_grants(academy_community_id,academy_member_id,source_type,source_key,status,ends_at,metadata)
      values(m.academy_community_id,m.id,'manual',key,case when p_enabled then 'active' else 'revoked' end,case when p_enabled then p_ends_at else null end,metadata_value)
      on conflict(academy_member_id,source_type,source_key) where course_id is null do update
        set status=excluded.status,starts_at=now(),ends_at=excluded.ends_at,metadata=excluded.metadata;
    else
      insert into public.academy_access_grants(academy_community_id,academy_member_id,course_id,source_type,source_key,status,ends_at,metadata)
      values(m.academy_community_id,m.id,cid,'manual',key,case when p_enabled then 'active' else 'revoked' end,case when p_enabled then p_ends_at else null end,metadata_value)
      on conflict(academy_member_id,course_id,source_type,source_key) where course_id is not null do update
        set status=excluded.status,starts_at=now(),ends_at=excluded.ends_at,metadata=excluded.metadata;
    end if;
  end if;
end;
$$;
revoke all on function private.admin_set_free_access(uuid,text,boolean,timestamptz) from public,anon;
grant execute on function private.admin_set_free_access(uuid,text,boolean,timestamptz) to authenticated;

create function private.admin_get_free_access(p_member_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare community_id uuid; grants jsonb;
begin
  select academy_community_id into community_id from public.academy_members where id=p_member_id;
  if community_id is null or (select auth.uid()) is null or not private.can_manage_academy_members(community_id) then
    raise exception 'Academy owner access required' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('resource',resource,'endsAt',ends_at)),'[]'::jsonb) into grants from (
    select coalesce(course_id::text,'community') resource,ends_at from public.academy_access_grants
      where academy_member_id=p_member_id and source_type='manual' and source_key='owner-free:'||coalesce(course_id::text,'community')
        and status='active' and starts_at<=now() and (ends_at is null or ends_at>now())
    union all select feature_key,ends_at from public.academy_feature_grants where academy_member_id=p_member_id
      and source_type='manual' and source_key='owner-free:'||feature_key and status='active'
      and starts_at<=now() and (ends_at is null or ends_at>now())
  ) active_grants;
  return grants;
end;
$$;
revoke all on function private.admin_get_free_access(uuid) from public,anon;
grant execute on function private.admin_get_free_access(uuid) to authenticated;


-- Community-only complimentary access never implies course access.
create or replace function private.can_access_course(target_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.courses c
    where c.id = target_course_id
      and (select private.can_manage_academy(c.academy_community_id))
  ) or exists (
    select 1
    from public.courses c
    join public.academy_members m
      on m.academy_community_id = c.academy_community_id
     and m.user_id = (select auth.uid())
     and m.status = 'active'
    where c.id = target_course_id
      and c.status = 'published'
      and not exists (
        select 1 from public.academy_course_access_denials denial
        where denial.academy_member_id = m.id and denial.course_id = c.id
      )
      and (
        (
          exists (select 1 from public.academy_access_grants g
            where g.academy_member_id=m.id and g.course_id is null and g.status='active'
              and g.starts_at<=now() and (g.ends_at is null or g.ends_at>now())
              and not (g.source_type='manual' and g.source_key='owner-free:community'))
          and (
            c.access_type = 'open'
            or (c.access_type = 'level' and m.level >= coalesce(c.required_level, 1))
          )
        )
        or (select private.has_active_academy_grant(m.id, c.id))
      )
  );
$$;

-- Exposed wrappers use invoker security; privileged implementations check the verified master identity.
create function public.admin_set_free_access(p_member_id uuid,p_resource text,p_enabled boolean,p_ends_at timestamptz default null)
returns void language sql security invoker set search_path='' as $$
  select private.admin_set_free_access(p_member_id,p_resource,p_enabled,p_ends_at);
$$;
revoke all on function public.admin_set_free_access(uuid,text,boolean,timestamptz) from public,anon;
grant execute on function public.admin_set_free_access(uuid,text,boolean,timestamptz) to authenticated;
create function public.admin_get_free_access(p_member_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select private.admin_get_free_access(p_member_id);
$$;
revoke all on function public.admin_get_free_access(uuid) from public,anon;
grant execute on function public.admin_get_free_access(uuid) to authenticated;