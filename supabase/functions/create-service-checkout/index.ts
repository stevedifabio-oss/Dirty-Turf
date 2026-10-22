import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import Stripe from 'npm:stripe@22.6.2';
import { loadRuntimeConfig } from '../_shared/runtime-config.ts';
import { billingConfiguration } from '../_shared/checkout.ts';
import { createServiceCheckoutHandler } from '../_shared/service-checkout.ts';
import { handlePreflight, corsHeaders, jsonResponse } from '../_shared/http.ts';

Deno.serve(async request => {
  const preflight = handlePreflight(request); if (preflight) return preflight;
  const url = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return jsonResponse(request, { error: 'Service checkout is not configured' }, { status: 503 });
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const runtime = await loadRuntimeConfig(admin, ['STRIPE_SECRET_KEY', 'STRIPE_MODE', 'STRIPE_SERVICE_CHECKOUT_ENABLED', 'STRIPE_SERVICE_RECURRING_ENABLED', 'STRIPE_PORTAL_CONFIGURATION_ID'], name => Deno.env.get(name));
  const config = billingConfiguration(runtime.STRIPE_SERVICE_CHECKOUT_ENABLED, runtime.STRIPE_MODE, runtime.STRIPE_SECRET_KEY);
  if (!config.enabled || !runtime.STRIPE_SECRET_KEY) return jsonResponse(request, { error: 'Service checkout is not open yet' }, { status: 503 });
  const handler = createServiceCheckoutHandler({ admin, stripe: new Stripe(runtime.STRIPE_SECRET_KEY), ...config, appUrl: Deno.env.get('APP_URL'), recurringEnabled: runtime.STRIPE_SERVICE_RECURRING_ENABLED === 'true', configurationId: runtime.STRIPE_PORTAL_CONFIGURATION_ID });
  const result = await handler(request);
  for (const [name, value] of Object.entries(corsHeaders(request))) result.headers.set(name, value);
  return result;
});
