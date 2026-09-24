-- Reports are created through report_academy_content(), which validates the
-- target and stamps the authenticated reporter. Direct client writes may only
-- change the moderation fields used by Admin Studio.
revoke insert, update, delete on public.content_reports from authenticated;
grant update (status, resolved_at, resolved_by) on public.content_reports to authenticated;

-- Keep target resolution out of the caller's content RLS, but authorize only
-- a manager of the Academy that actually owns the reported target.
create or replace function private.can_moderate_academy_report(
  p_organization_id uuid,
  p_content_type text,
  p_content_id uuid
)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.academy_communities community
    where community.owner_organization_id = p_organization_id
      and (select private.can_manage_academy(community.id))
      and (
        (p_content_type = 'post' and exists (
          select 1 from public.community_posts post
          where post.id = p_content_id and post.academy_community_id = community.id
        ))
        or (p_content_type = 'comment' and exists (
          select 1 from public.community_comments comment
          where comment.id = p_content_id and comment.academy_community_id = community.id
        ))
        or (p_content_type = 'member' and exists (
          select 1 from public.academy_members member
          where member.id = p_content_id and member.academy_community_id = community.id
        ))
      )
  );
$$;
revoke all on function private.can_moderate_academy_report(uuid, text, uuid) from public, anon;
grant execute on function private.can_moderate_academy_report(uuid, text, uuid) to authenticated;

drop policy if exists "content_reports_academy_admin_manage" on public.content_reports;
create policy "content_reports_academy_admin_read"
  on public.content_reports for select to authenticated
  using ((select private.can_moderate_academy_report(organization_id, content_type, content_id)));
create policy "content_reports_academy_admin_update"
  on public.content_reports for update to authenticated
  using ((select private.can_moderate_academy_report(organization_id, content_type, content_id)))
  with check (
    (select private.can_moderate_academy_report(organization_id, content_type, content_id))
    and (
      (status in ('resolved', 'dismissed') and resolved_by = (select auth.uid()) and resolved_at is not null)
      or (status in ('open', 'reviewing') and resolved_by is null and resolved_at is null)
    )
  );
