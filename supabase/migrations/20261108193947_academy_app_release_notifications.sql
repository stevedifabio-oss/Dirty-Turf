-- Explicit owner announcements only. No release is seeded, no queue is backfilled,
-- and held provider/readiness switches and dispatch schedules remain unchanged.
alter table public.notification_preferences add column push_app_updates boolean not null default true;
create table private.academy_app_releases (
  id uuid primary key default gen_random_uuid(),
  academy_community_id uuid not null references public.academy_communities(id) on delete cascade,
  platform text not null check(platform in ('ios','android')),
  version text not null check(version ~ '^[0-9]{1,9}(\.[0-9]{1,9}){0,3}$'),
  build text not null check(build ~ '^[0-9]{1,9}(\.[0-9]{1,9}){0,3}$'),
  store_url text not null,
  release_notes text not null check(length(release_notes)<=2000),
  published_at timestamptz not null,
  expires_at timestamptz not null,
  active boolean not null default true,
  check(expires_at>published_at),
  check(platform<>'android' or build ~ '^[0-9]{1,9}$'),
  check((platform='ios' and store_url='https://apps.apple.com/app/id6813588770') or
    (platform='android' and store_url='https://play.google.com/store/apps/details?id=com.dirtyturf.academy')),
  unique(academy_community_id,platform,version,build)
);
alter table private.academy_app_releases enable row level security;
revoke all on private.academy_app_releases from public,anon,authenticated;
grant all on private.academy_app_releases to service_role;

create function private.academy_app_release_recipient(p_member uuid,p_community uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.academy_members m join auth.users u on u.id=m.user_id
    where m.id=p_member and m.academy_community_id=p_community and m.status='active'
      and u.email_confirmed_at is not null and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
      and (m.role in ('owner','admin') or exists(select 1 from public.academy_access_grants g
        where g.academy_member_id=m.id and private.has_active_academy_grant(m.id,g.course_id))
        or exists(select 1 from public.academy_feature_grants g
          where g.academy_member_id=m.id and private.has_active_academy_feature(m.id,g.feature_key))));
$$;
revoke all on function private.academy_app_release_recipient(uuid,uuid) from public,anon,authenticated;

-- Calling this attests that the named version/build is publicly available at the
-- fixed store listing. Internal testing and review submissions are not releases.
create function public.admin_announce_app_release(p_community_id uuid,p_platform text,p_version text,p_build text,
  p_store_url text,p_release_notes text,p_published_at timestamptz,p_expires_at timestamptz)
returns uuid language plpgsql security definer set search_path='' as $$
declare release private.academy_app_releases%rowtype; recipient record; notification_id uuid; org uuid;
begin
  if auth.uid() is null or not private.can_manage_academy_members(p_community_id) then
    raise insufficient_privilege using message='Master owner access required'; end if;
  if p_published_at is null or p_expires_at is null or p_published_at>now() or p_expires_at<=now()
    or p_expires_at>now()+interval '90 days' then raise exception 'A current public release window is required'; end if;
  insert into private.academy_app_releases(academy_community_id,platform,version,build,store_url,release_notes,published_at,expires_at)
    values(p_community_id,p_platform,p_version,p_build,p_store_url,p_release_notes,p_published_at,p_expires_at)
    on conflict(academy_community_id,platform,version,build) do nothing returning * into release;
  if release.id is null then
    select * into release from private.academy_app_releases where academy_community_id=p_community_id
      and platform=p_platform and version=p_version and build=p_build;
    if (release.store_url,release.release_notes,release.published_at,release.expires_at)
      is distinct from (p_store_url,p_release_notes,p_published_at,p_expires_at) then raise exception 'Release already announced with different details'; end if;
    return release.id; -- Exact retries never add a new audience or delivery.
  end if;
  select owner_organization_id into org from public.academy_communities where id=p_community_id;
  for recipient in select m.id,m.user_id from public.academy_members m
    where m.academy_community_id=p_community_id and private.academy_app_release_recipient(m.id,p_community_id) loop
    insert into public.notifications(organization_id,recipient_id,kind,title,detail,target_type,target_id,dedupe_key)
      values(org,recipient.user_id,'admin','A new app version is available','Dirty Turf '||p_version||' is available in the '||
        case p_platform when 'ios' then 'App Store.' else 'Google Play Store.' end,'app_release',release.id,
        'app-release:'||release.id||':'||recipient.id) returning id into notification_id;
    insert into private.academy_push_deliveries(notification_id,device_id,user_id,generation,community_id,member_id,
      template_key,preference_key,target_type,target_id,send_after,expires_at)
      select notification_id,d.id,recipient.user_id,d.generation,p_community_id,recipient.id,'app_update','app_updates','app_release',release.id,
        private.academy_push_next_window(d.timezone,now()),least(now()+interval '1 day',release.expires_at)
      from private.academy_push_devices d
      join public.notification_preferences p on p.user_id=d.user_id and p.push_enabled and p.push_app_updates
      join private.academy_push_settings s on s.id and s.enabled and s.client_ready and s.environment=d.environment and now()>=s.enabled_at
      where d.user_id=recipient.user_id and d.platform=p_platform and d.enabled and d.retired_at is null
        and d.updated_at>now()-interval '90 days';
  end loop;
  return release.id;
