import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  getGhlLocation,
  getGhlPipelines,
  getGhlProductAccess,
  getGhlWorkflows,
  GhlApiError,
} from "../_shared/ghl.ts";

Deno.serve(async (request) => {
  const cors = corsHeaders(request);
  if (!cors) {
    return Response.json({ error: "Origin is not allowed" }, { status: 403 });
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (request.method !== "GET") {
    return Response.json({ error: "Method not allowed" }, {
      status: 405,
      headers: cors,
    });
  }

  const authorization = request.headers.get("authorization");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!authorization || !supabaseUrl || !anonKey) {
    return Response.json({ error: "Authentication is not configured" }, {
      status: 503,
      headers: cors,
    });
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const token = authorization.replace(/^Bearer\s+/i, "");
  const { data: userData, error: userError } = await supabase.auth.getUser(
    token,
  );
  if (userError || !userData.user) {
    return Response.json({ error: "Authentication required" }, {
      status: 401,
      headers: cors,
    });
  }

  const { data: membership, error: membershipError } = await supabase
    .from("organization_members")
    .select("role")
    .eq("user_id", userData.user.id)
    .in("role", ["owner", "admin"])
    .limit(1)
    .maybeSingle();
  if (membershipError) {
    console.error(
      "HighLevel status membership lookup failed",
      membershipError.code,
    );
    return Response.json({ error: "Workspace access could not be verified" }, {
      status: 500,
      headers: cors,
    });
  }
  if (!membership) {
    return Response.json({ error: "Administrator access required" }, {
      status: 403,
      headers: cors,
    });
  }

  const [location, pipelines, workflows, products] = await Promise.allSettled([
    getGhlLocation(),
    getGhlPipelines(),
    getGhlWorkflows(),
    getGhlProductAccess(),
  ]);

  const locationResult = settled(location, (value) => value);
  const pipelineResult = settled(pipelines, (value) => ({
    count: value.length,
    items: value.map((pipeline) => ({
      id: pipeline.id,
      name: pipeline.name,
      stages: (pipeline.stages ?? []).map((stage) => ({
        id: stage.id,
        name: stage.name,
      })),
    })),
  }));
  const workflowResult = settled(workflows, (value) => ({
    count: value.length,
    items: value.map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      status: workflow.status ?? null,
    })),
  }));
  const productResult = settled(products, () => ({ accessible: true }));

  return Response.json({
    connected: locationResult.available,
    location: locationResult,
    pipelines: pipelineResult,
    workflows: workflowResult,
    products: productResult,
  }, { headers: cors });
});

function settled<T, R>(result: PromiseSettledResult<T>, map: (value: T) => R) {
  if (result.status === "fulfilled") {
    return { available: true as const, ...map(result.value) };
  }
  const error = result.reason;
  const status = error instanceof GhlApiError ? error.status : 502;
  return { available: false as const, status };
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin")?.replace(/\/$/, "") ?? "";
  const appUrl = Deno.env.get("APP_URL")?.replace(/\/$/, "") ?? "";
  const localOrigins = new Set([
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ]);
  const allowedOrigin =
    origin && (origin === appUrl || localOrigins.has(origin))
      ? origin
      : !origin
      ? appUrl || "http://localhost:5173"
      : "";
  if (!allowedOrigin) return null;
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Vary": "Origin",
  };
}
