import { loadRuntimeConfig } from "../_shared/runtime-config.ts";
import { readCommunitySyncJson, validateCommunitySyncEvent, communitySha256, canonicalCommunityJson, secretMatches } from "../_shared/community-sync.ts";

type DatabaseError = { code?: string; message?: string } | null;
type Config = { id: string; enabled: boolean; location_id: string; group_id: string };
export type CommunitySyncAdmin = {
  from(table: string): {
    select(columns: string): { eq(column: string, value: string): { maybeSingle(): PromiseLike<{ data: Config | null; error: DatabaseError }> } };
    insert(row: Record<string, unknown>): PromiseLike<{ error: DatabaseError }>;
  };
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: DatabaseError }>;
};
export const communitySyncReply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export function createCommunitySyncHandler(admin: CommunitySyncAdmin, env: (name: string) => string | undefined) {
  return async (request: Request): Promise<Response> => {
    try {
      if (request.method !== "POST") return communitySyncReply({ error: "Method not allowed" }, 405);
      const settings = await loadRuntimeConfig(admin, ["GHL_COMMUNITY_SYNC_SECRET", "GHL_COMMUNITY_SYNC_CONFIG_ID"], env);
      if (!await secretMatches(request.headers.get("x-community-sync-secret"), settings.GHL_COMMUNITY_SYNC_SECRET)) return communitySyncReply({ error: "Unauthorized" }, 401);
      const configId = settings.GHL_COMMUNITY_SYNC_CONFIG_ID;
      if (!configId) return communitySyncReply({ error: "Sync not configured" }, 503);
      const { data: config, error: configError } = await admin.from("academy_community_sync_configs")
        .select("id,enabled,location_id,group_id").eq("id", configId).maybeSingle();
      if (configError || !config || config.id !== configId) return communitySyncReply({ error: "Sync not configured" }, 503);
      if (!config.enabled) return communitySyncReply({ status: "disabled" }, 503);
      const route = new URL(request.url).pathname.split("/").filter(Boolean).at(-1);
      if (route !== "capture" && route !== "apply") return communitySyncReply({ error: "Unknown sync route" }, 404);
      let payload: unknown;
      try { payload = await readCommunitySyncJson(request); }
      catch (error) { return communitySyncReply({ error: "Invalid or oversized JSON payload" }, (error as { status?: number }).status === 413 ? 413 : 400); }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return communitySyncReply({ error: "Object payload required" }, 400);

      // Raw native payloads remain private and unapplied until their identity schema is verified.
      if (route === "capture") {
        const hash = await communitySha256(canonicalCommunityJson(payload));
        const { error } = await admin.from("academy_community_sync_inbox").insert({ config_id: configId, payload_hash: hash, payload });
        if (error && error.code !== "23505") return communitySyncReply({ error: "Capture temporarily unavailable" }, 503);
        return communitySyncReply({ accepted: true, status: "needs_mapping", duplicate: error?.code === "23505" }, 202);
      }
      let event;
      try { event = validateCommunitySyncEvent(payload); }
      catch { return communitySyncReply({ error: "Invalid community event contract" }, 422); }
      if (event.locationId !== config.location_id || event.groupId !== config.group_id) return communitySyncReply({ error: "Source not allowed" }, 403);
      const { data, error } = await admin.rpc("apply_academy_community_event", { p_config_id: configId, p_event: event });
      if (error) return communitySyncReply({ error: "Unable to apply community event" }, 503);
      if (!data || typeof data !== "object" || Array.isArray(data)) return communitySyncReply({ error: "Invalid sync result" }, 503);
      const status = (data as { status?: string }).status;
      if (!["applied", "duplicate", "stale", "conflict", "pending"].includes(status ?? "")) return communitySyncReply({ error: "Invalid sync result" }, 503);
      return communitySyncReply(data, status === "pending" ? 202 : 200);
    } catch {
      // No provider exceptions, secrets or member payloads are exposed to the caller.
      return communitySyncReply({ error: "Community sync temporarily unavailable" }, 503);
    }
  };
}