end;
$$;
revoke all on function public.admin_announce_app_release(uuid,text,text,text,text,text,timestamptz,timestamptz) from public,anon;
grant execute on function public.admin_announce_app_release(uuid,text,text,text,text,text,timestamptz,timestamptz) to authenticated;

alter function private.academy_push_eligible(private.academy_push_deliveries) rename to academy_push_eligible_before_app_releases;
create function private.academy_push_eligible(q private.academy_push_deliveries)
returns boolean language sql stable security definer set search_path='' as $$
  select case when q.template_key<>'app_update' then private.academy_push_eligible_before_app_releases(q)
    else exists(select 1 from private.academy_app_releases r
      join private.academy_push_devices d on d.id=q.device_id and d.user_id=q.user_id and d.generation=q.generation
        and d.enabled and d.retired_at is null and d.updated_at>now()-interval '90 days' and d.platform=r.platform
      join private.academy_push_settings s on s.id and s.enabled and s.client_ready and s.environment=d.environment and q.created_at>=s.enabled_at
      join public.notification_preferences p on p.user_id=q.user_id and p.push_enabled and p.push_app_updates
      join public.academy_members m on m.id=q.member_id and m.user_id=q.user_id and m.academy_community_id=q.community_id
      join public.notifications n on n.id=q.notification_id and n.recipient_id=q.user_id and n.target_type='app_release' and n.target_id=r.id
      where q.target_type='app_release' and q.target_id=r.id and q.preference_key='app_updates'
        and r.academy_community_id=q.community_id and r.active and r.published_at<=now() and r.expires_at>now() and q.expires_at>now()
        and private.academy_app_release_recipient(q.member_id,q.community_id)) end;
$$;
revoke all on function private.academy_push_eligible(private.academy_push_deliveries),private.academy_push_eligible_before_app_releases(private.academy_push_deliveries) from public,anon,authenticated;

create function public.get_app_release_notice(p_notification_id uuid)
returns table(platform text,version text,build text,published_at timestamptz,expires_at timestamptz,release_notes text)
language sql stable security definer set search_path='' as $$
  select r.platform,r.version,r.build,r.published_at,r.expires_at,r.release_notes
    from private.academy_app_releases r join public.notifications n on n.target_id=r.id and n.target_type='app_release' and n.recipient_id=auth.uid()
    join public.academy_members m on m.user_id=auth.uid() and m.academy_community_id=r.academy_community_id
    where n.id=p_notification_id and r.active and r.published_at<=now() and r.expires_at>now()
      and private.academy_app_release_recipient(m.id,r.academy_community_id);
$$;
revoke all on function public.get_app_release_notice(uuid) from public,anon;
grant execute on function public.get_app_release_notice(uuid) to authenticated;

alter function public.resolve_academy_push_notification(uuid) rename to resolve_academy_push_notification_before_app_releases;
alter function public.resolve_academy_push_notification_before_app_releases(uuid) set schema private;
revoke all on function private.resolve_academy_push_notification_before_app_releases(uuid) from public,anon,authenticated;
create function public.resolve_academy_push_notification(p_notification_id uuid)
returns table(target_type text,target_id uuid,comment_id uuid) language sql stable security definer set search_path='' as $$
  select old.* from private.resolve_academy_push_notification_before_app_releases(p_notification_id) old
  union all
  select 'app_release',n.target_id,null::uuid from public.get_app_release_notice(p_notification_id) notice
    join public.notifications n on n.id=p_notification_id and n.recipient_id=auth.uid()
    where exists(select 1 from private.academy_push_deliveries q where q.notification_id=n.id and q.user_id=auth.uid()
      and q.target_type='app_release' and q.target_id=n.target_id and q.template_key='app_update');
$$;
revoke all on function public.resolve_academy_push_notification(uuid) from public,anon;
grant execute on function public.resolve_academy_push_notification(uuid) to authenticated;
