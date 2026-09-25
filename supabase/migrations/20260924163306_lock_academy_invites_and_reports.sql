-- Academy managers can read invitations, but only the guarded member-creation
-- RPC and service-role provisioning may create or change them. A direct UPDATE
-- could otherwise retarget an unclaimed owner invitation before it is claimed.
revoke insert, update, delete on public.academy_member_invites from authenticated;
drop policy if exists "academy_invites_admin_insert" on public.academy_member_invites;
drop policy if exists "academy_invites_admin_update" on public.academy_member_invites;
drop policy if exists "academy_invites_admin_delete" on public.academy_member_invites;

-- Organization admins retain their existing organization-wide policy. An
-- Academy-only manager may moderate a report only when its actual target is
-- in an Academy community that they manage, not merely in the same owner org.
drop policy if exists "content_reports_academy_admin_manage" on public.content_reports;
create policy "content_reports_academy_admin_manage"
  on public.content_reports for all to authenticated
  using (exists (
    select 1 from public.academy_communities community
    where community.owner_organization_id = content_reports.organization_id
      and (select private.can_manage_academy(community.id))
      and (
        (content_reports.content_type = 'post' and exists (
          select 1 from public.community_posts post
          where post.id = content_reports.content_id
            and post.academy_community_id = community.id
        ))
        or (content_reports.content_type = 'comment' and exists (
          select 1 from public.community_comments comment
          where comment.id = content_reports.content_id
            and comment.academy_community_id = community.id
        ))
        or (content_reports.content_type = 'member' and exists (
          select 1 from public.academy_members member
          where member.id = content_reports.content_id
            and member.academy_community_id = community.id
        ))
      )
  ))
  with check (exists (
    select 1 from public.academy_communities community
    where community.owner_organization_id = content_reports.organization_id
      and (select private.can_manage_academy(community.id))
      and (
        (content_reports.content_type = 'post' and exists (
          select 1 from public.community_posts post
          where post.id = content_reports.content_id
            and post.academy_community_id = community.id
        ))
        or (content_reports.content_type = 'comment' and exists (
          select 1 from public.community_comments comment
          where comment.id = content_reports.content_id
            and comment.academy_community_id = community.id
        ))
        or (content_reports.content_type = 'member' and exists (
          select 1 from public.academy_members member
          where member.id = content_reports.content_id
            and member.academy_community_id = community.id
        ))
      )
  ));
