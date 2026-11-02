import { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  History,
  MapPin,
  Layers3,
  RotateCcw,
  Trash2,
  Undo2,
} from "lucide-react";
import "leaflet/dist/leaflet.css";
import {
  ESRI_CURRENT_TILES,
  NAIP_SERVICE,
  OPEN_STREET_MAP_TILES,
  WAYBACK_CAPABILITIES,
  combinedSphericalAreaSquareFeet,
  parseWaybackCapabilities,
  sphericalAreaSquareFeet,
  toLeafletWaybackTemplate,
  type GeoPoint,
  type WaybackRelease,
} from "../lib/mapMeasurement";
import { searchPropertyAddress } from "../lib/backend";
import type { PropertyGeocodeResult } from "../lib/mapGeocode";
import { drawMapBoundary } from "../lib/mapBoundaryArtwork";
import { PropertyAddressSearch } from "./PropertyAddressSearch";

type MapMeasurementProps = {
  address: string;
  area: number;
  onAddressChange: (address: string) => void;
  onAreaChange: (area: number) => void;
};

type FinishedArea = {
  id: number;
  points: GeoPoint[];
  squareFeet: number;
};

type ImageryMode = "esri" | "naip" | "wayback" | "street";

type NaipCapture = {
  OBJECTID: number;
  Year?: number;
  acquisition_date?: number;
  resolution_value?: number;
  resolution_units?: string;
};

const DEFAULT_CENTER: L.LatLngExpression = [33.4484, -112.074];

