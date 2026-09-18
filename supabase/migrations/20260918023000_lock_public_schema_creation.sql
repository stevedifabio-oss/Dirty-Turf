-- Prevent authenticated or anonymous API users from shadowing objects used by
-- trusted database functions whose search path includes the public schema.
revoke create on schema public from public, anon, authenticated;

alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon;
