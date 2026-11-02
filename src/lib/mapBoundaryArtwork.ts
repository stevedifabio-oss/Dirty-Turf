import L from "leaflet";
import type { GeoPoint } from "./mapMeasurement";

/** Same red pennants, white poles and yellow ruler artwork as camera measurement.
 * The icon anchor is the pole's foot: zooming never shifts the measured corner.
 * Tick spacing is screen artwork, not a calibrated distance scale.
 */
export function drawMapBoundary(group: L.LayerGroup, points: GeoPoint[], tooltip?: string) {
  if (points.length >= 3) {
    const fill = L.polygon(points, { stroke: false, fillColor: "#ffff32", fillOpacity: 0.12, interactive: Boolean(tooltip) });
    if (tooltip) fill.bindTooltip(tooltip);
    fill.addTo(group);
  }
  if (points.length >= 2) {
    const line = points.length >= 3 ? [...points, points[0]] : points;
    L.polyline(line, { color: "#111811", opacity: 0.9, weight: 12, interactive: false }).addTo(group);
    L.polyline(line, { color: "#ffff32", weight: 9, interactive: false }).addTo(group);
    L.polyline(line, { color: "#111811", weight: 4, dashArray: "1 7", lineCap: "butt", interactive: false }).addTo(group);
    L.polyline(line, { color: "#111811", weight: 8, dashArray: "1 39", lineCap: "butt", interactive: false }).addTo(group);
  }
  points.forEach((point, index) => {
    const icon = L.divIcon({ className: "map-boundary-flag", iconSize: [42, 56], iconAnchor: [8, 52], html: `<svg width="42" height="56" viewBox="0 0 42 56" aria-hidden="true"><circle cx="8" cy="52" r="5" fill="#ffff32" stroke="#111811" stroke-width="2"/><path d="M8 52V4" stroke="#111811" stroke-width="6"/><path d="M8 52V4" stroke="white" stroke-width="3"/><path d="M8 4L37 14L8 25Z" fill="#e5372e" stroke="#111811" stroke-width="1.5"/><text x="18" y="17" fill="white" font-family="sans-serif" font-size="10" font-weight="bold">${index + 1}</text></svg>` });
    L.marker(point, { icon, title: `Boundary flag ${index + 1}`, alt: `Boundary flag ${index + 1}`, interactive: false, keyboard: false }).addTo(group);
  });
}
