-- Enforce source visibility at the API and Storage boundary, not only in the UI.
-- Restrictive policies also constrain the older organization-member read policies.
-- Private lookup helpers avoid recursive RLS when resolving a lesson's parents.
create or replace function private.can_read_academy_module(p_module_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.course_modules m join public.courses c on c.id=m.course_id
    where m.id=p_module_id and (
      (select private.can_manage_academy(c.academy_community_id))
      or (select public.is_organization_admin(c.organization_id))
      or (
        m.source_archived_at is null
        and (m.sync_owner='local' or m.source_visibility='published')
        and (
          (select private.can_access_course(c.id))
          or (c.academy_community_id is null and (select public.is_organization_member(c.organization_id)))
        )
      )
    )
  );
$$;

create or replace function private.can_read_academy_lesson(p_lesson_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.course_lessons l
    join public.course_modules m on m.id=l.module_id
    join public.courses c on c.id=m.course_id
    where l.id=p_lesson_id and (
      (select private.can_manage_academy(c.academy_community_id))
      or (select public.is_organization_admin(c.organization_id))
      or (l.status='published' and (select private.can_read_academy_module(m.id)))
    )
  );
$$;
revoke all on function private.can_read_academy_module(uuid), private.can_read_academy_lesson(uuid) from public, anon;
grant execute on function private.can_read_academy_module(uuid), private.can_read_academy_lesson(uuid) to authenticated, service_role;

create policy "modules_visibility_guard" on public.course_modules
  as restrictive for select to authenticated
  using ((select private.can_read_academy_module(id)));
create policy "lessons_visibility_guard" on public.course_lessons
  as restrictive for select to authenticated
  using ((select private.can_read_academy_lesson(id)));
create policy "academy_assets_lesson_visibility_guard" on public.academy_assets
  as restrictive for select to authenticated
  using (
    lesson_id is null
    or (select private.can_manage_academy(academy_community_id))
    or (select private.can_read_academy_lesson(lesson_id))
  );

-- A course-folder grant must not make an unpublished lesson's media signable.
-- Member objects must have an accessible catalog record. This fails closed for
-- orphan/unregistered files; administrators can still manage uploaded objects.
-- Other storage buckets keep their existing policy behavior. Previously issued
-- signed URLs remain valid until their token expires; this blocks new signing
-- and authenticated downloads rather than claiming to revoke existing tokens.
create policy "academy_storage_lesson_visibility_guard" on storage.objects
  as restrictive for select to authenticated
  using (
    bucket_id <> 'academy-assets'
    or exists (
      select 1 from public.academy_assets asset
      where asset.storage_bucket=storage.objects.bucket_id
        and asset.storage_path=storage.objects.name
    )
    or exists (
      select 1 from public.academy_communities community
      where community.id::text=(storage.foldername(storage.objects.name))[1]
        and (select private.can_manage_academy(community.id))
    )
  );
