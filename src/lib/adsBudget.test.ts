import { describe, expect, it } from "vitest";
import { estimatedAdsLeads } from "./adsBudget";

describe("advertising budget scenarios", () => {
  it("uses the visitor's assumptions and rounds down whole inquiries", () => {
    expect(estimatedAdsLeads(1000, 25)).toBe(40);
    expect(estimatedAdsLeads(1000, 30)).toBe(33);
    expect(estimatedAdsLeads(300, 1000)).toBe(0);
  });
  it("rejects undefined costs, invalid budgets, and unsafe estimates", () => {
    for (const cost of [0, -1, NaN, Infinity, Number.MIN_VALUE]) expect(estimatedAdsLeads(1000, cost)).toBeNull();
    for (const budget of [0, 299, 5001, NaN, Infinity]) expect(estimatedAdsLeads(budget, 25)).toBeNull();
  });
});