export function MapMeasurement({ address, area, onAddressChange, onAreaChange }: MapMeasurementProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseLayerRef = useRef<L.Layer | null>(null);
  const draftLayerRef = useRef<L.LayerGroup | null>(null);
  const finishedLayerRef = useRef<L.LayerGroup | null>(null);
  const onAreaChangeRef = useRef(onAreaChange);
  const touchedRef = useRef(false);
  const imageryRequestRef = useRef(0);
  const searchRequestRef = useRef(0);
  const locationLayerRef = useRef<L.LayerGroup | null>(null);
  const hasBoundaryRef = useRef(false);

  const [query, setQuery] = useState(address);
  const [searching, setSearching] = useState(false);
  const [matches, setMatches] = useState<PropertyGeocodeResult[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<PropertyGeocodeResult | null>(null);
  const [pendingLocation, setPendingLocation] = useState<PropertyGeocodeResult | null>(null);
  const [searchError, setSearchError] = useState("");
  const [imageryError, setImageryError] = useState(false);
  const [status, setStatus] = useState("Ready to trace");
  const [currentPoints, setCurrentPoints] = useState<GeoPoint[]>([]);
  const [finishedAreas, setFinishedAreas] = useState<FinishedArea[]>([]);
  const [imageryMode, setImageryMode] = useState<ImageryMode>("esri");
  const [waybackReleases, setWaybackReleases] = useState<WaybackRelease[]>([]);
  const [waybackIndex, setWaybackIndex] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [naipCaptures, setNaipCaptures] = useState<NaipCapture[]>([]);
  const [naipIndex, setNaipIndex] = useState(0);
  hasBoundaryRef.current = currentPoints.length > 0 || finishedAreas.length > 0;

  onAreaChangeRef.current = onAreaChange;

  useEffect(() => {
    searchRequestRef.current += 1;
    setSearching(false);
    setMatches([]);
    setQuery(address);
  }, [address]);

  const replaceBaseLayer = useCallback((layer: L.Layer) => {
    const map = mapRef.current;
    if (!map) return;
    if (baseLayerRef.current) map.removeLayer(baseLayerRef.current);
    layer.addTo(map);
    if ("bringToBack" in layer && typeof layer.bringToBack === "function") layer.bringToBack();
    baseLayerRef.current = layer;
    setImageryError(false);
    layer.on("tileerror", () => { if (baseLayerRef.current === layer) setImageryError(true); });
  }, []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      bounceAtZoomLimits: false,
      doubleClickZoom: true,
      maxZoom: 24,
      scrollWheelZoom: true,
      touchZoom: true,
      zoomControl: true,
    }).setView(DEFAULT_CENTER, 19);

    mapRef.current = map;
    draftLayerRef.current = L.layerGroup().addTo(map);
    finishedLayerRef.current = L.layerGroup().addTo(map);
    locationLayerRef.current = L.layerGroup().addTo(map);
    const initialLayer = esriLayer();
    initialLayer.addTo(map);
    baseLayerRef.current = initialLayer;
    initialLayer.on("tileerror", () => { if (baseLayerRef.current === initialLayer) setImageryError(true); });

    const handleMapClick = (event: L.LeafletMouseEvent) => {
      touchedRef.current = true;
      setCurrentPoints((points) => [...points, { lat: event.latlng.lat, lng: event.latlng.lng }]);
    };
    map.on("click", handleMapClick);

    const resizeTimer = window.setTimeout(() => map.invalidateSize(), 80);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => map.invalidateSize());
    observer?.observe(containerRef.current);
    return () => {
      imageryRequestRef.current += 1;
      searchRequestRef.current += 1;
      observer?.disconnect();
      window.clearTimeout(resizeTimer);
      map.off("click", handleMapClick);
      map.remove();
      mapRef.current = null;
      baseLayerRef.current = null;
      draftLayerRef.current = null;
      finishedLayerRef.current = null;
      locationLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const group = draftLayerRef.current;
    if (!group) return;
    group.clearLayers();

    drawMapBoundary(group, currentPoints);
  }, [currentPoints]);

  useEffect(() => {
    const group = finishedLayerRef.current;
    if (!group) return;
    group.clearLayers();

    for (const [index, finishedArea] of finishedAreas.entries()) {
      drawMapBoundary(group, finishedArea.points, `Area ${index + 1}: ${formatNumber(finishedArea.squareFeet)} sq ft`);
    }
  }, [finishedAreas]);

  useEffect(() => {
    if (!touchedRef.current) return;
    const finishedTotal = combinedSphericalAreaSquareFeet(finishedAreas.map((item) => item.points));
    const liveArea = sphericalAreaSquareFeet(currentPoints);
    onAreaChangeRef.current(finishedTotal + liveArea);
  }, [currentPoints, finishedAreas]);

  const searchAddress = async () => {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length < 3 || trimmedQuery.length > 180) { setSearchError("Enter a street number, street, city and state (3–180 characters)."); return; }
    const request = ++searchRequestRef.current;
    setSearching(true);
    setSearchError("");
    setMatches([]);
    setPendingLocation(null);
    setStatus("Searching...");

    try {
      const results = await searchPropertyAddress(trimmedQuery);
      if (request !== searchRequestRef.current) return;
      const match = results[0];
      if (!match) {
        setStatus("Address not found");
        setSearchError("No matching address was found. Include the street number, city, state and ZIP code, or use your current location.");
        return;
      }
      if (results.length === 1) chooseLocation(match);
      else { setMatches(results); setStatus("Choose the matching property below"); }
    } catch (error) {
      if (request !== searchRequestRef.current) return;
      setStatus("Address search failed");
      setSearchError(error instanceof Error ? error.message : "Address search is unavailable. Please try again.");
    } finally {
      if (request === searchRequestRef.current) setSearching(false);
    }
  };

  const showLocation = (match: PropertyGeocodeResult) => {
    const map = mapRef.current;
    if (!map) return;
    map.invalidateSize();
    map.setView([match.latitude, match.longitude], 20);
    locationLayerRef.current?.clearLayers();
    if (locationLayerRef.current) L.circleMarker([match.latitude, match.longitude], { color: "#fff", fillColor: "#157ee8", fillOpacity: 1, radius: 8, weight: 3, interactive: false }).addTo(locationLayerRef.current);
    setSelectedLocation(match);
    setMatches([]);
    setPendingLocation(null);
    setQuery(match.formattedAddress);
    onAddressChange(match.formattedAddress);
    setStatus("Address located · verify the yard before tracing");
  };
  const chooseLocation = (match: PropertyGeocodeResult) => {
    if (hasBoundaryRef.current) { setPendingLocation(match); setMatches([]); setStatus("Confirm changing property below"); }
    else showLocation(match);
  };

  const locateProperty = () => {
    const request = ++searchRequestRef.current;
    setSearching(false); setMatches([]); setSearchError(""); setPendingLocation(null);
    if (!navigator.geolocation) {
      setStatus("Location unavailable");
      return;
    }

    setStatus("Locating...");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (request !== searchRequestRef.current) return;
        chooseLocation({ latitude: coords.latitude, longitude: coords.longitude, formattedAddress: `Current location (${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)})`, approximate: true });
      },
      () => { if (request === searchRequestRef.current) setSearchError("Location permission is unavailable. Search for the full property address instead."); },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 10_000 },
    );
  };

  const loadWayback = async (force = false) => {
    if (!force && waybackReleases.length) return waybackReleases;
    setStatus("Loading imagery history...");
    const response = await fetch(WAYBACK_CAPABILITIES, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error("Imagery history unavailable.");
    const releases = parseWaybackCapabilities(await response.text());
    if (!releases.length) throw new Error("No imagery archive dates were returned.");
    setWaybackReleases(releases);
    return releases;
  };

  const showWayback = async (index = waybackIndex, force = false) => {
    const request = ++imageryRequestRef.current;
    setHistoryLoading(true);
    setHistoryError(false);
    try {
      const releases = await loadWayback(force);
      if (request !== imageryRequestRef.current) return;
      const release = releases[index];
      if (!release) throw new Error("Imagery history unavailable.");
      setWaybackIndex(index);
      setImageryMode("wayback");
      replaceBaseLayer(L.tileLayer(toLeafletWaybackTemplate(release), {
        attribution: "Historical imagery (c) Esri",
        maxNativeZoom: 19,
        maxZoom: 22,
      }));
      setStatus(`Esri archive: ${release.date}`);
    } catch {
      if (request !== imageryRequestRef.current) return;
      setHistoryError(true);
      setStatus("Imagery history unavailable");
    } finally {
      if (request === imageryRequestRef.current) setHistoryLoading(false);
    }
  };

  const findNaipCaptures = async () => {
    const map = mapRef.current;
    if (!map) return [];
    const center = map.getCenter();
    const params = new URLSearchParams({
      f: "json",
      geometry: `${center.lng},${center.lat}`,
      geometryType: "esriGeometryPoint",
      inSR: "4326",
      orderByFields: "Year DESC, acquisition_date DESC",
      outFields: "OBJECTID,Year,acquisition_date,resolution_value,resolution_units",
      resultRecordCount: "50",
      returnGeometry: "false",
      spatialRel: "esriSpatialRelIntersects",
      where: "1=1",
    });

    setStatus("Checking NAIP captures...");
    const response = await fetch(`${NAIP_SERVICE}/query?${params.toString()}`, { cache: "no-store" });
    if (!response.ok) throw new Error("NAIP imagery unavailable.");
    const result = await response.json() as {
      error?: { message?: string };
      features?: Array<{ attributes: NaipCapture }>;
    };
    if (result.error) throw new Error(result.error.message || "NAIP imagery unavailable.");
    const captures = (result.features ?? []).map((feature) => feature.attributes).filter(Boolean);
    setNaipCaptures(captures);
    setNaipIndex(0);
    setStatus(captures.length ? `${captures.length} NAIP captures found` : "No NAIP captures found");
    return captures;
  };

  const showNaip = async (capture?: NaipCapture) => {
    const map = mapRef.current;
    if (!map) return;
    setImageryMode("naip");
    replaceBaseLayer(createNaipLayer(map, capture?.OBJECTID));
    setStatus(capture ? `NAIP ${captureLabel(capture)}` : "Latest NAIP imagery");
    if (!naipCaptures.length) {
      findNaipCaptures().catch(() => setStatus("NAIP dates unavailable"));
    }
  };

  const changeImagery = (mode: ImageryMode) => {
    imageryRequestRef.current += 1;
    setHistoryLoading(false);
    setImageryMode(mode);
    if (mode === "esri") {
      replaceBaseLayer(esriLayer());
      setStatus("Current Esri imagery");
    } else if (mode === "street") {
      replaceBaseLayer(L.tileLayer(OPEN_STREET_MAP_TILES, {
        attribution: "(c) OpenStreetMap contributors",
        maxNativeZoom: 19,
        maxZoom: 24,
      }));
      setStatus("Street map");
    } else if (mode === "naip") {
      showNaip().catch(() => setStatus("NAIP imagery unavailable"));
    } else {
      showWayback().catch(() => setStatus("Imagery history unavailable"));
    }
  };

  const finishArea = () => {
    if (currentPoints.length < 3) {
      setStatus("Add at least 3 boundary points");
      return;
    }
    const squareFeet = sphericalAreaSquareFeet(currentPoints);
    setFinishedAreas((items) => [...items, { id: Date.now(), points: currentPoints, squareFeet }]);
    setCurrentPoints([]);
    setStatus(`Area saved: ${formatNumber(squareFeet)} sq ft`);
  };

  const clearBoundary = () => {
    touchedRef.current = true;
    setCurrentPoints([]);
    setFinishedAreas([]);
    onAreaChangeRef.current(0);
    setStatus("Boundary cleared");
  };

  const liveArea = Math.round(sphericalAreaSquareFeet(currentPoints));

  return <section className="property-map-measure">
    <PropertyAddressSearch value={query} searching={searching}
      onChange={value => { searchRequestRef.current += 1; setSearching(false); setMatches([]); setSearchError(""); setPendingLocation(null); setQuery(value); }}
      onSelect={match => { searchRequestRef.current += 1; setSearching(false); setSearchError(""); chooseLocation(match); }}
      onSearch={() => void searchAddress()} onLocate={locateProperty} />
    <small className="map-geocode-attribution">Address search: U.S. Census Bureau / © OpenStreetMap contributors. Address pins can be approximate; confirm the turf in the image.</small>
    {searchError && <p className="map-search-error" role="alert">{searchError}</p>}
    {matches.length > 0 && <section className="map-address-matches" aria-label="Matching addresses"><strong>Choose your property</strong>{matches.map(match => <button type="button" key={`${match.latitude}:${match.longitude}:${match.formattedAddress}`} onClick={() => chooseLocation(match)}><MapPin size={17} /><span>{match.formattedAddress}</span></button>)}</section>}
    {pendingLocation && <section className="map-location-confirm" aria-label="Change property"><p>Start measuring <strong>{pendingLocation.formattedAddress}</strong>? This clears the areas currently traced on this map.</p><button type="button" onClick={() => { clearBoundary(); showLocation(pendingLocation); }}>Clear areas and show property</button><button type="button" onClick={() => { setPendingLocation(null); setStatus("Current measurement kept"); }}>Keep current measurement</button></section>}
    {selectedLocation && <p className="map-selected-address"><MapPin size={15} />{selectedLocation.formattedAddress}</p>}

    <div className="map-source-row">
      <label>
        <Layers3 size={15} />
        <span className="sr-only">Imagery source</span>
        <select value={imageryMode} onChange={(event) => changeImagery(event.target.value as ImageryMode)}>
          <option value="esri">Current imagery</option>
          <option value="naip">USGS NAIP</option>
          <option value="wayback">Historical imagery · choose a date</option>
          <option value="street">Street map</option>
        </select>
      </label>
      <span role="status" aria-live="polite">{status}</span>
    </div>

    <button type="button" className="map-history-button" aria-expanded={imageryMode === "wayback"} onClick={() => changeImagery(imageryMode === "wayback" ? "esri" : "wayback")}><History size={17} /> {imageryMode === "wayback" ? "Back to current imagery" : "Historical imagery & latest archive"}</button>
    {imageryMode === "wayback" && <section className="map-history-panel" aria-label="Historical imagery dates" aria-busy={historyLoading}>
    <div className="map-history-heading"><strong>Choose an imagery date</strong><button type="button" disabled={historyLoading} onClick={() => showWayback(0, true)}>Latest available</button></div>
    {historyLoading && <p role="status">Loading imagery dates…</p>}
    {historyError && <p role="alert">The imagery archive could not load. Select Latest available to retry, or choose another imagery source.</p>}
    {waybackReleases.length > 0 && <><div className="imagery-date-row">
      <History size={15} />
      <select
        aria-label="Historical imagery release"
        disabled={historyLoading}
        value={waybackIndex}
        onChange={(event) => showWayback(Number(event.target.value))}
      >
        {waybackReleases.length
          ? waybackReleases.map((release, index) => <option value={index} key={release.date}>{release.date}</option>)
          : <option value={0}>Loading releases...</option>}
      </select>
      <button type="button" disabled={historyLoading} onClick={() => showWayback(0, true)} aria-label="Refresh imagery history"><RotateCcw size={15} /></button>
    </div>
    <div className="map-history-timeline"><button type="button" aria-label="Older imagery" disabled={historyLoading || waybackIndex >= waybackReleases.length - 1} onClick={() => showWayback(waybackIndex + 1)}><ChevronLeft size={19} /></button><input type="range" min={0} max={waybackReleases.length - 1} value={waybackReleases.length - 1 - waybackIndex} disabled={historyLoading} aria-label="Imagery date timeline" aria-valuetext={waybackReleases[waybackIndex]?.date} onChange={event => showWayback(waybackReleases.length - 1 - Number(event.target.value))} /><button type="button" aria-label="Newer imagery" disabled={historyLoading || waybackIndex === 0} onClick={() => showWayback(waybackIndex - 1)}><ChevronRight size={19} /></button></div>
    <div className="map-history-endpoints"><span>Older · {waybackReleases.at(-1)?.date}</span><span>Newest · {waybackReleases[0]?.date}</span></div></>}
    <p className="map-history-help">Move right for newer archive releases. Esri images and dates can differ from Google Earth. A release date is when imagery was published, not necessarily when the photo was taken; nearby dates may show the same photo.</p>
    </section>}

    {imageryMode === "naip" && naipCaptures.length > 0 && <div className="imagery-date-row">
      <History size={15} />
      <select
        aria-label="NAIP capture"
        value={naipIndex}
        onChange={(event) => {
          const nextIndex = Number(event.target.value);
          setNaipIndex(nextIndex);
          showNaip(naipCaptures[nextIndex]);
        }}
      >
        {naipCaptures.map((capture, index) => <option value={index} key={capture.OBJECTID}>{captureLabel(capture)}</option>)}
      </select>
      <button type="button" onClick={() => findNaipCaptures().then((captures) => captures[0] && showNaip(captures[0])).catch(() => setStatus("NAIP dates unavailable"))} aria-label="Refresh NAIP captures"><RotateCcw size={15} /></button>
    </div>}

    <div className="leaflet-measure-wrap">
      <div ref={containerRef} className="leaflet-measure-map" aria-label="Interactive property measurement map" />
      <div className="map-live-metric">
        <strong>{formatNumber(area)}</strong>
        <span>sq ft</span>
      </div>
      <div className="map-point-count">{currentPoints.length} flags{liveArea > 0 ? ` · ${formatNumber(liveArea)} sq ft` : ""}</div>
    </div>
    {imageryError && <p className="map-search-error" role="alert">Some map images could not load. Try Current imagery, another archive date, or Street map.</p>}
    <small className="map-geocode-attribution">Tap each turf corner to place a red flag. The foot of each flag marks the corner; yellow ruler lines connect the flags. Ruler ticks are decorative.</small>

    <div className="map-command-row">
      <button type="button" onClick={() => setCurrentPoints((points) => points.slice(0, -1))} disabled={!currentPoints.length}><Undo2 size={16} /> Undo</button>
      <button type="button" className="finish" onClick={finishArea} disabled={currentPoints.length < 3}><Check size={16} /> Finish area</button>
      <button type="button" onClick={clearBoundary} disabled={!currentPoints.length && !finishedAreas.length}><Trash2 size={16} /> Clear</button>
    </div>

    {finishedAreas.length > 0 && <div className="measured-area-list">
      {finishedAreas.map((item, index) => <div key={item.id}>
        <span>Area {index + 1}</span>
        <strong>{formatNumber(item.squareFeet)} sq ft</strong>
        <button type="button" aria-label={`Delete area ${index + 1}`} onClick={() => {
          touchedRef.current = true;
          setFinishedAreas((items) => items.filter((areaItem) => areaItem.id !== item.id));
        }}><Trash2 size={14} /></button>
      </div>)}
    </div>}
  </section>;
}

