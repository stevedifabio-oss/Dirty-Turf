import type { PropertyGeocodeResult } from "./mapGeocode";

export const ADDRESS_SUGGESTION_DELAY_MS = 650;
export const ADDRESS_SUGGESTION_MIN_LENGTH = 4;

/** Photon explicitly supports search-as-you-type. Never send these requests to
 * the public Nominatim endpoint, which prohibits autocomplete.
 */
export async function suggestPropertyAddresses(query: string, signal: AbortSignal): Promise<PropertyGeocodeResult[]> {
  const clean = query.replace(/\s+/g, " ").trim();
  if (clean.length < ADDRESS_SUGGESTION_MIN_LENGTH || clean.length > 180 || !/[a-z]/i.test(clean)) return [];
  const endpoint = new URL(import.meta.env.VITE_ADDRESS_AUTOCOMPLETE_URL?.trim() || "https://photon.komoot.io/api/");
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) throw new Error("Address suggestions are unavailable.");
  endpoint.search = new URLSearchParams({ q: clean, limit: "5", lang: "en", countrycode: "US" }).toString();
  const response = await fetch(endpoint, { signal, credentials: "omit", referrerPolicy: "origin", headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("Address suggestions are unavailable.");
  return parseAddressSuggestions(await response.json());
}

export function parseAddressSuggestions(value: unknown): PropertyGeocodeResult[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { features?: unknown }).features)) return [];
  const seen = new Set<string>();
  return (value as { features: unknown[] }).features.flatMap(entry => {
    if (!entry || typeof entry !== "object") return [];
    const feature = entry as { geometry?: { type?: unknown; coordinates?: unknown }; properties?: Record<string, unknown> };
    const coordinates = feature.geometry?.coordinates;
    const properties = feature.properties;
    if (feature.geometry?.type !== "Point" || !Array.isArray(coordinates) || coordinates.length !== 2 || !properties || String(properties.countrycode).toUpperCase() !== "US") return [];
    const [longitude, latitude] = coordinates;
    if (typeof latitude !== "number" || typeof longitude !== "number" || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return [];
    const part = (key: string) => typeof properties[key] === "string" ? properties[key].trim().slice(0, 160) : "";
    const street = [part("housenumber"), part("street")].filter(Boolean).join(" ") || part("name");
    if (!street) return [];
    const formattedAddress = [street, part("city") || part("district") || part("county"), [part("state"), part("postcode")].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    const key = `${formattedAddress}:${latitude}:${longitude}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ formattedAddress, latitude, longitude, approximate: properties.type !== "house" }];
  }).slice(0, 5);
}
