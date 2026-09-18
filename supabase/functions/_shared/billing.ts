export type AcademyBillingStatus =
  | "pending"
  | "trialing"
  | "active"
  | "past_due"
  | "paused"
  | "cancelled"
  | "expired";

export function normalizeStripeSubscriptionStatus(
  value: unknown,
): AcademyBillingStatus {
  if (value === "trialing") return "trialing";
  if (value === "active") return "active";
  if (value === "past_due" || value === "unpaid") return "past_due";
  if (value === "paused") return "paused";
  if (value === "canceled") return "cancelled";
  if (value === "incomplete_expired") return "expired";
  return "pending";
}

export function normalizeBillingEmail(value: unknown) {
  return typeof value === "string"
    ? value.trim().toLocaleLowerCase("en-US")
    : "";
}

export function looksLikeEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value);
}

export function stringId(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" ? id : "";
  }
  return "";
}

export function unixTimestamp(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value * 1000).toISOString()
    : null;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown billing error";
}
