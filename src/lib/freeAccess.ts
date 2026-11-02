import { supabase } from "./backend";

export type FreeAccessGrant = { resource: string; endsAt: string | null };
export async function loadFreeAccess(memberId: string): Promise<FreeAccessGrant[]> {
  if (!supabase) throw new Error("Free access needs the connected Academy backend.");
  const { data, error } = await supabase.rpc("admin_get_free_access", { p_member_id: memberId });
  if (error) throw new Error("Free access could not load. This feature requires the backend update and Academy owner access.");
  if (!Array.isArray(data) || data.some(row => !row || typeof row.resource !== "string" || (row.endsAt !== null && (typeof row.endsAt !== "string" || !Number.isFinite(Date.parse(row.endsAt)))))) throw new Error("Free access could not be verified.");
  return data;
}

export async function saveFreeAccess(memberId: string, resource: string, enabled: boolean, endsAt: string | null) {
  if (!supabase) throw new Error("Free access needs the connected Academy backend.");
  if (!memberId || !resource || (endsAt !== null && (!Number.isFinite(Date.parse(endsAt)) || Date.parse(endsAt) <= Date.now()))) throw new Error("Choose a future expiration or permanent access.");
  const { error } = await supabase.rpc("admin_set_free_access", { p_member_id: memberId, p_resource: resource, p_enabled: enabled, p_ends_at: enabled ? endsAt : null });
  if (error) throw new Error("Free access could not be saved. Check owner permissions, course restrictions, and the backend update, then reload current access.");
}
