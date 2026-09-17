import { describe, expect, it } from "vitest";
import type { QuoteDraft } from "../domain";
import { calculateQuote } from "./quote";

const base: QuoteDraft = {
  address: "",
  mode: "manual",
  length: 38,
  width: 18,
  cameraArea: 0,
  mapArea: 0,
  serviceRate: 0.72,
  infillRate: 0.25,
};

describe("calculateQuote", () => {
  it("multiplies length by width without discarding decimal square footage", () => {
    expect(calculateQuote({ ...base, length: 10.5, width: 20.5 }).area).toBe(215.25);
  });

  it("calculates pounds and rounds both bag sizes up", () => {
    expect(calculateQuote(base)).toEqual({
      area: 684,
      infillPounds: 171,
      bags40: 5,
      bags50: 4,
      infillBags: 5,
      serviceSubtotal: 492.48,
      total: 492.48,
    });
  });

  it("uses the selected pounds-per-square-foot rate", () => {
    const quote = calculateQuote({ ...base, length: 100, width: 10, infillRate: 0.75 });
    expect(quote.infillPounds).toBe(750);
    expect(quote.bags40).toBe(19);
    expect(quote.bags50).toBe(15);
  });

  it("uses mapped area when map mode is selected", () => {
    const quote = calculateQuote({ ...base, mode: "map", mapArea: 800, infillRate: 0.5 });
    expect(quote.area).toBe(800);
    expect(quote.infillPounds).toBe(400);
    expect(quote.bags40).toBe(10);
    expect(quote.bags50).toBe(8);
  });

  it("uses a completed live camera area", () => {
    const quote = calculateQuote({ ...base, mode: "camera", cameraArea: 800 });
    expect(quote.area).toBe(800);
    expect(quote.infillPounds).toBe(200);
  });

  it("charges only by measured square footage", () => {
    expect(calculateQuote({ ...base, length: 10, width: 10, serviceRate: 0.85 }).total).toBe(85);
  });

  it("handles empty area and a zero infill rate safely", () => {
    const quote = calculateQuote({ ...base, length: 0, infillRate: 0 });
    expect(quote.area).toBe(0);
    expect(quote.infillPounds).toBe(0);
    expect(quote.bags40).toBe(0);
    expect(quote.bags50).toBe(0);
    expect(quote.total).toBe(0);
  });
});
