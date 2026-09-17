import { describe, expect, it } from "vitest";
import type { QuoteDraft } from "../domain";
import { calculateQuote } from "./quote";

const base: QuoteDraft = {
  propertyName: "Test yard",
  address: "",
  mode: "camera",
  length: 38,
  width: 18,
  cameraArea: 0,
  mapArea: 0,
  serviceRate: 0.72,
  minimum: 195,
  bagCoverage: 70,
  bagPrice: 12,
  plan: "premium",
};

describe("calculateQuote", () => {
  it("calculates area, bags, and the premium total", () => {
    expect(calculateQuote(base)).toEqual({
      area: 684,
      infillBags: 10,
      serviceSubtotal: 492,
      materials: 120,
      planCost: 75,
      total: 687,
    });
  });

  it("uses mapped area when map mode is selected", () => {
    const quote = calculateQuote({ ...base, mode: "map", mapArea: 800, bagPrice: 15 });
    expect(quote.area).toBe(800);
    expect(quote.infillBags).toBe(12);
    expect(quote.total).toBe(831);
  });

  it("uses a completed live camera area instead of rectangular dimensions", () => {
    const quote = calculateQuote({ ...base, mode: "camera", cameraArea: 800, bagPrice: 15 });
    expect(quote.area).toBe(800);
    expect(quote.infillBags).toBe(12);
    expect(quote.total).toBe(831);
  });

  it("enforces the service minimum", () => {
    const quote = calculateQuote({ ...base, length: 10, width: 10, plan: "quick" });
    expect(quote.serviceSubtotal).toBe(195);
  });

  it("handles empty area and invalid bag coverage safely", () => {
    const quote = calculateQuote({ ...base, length: 0, bagCoverage: 0 });
    expect(quote.area).toBe(0);
    expect(quote.infillBags).toBe(0);
    expect(quote.total).toBe(270);
  });
});
