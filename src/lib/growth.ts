import { supabase } from "./backend";

export type GrowthServiceKey = "website" | "ghl" | "seo-aeo" | "facebook-ads" | "website-care" | "ghl-subscription";
export type GrowthCadence = "quote" | "one_time" | "month";
export type GrowthRequestStatus = "new" | "contacted" | "closed";
export type GrowthService = { key: GrowthServiceKey; title: string; summary: string; fromCents: number; toCents: number; billingInterval: GrowthCadence };
export type GrowthSettings = { communityId: string; serviceCadences: Record<GrowthServiceKey, GrowthCadence> };
export type GrowthCatalog = { settings: GrowthSettings; services: GrowthService[] };
export type GrowthRequest = { id: string; serviceKey: GrowthServiceKey; status: GrowthRequestStatus; notes: string; createdAt: string; memberName: string; companyName: string };

export const growthServices: readonly GrowthService[] = [
  { key: "website", title: "Website", summary: "A website for your turf cleaning business.", fromCents: 149500, toCents: 249500, billingInterval: "one_time" },
  { key: "ghl", title: "GoHighLevel", summary: "Help with your business CRM and customer follow-up.", fromCents: 149500, toCents: 249500, billingInterval: "one_time" },
  { key: "seo-aeo", title: "SEO / AEO", summary: "Search and answer engine optimization for your business.", fromCents: 149500, toCents: 249500, billingInterval: "one_time" },
  { key: "facebook-ads", title: "Facebook ads management", summary: "Help managing your Facebook advertising.", fromCents: 49500, toCents: 89500, billingInterval: "month" },
  { key: "website-care", title: "Website care", summary: "Ongoing care for your business website.", fromCents: 9700, toCents: 9700, billingInterval: "month" },
  { key: "ghl-subscription", title: "GoHighLevel subscription", summary: "An ongoing GoHighLevel subscription for your business.", fromCents: 19700, toCents: 19700, billingInterval: "month" },
];

const serviceKeys: GrowthServiceKey[] = ["website", "ghl", "seo-aeo", "facebook-ads", "website-care", "ghl-subscription"];
const statuses: GrowthRequestStatus[] = ["new", "contacted", "closed"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const migrationMessage = "Growth tools need their database update. Ask an administrator to apply the Academy growth services migration, then reload.";

export function defaultGrowthSettings(communityId: string): GrowthSettings {
  return { communityId, serviceCadences: { website: "one_time", ghl: "one_time", "seo-aeo": "one_time", "facebook-ads": "month", "website-care": "month", "ghl-subscription": "month" } };
}

export function validateGrowthSettings(value: GrowthSettings): GrowthSettings {
  if (!value || !uuid.test(value.communityId) ||
    !value.serviceCadences || Object.keys(value.serviceCadences).length !== serviceKeys.length ||
    serviceKeys.some((key) => value.serviceCadences[key] !== growthServices.find((service) => service.key === key)?.billingInterval)) throw new Error("Growth settings must use the approved service payment schedules. Reload and try again.");
  return { ...value, serviceCadences: { ...value.serviceCadences } };
}

export function parseGrowthSettings(row: unknown, communityId: string): GrowthSettings {
  if (row === null) return defaultGrowthSettings(communityId);
  if (!row || typeof row !== "object") throw new Error("Growth settings could not be loaded.");
  const value = row as Record<string, unknown>;
  if (value.academy_community_id !== communityId) throw new Error("Growth settings do not belong to this Academy.");
  return validateGrowthSettings({ communityId, serviceCadences: value.service_cadences as GrowthSettings["serviceCadences"] });
}

export function parseGrowthRequest(row: unknown): GrowthRequest {
  if (!row || typeof row !== "object") throw new Error("Service requests could not be loaded.");
  const value = row as Record<string, unknown>;
  if (typeof value.id !== "string" || !uuid.test(value.id) || !serviceKeys.includes(value.service_key as GrowthServiceKey) || !statuses.includes(value.status as GrowthRequestStatus) ||
    typeof value.notes !== "string" || value.notes.length > 2000 || typeof value.created_at !== "string" || !Number.isFinite(Date.parse(value.created_at)) ||
    typeof value.member_name !== "string" || typeof value.company_name !== "string") throw new Error("Service requests could not be loaded.");
  return { id: value.id, serviceKey: value.service_key as GrowthServiceKey, status: value.status as GrowthRequestStatus,
    notes: value.notes, createdAt: value.created_at, memberName: value.member_name, companyName: value.company_name };
}

function growthError(error: { code?: string } | null, fallback: string): Error {
  return new Error(error && ["42P01", "42883", "PGRST202", "PGRST205"].includes(error.code ?? "") ? migrationMessage : fallback);
}

async function growthContext() {
  if (!supabase) throw new Error("Sign in online to use growth services.");
  const { data, error } = await supabase.rpc("get_academy_access_state");
  if (error) throw growthError(error, "Your Academy access could not be checked. Reconnect and try again.");
  if (data?.hasAccess !== true || typeof data.communityId !== "string" || !uuid.test(data.communityId)) throw new Error("Active Academy access is required.");
  return { client: supabase, communityId: data.communityId as string, canManage: data.canManage === true };
}

const requestColumns = "id,service_key,status,notes,created_at,member_name,company_name";

export async function loadGrowthCatalog(): Promise<GrowthCatalog> {
  const { client, communityId } = await growthContext();
  const { data, error } = await client.from("academy_growth_settings").select("academy_community_id,service_cadences").eq("academy_community_id", communityId).maybeSingle();
  if (error) throw growthError(error, "Growth options could not load. Please try again.");
  const settings = parseGrowthSettings(data, communityId);
  return { settings, services: growthServices.map((service) => ({ ...service, billingInterval: settings.serviceCadences[service.key] })) };
}

export async function loadOwnGrowthRequests(): Promise<GrowthRequest[]> {
  const { client, communityId } = await growthContext();
  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError || !auth.user) throw new Error("Sign in again to view your service requests.");
  const { data, error } = await client.from("academy_growth_requests").select(requestColumns).eq("academy_community_id", communityId).eq("user_id", auth.user.id).order("created_at", { ascending: false }).limit(250);
  if (error) throw growthError(error, "Your service requests could not load. Please try again.");
  return (data ?? []).map(parseGrowthRequest);
}

