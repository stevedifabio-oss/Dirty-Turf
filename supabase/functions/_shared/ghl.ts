const GHL_BASE_URL = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "v3";
const REQUEST_TIMEOUT_MS = 12_000;

export type GhlLocation = {
  id: string;
  name: string;
};

export type GhlPipeline = {
  id: string;
  name: string;
  stages?: Array<{ id: string; name: string }>;
};

export type GhlWorkflow = {
  id: string;
  name: string;
  status?: string;
};

export class GhlApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "GhlApiError";
  }
}

export function getGhlConfig() {
  const token = Deno.env.get("GHL_PRIVATE_INTEGRATION_TOKEN")?.trim();
  const locationId = Deno.env.get("GHL_LOCATION_ID")?.trim();
  if (!token || !locationId) {
    throw new GhlApiError("HighLevel is not configured.", 503);
  }
  return { token, locationId };
}

export async function getGhlLocation() {
  const { locationId } = getGhlConfig();
  const response = await ghlRequest<
    { location?: GhlLocation } & Partial<GhlLocation>
  >(
    `/locations/${encodeURIComponent(locationId)}`,
  );
  const location = response.location ?? response;
  if (!location.id || !location.name) {
    throw new GhlApiError(
      "HighLevel returned an invalid location response.",
      502,
    );
  }
  return { id: location.id, name: location.name };
}

export async function getGhlPipelines() {
  const { locationId } = getGhlConfig();
  const response = await ghlRequest<{ pipelines?: GhlPipeline[] }>(
    `/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`,
  );
  return response.pipelines ?? [];
}

export async function getGhlWorkflows() {
  const { locationId } = getGhlConfig();
  const response = await ghlRequest<{ workflows?: GhlWorkflow[] }>(
    `/workflows/?locationId=${encodeURIComponent(locationId)}`,
  );
  return response.workflows ?? [];
}

export async function getGhlProductAccess() {
  const { locationId } = getGhlConfig();
  await ghlRequest(
    `/products/?locationId=${encodeURIComponent(locationId)}&limit=1`,
  );
  return true;
}

async function ghlRequest<T = Record<string, unknown>>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (!path.startsWith("/")) {
    throw new GhlApiError("Invalid HighLevel API path.", 500);
  }
  const { token } = getGhlConfig();
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Version", GHL_API_VERSION);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${GHL_BASE_URL}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
    const text = await response.text();
    const body = parseJson(text);
    if (!response.ok) {
      const detail = responseMessage(body);
      throw new GhlApiError(
        detail
          ? `HighLevel request failed: ${detail}`
          : "HighLevel request failed.",
        response.status,
      );
    }
    return body as T;
  } catch (error) {
    if (error instanceof GhlApiError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new GhlApiError("HighLevel did not respond in time.", 504);
    }
    throw new GhlApiError("HighLevel could not be reached.", 502);
  } finally {
    clearTimeout(timeout);
  }
}

function parseJson(value: string): unknown {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function responseMessage(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const body = value as { message?: unknown; error?: unknown };
  const candidate = body.message ?? body.error;
  if (typeof candidate === "string") return candidate.slice(0, 180);
  if (Array.isArray(candidate)) {
    return candidate.filter((item) => typeof item === "string").join(", ")
      .slice(0, 180);
  }
  return "";
}
