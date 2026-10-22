-- Limited literal-text screening, not comprehensive abuse or media detection.
-- Human reports, member blocking and moderator review remain necessary. This
-- migration does not rewrite, hide or delete existing community content.
create function private.normalize_community_filter_text(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(lower(coalesce(p_text, '')), '[^[:alnum:]]+', ' ', 'g'))
$$;

create table private.community_prohibited_text_rules (
  phrase text primary key check (char_length(phrase) between 1 and 200),
  normalized_phrase text generated always as (private.normalize_community_filter_text(phrase)) stored,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  constraint community_prohibited_text_rules_normalized_key unique (normalized_phrase),
  constraint community_prohibited_text_rules_nonempty check (normalized_phrase <> '')
);
alter table private.community_prohibited_text_rules enable row level security;
revoke all on private.community_prohibited_text_rules from public, anon, authenticated;
grant usage on schema private to service_role;
grant select, insert, update, delete on private.community_prohibited_text_rules to service_role;
create policy community_prohibited_text_rules_service_manage
  on private.community_prohibited_text_rules for all to service_role
  using (true) with check (true);

revoke all on function private.normalize_community_filter_text(text) from public, anon, authenticated;
grant execute on function private.normalize_community_filter_text(text) to service_role;

-- Rules are private literal phrases, never user-supplied executable patterns.
-- New rules and enabled-state changes require trusted server administration.
insert into private.community_prohibited_text_rules (phrase) values
  ('kill yourself'),
  ('i will kill you');

create function private.screen_community_prohibited_text()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  texts_to_check text[] := '{}'::text[];
  candidate text;
  normalized text;
begin
  -- No member, manager, importer, service-role or sync-setting bypass: the
  -- trigger checks the same changed fields regardless of the write's origin.
  if tg_op = 'INSERT' then
    texts_to_check := array[new.body];
    if tg_table_name = 'community_posts' then
      texts_to_check := array_append(texts_to_check, new.title);
    end if;
  else
    if new.body is distinct from old.body then
      texts_to_check := array_append(texts_to_check, new.body);
    end if;
    if tg_table_name = 'community_posts' then
      if new.title is distinct from old.title then
        texts_to_check := array_append(texts_to_check, new.title);
      end if;
    end if;
  end if;

  foreach candidate in array texts_to_check loop
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

-- Definer access is only for the private-rule lookup inside this internal
-- trigger. It is not a callable client API and does not alter write privileges.
revoke all on function private.screen_community_prohibited_text() from public, anon, authenticated, service_role;
create trigger screen_community_post_prohibited_text
  before insert or update of title, body on public.community_posts
  for each row execute function private.screen_community_prohibited_text();
create trigger screen_community_comment_prohibited_text
  before insert or update of body on public.community_comments
  for each row execute function private.screen_community_prohibited_text();

comment on table private.community_prohibited_text_rules is
  'Service-administered literal phrase rules for limited pre-write community text screening. Not a comprehensive abuse/media filter; human reporting and moderation remain required.';