export async function createGrowthRequest(serviceKey: GrowthServiceKey, notes: string, requestId: string): Promise<GrowthRequest> {
  if (!serviceKeys.includes(serviceKey) || typeof notes !== "string" || notes.length > 2000 || !uuid.test(requestId)) throw new Error("Choose a service and keep your message within 2,000 characters.");
  const { client } = await growthContext();
  const { data, error } = await client.rpc("create_academy_growth_request", { p_service_key: serviceKey, p_notes: notes.trim(), p_request_id: requestId });
  if (error) throw growthError(error, "Your request could not be saved. Please try again; retries will not create another open request.");
  try { return parseGrowthRequest(data); }
  catch { throw new Error("The request could not be confirmed. Retry with the same request before submitting another."); }
}

export async function loadAdminGrowthRequests(communityId: string, status: GrowthRequestStatus | "all" = "all"): Promise<GrowthRequest[]> {
  if (status !== "all" && !statuses.includes(status)) throw new Error("Choose a valid request status.");
  const context = await growthContext();
  if (!context.canManage || communityId !== context.communityId) throw new Error("Administrator access is required for this Academy.");
  // Bound each status separately so recent closed requests cannot hide older
  // unresolved work. The UI states the latest-250-per-status limit explicitly.
  const groups = await Promise.all((status === "all" ? statuses : [status]).map(async (requestedStatus) => {
    const { data, error } = await context.client.from("academy_growth_requests").select(requestColumns).eq("academy_community_id", communityId)
      .eq("status", requestedStatus).order("created_at", { ascending: false }).limit(250);
    if (error) throw growthError(error, "Service requests could not load. Please try again.");
    return (data ?? []).map(parseGrowthRequest);
  }));
  return [...new Map(groups.flat().map((request) => [request.id, request])).values()].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

export async function updateGrowthRequestStatus(id: string, status: GrowthRequestStatus): Promise<void> {
  if (!uuid.test(id) || !statuses.includes(status)) throw new Error("Choose a valid request status.");
  const { client, communityId, canManage } = await growthContext();
  if (!canManage) throw new Error("Administrator access is required.");
  const { data, error } = await client.from("academy_growth_requests").update({ status }).eq("id", id).eq("academy_community_id", communityId).select("id").single();
  if (error || !data) throw growthError(error, "The request status could not be saved. Refresh and try again.");
}

export async function saveGrowthSettings(input: GrowthSettings): Promise<GrowthSettings> {
  const settings = validateGrowthSettings(input);
  const { client, communityId, canManage } = await growthContext();
  if (!canManage || settings.communityId !== communityId) throw new Error("Administrator access is required for this Academy.");
  const { data, error } = await client.from("academy_growth_settings").upsert({ academy_community_id: communityId, service_cadences: settings.serviceCadences }, { onConflict: "academy_community_id" })
    .select("academy_community_id,service_cadences").single();
  if (error || !data) throw growthError(error, "Growth settings could not be saved. Refresh and try again.");
  return parseGrowthSettings(data, communityId);
}
