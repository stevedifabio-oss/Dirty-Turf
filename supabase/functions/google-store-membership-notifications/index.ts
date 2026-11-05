import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@6.2.15";
import { createGoogleMembershipNotificationHandler } from "../_shared/google-membership-notifications.ts";
import { googleMembershipSourceKey, verifyGoogleMembership, getGoogleMembershipAccountBinding, acknowledgeGoogleMembership } from "../_shared/google-membership-runtime.ts";
import { applyVerifiedMembership } from "../_shared/store-membership-fulfillment.ts";
const url = Deno.env.get("SUPABASE_URL") ?? "";
const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"), { timeoutDuration: 8_000 });
const handler = createGoogleMembershipNotificationHandler({
  async authenticate(request) {
    const expectedEmail = Deno.env.get("GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL");
    if (!expectedEmail || !/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(expectedEmail)) return false;
    const authorization = request.headers.get("authorization") ?? "";
    if (!/^Bearer \S+$/.test(authorization)) return false;
    const { payload } = await jwtVerify(authorization.slice(7), googleKeys, {
      algorithms: ["RS256"], issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: `${url}/functions/v1/google-store-membership-notifications`, maxTokenAge: "65m",
    });
    return payload.email === expectedEmail && payload.email_verified === true;
  },
  sourceKey: googleMembershipSourceKey,
  accountBinding: token => getGoogleMembershipAccountBinding(token, { serviceAccountJson: Deno.env.get("GOOGLE_PLAY_IAP_SERVICE_ACCOUNT_JSON") ?? "" }),
  async resolveAccount(hash) {
    const { data, error } = await admin.rpc("resolve_google_store_account", { p_account_hash: hash });
    if (error) throw new Error("Store account binding unavailable");
    return typeof data === "string" ? data : null;
  },
  async lookup(sourceKey) {
    const { data, error } = await admin.from("academy_store_entitlements").select("user_id").eq("provider", "google").eq("source_key", sourceKey).limit(2);
    if (error) throw new Error("Store binding unavailable");
    return data?.length === 1 ? data[0].user_id : null;
  },
  verify: (token, userId) => verifyGoogleMembership(token, userId, { serviceAccountJson: Deno.env.get("GOOGLE_PLAY_IAP_SERVICE_ACCOUNT_JSON") ?? "" }),
  apply: value => applyVerifiedMembership(admin, value),
  acknowledge: (token, userId) => acknowledgeGoogleMembership(token, userId, { serviceAccountJson: Deno.env.get("GOOGLE_PLAY_IAP_SERVICE_ACCOUNT_JSON") ?? "" }),
});
Deno.serve(handler);
