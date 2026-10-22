-- Screen a photo post's text before issuing or renewing an upload lease.
-- File-format checks do not screen objectionable image content: human reports,
-- blocking, and moderator review remain necessary for the images themselves.
create function private.screen_community_photo_draft_text()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate text;
  normalized text;
begin
  -- Completed receipts and failed-attempt cleanup remain recoverable even if
  -- the private phrase rules changed after the original submission.
  if new.status is distinct from 'uploading' then return new; end if;

  foreach candidate in array array[new.payload->>'title', new.payload->>'body'] loop
    normalized := private.normalize_community_filter_text(candidate);
    if exists (
      select 1 from private.community_prohibited_text_rules rule
      where rule.enabled
        and strpos(' ' || normalized || ' ', ' ' || rule.normalized_phrase || ' ') > 0
    ) then
      raise exception using errcode = '23514',
        message = 'This content cannot be posted under the Community Rules. Please revise it or contact support.';
    end if;
  end loop;
  return new;
end;
$$;

-- Only the private-rule lookup needs definer privileges. This is an internal
-- table invariant, not a new public RPC or a client-callable helper.
revoke all on function private.screen_community_photo_draft_text()
  from public, anon, authenticated, service_role;
create trigger screen_community_photo_draft_text
  before insert or update on public.academy_community_photo_requests
  for each row execute function private.screen_community_photo_draft_text();

-- The community_posts text trigger remains the final commit-time invariant if
-- a rule is enabled between successful reservation/upload and finalization.
