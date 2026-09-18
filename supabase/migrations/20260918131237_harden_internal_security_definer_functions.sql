-- These functions are invoked by database triggers, never by client RPCs.
-- Keep their SECURITY DEFINER privileges internal to the database owner.
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.rls_auto_enable() from public, anon, authenticated;
