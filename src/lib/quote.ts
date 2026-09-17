import type { QuoteDraft, QuoteTotals } from "../domain";

const PLAN_SURCHARGE = {
  quick: 0,
  premium: 75,
  annihilator: 140,
} as const;

export function calculateQuote(draft: QuoteDraft): QuoteTotals {
  const rawArea = draft.mode === "map"
    ? draft.mapArea
    : draft.mode === "camera" && draft.cameraArea > 0
      ? draft.cameraArea
      : draft.length * draft.width;
  const area = Math.max(0, Math.round(rawArea));
  const infillBags = area > 0 ? Math.ceil(area / Math.max(1, draft.bagCoverage)) : 0;
  const serviceSubtotal = Math.round(Math.max(draft.minimum, area * draft.serviceRate));
  const materials = Math.round(infillBags * Math.max(0, draft.bagPrice));
  const planCost = PLAN_SURCHARGE[draft.plan];

  return {
    area,
    infillBags,
    serviceSubtotal,
    materials,
    planCost,
    total: serviceSubtotal + materials + planCost,
  };
}
