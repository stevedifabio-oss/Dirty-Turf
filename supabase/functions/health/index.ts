import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(() => Response.json({
  ok: true,
  service: "dirty-turf-api",
  timestamp: new Date().toISOString(),
}));
