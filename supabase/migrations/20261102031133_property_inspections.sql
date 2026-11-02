-- Optional inspections extend saved calculations without changing the RPC used
-- by older installed clients. Photos continue to use the existing property store.
alter table public.estimates
  add constraint estimates_id_organization_key unique (id, organization_id);

create table public.property_inspections (
  estimate_id uuid primary key,
  organization_id uuid not null,
  turf_condition text check (turf_condition in ('poor', 'fair', 'good', 'excellent')),
  visible_seams text check (visible_seams in ('none', 'visible', 'separating')),
  debris_level text check (debris_level in ('none', 'light', 'moderate', 'heavy')),
  infill_level text check (infill_level in ('low', 'adequate', 'high', 'unsure')),
  notes text not null default '' check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint property_inspections_estimate_organization_fk
    foreign key (estimate_id, organization_id)
    references public.estimates(id, organization_id) on delete cascade
);

create index property_inspections_organization_idx on public.property_inspections(organization_id);
create trigger property_inspections_updated_at before update on public.property_inspections
  for each row execute function public.set_updated_at();

alter table public.property_inspections enable row level security;
revoke all on public.property_inspections from public, anon, authenticated;
grant select, insert, update, delete on public.property_inspections to authenticated;
grant all on public.property_inspections to service_role;
create policy "property_inspections_member_access"
  on public.property_inspections for all to authenticated
  using (public.is_organization_member(organization_id))
  with check (public.is_organization_member(organization_id));

create function public.create_infill_inspection(
  p_label text,
  p_square_feet numeric,
  p_infill_rate numeric,
  p_service_rate numeric,
  p_measurement_method public.measurement_method,
  p_inspection jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  inspection jsonb := coalesce(p_inspection, '{}'::jsonb);
  item record;
  condition_value text;
  seams_value text;
  debris_value text;
  infill_value text;
  notes_value text;
  new_estimate_id uuid;
  target_organization_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to save a property' using errcode = '42501';
  end if;
  if jsonb_typeof(inspection) is distinct from 'object' then
    raise exception 'Inspection must be an object' using errcode = '22023';
  end if;
  for item in select key, value from jsonb_each(inspection) loop
    if item.key not in ('turf_condition', 'visible_seams', 'debris_level', 'infill_level', 'notes')
       or jsonb_typeof(item.value) not in ('string', 'null') then
      raise exception 'Unsupported inspection field or value' using errcode = '22023';
    end if;
  end loop;

  condition_value := nullif(btrim(inspection ->> 'turf_condition'), '');
  seams_value := nullif(btrim(inspection ->> 'visible_seams'), '');
  debris_value := nullif(btrim(inspection ->> 'debris_level'), '');
  infill_value := nullif(btrim(inspection ->> 'infill_level'), '');
  notes_value := btrim(coalesce(inspection ->> 'notes', ''));
  if (condition_value is not null and condition_value not in ('poor', 'fair', 'good', 'excellent'))
     or (seams_value is not null and seams_value not in ('none', 'visible', 'separating'))
     or (debris_value is not null and debris_value not in ('none', 'light', 'moderate', 'heavy'))
     or (infill_value is not null and infill_value not in ('low', 'adequate', 'high', 'unsure'))
     or char_length(notes_value) > 2000 then
    raise exception 'Invalid inspection choice or notes longer than 2000 characters' using errcode = '22023';
  end if;

  if p_square_feet is null or p_square_feet::text in ('NaN', 'Infinity', '-Infinity')
     or round(p_square_feet, 2) <= 0 or p_square_feet > 9999999999.99
     or p_service_rate is null or p_service_rate::text in ('NaN', 'Infinity', '-Infinity')
     or p_service_rate < 0 or p_service_rate > 99999999.99
     or p_infill_rate is null or p_infill_rate not in (0.25, 0.50, 0.75, 1.00, 1.50, 2.00, 2.50, 3.00)
     or p_measurement_method is null then
    raise exception 'Invalid measurement or pricing values' using errcode = '22023';
  end if;

  new_estimate_id := public.create_infill_calculation(
    p_label, p_square_feet, p_infill_rate, p_service_rate, p_measurement_method
  );
  select organization_id into strict target_organization_id
    from public.estimates where id = new_estimate_id;

  if condition_value is not null or seams_value is not null or debris_value is not null
     or infill_value is not null or notes_value <> '' then
    insert into public.property_inspections(
      estimate_id, organization_id, turf_condition, visible_seams, debris_level, infill_level, notes
    ) values (
      new_estimate_id, target_organization_id, condition_value, seams_value, debris_value, infill_value, notes_value
    );
  end if;
  return new_estimate_id;
end;
$$;

revoke all on function public.create_infill_inspection(text, numeric, numeric, numeric, public.measurement_method, jsonb)
  from public, anon;
grant execute on function public.create_infill_inspection(text, numeric, numeric, numeric, public.measurement_method, jsonb)
  to authenticated;
