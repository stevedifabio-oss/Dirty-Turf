import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { corsHeaders, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { createCommunityPhotoHandler } from "../_shared/community-photo-handler.ts";

Deno.serve(async request => {
  const preflight = handlePreflight(request); if (preflight) return preflight;
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return jsonResponse(request,{error:"Photo posting is not available yet.",retrySameDraft:false},{status:503});
  const admin = createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const bucket = admin.storage.from("community-photos");
  const handler = createCommunityPhotoHandler({
    user: async token => { const {data,error} = await admin.auth.getUser(token); return error ? null : data.user?.id ?? null; },
    rpc: async (name,args) => admin.rpc(name,args),
    upload: async (path,file,contentType) => bucket.upload(path,file,{contentType,upsert:false,cacheControl:"3600"}),
    remove: async paths => bucket.remove(paths),
  });
  const response = await handler(request);
  for (const [name,value] of Object.entries(corsHeaders(request))) response.headers.set(name,value);
  return response;
});
