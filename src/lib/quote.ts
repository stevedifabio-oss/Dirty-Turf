import type { QuoteDraft, QuoteTotals } from "../domain";

function positive(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function round(value: number, places = 2) {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function calculateQuote(draft: QuoteDraft): QuoteTotals {
  const rawArea = draft.mode === "map"
    ? positive(draft.mapArea)
    : draft.mode === "camera" && positive(draft.cameraArea) > 0
      ? positive(draft.cameraArea)
      : positive(draft.length) * positive(draft.width);
  const area = round(rawArea);
  const infillPounds = area > 0 ? Math.ceil(area * positive(draft.infillRate)) : 0;
  const bags40 = infillPounds > 0 ? Math.ceil(infillPounds / 40) : 0;
  const bags50 = infillPounds > 0 ? Math.ceil(infillPounds / 50) : 0;
  const serviceSubtotal = round(area * positive(draft.serviceRate));

  return {
    area,
    infillPounds,
    bags40,
    bags50,
    infillBags: bags40,
    serviceSubtotal,
    total: serviceSubtotal,
  };
}
