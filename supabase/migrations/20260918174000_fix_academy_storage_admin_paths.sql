-- The Academy community alias also has a `name` column. Qualify the Storage
-- object path so PostgreSQL cannot resolve foldername(name) to the community
-- display name inside the policy subquery.
drop policy if exists "academy_storage_admin_read" on storage.objects;
drop policy if exists "academy_storage_admin_insert" on storage.objects;
drop policy if exists "academy_storage_admin_update" on storage.objects;
drop policy if exists "academy_storage_admin_delete" on storage.objects;

create policy "academy_storage_admin_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'academy-assets'
    and exists (
      select 1
      from public.academy_communities community
      where community.id::text = (storage.foldername(storage.objects.name))[1]
        and (select private.can_manage_academy(community.id))
    )
  );

create policy "academy_storage_admin_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'academy-assets'
    and exists (
      select 1
      from public.academy_communities community
      where community.id::text = (storage.foldername(storage.objects.name))[1]
        and (select private.can_manage_academy(community.id))
    )
  );

create policy "academy_storage_admin_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'academy-assets'
    and exists (
      select 1
      from public.academy_communities community
      where community.id::text = (storage.foldername(storage.objects.name))[1]
        and (select private.can_manage_academy(community.id))
    )
  )
  with check (
    bucket_id = 'academy-assets'
    and exists (
      select 1
      from public.academy_communities community
      where community.id::text = (storage.foldername(storage.objects.name))[1]
        and (select private.can_manage_academy(community.id))
    )
  );

create policy "academy_storage_admin_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'academy-assets'
    and exists (
      select 1
      from public.academy_communities community
      where community.id::text = (storage.foldername(storage.objects.name))[1]
        and (select private.can_manage_academy(community.id))
    )
  );
