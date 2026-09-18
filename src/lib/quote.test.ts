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
  infillRate: 0.25,
  serviceRate: 0.72,
};

describe("calculateQuote", () => {
  it("calculates rectangular area, infill weight, both bag sizes, and service price", () => {
    expect(calculateQuote(base)).toEqual({
      area: 684,
      preciseArea: 684,
      infillPounds: 171,
      bags40: 5,
      bags50: 4,
      serviceTotal: 492.48,
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
    const quote = calculateQuote({ ...base, mode: "map", mapArea: 800 });
    expect(quote.area).toBe(800);
    expect(quote.infillPounds).toBe(200);
    expect(quote.bags40).toBe(5);
    expect(quote.bags50).toBe(4);
    expect(quote.total).toBe(576);
  });

  it("uses a completed live camera area instead of rectangular dimensions", () => {
    const quote = calculateQuote({ ...base, mode: "camera", cameraArea: 800 });
    expect(quote.area).toBe(800);
    expect(quote.infillPounds).toBe(200);
    expect(quote.bags40).toBe(5);
    expect(quote.bags50).toBe(4);
  });

  it("preserves decimal dimensions instead of rounding each side", () => {
    const quote = calculateQuote({ ...base, length: 10.5, width: 12.25 });
    expect(quote.area).toBe(128.63);
    expect(quote.infillPounds).toBe(33);
    expect(quote.serviceTotal).toBe(92.61);
  });

  it("uses the unrounded measured area for bag and price calculations", () => {
    const quote = calculateQuote({ ...base, length: 40.001, width: 4, serviceRate: 0.75 });
    expect(quote.area).toBe(160);
    expect(quote.preciseArea).toBeCloseTo(160.004);
    expect(quote.infillPounds).toBe(41);
    expect(quote.serviceTotal).toBe(120);
  });

  it("handles empty area and invalid rates safely", () => {
    const quote = calculateQuote({ ...base, length: 0, infillRate: -1, serviceRate: -1 });
    expect(quote.area).toBe(0);
    expect(quote.infillPounds).toBe(0);
    expect(quote.bags40).toBe(0);
    expect(quote.bags50).toBe(0);
    expect(quote.total).toBe(0);
  });

  it("does not turn two invalid negative dimensions into a positive area", () => {
    expect(calculateQuote({ ...base, length: -10, width: -10 }).area).toBe(0);
  });

  it("charges only by measured square footage", () => {
    expect(calculateQuote({ ...base, length: 10, width: 10, serviceRate: 0.85 }).total).toBe(85);
  });
});
