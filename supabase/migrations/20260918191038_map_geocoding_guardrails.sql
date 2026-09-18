-- Keep address lookups member-only, cache them per user, and enforce the
-- public Nominatim service's application-wide request ceiling.
create table public.map_geocode_cache (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'nominatim' check (provider in ('nominatim')),
  query_hash text not null check (query_hash ~ '^[0-9a-f]{64}$'),
  results jsonb not null check (jsonb_typeof(results) = 'array'),
  cached_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (user_id, provider, query_hash),
  check (expires_at > cached_at)
);

create table public.map_geocode_request_slots (
  provider text not null check (provider in ('nominatim')),
  request_second timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (provider, request_second),
  check (request_second = date_trunc('second', request_second))
);

alter table public.map_geocode_cache enable row level security;
alter table public.map_geocode_request_slots enable row level security;

revoke all on table public.map_geocode_cache from public, anon, authenticated;
revoke all on table public.map_geocode_request_slots from public, anon, authenticated;
grant select, insert, update, delete on table public.map_geocode_cache to service_role;
grant select, insert, delete on table public.map_geocode_request_slots to service_role;

create index map_geocode_cache_expires_at_idx
  on public.map_geocode_cache (expires_at);
create index map_geocode_request_slots_created_at_idx
  on public.map_geocode_request_slots (created_at);
