-- Cover notification foreign-key and administrative lookup paths before the
-- member import creates fan-out traffic.

create index academy_email_deliveries_community_idx
  on public.academy_email_deliveries (academy_community_id, created_at desc);
create index academy_email_deliveries_notification_idx
  on public.academy_email_deliveries (notification_id)
  where notification_id is not null;
create index academy_email_deliveries_profile_idx
  on public.academy_email_deliveries (recipient_id, created_at desc)
  where recipient_id is not null;

create index academy_content_mentions_community_idx
  on public.academy_content_mentions (academy_community_id, created_at desc);
create index academy_content_mentions_actor_idx
  on public.academy_content_mentions (actor_member_id, created_at desc);
create index academy_content_mentions_recipient_idx
  on public.academy_content_mentions (mentioned_member_id, created_at desc);
