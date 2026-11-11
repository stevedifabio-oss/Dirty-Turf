import type { VerifiedStoreMembership } from "./store-membership-handler.ts";
type FulfillmentClient = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ error: unknown }> };
export async function applyVerifiedMembership(admin: FulfillmentClient, value: VerifiedStoreMembership) {
  const { error } = await admin.rpc("apply_academy_store_entitlement", {
    p_provider: value.provider, p_source_key: value.sourceKey, p_user_id: value.userId, p_product_id: value.productId,
    p_status: value.status, p_current_period_end: value.currentPeriodEnd, p_auto_renew: value.autoRenew,
    p_environment: value.environment, p_verified_at: value.verifiedAt,
  });
  if (error) throw new Error("Store entitlement could not be applied");
}
