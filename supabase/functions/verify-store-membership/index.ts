import "jsr:@supabase/functions-js@2.116.0/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { handlePreflight, corsHeaders } from "../_shared/http.ts";
import { createMembershipVerificationHandler } from "../_shared/store-membership-handler.ts";
import { verifyAppleMembership } from "../_shared/apple-membership-runtime.ts";
import { verifyGoogleMembership, acknowledgeGoogleMembership } from "../_shared/google-membership-runtime.ts";
import { applyVerifiedMembership } from "../_shared/store-membership-fulfillment.ts";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const google = () => ({ serviceAccountJson: Deno.env.get("GOOGLE_PLAY_IAP_SERVICE_ACCOUNT_JSON") ?? "" });
const apple = () => ({ privateKey: Deno.env.get("APPLE_IAP_PRIVATE_KEY") ?? "", keyId: Deno.env.get("APPLE_IAP_KEY_ID") ?? "", issuerId: Deno.env.get("APPLE_IAP_ISSUER_ID") ?? "" });
const handler = createMembershipVerificationHandler({
  async authenticate(authorization) {
    const { data, error } = await admin.auth.getUser(authorization.slice(7));
    return error || !data.user?.email_confirmed_at ? null : data.user.id;
  },
  async availability(authorization, provider) {
    const caller = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
    const { data, error } = await caller.rpc("get_membership_store_status", { p_provider: provider });
    if (error || !data || typeof data.enabled !== "boolean" || !Array.isArray(data.products)) throw new Error("Store purchase configuration unavailable");
    return data;
  },
  verifyGoogle: (token, userId) => verifyGoogleMembership(token, userId, google()),
  verifyApple: (proof, userId) => verifyAppleMembership(proof, userId, apple()),
  apply: value => applyVerifiedMembership(admin, value),
  async acknowledgeGoogle(token, userId) {
    const latest = await acknowledgeGoogleMembership(token, userId, google());
    await applyVerifiedMembership(admin, latest);
  },
  async reserveVerification(userId) {
    const { data, error } = await admin.rpc("reserve_store_verification", { p_user_id: userId });
    if (error) throw new Error("Purchase verification is temporarily unavailable");
    return data?.allowed === true;
  },
});
Deno.serve(async request => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  const response = await handler(request);
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(request))) headers.set(key, value);
  return new Response(response.body, { status: response.status, headers });
});
