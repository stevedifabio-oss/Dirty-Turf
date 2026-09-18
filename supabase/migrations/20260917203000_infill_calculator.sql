alter table public.estimates
  add column if not exists infill_rate numeric(4,2) not null default 0.25
    check (infill_rate in (0.25, 0.50, 0.75, 1.00, 1.50, 2.00, 2.50, 3.00)),
  add column if not exists total_infill_pounds numeric(12,2) not null default 0
    check (total_infill_pounds >= 0),
  add column if not exists bag_count_40 integer not null default 0
    check (bag_count_40 >= 0),
  add column if not exists bag_count_50 integer not null default 0
    check (bag_count_50 >= 0),
  add column if not exists service_rate numeric(10,2) not null default 0
    check (service_rate >= 0);

update public.estimates
set bag_count_40 = bag_count
where bag_count_40 = 0 and bag_count > 0;

create or replace view public.job_cards with (security_invoker = true) as
select
  e.id,
  p.name as property_name,
  coalesce(m.square_feet, 0) as square_feet,
  e.bag_count_40 as bag_count,
  e.total,
  e.status::text,
  coalesce(m.method, 'manual'::public.measurement_method)::text as measurement_method,
  e.created_at,
  (select count(*) from public.photos ph where ph.property_id = p.id)::integer as photo_count,
  e.total_infill_pounds,
  e.bag_count_50,
  e.infill_rate,
  e.service_rate
from public.estimates e
join public.properties p on p.id = e.property_id
left join public.measurements m on m.id = e.measurement_id;

create or replace function public.create_infill_calculation(
  p_label text,
  p_square_feet numeric,
  p_infill_rate numeric,
  p_service_rate numeric,
  p_measurement_method public.measurement_method
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  target_organization_id uuid;
  new_property_id uuid;
  new_measurement_id uuid;
  new_estimate_id uuid;
  safe_area numeric := greatest(coalesce(p_square_feet, 0), 0);
  safe_rate numeric := greatest(coalesce(p_service_rate, 0), 0);
  safe_infill_rate numeric := coalesce(p_infill_rate, 0.25);
  infill_pounds numeric;
  bags_40 integer;
  bags_50 integer;
  customer_total numeric;
begin
  if safe_infill_rate not in (0.25, 0.50, 0.75, 1.00, 1.50, 2.00, 2.50, 3.00) then
    raise exception 'Unsupported infill rate';
  end if;
  if safe_area <= 0 then
    raise exception 'Measured area must be greater than zero';
  end if;

  select organization_id into target_organization_id
  from public.organization_members
  where user_id = (select auth.uid())
  order by created_at
  limit 1;

  if target_organization_id is null then
    raise exception 'No organization membership found';
  end if;

  infill_pounds := ceil(safe_area * safe_infill_rate);
  bags_40 := ceil(infill_pounds / 40.0);
  bags_50 := ceil(infill_pounds / 50.0);
  customer_total := round(safe_area * safe_rate, 2);

  insert into public.properties (organization_id, name, created_by)
  values (
    target_organization_id,
    coalesce(nullif(trim(p_label), ''), p_measurement_method::text || ' measurement - ' || round(safe_area, 2) || ' sq ft'),
    (select auth.uid())
  )
  returning id into new_property_id;

  insert into public.measurements (organization_id, property_id, method, square_feet, created_by)
  values (target_organization_id, new_property_id, p_measurement_method, safe_area, (select auth.uid()))
  returning id into new_measurement_id;

  insert into public.estimates (
    organization_id,
    property_id,
    measurement_id,
    plan,
    bag_count,
    bag_count_40,
    bag_count_50,
    infill_rate,
    total_infill_pounds,
    service_rate,
    service_subtotal,
    materials_total,
    plan_total,
    total,
    status,
    created_by
  )
  values (
    target_organization_id,
    new_property_id,
    new_measurement_id,
    'premium',
    bags_40,
    bags_40,
    bags_50,
    safe_infill_rate,
    infill_pounds,
    safe_rate,
    customer_total,
    0,
    0,
    customer_total,
    'ready_to_quote',
    (select auth.uid())
  )
  returning id into new_estimate_id;

  return new_estimate_id;
end;
$$;

revoke execute on function public.create_infill_calculation(
  text,
  numeric,
  numeric,
  numeric,
  public.measurement_method
) from public, anon;

grant execute on function public.create_infill_calculation(
  text,
  numeric,
  numeric,
  numeric,
  public.measurement_method
) to authenticated;
