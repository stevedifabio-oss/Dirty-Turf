export type GeoPoint = {
  lat: number;
  lng: number;
};

export type WaybackRelease = {
  date: string;
  template: string;
};

export const ESRI_CURRENT_TILES =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

export const OPEN_STREET_MAP_TILES =
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

export const NAIP_SERVICE =
  "https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer";

export const WAYBACK_CAPABILITIES =
  "https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/WMTS/1.0.0/WMTSCapabilities.xml";

const SQUARE_FEET_PER_SQUARE_METER = 10.7639104167;

export function sphericalAreaSquareFeet(points: GeoPoint[]) {
  if (points.length < 3) return 0;

  const earthRadiusMeters = 6_378_137;
  let sum = 0;

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const currentLongitude = current.lng * Math.PI / 180;
    const nextLongitude = next.lng * Math.PI / 180;
    const currentLatitude = current.lat * Math.PI / 180;
    const nextLatitude = next.lat * Math.PI / 180;

    sum += (nextLongitude - currentLongitude)
      * (2 + Math.sin(currentLatitude) + Math.sin(nextLatitude));
  }

  const squareMeters = Math.abs(sum) * earthRadiusMeters * earthRadiusMeters / 2;
  return squareMeters * SQUARE_FEET_PER_SQUARE_METER;
}

export function parseWaybackCapabilities(xmlText: string) {
  const documentNode = new DOMParser().parseFromString(xmlText, "application/xml");
  if (documentNode.querySelector("parsererror")) throw new Error("The imagery archive response was invalid.");

  const releases: WaybackRelease[] = [];
  const layers = Array.from(documentNode.getElementsByTagNameNS("*", "Layer"));

  for (const layer of layers) {
    const children = Array.from(layer.children);
    const title = children.find((node) => node.localName === "Title")?.textContent ?? "";
    const resource = Array.from(layer.getElementsByTagNameNS("*", "ResourceURL"))
      .find((node) => node.getAttribute("resourceType") === "tile");
    const match = title.match(/Wayback\s+(\d{4}-\d{2}-\d{2})/i);

    if (match && resource?.getAttribute("template")) {
      releases.push({ date: match[1], template: resource.getAttribute("template")! });
    }
  }

  const seen = new Set<string>();
  return releases
    .sort((left, right) => right.date.localeCompare(left.date))
    .filter((release) => !seen.has(release.date) && Boolean(seen.add(release.date)));
}

export function toLeafletWaybackTemplate(release: WaybackRelease) {
  return release.template
    .replace("{TileMatrixSet}", "default028mm")
    .replace("{TileMatrix}", "{z}")
    .replace("{TileRow}", "{y}")
    .replace("{TileCol}", "{x}")
    .replace("{level}", "{z}")
    .replace("{row}", "{y}")
    .replace("{col}", "{x}");
}