function esriLayer() {
  return L.tileLayer(ESRI_CURRENT_TILES, {
    attribution: "Tiles (c) Esri",
    maxNativeZoom: 19,
    maxZoom: 24,
  });
}

function createNaipLayer(map: L.Map, objectId?: number) {
  class NaipGridLayer extends L.GridLayer {
    constructor(private readonly rasterId?: number) {
      super({ attribution: "USGS / USDA NAIP", maxZoom: 24, tileSize: 256 });
    }

    override createTile(coords: L.Coords, done: L.DoneCallback) {
      const image = document.createElement("img");
      image.alt = "";
      image.setAttribute("role", "presentation");
      image.crossOrigin = "anonymous";

      const tileSize = this.getTileSize();
      const northWestPoint = coords.scaleBy(tileSize);
      const southEastPoint = northWestPoint.add(tileSize);
      const northWest = map.unproject(northWestPoint, coords.z);
      const southEast = map.unproject(southEastPoint, coords.z);
      const crs = map.options.crs ?? L.CRS.EPSG3857;
      const projectedNorthWest = crs.project(northWest);
      const projectedSouthEast = crs.project(southEast);
      const params = new URLSearchParams({
        bbox: `${projectedNorthWest.x},${projectedSouthEast.y},${projectedSouthEast.x},${projectedNorthWest.y}`,
        bboxSR: "3857",
        f: "image",
        format: "jpgpng",
        imageSR: "3857",
        interpolation: "RSP_BilinearInterpolation",
        size: `${tileSize.x},${tileSize.y}`,
      });

      if (this.rasterId) {
        params.set("mosaicRule", JSON.stringify({
          ascending: true,
          lockRasterIds: [this.rasterId],
          mosaicMethod: "esriMosaicLockRaster",
          mosaicOperation: "MT_FIRST",
        }));
      }

      image.addEventListener("load", () => done(undefined, image));
      image.addEventListener("error", () => done(new Error("NAIP tile failed to load"), image));
      image.src = `${NAIP_SERVICE}/exportImage?${params.toString()}`;
      return image;
    }
  }

  return new NaipGridLayer(objectId);
}

function captureLabel(capture: NaipCapture) {
  const date = capture.acquisition_date
    ? new Date(capture.acquisition_date).toLocaleDateString()
    : capture.Year?.toString() ?? "Unknown date";
  const resolution = capture.resolution_value
    ? ` · ${capture.resolution_value} ${capture.resolution_units ?? ""}`.trimEnd()
    : "";
  return `${date}${resolution}`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}
