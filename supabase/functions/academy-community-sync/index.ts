import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { createCommunitySyncHandler, communitySyncReply, type CommunitySyncAdmin } from "./handler.ts";

Deno.serve(async request => {
  if (request.method !== "POST") return communitySyncReply({ error: "Method not allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return communitySyncReply({ error: "Sync not configured" }, 503);
  const admin = createClient(url, key, { auth: { persistSession: false } });
  // Narrow the client's generic query types to the server operations this handler uses.
  return createCommunitySyncHandler(admin as unknown as CommunitySyncAdmin, name => Deno.env.get(name))(request);
});
