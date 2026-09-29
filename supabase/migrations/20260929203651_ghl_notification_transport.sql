-- Exact server-only allowlist. Built-in service-role keys never enter this RPC.
create or replace function private.get_server_runtime_config(p_names text[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') <> 'service_role' then
    raise insufficient_privilege using message = 'Service role required';
  end if;
  return coalesce((
    select jsonb_object_agg(s.name, s.decrypted_secret)
    from vault.decrypted_secrets s
    where s.name = any(p_names) and s.name = any(array[
      'STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','STRIPE_MODE','STRIPE_CHECKOUT_ENABLED','STRIPE_PORTAL_CONFIGURATION_ID',
      'GHL_COURSE_SYNC_SECRET','GHL_COURSE_SYNC_ENABLED','GHL_PRIVATE_INTEGRATION_TOKEN','GHL_LOCATION_ID',
      'ACADEMY_EMAIL_DELIVERY_ENABLED','NOTIFICATION_DISPATCH_SECRET','NOTIFICATION_SIGNING_SECRET',
      'MAILGUN_API_KEY','MAILGUN_DOMAIN','MAILGUN_FROM_EMAIL','MAILGUN_FROM_NAME','MAILGUN_REGION',
      'ACADEMY_EMAIL_PROVIDER','GHL_EMAIL_FROM'
    ]::text[])
  ), '{}'::jsonb);
end;
$$;
revoke all on function private.get_server_runtime_config(text[]) from public, anon, authenticated;
grant execute on function private.get_server_runtime_config(text[]) to service_role;
