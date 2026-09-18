import type { QuoteDraft, QuoteTotals } from "../domain";

export const INFILL_RATES = [0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3] as const;

function positive(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function roundToHundredth(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateQuote(draft: QuoteDraft): QuoteTotals {
  const rawArea = draft.mode === "map"
    ? positive(draft.mapArea)
    : draft.mode === "camera" && positive(draft.cameraArea) > 0
      ? positive(draft.cameraArea)
      : positive(draft.length) * positive(draft.width);
  const preciseArea = rawArea;
  const area = roundToHundredth(preciseArea);
  const infillRate = positive(draft.infillRate);
  const serviceRate = positive(draft.serviceRate);
  const infillPounds = preciseArea > 0 ? Math.ceil(preciseArea * infillRate) : 0;
  const bags40 = infillPounds > 0 ? Math.ceil(infillPounds / 40) : 0;
  const bags50 = infillPounds > 0 ? Math.ceil(infillPounds / 50) : 0;
  const serviceTotal = roundToHundredth(preciseArea * serviceRate);

  return {
    area,
    preciseArea,
    infillPounds,
    bags40,
    bags50,
    serviceTotal,
    total: serviceTotal,
  };
}
