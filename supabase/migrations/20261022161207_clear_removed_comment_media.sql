-- Keep the thread/audit identity when an Academy moderator removes a comment,
-- but remove every attachment as well as the displayed text. No storage object
-- is deleted: an object may be shared with another still-accessible record.
alter table public.community_comments
  add column moderated_at timestamptz,
  add column moderated_by uuid references auth.users(id) on delete set null;
create index community_comments_moderated_by_idx
  on public.community_comments(moderated_by) where moderated_by is not null;

-- academy-import also writes comments directly, outside the event/snapshot
-- override checks. Keep a removed comment removed at the shared SQL boundary.
-- This internal trigger needs no privileged lookup or client execute access.
create function private.preserve_removed_community_comment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  deleting_moderator_reference boolean := false;
begin
  if old.moderated_at is not null then
    -- Honor the audit FK's ON DELETE SET NULL action when Auth deletes its
    -- referenced user. A direct writer cannot use this nested, audit-only path.
    deleting_moderator_reference := pg_trigger_depth() > 1
      and old.moderated_by is not null and new.moderated_by is null
      and (to_jsonb(new) - array['moderated_by', 'updated_at'])
        is not distinct from (to_jsonb(old) - array['moderated_by', 'updated_at']);
    new.body := '[Removed by Academy moderator]';
    new.media := '[]'::jsonb;
    new.is_answer := false;
    new.sync_owner := 'local';
    new.moderated_at := old.moderated_at;
    if not deleting_moderator_reference then new.moderated_by := old.moderated_by; end if;
  end if;
  return new;
end;
$$;
revoke all on function private.preserve_removed_community_comment()
  from public, anon, authenticated, service_role;
create trigger preserve_removed_community_comment
  before update on public.community_comments
  for each row execute function private.preserve_removed_community_comment();

create or replace function public.admin_remove_community_comment(p_comment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.community_comments%rowtype;
  sync_config_id uuid;
  moderator_id uuid := (select auth.uid());
begin
  select * into target from public.community_comments where id = p_comment_id for update;
  if moderator_id is null or target.academy_community_id is null
     or not (select private.can_manage_academy(target.academy_community_id)) then
    raise exception 'Academy administrator access required' using errcode = '42501';
  end if;

  update public.community_comments set
    body = '[Removed by Academy moderator]',
    media = '[]'::jsonb,
    is_answer = false,
    sync_owner = 'local',
    moderated_by = case when moderated_at is null then moderator_id else moderated_by end,
    moderated_at = coalesce(moderated_at, now())
  where id = target.id;

  -- Reserve the imported identity explicitly, including calls made inside a
  -- source-sync session. Both event and snapshot writers honor local_override;
  -- a later source edit/delete must not restore the removed text or media.
  if target.source_provider = 'highlevel' and target.external_id is not null then
    select id into sync_config_id from public.academy_community_sync_configs
    where academy_community_id = target.academy_community_id;
    if sync_config_id is not null then
      insert into public.academy_community_sync_state
        (config_id, entity, external_id, row_id, local_override)
      values (sync_config_id, 'comment', target.external_id, target.id, true)
      on conflict (config_id, entity, external_id)
      do update set row_id = excluded.row_id, local_override = true;
    end if;
  end if;
end;
$$;

revoke all on function public.admin_remove_community_comment(uuid) from public, anon;
grant execute on function public.admin_remove_community_comment(uuid) to authenticated;

-- Repair old removals that predate attachment support. The original actor/time
-- cannot be reconstructed: record this repair time, leave the actor unknown,
-- and preserve the existing report, parent/replies, and comment identity.
do $$
declare previous_sync text := current_setting('app.academy_community_sync', true);
begin
  perform set_config('app.academy_community_sync', 'off', true);
  update public.community_comments set
    media = '[]'::jsonb,
    is_answer = false,
    sync_owner = 'local',
    moderated_at = coalesce(moderated_at, now())
  where academy_community_id is not null
    and body = '[Removed by Academy moderator]';
  perform set_config('app.academy_community_sync', coalesce(previous_sync, 'off'), true);
end;
$$;
