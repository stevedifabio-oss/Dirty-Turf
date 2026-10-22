-- Private, small photo posts. Existing text posts and Academy media are unchanged.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('community-photos','community-photos',false,4194304,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create table public.academy_community_photo_requests (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  academy_community_id uuid not null references public.academy_communities(id) on delete cascade,
  academy_member_id uuid not null references public.academy_members(id) on delete cascade,
  payload jsonb not null,
  status text not null default 'uploading' check(status in('uploading','failed','published')),
  lease_token uuid not null default gen_random_uuid(),
  lease_expires_at timestamptz not null default now()+interval '3 minutes',
  attempt_count integer not null default 1 check(attempt_count between 1 and 3),
  post_id uuid unique references public.community_posts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index academy_community_photo_requests_user_created on public.academy_community_photo_requests(user_id,created_at);
alter table public.academy_community_photo_requests enable row level security;
revoke all on public.academy_community_photo_requests from public,anon,authenticated;
grant all on public.academy_community_photo_requests to service_role;

create function private.community_photo_member(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m public.academy_members; c public.academy_communities; manager boolean;
begin
  select * into m from public.academy_members where user_id=p_user_id and status='active' order by created_at,id limit 1;
  if m.id is null then raise exception 'Active Community membership required' using errcode='42501'; end if;
  select * into c from public.academy_communities where id=m.academy_community_id;
  manager:=m.role in('owner','admin') or exists(select 1 from public.organization_members om where om.organization_id=c.owner_organization_id and om.user_id=p_user_id and om.role in('owner','admin'));
  if c.owner_organization_id is null or not (manager or private.has_active_academy_grant(m.id,null)) then
    raise exception 'Active Community membership required' using errcode='42501';
  end if;
  return jsonb_build_object('memberId',m.id,'communityId',m.academy_community_id,'organizationId',c.owner_organization_id,'canManage',manager);
end $$;
revoke all on function private.community_photo_member(uuid) from public,anon,authenticated;
grant execute on function private.community_photo_member(uuid) to service_role;

create function private.validate_community_photo_payload(p_payload jsonb)
returns void language plpgsql immutable set search_path='' as $$
declare photo jsonb;
begin
  if jsonb_typeof(p_payload) is distinct from 'object'
    or (p_payload-array['title','body','category','mentionedMemberIds','photos'])<>'{}'::jsonb
    or jsonb_typeof(p_payload->'title') is distinct from 'string' or char_length(trim(p_payload->>'title')) not between 1 and 120
    or jsonb_typeof(p_payload->'body') is distinct from 'string' or char_length(trim(p_payload->>'body')) not between 1 and 5000
    or jsonb_typeof(p_payload->'category') is distinct from 'string' or char_length(trim(p_payload->>'category')) not between 1 and 80
    or jsonb_typeof(p_payload->'mentionedMemberIds') is distinct from 'array' or jsonb_array_length(p_payload->'mentionedMemberIds')>20
    or jsonb_typeof(p_payload->'photos') is distinct from 'array' or jsonb_array_length(p_payload->'photos') not between 1 and 4 then
    raise exception 'Invalid photo post' using errcode='22023';
  end if;
  for photo in select value from jsonb_array_elements(p_payload->'photos') loop
    if jsonb_typeof(photo) is distinct from 'object' or (photo-array['sha256','mimeType','extension','size','width','height'])<>'{}'::jsonb
      or jsonb_typeof(photo->'sha256') is distinct from 'string' or jsonb_typeof(photo->'mimeType') is distinct from 'string' or jsonb_typeof(photo->'extension') is distinct from 'string'
      or jsonb_typeof(photo->'size') is distinct from 'number' or jsonb_typeof(photo->'width') is distinct from 'number' or jsonb_typeof(photo->'height') is distinct from 'number'
      or coalesce(photo->>'sha256','') !~ '^[0-9a-f]{64}$'
      or not coalesce(((photo->>'mimeType'='image/jpeg' and photo->>'extension'='jpg') or (photo->>'mimeType'='image/png' and photo->>'extension'='png') or (photo->>'mimeType'='image/webp' and photo->>'extension'='webp')),false)
      or coalesce(photo->>'size','') !~ '^[1-9][0-9]{0,7}$' or (photo->>'size')::bigint>4194304
      or coalesce(photo->>'width','') !~ '^[1-9][0-9]{0,4}$' or coalesce(photo->>'height','') !~ '^[1-9][0-9]{0,4}$'
      or (photo->>'width')::bigint>10000 or (photo->>'height')::bigint>10000 or (photo->>'width')::bigint*(photo->>'height')::bigint>24000000 then
      raise exception 'Invalid photo metadata' using errcode='22023';
    end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(p_payload->'mentionedMemberIds') value where jsonb_typeof(value) is distinct from 'string' or coalesce(value#>>'{}','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'Invalid mention identity' using errcode='22023';
  end if;
end $$;
revoke all on function private.validate_community_photo_payload(jsonb) from public,anon,authenticated;

create function public.reserve_community_photo_post(p_user_id uuid,p_request_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb; row public.academy_community_photo_requests; used bigint; category public.community_categories;
begin
  ctx:=private.community_photo_member(p_user_id);
  perform private.validate_community_photo_payload(p_payload);
  -- Serialize quota/reservation checks per authenticated identity.
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));
  select * into row from public.academy_community_photo_requests where id=p_request_id for update;
  if row.id is not null then
    if row.user_id<>p_user_id or row.academy_member_id<>(ctx->>'memberId')::uuid or row.payload<>p_payload then
      raise exception 'This photo request belongs to another draft' using errcode='22023';
    end if;
    if row.status='published' then return jsonb_build_object('status','published','postId',row.post_id); end if;
    if row.status='uploading' and row.lease_expires_at>now() then return jsonb_build_object('status','busy'); end if;
    if row.attempt_count>=3 then raise exception 'Photo request needs administrator review before another attempt' using errcode='54000'; end if;
  end if;
  select * into category from public.community_categories where academy_community_id=(ctx->>'communityId')::uuid and lower(name)=lower(trim(p_payload->>'category')) order by sort_order,id limit 1;
  if category.id is null or not(category.member_can_post or (ctx->>'canManage')::boolean) then raise exception 'This discussion channel is not available for posting' using errcode='42501'; end if;
  select coalesce(sum((photo->>'size')::bigint*r.attempt_count),0) into used
    from public.academy_community_photo_requests r cross join lateral jsonb_array_elements(r.payload->'photos') photo
    where r.user_id=p_user_id and r.created_at>now()-interval '24 hours';
  if used+(select sum((value->>'size')::bigint) from jsonb_array_elements(p_payload->'photos'))>104857600 then
    raise exception 'Daily photo upload limit reached. Try later or contact Academy support' using errcode='54000';
  end if;
  if row.id is null then
    if (select count(*) from public.academy_community_photo_requests where user_id=p_user_id and created_at>now()-interval '24 hours')>=20 then
      raise exception 'Daily photo post limit reached. Try later or contact Academy support' using errcode='54000';
    end if;
    insert into public.academy_community_photo_requests(id,user_id,academy_community_id,academy_member_id,payload)
      values(p_request_id,p_user_id,(ctx->>'communityId')::uuid,(ctx->>'memberId')::uuid,p_payload) returning * into row;
  else
    update public.academy_community_photo_requests set status='uploading',lease_token=gen_random_uuid(),lease_expires_at=now()+interval '3 minutes',attempt_count=attempt_count+1,updated_at=now() where id=row.id returning * into row;
  end if;
  return jsonb_build_object('status','uploading','leaseToken',row.lease_token,'communityId',row.academy_community_id,'memberId',row.academy_member_id);
end $$;

create function public.finalize_community_photo_post(p_user_id uuid,p_request_id uuid,p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb; row public.academy_community_photo_requests; category public.community_categories; photo jsonb; media jsonb:='[]'; path text; post uuid; ordinal integer:=0; mentioned uuid;
begin
  ctx:=private.community_photo_member(p_user_id);
  select * into row from public.academy_community_photo_requests where id=p_request_id for update;
  if row.id is null or row.user_id<>p_user_id or row.academy_member_id<>(ctx->>'memberId')::uuid then raise exception 'Photo request not found' using errcode='42501'; end if;
  if row.status='published' then return jsonb_build_object('status','published','postId',row.post_id); end if;
  if row.status<>'uploading' or row.lease_token<>p_lease_token or row.lease_expires_at<=now() then raise exception 'Photo upload reservation expired; retry this draft' using errcode='22023'; end if;
  select * into category from public.community_categories where academy_community_id=row.academy_community_id and lower(name)=lower(trim(row.payload->>'category')) order by sort_order,id limit 1;
  if category.id is null or not(category.member_can_post or (ctx->>'canManage')::boolean) then raise exception 'This discussion channel is not available for posting' using errcode='42501'; end if;
  for photo in select value from jsonb_array_elements(row.payload->'photos') loop
    ordinal:=ordinal+1;
    path:=row.academy_community_id::text||'/'||row.academy_member_id::text||'/'||row.id::text||'/'||row.lease_token::text||'/'||ordinal::text||'-'||(photo->>'sha256')||'.'||(photo->>'extension');
    if not exists(select 1 from storage.objects object where object.bucket_id='community-photos' and object.name=path and object.metadata->>'mimetype'=photo->>'mimeType' and (object.metadata->>'size')::bigint=(photo->>'size')::bigint) then
      raise exception 'A verified photo is missing; retry this draft' using errcode='22023';
    end if;
    media:=media||jsonb_build_array(jsonb_build_object('type','image','storage_bucket','community-photos','storage_path',path,'mime_type',photo->>'mimeType','byte_size',(photo->>'size')::bigint,'label','Photo '||ordinal));
  end loop;
  insert into public.community_posts(organization_id,academy_community_id,academy_author_id,author_id,category_id,title,body,status,media)
    values((ctx->>'organizationId')::uuid,row.academy_community_id,row.academy_member_id,p_user_id,category.id,trim(row.payload->>'title'),trim(row.payload->>'body'),'published',media) returning id into post;
  for mentioned in select distinct value::uuid from jsonb_array_elements_text(row.payload->'mentionedMemberIds') loop
    if mentioned<>row.academy_member_id and exists(select 1 from public.academy_members m where m.id=mentioned and m.academy_community_id=row.academy_community_id and m.status='active') then
      insert into public.academy_content_mentions(academy_community_id,post_id,mentioned_member_id,actor_member_id) values(row.academy_community_id,post,mentioned,row.academy_member_id) on conflict do nothing;
    end if;
  end loop;
  update public.academy_community_photo_requests set status='published',post_id=post,updated_at=now() where id=row.id;
  return jsonb_build_object('status','published','postId',post);
end $$;

-- Only a failed attempt that never called the finalizer may be released/cleaned.
-- Its token-specific folder can never be used by a later reservation.
create function public.release_community_photo_upload(p_user_id uuid,p_request_id uuid,p_lease_token uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  update public.academy_community_photo_requests set status='failed',updated_at=now()
    where id=p_request_id and user_id=p_user_id and lease_token=p_lease_token and status='uploading';
  return found;
end $$;
revoke all on function public.reserve_community_photo_post(uuid,uuid,jsonb),public.finalize_community_photo_post(uuid,uuid,uuid),public.release_community_photo_upload(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.reserve_community_photo_post(uuid,uuid,jsonb),public.finalize_community_photo_post(uuid,uuid,uuid),public.release_community_photo_upload(uuid,uuid,uuid) to service_role;

create function private.can_read_community_photo(p_path text)
returns boolean language sql stable security definer set search_path='' as $$
  select (select auth.uid()) is not null and exists(
    select 1 from public.community_posts post
    where post.status='published' and (select private.is_academy_member(post.academy_community_id))
      and exists(select 1 from jsonb_array_elements(case when jsonb_typeof(post.media)='array' then post.media else '[]'::jsonb end) item where item->>'storage_bucket'='community-photos' and item->>'storage_path'=p_path)
      and not exists(select 1 from public.academy_member_blocks block join public.academy_members viewer on viewer.id=block.blocker_member_id
        where viewer.user_id=(select auth.uid()) and block.academy_community_id=post.academy_community_id and block.blocked_member_id=post.academy_author_id)
  );
$$;
revoke all on function private.can_read_community_photo(text) from public,anon;
grant execute on function private.can_read_community_photo(text) to authenticated,service_role;
create policy "community_photos_visible_post_read" on storage.objects for select to authenticated
  using(bucket_id='community-photos' and (select private.can_read_community_photo(name)));
create policy "community_photos_service_insert_only" on storage.objects as restrictive for insert to authenticated with check(bucket_id<>'community-photos');
create policy "community_photos_service_update_only" on storage.objects as restrictive for update to authenticated using(bucket_id<>'community-photos') with check(bucket_id<>'community-photos');
create policy "community_photos_service_delete_only" on storage.objects as restrictive for delete to authenticated using(bucket_id<>'community-photos');
