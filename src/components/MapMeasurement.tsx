import { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";
import {
  Check,
  History,
  Layers3,
  LocateFixed,
  RotateCcw,
  Search,
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

  const [query, setQuery] = useState(address);
  const [searching, setSearching] = useState(false);
  const [status, setStatus] = useState("Ready to trace");
  const [currentPoints, setCurrentPoints] = useState<GeoPoint[]>([]);
  const [finishedAreas, setFinishedAreas] = useState<FinishedArea[]>([]);
  const [imageryMode, setImageryMode] = useState<ImageryMode>("esri");
  const [waybackReleases, setWaybackReleases] = useState<WaybackRelease[]>([]);
  const [waybackIndex, setWaybackIndex] = useState(0);
  const [naipCaptures, setNaipCaptures] = useState<NaipCapture[]>([]);
  const [naipIndex, setNaipIndex] = useState(0);

  onAreaChangeRef.current = onAreaChange;

  useEffect(() => {
    setQuery(address);
  }, [address]);

  const replaceBaseLayer = useCallback((layer: L.Layer) => {
    const map = mapRef.current;
    if (!map) return;
    if (baseLayerRef.current) map.removeLayer(baseLayerRef.current);
    layer.addTo(map);
    if ("bringToBack" in layer && typeof layer.bringToBack === "function") layer.bringToBack();
    baseLayerRef.current = layer;
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
    const initialLayer = esriLayer();
    initialLayer.addTo(map);
    baseLayerRef.current = initialLayer;

    const handleMapClick = (event: L.LeafletMouseEvent) => {
      touchedRef.current = true;
      setCurrentPoints((points) => [...points, { lat: event.latlng.lat, lng: event.latlng.lng }]);
    };
    map.on("click", handleMapClick);

    const resizeTimer = window.setTimeout(() => map.invalidateSize(), 80);
    return () => {
      window.clearTimeout(resizeTimer);
      map.off("click", handleMapClick);
      map.remove();
      mapRef.current = null;
      baseLayerRef.current = null;
      draftLayerRef.current = null;
      finishedLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const group = draftLayerRef.current;
    if (!group) return;
    group.clearLayers();

    for (const point of currentPoints) {
      L.circleMarker(point, {
        color: "#ffffff",
        fillColor: "#78c12e",
        fillOpacity: 1,
        radius: 6,
        weight: 3,
      }).addTo(group);
    }

    if (currentPoints.length >= 2) {
      L.polygon(currentPoints, {
        color: "#78c12e",
        fillColor: "#047631",
        fillOpacity: 0.28,
        weight: 3,
      }).addTo(group);
    }
  }, [currentPoints]);

  useEffect(() => {
    const group = finishedLayerRef.current;
    if (!group) return;
    group.clearLayers();

    for (const [index, finishedArea] of finishedAreas.entries()) {
      L.polygon(finishedArea.points, {
        color: "#047631",
        fillColor: "#78c12e",
        fillOpacity: 0.2,
        weight: 3,
      }).bindTooltip(`Area ${index + 1}: ${formatNumber(finishedArea.squareFeet)} sq ft`).addTo(group);
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
    if (!trimmedQuery || searching) return;
    setSearching(true);
    setStatus("Searching...");

    try {
      const results = await searchPropertyAddress(trimmedQuery);
      const match = results[0];
      if (!match) {
        setStatus("Address not found");
        return;
      }

      mapRef.current?.setView([match.latitude, match.longitude], 21);
      setQuery(match.formattedAddress);
      onAddressChange(match.formattedAddress);
      setStatus("Property centered");
    } catch (error) {
      setStatus(error instanceof Error && error.message === "Sign in to search for an address."
        ? error.message
        : "Search unavailable");
    } finally {
      setSearching(false);
    }
  };

  const locateProperty = () => {
    if (!navigator.geolocation) {
      setStatus("Location unavailable");
      return;
    }

    setStatus("Locating...");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        mapRef.current?.setView([coords.latitude, coords.longitude], 21);
        setStatus("Location centered");
      },
      () => setStatus("Location permission unavailable"),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 10_000 },
    );
  };

  const loadWayback = async (force = false) => {
    if (!force && waybackReleases.length) return waybackReleases;
    setStatus("Loading imagery history...");
    const response = await fetch(WAYBACK_CAPABILITIES, { cache: "no-store" });
    if (!response.ok) throw new Error("Imagery history unavailable.");
    const releases = parseWaybackCapabilities(await response.text());
    setWaybackReleases(releases);
    return releases;
  };

  const showWayback = async (index = waybackIndex, force = false) => {
    try {
      const releases = await loadWayback(force);
      const release = releases[index];
      if (!release) throw new Error("Imagery history unavailable.");
      setWaybackIndex(index);
      setImageryMode("wayback");
      replaceBaseLayer(L.tileLayer(toLeafletWaybackTemplate(release), {
        attribution: "Historical imagery (c) Esri",
        maxNativeZoom: 19,
        maxZoom: 22,
      }));
      setStatus(`Wayback ${release.date}`);
    } catch {
      setStatus("Imagery history unavailable");
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
    <div className="map-search-row">
      <label>
        <span className="sr-only">Property address</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && searchAddress()}
          placeholder="Search property address"
        />
      </label>
      <button type="button" onClick={searchAddress} aria-label="Search address" disabled={searching}><Search size={17} /></button>
      <button type="button" onClick={locateProperty} aria-label="Use current location"><LocateFixed size={17} /></button>
    </div>
    <small className="map-geocode-attribution">Address search © OpenStreetMap contributors</small>

    <div className="map-source-row">
      <label>
        <Layers3 size={15} />
        <span className="sr-only">Imagery source</span>
        <select value={imageryMode} onChange={(event) => changeImagery(event.target.value as ImageryMode)}>
          <option value="esri">Current imagery</option>
          <option value="naip">USGS NAIP</option>
          <option value="wayback">Historical imagery</option>
          <option value="street">Street map</option>
        </select>
      </label>
      <span>{status}</span>
    </div>

    {imageryMode === "wayback" && <div className="imagery-date-row">
      <History size={15} />
      <select
        aria-label="Historical imagery release"
        value={waybackIndex}
        onChange={(event) => showWayback(Number(event.target.value))}
      >
        {waybackReleases.length
          ? waybackReleases.map((release, index) => <option value={index} key={release.date}>{release.date}</option>)
          : <option value={0}>Loading releases...</option>}
      </select>
      <button type="button" onClick={() => showWayback(0, true)} aria-label="Refresh imagery history"><RotateCcw size={15} /></button>
    </div>}

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
      <div className="map-point-count">{currentPoints.length} points{liveArea > 0 ? ` · ${formatNumber(liveArea)} sq ft` : ""}</div>
    </div>

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
