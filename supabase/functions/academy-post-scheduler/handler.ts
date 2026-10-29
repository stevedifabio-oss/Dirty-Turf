type SchedulerAdmin = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };
type Settings = { enabled?: string; secret?: string };

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store" },
});
function equalSecret(a: string, b: string) {
  const aa = new TextEncoder().encode(a), bb = new TextEncoder().encode(b);
  let difference = aa.length ^ bb.length;
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) difference |= (aa[i] ?? 0) ^ (bb[i] ?? 0);
  return difference === 0;
}

/** No member JWT or request-supplied clock can authorize publication. */
export async function handlePostScheduler(request: Request, settings: Settings, admin: () => SchedulerAdmin) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!settings.secret || settings.secret.length < 32) return json({ error: "Scheduler is not configured" }, 503);
  if (!equalSecret(request.headers.get("x-post-scheduler-secret") ?? "", settings.secret)) return json({ error: "Authentication required" }, 401);
  if (settings.enabled !== "true") return json({ enabled: false, published: 0 });
  const length = Number(request.headers.get("content-length") ?? 0);
  if (!Number.isFinite(length) || length > 1024) return json({ error: "Invalid scheduler request" }, 400);
  let body: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 1024) return json({ error: "Invalid scheduler request" }, 400);
    body = raw ? JSON.parse(raw) : {};
  } catch { return json({ error: "Invalid scheduler request" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => key !== "limit")) return json({ error: "Invalid scheduler request" }, 400);
  const limit = (body as { limit?: unknown }).limit ?? 25;
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 100) return json({ error: "Invalid scheduler batch" }, 400);
  try {
    const { data, error } = await admin().rpc("publish_due_academy_posts", { p_limit: limit });
    if (error) return json({ error: "Scheduled publication failed" }, 500);
    return json(data);
  } catch { return json({ error: "Scheduled publication failed" }, 500); }
}
