import { describe, expect, it } from "vitest";
import { sphericalAreaSquareFeet, toLeafletWaybackTemplate } from "./mapMeasurement";

describe("map measurement", () => {
  it("returns zero until a boundary has at least three points", () => {
    expect(sphericalAreaSquareFeet([])).toBe(0);
    expect(sphericalAreaSquareFeet([{ lat: 33, lng: -112 }, { lat: 33.1, lng: -112 }])).toBe(0);
  });

  it("calculates a small property boundary in square feet", () => {
    const area = sphericalAreaSquareFeet([
      { lat: 33.4484, lng: -112.0740 },
      { lat: 33.4484, lng: -112.0739 },
      { lat: 33.4483, lng: -112.0739 },
      { lat: 33.4483, lng: -112.0740 },
    ]);

    expect(area).toBeGreaterThan(1_000);
    expect(area).toBeLessThan(1_200);
  });

  it("converts Esri Wayback placeholders for Leaflet", () => {
    expect(toLeafletWaybackTemplate({
      date: "2026-08-01",
      template: "https://example.test/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}",
    })).toBe("https://example.test/default028mm/{z}/{y}/{x}");
  });
});
