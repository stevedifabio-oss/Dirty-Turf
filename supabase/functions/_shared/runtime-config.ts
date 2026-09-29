// Server-only fallback. Never use this module with a browser Supabase client.
export const SERVER_RUNTIME_CONFIG_NAMES = [
  "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_MODE", "STRIPE_CHECKOUT_ENABLED", "STRIPE_PORTAL_CONFIGURATION_ID",
  "GHL_COURSE_SYNC_SECRET", "GHL_COURSE_SYNC_ENABLED", "GHL_PRIVATE_INTEGRATION_TOKEN", "GHL_LOCATION_ID",
  "ACADEMY_EMAIL_DELIVERY_ENABLED", "NOTIFICATION_DISPATCH_SECRET", "NOTIFICATION_SIGNING_SECRET",
  "MAILGUN_API_KEY", "MAILGUN_DOMAIN", "MAILGUN_FROM_EMAIL", "MAILGUN_FROM_NAME", "MAILGUN_REGION",
  "ACADEMY_EMAIL_PROVIDER", "GHL_EMAIL_FROM",
] as const;

type RuntimeClient = {
  rpc(name: string, args: { p_names: string[] }): PromiseLike<{ data: unknown; error: unknown }>;
};

export async function loadRuntimeConfig(
  admin: RuntimeClient,
  names: readonly string[],
  env: (name: string) => string | undefined,
): Promise<Record<string, string | undefined>> {
  const allowed = new Set<string>(SERVER_RUNTIME_CONFIG_NAMES);
  const requested = [...new Set(names)].filter(name => allowed.has(name));
  const result: Record<string, string | undefined> = Object.create(null);
  for (const name of requested) {
    const value = env(name);
    // Validation belongs to the consumer. Never normalize malformed credentials
    // or identifiers into values that could pass strict configuration checks.
    result[name] = value?.trim() ? value : undefined;
  }
  const missing = requested.filter(name => result[name] === undefined);
  if (!missing.length) return result;
  try {
    const { data, error } = await admin.rpc("get_server_runtime_config", { p_names: missing });
    if (error || !data || typeof data !== "object" || Array.isArray(data)) return result;
    for (const name of missing) {
      const value = (data as Record<string, unknown>)[name];
      if (typeof value === "string" && value.trim()) result[name] = value;
    }
  } catch {
    // Missing or inaccessible Vault configuration fails closed, without logging secrets.
  }
  return result;
}
