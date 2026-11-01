-- Prepared only: new accounts after rollout complete onboarding. No access grants.
create table private.signup_profile_rollout(singleton boolean primary key default true check(singleton),required_after timestamptz not null default now());
alter table private.signup_profile_rollout enable row level security;
insert into private.signup_profile_rollout default values;
revoke all on private.signup_profile_rollout from public,anon,authenticated;
create table private.member_signup_profiles(
 user_id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null check(char_length(display_name) between 2 and 100),
 phone text not null check(char_length(phone)<=40 and phone ~ '^[+0-9 ().-]+$' and char_length(regexp_replace(phone,'[^0-9]','','g')) between 7 and 15),
 location text not null check(char_length(location) between 2 and 160),
 about text not null check(char_length(about) between 10 and 500),
 experience text not null check(experience in ('just_started','under_two_years','over_two_years')),
 avatar_path text not null,completed_at timestamptz not null default now()
);
alter table private.member_signup_profiles enable row level security;
revoke all on private.member_signup_profiles from public,anon,authenticated;
alter table public.academy_members add column about text not null default '' check(char_length(about)<=500);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('member-avatars','member-avatars',true,5242880,array['image/jpeg']) on conflict(id) do nothing;
create policy member_avatar_insert on storage.objects for insert to authenticated
with check(bucket_id='member-avatars' and name ~ ('^'||(select auth.uid())::text||'/[0-9a-f-]{36}\.jpg$'));
create policy member_avatar_delete on storage.objects for delete to authenticated
using(bucket_id='member-avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy member_avatar_own_select on storage.objects for select to authenticated
using(bucket_id='member-avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy member_avatar_insert_guard on storage.objects as restrictive for insert to authenticated
with check(bucket_id<>'member-avatars' or name ~ ('^'||(select auth.uid())::text||'/[0-9a-f-]{36}\.jpg$'));
create policy member_avatar_update_guard on storage.objects as restrictive for update to authenticated
using(bucket_id<>'member-avatars') with check(bucket_id<>'member-avatars');
create policy member_avatar_delete_guard on storage.objects as restrictive for delete to authenticated
using(bucket_id<>'member-avatars' or (storage.foldername(name))[1]=(select auth.uid())::text);

create function private.get_my_signup_profile() returns jsonb language plpgsql security definer set search_path='' as $$
declare account auth.users; profile private.member_signup_profiles;
begin
 select * into account from auth.users where id=auth.uid() and email_confirmed_at is not null and deleted_at is null and (banned_until is null or banned_until<now());
 if account.id is null then raise exception 'Verified sign-in required'; end if;
 select * into profile from private.member_signup_profiles where user_id=account.id;
 return jsonb_build_object('required',profile.user_id is null and account.created_at >= (select required_after from private.signup_profile_rollout),
 'profile',case when profile.user_id is null then '{}'::jsonb else jsonb_build_object('name',profile.display_name,'phone',profile.phone,'location',profile.location,'about',profile.about,'avatarPath',profile.avatar_path,'experience',profile.experience) end);
end $$;
create function public.get_my_signup_profile() returns jsonb language sql security invoker set search_path='' as $$ select private.get_my_signup_profile() $$;
create function private.save_my_signup_profile(p_name text,p_phone text,p_location text,p_about text,p_avatar_path text,p_experience text) returns void language plpgsql security definer set search_path='' as $$
declare uid uuid := auth.uid();
begin
 if not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null and deleted_at is null and (banned_until is null or banned_until<now())) then raise exception 'Verified sign-in required'; end if;
 if p_avatar_path is null or p_avatar_path !~ ('^'||uid::text||'/[0-9a-f-]{36}\.jpg$') or not exists(select 1 from storage.objects where bucket_id='member-avatars' and name=p_avatar_path and metadata->>'mimetype'='image/jpeg' and (metadata->>'size')::bigint between 1 and 5242880) then raise exception 'Upload your profile photo first'; end if;
 insert into private.member_signup_profiles(user_id,display_name,phone,location,about,avatar_path,experience) values(uid,btrim(p_name),btrim(p_phone),btrim(p_location),btrim(p_about),p_avatar_path,p_experience)
 on conflict(user_id) do update set display_name=excluded.display_name,phone=excluded.phone,location=excluded.location,about=excluded.about,avatar_path=excluded.avatar_path,experience=excluded.experience;
 update public.academy_members set display_name=btrim(p_name),location=btrim(p_location),about=btrim(p_about),avatar_url='https://ipbtldajgsoxixqmajec.supabase.co/storage/v1/object/public/member-avatars/'||p_avatar_path where user_id=uid;
end $$;
create function public.save_my_signup_profile(p_name text,p_phone text,p_location text,p_about text,p_avatar_path text,p_experience text) returns void language sql security invoker set search_path='' as $$ select private.save_my_signup_profile(p_name,p_phone,p_location,p_about,p_avatar_path,p_experience) $$;
create function private.apply_signup_profile_to_member() returns trigger language plpgsql security definer set search_path='' as $$
declare profile private.member_signup_profiles;
begin
 select * into profile from private.member_signup_profiles where user_id=new.user_id;
 if profile.user_id is not null then
 new.display_name:=profile.display_name; new.location:=profile.location; new.about:=profile.about;
 new.avatar_url:='https://ipbtldajgsoxixqmajec.supabase.co/storage/v1/object/public/member-avatars/'||profile.avatar_path;
 end if;
 return new;
end $$;
create trigger member_signup_profile_copy before insert or update of user_id on public.academy_members for each row execute function private.apply_signup_profile_to_member();
revoke all on function private.apply_signup_profile_to_member() from public,anon,authenticated;
revoke all on function private.get_my_signup_profile(),public.get_my_signup_profile(),private.save_my_signup_profile(text,text,text,text,text,text),public.save_my_signup_profile(text,text,text,text,text,text) from public,anon,authenticated;
grant usage on schema private to authenticated;
grant execute on function private.get_my_signup_profile(),public.get_my_signup_profile(),private.save_my_signup_profile(text,text,text,text,text,text),public.save_my_signup_profile(text,text,text,text,text,text) to authenticated;
