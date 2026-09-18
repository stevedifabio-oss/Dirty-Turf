-- Organization owners and Academy admins can manage the same private media
-- they are already authorized to upload. Member access remains scoped to
-- active Academy membership and entitled course paths.
create policy "academy_storage_admin_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'academy-assets'
    and exists (
      select 1
      from public.academy_communities c
      where c.id::text = (storage.foldername(name))[1]
        and (select private.can_manage_academy(c.id))
    )
  );
