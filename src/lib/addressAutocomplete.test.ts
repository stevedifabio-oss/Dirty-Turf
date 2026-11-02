import { afterEach, describe, expect, it, vi } from "vitest";
import { parseAddressSuggestions, suggestPropertyAddresses } from "./addressAutocomplete";

const house = { geometry: { type: "Point", coordinates: [-112.1, 33.5] }, properties: { type: "house", countrycode: "US", housenumber: "123", street: "Fixture Lane", city: "Test City", state: "Arizona", postcode: "85000" } };
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("address autocomplete provider", () => {
  it("formats usable U.S. addresses, rejects bad coordinates and removes duplicates", () => {
    expect(parseAddressSuggestions({ features: [house, house, { ...house, properties: { ...house.properties, countrycode: "FR" } }, { ...house, geometry: { type: "Point", coordinates: [null, null] } }] })).toEqual([{ formattedAddress: "123 Fixture Lane, Test City, Arizona 85000", longitude: -112.1, latitude: 33.5, approximate: false }]);
    expect(parseAddressSuggestions(null)).toEqual([]);
  });
  it("does not send short or number-only input and never uses Nominatim for autocomplete", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ features: [house] })); vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    await suggestPropertyAddresses("123", signal); await suggestPropertyAddresses("12345", signal);
    expect(fetch).not.toHaveBeenCalled();
    await suggestPropertyAddresses("123 Fixture", signal);
    const url = fetch.mock.calls[0][0] as URL;
    expect(url.hostname).toBe("photon.komoot.io");
    expect(url.searchParams.get("countrycode")).toBe("US");
    expect(fetch.mock.calls[0][1]).toMatchObject({ signal, credentials: "omit" });
  });
  it("rejects service errors and unsafe endpoint configuration", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("busy", { status: 429 })));
    await expect(suggestPropertyAddresses("123 Fixture", new AbortController().signal)).rejects.toThrow("unavailable");
    vi.stubEnv("VITE_ADDRESS_AUTOCOMPLETE_URL", "http://unsafe.example/api/");
    await expect(suggestPropertyAddresses("123 Fixture", new AbortController().signal)).rejects.toThrow("unavailable");
  });
});
