-- Keep the public Data API authenticated-only. Row-level security remains the
-- per-record authorization boundary for members and company workspaces.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from public, anon;

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

revoke all on public.integration_events from authenticated;

grant execute on function public.is_organization_member(uuid) to authenticated;
grant execute on function public.is_organization_admin(uuid) to authenticated;
grant execute on function public.create_property_estimate(
  text,
  numeric,
  integer,
  numeric,
  public.measurement_method,
  public.cleaning_plan
) to authenticated;
grant execute on function public.create_community_post(text, text) to authenticated;
grant execute on function public.toggle_post_reaction(uuid) to authenticated;
grant execute on function public.toggle_post_bookmark(uuid) to authenticated;
grant execute on function public.toggle_event_rsvp(uuid) to authenticated;
grant execute on function public.set_lesson_completion(uuid, boolean) to authenticated;

alter default privileges for role postgres in schema public
  revoke all on tables from anon;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon;
