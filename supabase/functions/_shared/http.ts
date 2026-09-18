const nativeOrigins = new Set([
  "capacitor://localhost",
  "http://localhost",
  "https://localhost",
]);

export function corsHeaders(request: Request, methods = "POST, OPTIONS") {
  const origin = request.headers.get("origin");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": methods,
    "Vary": "Origin",
  };
  if (origin && allowedOrigins().has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

export function handlePreflight(request: Request, methods = "POST, OPTIONS") {
  if (request.method !== "OPTIONS") return null;
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigins().has(origin)) {
    return Response.json({ error: "Origin not allowed" }, { status: 403, headers: corsHeaders(request, methods) });
  }
  return new Response(null, { status: 204, headers: corsHeaders(request, methods) });
}

export function jsonResponse(
  request: Request,
  body: unknown,
  init: ResponseInit = {},
  methods = "POST, OPTIONS",
) {
  return Response.json(body, {
    ...init,
    headers: { ...corsHeaders(request, methods), ...init.headers },
  });
}

function allowedOrigins() {
  const origins = new Set(nativeOrigins);
  origins.add("http://localhost:5173");

  const appUrl = Deno.env.get("APP_URL");
  if (appUrl) {
    try {
      origins.add(new URL(appUrl).origin);
    } catch {
      // A malformed APP_URL is rejected by redirect validation where it matters.
    }
  }

  for (const configured of (Deno.env.get("APP_ALLOWED_ORIGINS") ?? "").split(",")) {
    const value = configured.trim();
    if (value) origins.add(value);
  }
  return origins;
}
