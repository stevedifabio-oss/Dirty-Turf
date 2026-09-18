import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { handlePreflight, jsonResponse } from "../_shared/http.ts";

const PROVIDER = "nominatim";
const CACHE_DAYS = 30;
const REQUEST_TIMEOUT_MS = 8_000;
const APP_USER_AGENT = "DirtyTurfAcademy/1.0 (+https://app.dirtyturf.com; contact: hello@dirtyturf.com)";

type GeocodeRequest = { query?: unknown };
type GeocodeResult = {
  formattedAddress: string;
  latitude: number;
  longitude: number;
};

Deno.serve(async (request) => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  if (request.method !== "POST") {
    return jsonResponse(request, { error: "Method not allowed" }, { status: 405 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("authorization");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization?.startsWith("Bearer ")) {
    return jsonResponse(request, { error: "Address search is not configured" }, { status: 503 });
  }

  let body: GeocodeRequest;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(request, { error: "Invalid JSON payload" }, { status: 400 });
  }

  const query = normalizeQuery(body.query);
  if (!query) {
    return jsonResponse(request, { error: "Enter an address between 3 and 180 characters" }, { status: 422 });
  }

  const memberClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const token = authorization.slice(7);
  const { data: userData, error: userError } = await memberClient.auth.getUser(token);
  if (userError || !userData.user) {
    return jsonResponse(request, { error: "Authentication required" }, { status: 401 });
  }

  const { data: accessData, error: accessError } = await memberClient.rpc("get_academy_access_state");
  const access = accessData && typeof accessData === "object"
    ? accessData as Record<string, unknown>
    : {};
  if (accessError || access.hasAccess !== true) {
    return jsonResponse(request, { error: "Academy membership is required" }, { status: 403 });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const queryHash = await sha256(query.toLocaleLowerCase("en-US"));
  const now = new Date();
  const { error: expiredCacheCleanupError } = await admin
    .from("map_geocode_cache")
    .delete()
    .lt("expires_at", now.toISOString());
  if (expiredCacheCleanupError) console.error("Expired geocode cache cleanup failed", expiredCacheCleanupError.code);

  const { data: cached, error: cacheReadError } = await admin
    .from("map_geocode_cache")
    .select("results")
    .eq("user_id", userData.user.id)
    .eq("provider", PROVIDER)
    .eq("query_hash", queryHash)
    .gt("expires_at", now.toISOString())
    .maybeSingle();
  if (cacheReadError) console.error("Geocode cache read failed", cacheReadError.code);
  if (cached && isGeocodeResults(cached.results)) {
    return jsonResponse(request, responseBody(cached.results, true));
  }

  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const { error: cleanupError } = await admin
    .from("map_geocode_request_slots")
    .delete()
    .lt("request_second", oneHourAgo);
  if (cleanupError) console.error("Geocode slot cleanup failed", cleanupError.code);

  const requestSecond = new Date(Math.floor(now.getTime() / 1000) * 1000).toISOString();
  const { error: slotError } = await admin
    .from("map_geocode_request_slots")
    .insert({ provider: PROVIDER, request_second: requestSecond });
  if (slotError?.code === "23505") {
    return jsonResponse(request, { error: "Address search is busy. Try again in a moment." }, {
      status: 429,
      headers: { "Retry-After": "1" },
    });
  }
  if (slotError) {
    console.error("Geocode slot reservation failed", slotError.code);
    return jsonResponse(request, { error: "Address search is temporarily unavailable" }, { status: 503 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const params = new URLSearchParams({
      countrycodes: "us",
      email: "hello@dirtyturf.com",
      format: "jsonv2",
      limit: "5",
      q: query,
    });
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: {
        Accept: "application/json",
        "Accept-Language": "en-US,en;q=0.8",
        "User-Agent": APP_USER_AGENT,
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Nominatim returned ${response.status}`);

    const results = normalizeProviderResults(await response.json());
    const expiresAt = new Date(now.getTime() + CACHE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { error: cacheWriteError } = await admin.from("map_geocode_cache").upsert({
      user_id: userData.user.id,
      provider: PROVIDER,
      query_hash: queryHash,
      results,
      cached_at: now.toISOString(),
      expires_at: expiresAt,
    }, { onConflict: "user_id,provider,query_hash" });
    if (cacheWriteError) console.error("Geocode cache write failed", cacheWriteError.code);

    return jsonResponse(request, responseBody(results, false));
  } catch (error) {
    console.error("Address geocoding failed", error instanceof Error ? error.message : "unknown error");
    return jsonResponse(request, { error: "Address search is temporarily unavailable" }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
});

function normalizeQuery(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return normalized.length >= 3 && normalized.length <= 180 ? normalized : null;
}

function normalizeProviderResults(value: unknown): GeocodeResult[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const latitude = Number(item.lat);
    const longitude = Number(item.lon);
    const formattedAddress = typeof item.display_name === "string"
      ? item.display_name.trim().slice(0, 300)
      : "";
    if (!formattedAddress || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return [];
    return [{ formattedAddress, latitude, longitude }];
  }).slice(0, 5);
}

function isGeocodeResults(value: unknown): value is GeocodeResult[] {
  return Array.isArray(value) && value.every((item) =>
    item && typeof item === "object" &&
    typeof item.formattedAddress === "string" &&
    typeof item.latitude === "number" && Number.isFinite(item.latitude) &&
    typeof item.longitude === "number" && Number.isFinite(item.longitude)
  );
}

function responseBody(results: GeocodeResult[], cached: boolean) {
  return { results, cached, attribution: "© OpenStreetMap contributors" };
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
