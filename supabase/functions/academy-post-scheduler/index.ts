import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { handleConfiguredPostScheduler } from "./runtime-handler.ts";

Deno.serve(request => handleConfiguredPostScheduler(request, name => Deno.env.get(name), () => {
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Scheduler is not configured");
  return createClient(url, key, { auth: { persistSession: false } });
}));
