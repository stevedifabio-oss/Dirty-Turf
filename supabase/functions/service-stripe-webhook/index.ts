import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import Stripe from 'npm:stripe@22.6.2';
import { loadRuntimeConfig } from '../_shared/runtime-config.ts';
import { billingConfiguration } from '../_shared/checkout.ts';
import { createServiceWebhookHandler } from '../_shared/service-checkout.ts';

Deno.serve(async request => {
  const url = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return Response.json({ error: 'Service payments are not configured' }, { status: 503 });
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const runtime = await loadRuntimeConfig(admin, ['STRIPE_SECRET_KEY', 'STRIPE_MODE', 'STRIPE_SERVICE_WEBHOOK_SECRET'], name => Deno.env.get(name));
  // Continue authentic webhook processing even if new sales have been disabled.
  const config = billingConfiguration('true', runtime.STRIPE_MODE, runtime.STRIPE_SECRET_KEY);
  if (!config.enabled || !runtime.STRIPE_SECRET_KEY) return Response.json({ error: 'Service payments are not configured' }, { status: 503 });
  return createServiceWebhookHandler({ admin, stripe: new Stripe(runtime.STRIPE_SECRET_KEY), ...config, signingSecret: runtime.STRIPE_SERVICE_WEBHOOK_SECRET, cryptoProvider: Stripe.createSubtleCryptoProvider() })(request);
});
