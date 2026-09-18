import { describe, expect, it } from "vitest";
import { propertyGeocodeResults } from "./mapGeocode";

describe("property geocoding", () => {
  it("keeps only complete coordinates returned by the member geocoder", () => {
    expect(propertyGeocodeResults({ results: [
      { formattedAddress: " 123 Main St, Phoenix, AZ ", latitude: "33.45", longitude: -112.07 },
      { formattedAddress: "Missing latitude", longitude: -112.07 },
      { formattedAddress: "Out of range", latitude: 91, longitude: 0 },
    ] })).toEqual([{ formattedAddress: "123 Main St, Phoenix, AZ", latitude: 33.45, longitude: -112.07 }]);
  });

  it("returns an empty list for malformed service responses", () => {
    expect(propertyGeocodeResults(null)).toEqual([]);
    expect(propertyGeocodeResults({ results: "not-an-array" })).toEqual([]);
  });
});
