-- A reply is member-facing only while its parent discussion is visible.
-- Keep the existing invoker boundary, identity, media, reactions and ordering.
create or replace view public.academy_comment_feed with (security_invoker = true) as
select
  comment.id,
  comment.academy_community_id,
  comment.post_id,
  comment.parent_id,
  coalesce(nullif(profile.full_name, ''), nullif(member.display_name, ''), 'Member') as author_name,
  comment.body,
  comment.is_answer,
  comment.created_at,
  (
    (select count(*) from public.community_comment_reactions reaction where reaction.comment_id = comment.id)
    + (select count(*) from public.academy_comment_reactions reaction where reaction.comment_id = comment.id)
  )::integer as like_count,
  comment.academy_author_id,
  comment.media
from public.community_comments comment
join public.community_posts post on post.id = comment.post_id
  and post.academy_community_id = comment.academy_community_id
left join public.profiles profile on profile.id = comment.author_id
left join public.academy_members member on member.id = comment.academy_author_id
where post.status = 'published'
  and not exists (
    select 1
    from public.academy_member_blocks block
    join public.academy_members viewer on viewer.id = block.blocker_member_id
    where viewer.user_id = (select auth.uid())
      and block.academy_community_id = comment.academy_community_id
      and block.blocked_member_id in (comment.academy_author_id, post.academy_author_id)
  )
group by comment.id, profile.full_name, member.display_name;

-- Removing a comment must also remove its rendered attachments, while keeping
-- the comment and its child replies for thread continuity and moderation history.
create or replace function public.admin_remove_community_comment(p_comment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  community_id uuid;
begin
  select academy_community_id into community_id from public.community_comments where id = p_comment_id;
  if community_id is null or not (select private.can_manage_academy(community_id)) then
    raise exception 'Academy administrator access required' using errcode = '42501';
  end if;
  update public.community_comments
  set body = '[Removed by Academy moderator]', is_answer = false, media = '[]'::jsonb
  where id = p_comment_id;
end;
$$;

revoke all on function public.admin_remove_community_comment(uuid) from public, anon;
grant execute on function public.admin_remove_community_comment(uuid) to authenticated;
grant select on public.academy_comment_feed to authenticated;
