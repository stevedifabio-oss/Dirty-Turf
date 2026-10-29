import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { loadRuntimeConfig } from "../_shared/runtime-config.ts";
import { configuredPushEnvironment, preparePushSender, PUSH_CONFIG_NAMES, type PushDelivery } from "../_shared/native-push.ts";

export async function handlePushDispatch(request: Request) {
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "Push is not configured" }, 503);
  const admin = createClient(url, key, { auth: { persistSession: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(8000) }) } });
  const settings = await loadRuntimeConfig(admin, PUSH_CONFIG_NAMES, name => Deno.env.get(name));
  if (settings.ACADEMY_PUSH_ENABLED !== "true") return json({ enabled: false, sent: 0 });
  let environment: "sandbox" | "production";
  try { environment = configuredPushEnvironment(settings); } catch { return json({ error: "Push is not configured" }, 503); }
  const supplied = request.headers.get("x-push-dispatch-secret") ?? "";
  const expected = settings.ACADEMY_PUSH_DISPATCH_SECRET!;
  let mismatch = supplied.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) mismatch |= (supplied.charCodeAt(i) || 0) ^ expected.charCodeAt(i);
  if (mismatch) return json({ error: "Authentication required" }, 401);
  const lock = crypto.randomUUID();
  const results: string[] = [];
  let claimedCount = 0;
  const claimDeadline = Date.now() + 45_000;
  const senders = new Map<string, Awaited<ReturnType<typeof preparePushSender>>>();
  // Claim one at a time: unattempted devices never sit under a processing lease
  // while prior provider requests wait on the network.
  for (let batch = 0; batch < 25 && Date.now() < claimDeadline; batch++) {
    const { data: rows, error } = await admin.rpc("claim_academy_push_deliveries", { p_limit: 1, p_lock: lock, p_environment: environment });
    if (error) return json({ error: "Push queue unavailable" }, 500);
    if (!rows?.[0]) break;
    const row = rows[0]; claimedCount++;
    let providerStarted = false;
    try {
      const { data: prepared, error: prepareError } = await admin.rpc("prepare_academy_push_delivery", { p_id: row.id, p_lock: lock });
      if (prepareError) throw new Error("Preparation failed");
      if (!prepared?.[0]) { results.push("cancelled"); continue; }
      const delivery = prepared[0] as PushDelivery;
      let sender = senders.get(delivery.platform);
      if (!sender) { sender = await preparePushSender(delivery.platform, environment, settings); senders.set(delivery.platform, sender); }
      // OAuth/signing can take time. Recheck after that work, immediately before send.
      const { data: final, error: finalError } = await admin.rpc("prepare_academy_push_delivery", { p_id: row.id, p_lock: lock });
      if (finalError) throw new Error("Preparation failed");
      if (!final?.[0]) { results.push("cancelled"); continue; }
      const current = final[0] as PushDelivery;
      if (JSON.stringify(current) !== JSON.stringify(delivery)) throw new Error("Delivery changed");
      providerStarted = true;
      const outcome = await sender(current);
      const { data: finished, error: finishError } = await admin.rpc("finish_academy_push_delivery", { p_id: row.id, p_lock: lock, p_result: outcome.result, p_provider_id: outcome.providerId ?? null });
      if (finishError || !finished) throw new Error("Completion failed");
      results.push(outcome.result);
    } catch {
      await admin.rpc("finish_academy_push_delivery", { p_id: row.id, p_lock: lock, p_result: providerStarted ? "uncertain" : "retry", p_provider_id: null });
      results.push(providerStarted ? "uncertain" : "retry");
    }
  }
  return json({ claimed: claimedCount, sent: results.filter(x => x === "sent").length, cancelled: results.filter(x => ["cancelled", "invalid_token"].includes(x)).length, reviewRequired: results.filter(x => ["rejected", "uncertain"].includes(x)).length, retrying: results.filter(x => x === "retry").length });
}
Deno.serve(handlePushDispatch);
