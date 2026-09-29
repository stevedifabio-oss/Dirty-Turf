/** Effective access is always returned by the server; prices never grant access. */
export type AcademyEntitlements = {
  pricingGatesEnabled: boolean;
  communityAccess: boolean;
  courseIds: string[];
  features: string[];
};
export type WorkspaceAccessState =
  | { status: "preview" }
  | { status: "signed_out" }
  | ({ status: "member"; canManage: boolean } & AcademyEntitlements)
  | { status: "no_access"; hasMemberIdentity?: boolean };
export type AccessState = WorkspaceAccessState | { status: "loading" | "error" };

export function parseAcademyAccess(value: unknown): WorkspaceAccessState {
  if (!value || typeof value !== "object" || typeof (value as Record<string, unknown>).hasAccess !== "boolean") throw new Error("Access could not be verified.");
  const raw = value as Record<string, unknown>;
  if (!raw.hasAccess) return { status: "no_access", hasMemberIdentity: typeof raw.memberId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw.memberId) };
  if (typeof raw.pricingGatesEnabled !== "boolean") throw new Error("Access could not be verified.");
  const gates = raw.pricingGatesEnabled;
  const strings = (input: unknown): input is string[] => Array.isArray(input) && input.every((item) => typeof item === "string" && item.length > 0);
  if (typeof raw.communityAccess !== "boolean" || !strings(raw.courseIds) || !strings(raw.features)) throw new Error("Access could not be verified.");
  return { status: "member", canManage: raw.canManage === true, pricingGatesEnabled: gates,
    communityAccess: gates ? raw.communityAccess === true : true,
    courseIds: strings(raw.courseIds) ? raw.courseIds : [], features: strings(raw.features) ? raw.features : [] };
}

export function communityAvailable(access: AccessState) {
  return access.status === "preview" || (access.status === "member" && (access.canManage || !access.pricingGatesEnabled || access.communityAccess));
}
export function featureAvailable(access: AccessState, feature: string) {
  return access.status === "preview" || (access.status === "member" && (access.canManage || !access.pricingGatesEnabled || access.features.includes(feature)));
}
export function courseAvailable(access: AccessState, courseId?: string) {
  return access.status === "preview" || (access.status === "member" && (access.canManage || !access.pricingGatesEnabled || Boolean(courseId && access.courseIds.includes(courseId))));
}
