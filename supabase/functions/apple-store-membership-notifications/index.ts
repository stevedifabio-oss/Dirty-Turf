import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { verifyAppleMembershipNotification } from "../_shared/apple-membership-runtime.ts";
import { applyVerifiedMembership } from "../_shared/store-membership-fulfillment.ts";
import { readLimitedJson, RequestBodyTooLarge } from "../_shared/limited-json.ts";
const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
Deno.serve(async request => {
  if (request.method !== "POST") return new Response(null, { status: 405 });
  try {
    const body = await readLimitedJson(request, 100_000) as { signedPayload?: unknown } | null;
    if (!body || typeof body.signedPayload !== "string" || body.signedPayload.length > 90_000) return new Response(null, { status: 400 });
    const verified = await verifyAppleMembershipNotification(body.signedPayload, {
      privateKey: Deno.env.get("APPLE_IAP_PRIVATE_KEY") ?? "", keyId: Deno.env.get("APPLE_IAP_KEY_ID") ?? "", issuerId: Deno.env.get("APPLE_IAP_ISSUER_ID") ?? "",
    });
    if (verified) await applyVerifiedMembership(admin, verified);
    return new Response(null, { status: 204 });
  } catch (error) { return new Response(null, { status: error instanceof RequestBodyTooLarge ? 413 : 503 }); }
});
