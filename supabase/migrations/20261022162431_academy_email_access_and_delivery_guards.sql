-- Preparation only. No mail is queued, sent or replayed by this migration.
-- Match notification eligibility to explicit course denials. Own cancellation
-- notices remain available after access ends, scoped to the member's real course
-- subscription rather than an arbitrary course target.
create or replace function private.academy_notification_access(
  p_member uuid,p_community uuid,p_type text,p_target uuid,p_template text
)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from public.academy_members m
    where m.id=p_member and m.academy_community_id=p_community
      and (m.status='active' or p_template in (
        'membership_requested','membership_declined','membership_removed',
        'group_subscription_cancelled','course_subscription_cancelled'))
      and (p_template not like '%\_admin' escape '\'
        or m.role in ('owner','admin')
        or (p_template='content_reported_admin' and m.role='moderator'))
      and case
        when p_template in ('membership_requested','membership_declined',
          'membership_removed','group_subscription_cancelled')
          then p_type='community' and p_target=p_community
        when p_template='course_subscription_cancelled' then p_type='course'
          and exists (
            select 1 from public.academy_billing_subscriptions subscription
            join public.academy_billing_plans plan on plan.id=subscription.plan_id
            join public.academy_billing_plan_courses included on included.plan_id=plan.id
            join public.courses course on course.id=included.course_id
            where subscription.academy_member_id=m.id
              and subscription.academy_community_id=p_community
              and plan.academy_community_id=p_community
              and course.academy_community_id=p_community and course.id=p_target
              and subscription.source_type='stripe_subscription'
              and (subscription.cancel_at_period_end or subscription.status in ('cancelled','expired'))
          )
        else (m.role in ('owner','admin') or private.has_active_academy_grant(m.id,null)
          or (p_type='course' and private.has_active_academy_grant(m.id,p_target)))
          and case p_type
            when 'course' then exists (
              select 1 from public.courses c where c.id=p_target and c.academy_community_id=p_community
                and c.status='published' and (
                  m.role in ('owner','admin') or (
                    not exists (select 1 from public.academy_course_access_denials denial
                      where denial.academy_member_id=m.id and denial.course_id=c.id)
                    and (private.has_active_academy_grant(m.id,c.id)
                      or (private.has_active_academy_grant(m.id,null)
                        and (c.access_type='open' or (c.access_type='level' and m.level>=coalesce(c.required_level,1)))))
                  )
                )
            )
            when 'event' then p_template='event_cancelled' or exists (
              select 1 from public.academy_events e where e.id=p_target and e.academy_community_id=p_community
                and e.status='published' and e.ends_at>now() and (p_template<>'new_event' or e.starts_at>now())
                and (m.role in ('owner','admin') or m.level>=coalesce(e.required_level,1))
            )
            when 'post' then exists (
              select 1 from public.community_posts post where post.id=p_target
                and post.academy_community_id=p_community and post.status='published'
                and not exists (select 1 from public.academy_member_blocks blocked
                  where blocked.academy_community_id=p_community
                    and ((blocked.blocker_member_id=m.id and blocked.blocked_member_id=post.academy_author_id)
                      or (blocked.blocked_member_id=m.id and blocked.blocker_member_id=post.academy_author_id)))
            )
            else p_type='community' and p_target=p_community
          end
      end
  );
$$;
revoke all on function private.academy_notification_access(uuid,uuid,text,uuid,text) from public,anon,authenticated;

-- Counts only discussions visible to this recipient. Imported history is silent;
-- blocked authors do not appear in a weekly summary, even as an inflated count.
create function private.academy_visible_digest_post_count(p_member uuid,p_community uuid,p_now timestamptz)
returns bigint language sql stable security definer set search_path='' as $$
  select count(*) from public.community_posts post
  where post.academy_community_id=p_community and post.status='published'
    and post.source_import_batch_id is null and post.created_at>=p_now-interval '7 days'
    and post.created_at<=p_now
    and private.academy_notification_access(p_member,p_community,'post',post.id,'weekly_digest')
    and not exists (
      select 1 from public.academy_member_blocks blocked where blocked.academy_community_id=p_community
        and ((blocked.blocker_member_id=p_member and blocked.blocked_member_id=post.academy_author_id)
          or (blocked.blocked_member_id=p_member and blocked.blocker_member_id=post.academy_author_id))
    );
$$;
revoke all on function private.academy_visible_digest_post_count(uuid,uuid,timestamptz) from public,anon,authenticated;

