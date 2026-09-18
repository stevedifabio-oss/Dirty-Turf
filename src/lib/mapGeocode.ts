export type PropertyGeocodeResult = {
  formattedAddress: string;
  latitude: number;
  longitude: number;
};

export function propertyGeocodeResults(value: unknown): PropertyGeocodeResult[] {
  if (!value || typeof value !== "object") return [];
  const results = (value as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];

  return results.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const candidate = entry as Record<string, unknown>;
    const formattedAddress = typeof candidate.formattedAddress === "string"
      ? candidate.formattedAddress.trim()
      : "";
    const latitude = Number(candidate.latitude);
    const longitude = Number(candidate.longitude);
    if (!formattedAddress || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return [];
    return [{ formattedAddress, latitude, longitude }];
  });
}
