import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  getGhlLocation,
  getGhlPipelines,
  getGhlProductAccess,
  getGhlWorkflows,
  GhlApiError,
} from "../_shared/ghl.ts";
import { handlePreflight, jsonResponse } from "../_shared/http.ts";

Deno.serve(async (request) => {
  const preflight = handlePreflight(request, "GET, OPTIONS");
  if (preflight) return preflight;
  if (request.method !== "GET") {
    return jsonResponse(request, { error: "Method not allowed" }, {
      status: 405,
    }, "GET, OPTIONS");
  }

  const authorization = request.headers.get("authorization");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!authorization || !supabaseUrl || !anonKey) {
    return jsonResponse(request, { error: "Authentication is not configured" }, {
      status: 503,
    }, "GET, OPTIONS");
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
    return jsonResponse(request, { error: "Authentication required" }, {
      status: 401,
    }, "GET, OPTIONS");
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
    return jsonResponse(request, { error: "Workspace access could not be verified" }, {
      status: 500,
    }, "GET, OPTIONS");
  }
  if (!membership) {
    return jsonResponse(request, { error: "Administrator access required" }, {
      status: 403,
    }, "GET, OPTIONS");
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

  return jsonResponse(request, {
    connected: locationResult.available,
    location: locationResult,
    pipelines: pipelineResult,
    workflows: workflowResult,
    products: productResult,
  }, {}, "GET, OPTIONS");
});

function settled<T, R>(result: PromiseSettledResult<T>, map: (value: T) => R) {
  if (result.status === "fulfilled") {
    return { available: true as const, ...map(result.value) };
  }
  const error = result.reason;
  const status = error instanceof GhlApiError ? error.status : 502;
  return { available: false as const, status };
}