create or replace function public.queue_academy_scheduled_notifications(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record; d record; reminders integer := 0; digests integer := 0;
begin
 for r in
  select e.*, rsvp.academy_member_id, reminder_window.hours_before
  from public.academy_events e join public.academy_member_event_rsvps rsvp on rsvp.event_id=e.id
  cross join (values (24),(1)) as reminder_window(hours_before)
  where e.status='published' and e.source_import_batch_id is null and rsvp.status in ('going','interested')
   and e.starts_at > p_now + make_interval(hours=>reminder_window.hours_before) - interval '15 minutes'
   and e.starts_at <= p_now + make_interval(hours=>reminder_window.hours_before)
 loop
  perform private.queue_academy_notification(r.academy_community_id,r.organization_id,r.academy_member_id,null,'event','event_reminder',
   'Reminder: ' || r.title || ' begins in ' || r.hours_before || case when r.hours_before=1 then ' hour' else ' hours' end,
   r.title,'event',r.id,'event:' || r.id || ':' || r.starts_at || ':' || r.hours_before || 'h:' || r.academy_member_id,
   'event_reminders',p_now,jsonb_build_object('eventTitle',r.title,'startsAt',r.starts_at,'endsAt',r.ends_at,'meetingUrl',r.meeting_url,'hoursBefore',r.hours_before),true);
  reminders := reminders+1;
 end loop;
 -- Once per Monday per member, using their own timezone. No imported-history recap.
 for d in
  select c.id community_id,c.owner_organization_id organization_id,m.id member_id,
   (p_now at time zone coalesce(p.timezone,'UTC')) local_now,
   private.academy_visible_digest_post_count(m.id,c.id,p_now) post_count
  from public.academy_communities c join public.academy_members m on m.academy_community_id=c.id and m.status='active'
  left join public.notification_preferences p on p.user_id=m.user_id
  where c.owner_organization_id is not null
   and extract(isodow from p_now at time zone coalesce(p.timezone,'UTC'))=1
   and extract(hour from p_now at time zone coalesce(p.timezone,'UTC'))=9
 loop
  if d.post_count > 0 then
   perform private.queue_academy_notification(d.community_id,d.organization_id,d.member_id,null,'admin','weekly_digest',
    'Your week in the Dirty Turf community',d.post_count || case when d.post_count=1 then ' new discussion this week.' else ' new discussions this week.' end,'community',d.community_id,
    'digest:' || d.community_id || ':' || d.member_id || ':' || to_char(d.local_now,'YYYY-MM-DD'),
    'weekly_digest',p_now,jsonb_build_object('postCount',d.post_count),false);
   digests := digests+1;
  end if;
 end loop;
 return jsonb_build_object('eventReminders',reminders,'weeklyDigests',digests);
end; $$;


create or replace function private.academy_email_eligible(d public.academy_email_deliveries)
returns boolean language sql stable security definer set search_path = '' as $$
 select exists (
  select 1 from public.academy_members m join auth.users u on u.id=m.user_id
  left join public.notification_preferences p on p.user_id=m.user_id
  join private.academy_email_cutover cutover on cutover.id and cutover.enabled and d.created_at >= cutover.enabled_at
  where m.id=d.recipient_member_id and m.user_id=d.recipient_id and lower(trim(u.email))=d.recipient_email
   and nullif(to_jsonb(u)->>'email_confirmed_at','') is not null
   and to_jsonb(u)->>'deleted_at' is null
   and (nullif(to_jsonb(u)->>'banned_until','') is null or (to_jsonb(u)->>'banned_until')::timestamptz<=now())
   and private.academy_notification_access(m.id,d.academy_community_id,d.target_type,d.target_id,d.template_key)
   and coalesce(p.email_enabled,true)
   and (d.template_key<>'weekly_digest' or private.academy_visible_digest_post_count(m.id,d.academy_community_id,now())>0)
   and not exists (select 1 from public.academy_member_blocks b where b.academy_community_id=d.academy_community_id
     and ((b.blocker_member_id=m.id and b.blocked_member_id::text=d.payload->>'actorMemberId')
       or (b.blocked_member_id=m.id and b.blocker_member_id::text=d.payload->>'actorMemberId')))
   and (d.template_key<>'new_post' or exists (select 1 from public.academy_member_follows f
     where f.academy_community_id=d.academy_community_id and f.follower_member_id=m.id and f.followed_member_id::text=d.payload->>'actorMemberId'))
   and (d.payload->>'commentId' is null or exists (
     select 1 from public.community_comments c
     where c.id::text=d.payload->>'commentId' and c.post_id=d.target_id
       and c.academy_community_id=d.academy_community_id
       and c.body<>'[Removed by Academy moderator]'
       and not exists (select 1 from public.academy_member_blocks blocked
         where blocked.academy_community_id=d.academy_community_id
           and ((blocked.blocker_member_id=m.id and blocked.blocked_member_id=c.academy_author_id)
             or (blocked.blocked_member_id=m.id and blocked.blocker_member_id=c.academy_author_id)))
   ))
   and (d.template_key<>'lesson_published' or exists (select 1 from public.course_lessons l join public.course_modules cm on cm.id=l.module_id
      where l.id::text=d.payload->>'lessonId' and cm.course_id=d.target_id and l.status='published'
        and cm.source_archived_at is null and (cm.sync_owner='local' or cm.source_visibility='published')
        and (coalesce(cm.drip_after_days,0)=0 or exists (select 1 from public.course_enrollments ce
          where ce.course_id=cm.course_id and ce.academy_member_id=m.id and ce.enrolled_at + make_interval(days=>cm.drip_after_days)<=now()))))
   and case
    when d.template_key in ('comment','reply') then coalesce(p.replies,true)
    when d.template_key in ('mention','mention_everyone_post','mention_everyone_comment') then coalesce(p.mentions,true)
    when d.template_key in ('post_reaction','comment_reaction') then coalesce(p.reactions,true)
    when d.template_key in ('new_event','event_reminder','event_rsvp','event_updated','event_cancelled') then coalesce(p.event_reminders,true)
    when d.template_key in ('new_course','course_unlocked','course_certificate','lesson_published') then coalesce(p.course_updates,true)
    when d.template_key='weekly_digest' then coalesce(p.weekly_digest,true)
    when d.template_key='new_post' then coalesce(p.new_posts,true)
    else coalesce(p.admin_announcements,true) end
   and (d.template_key not in ('event_reminder','event_rsvp','event_updated') or exists (
    select 1 from public.academy_member_event_rsvps r join public.academy_events e on e.id=r.event_id
    where r.event_id=d.target_id and r.academy_member_id=m.id and r.status in ('going','interested') and e.starts_at>now()
     and e.starts_at=(d.payload->>'startsAt')::timestamptz
     and (d.template_key<>'event_rsvp' or r.status=d.payload->>'rsvpStatus')))
 );
$$;
revoke all on function private.academy_email_eligible(public.academy_email_deliveries) from public,anon,authenticated;


-- Recheck the visible digest count immediately before handing the message to its
-- provider. No visible posts means cancellation; changed counts use current text.
create or replace function public.prepare_academy_email_delivery(p_delivery_id uuid,p_lock_token uuid)
returns setof public.academy_email_deliveries language plpgsql security definer set search_path='' as $$
declare visible_count bigint;
begin
  update public.academy_email_deliveries d set status='cancelled',last_error='No longer eligible at send time',lock_token=null,locked_at=null
    where id=p_delivery_id and status='processing' and lock_token=p_lock_token and not private.academy_email_eligible(d);
  select private.academy_visible_digest_post_count(d.recipient_member_id,d.academy_community_id,now()) into visible_count
    from public.academy_email_deliveries d where d.id=p_delivery_id and d.status='processing'
      and d.lock_token=p_lock_token and d.template_key='weekly_digest';
  if visible_count>0 then
    update public.academy_email_deliveries set detail=visible_count || case when visible_count=1 then ' new discussion this week.' else ' new discussions this week.' end,
      payload=payload || jsonb_build_object('postCount',visible_count)
      where id=p_delivery_id and status='processing' and lock_token=p_lock_token and template_key='weekly_digest';
  end if;
  -- Engagement queues keep identity references, not a right to email old text.
  -- Refresh the surviving discussion title/excerpt after edits and suppress a
  -- removed comment through the eligibility check above.
  update public.academy_email_deliveries d set detail=post.title,
    payload=d.payload || jsonb_build_object('postTitle',post.title)
      || case when d.payload ? 'excerpt' then jsonb_build_object('excerpt',
        left(case when d.payload->>'commentId' is not null then (
          select comment.body from public.community_comments comment
          where comment.id::text=d.payload->>'commentId' and comment.post_id=post.id
        ) else post.body end,500)) else '{}'::jsonb end
    from public.community_posts post
    where d.id=p_delivery_id and d.status='processing' and d.lock_token=p_lock_token
      and d.target_type='post' and post.id=d.target_id
      and post.academy_community_id=d.academy_community_id
      and d.template_key in ('new_post','announcement','comment','reply','mention',
        'post_reaction','comment_reaction','mention_everyone_post','mention_everyone_comment');
  return query select d.* from public.academy_email_deliveries d where d.id=p_delivery_id and d.status='processing' and d.lock_token=p_lock_token;
end;
$$;
revoke all on function public.prepare_academy_email_delivery(uuid,uuid) from public,anon,authenticated;
grant execute on function public.prepare_academy_email_delivery(uuid,uuid) to service_role;
