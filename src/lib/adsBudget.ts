/** Scenario math using the visitor's assumptions, never a performance forecast. */
export function estimatedAdsLeads(budget: number, assumedCostPerLead: number): number | null {
  if (!Number.isFinite(budget) || budget < 300 || budget > 5000 || !Number.isFinite(assumedCostPerLead) || assumedCostPerLead <= 0) return null;
  const estimate = Math.floor(budget / assumedCostPerLead);
  return Number.isSafeInteger(estimate) ? estimate : null;
}
