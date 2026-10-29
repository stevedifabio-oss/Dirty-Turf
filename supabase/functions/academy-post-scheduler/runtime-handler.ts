import { loadRuntimeConfig } from "../_shared/runtime-config.ts";
import { handlePostScheduler } from "./handler.ts";

export const POST_SCHEDULER_CONFIG_NAMES = ["ACADEMY_POST_SCHEDULER_ENABLED", "ACADEMY_POST_SCHEDULER_SECRET"] as const;
type SchedulerAdmin = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };

/** Environment wins, including an explicit disabled flag. Missing values may
 * use the existing service-role-only Vault RPC; failures remain unconfigured. */
export async function handleConfiguredPostScheduler(request: Request, env: (name: string) => string | undefined, createAdmin: () => SchedulerAdmin) {
  if (request.method !== "POST") return handlePostScheduler(request, {}, createAdmin);
  let client: SchedulerAdmin | undefined;
  const admin = () => client ??= createAdmin();
  // Keep construction lazy: fully configured unauthorized/disabled requests do
  // not need an admin client. Vault fallback performs reads, never publication.
  const settings = await loadRuntimeConfig({ rpc: (name, args) => admin().rpc(name, args) }, POST_SCHEDULER_CONFIG_NAMES, env);
  return handlePostScheduler(request, {
    enabled: settings.ACADEMY_POST_SCHEDULER_ENABLED,
    secret: settings.ACADEMY_POST_SCHEDULER_SECRET,
  }, admin);
}
