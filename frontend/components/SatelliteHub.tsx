"use client";

import { Crosshair, Flame, Globe, Layers, Pause, Play, Radar, RefreshCw, Satellite, X } from "lucide-react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource } from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GIBS_GROUP_LABEL, GIBS_LAYERS, gibsTileUrl, gibsTimeFor, utcDateString, type GibsGroup,
} from "@/lib/gibs";
import {
  SAT_GROUPS, buildSatellites, footprint, groundTrack, nextPasses, positionAt,
  type SatGroupId, type SatPass, type SatPosition, type TrackedSat,
} from "@/lib/satellite";

type MapMode = "street" | "satellite" | "dark";
type Tab = "imagery" | "sky" | "tracker";
type SkyMode = "off" | "radar" | "infrared";
type Frame = { time: number; path: string; kind: "past" | "nowcast" };
type Weather = {
  temp: number; feels: number; humidity: number; precip: number; cloud: number;
  wind: number; windDir: number; code: number; time: string;
  aqi?: number; pm25?: number; pm10?: number;
};

const TOMTOM_KEY = process.env.NEXT_PUBLIC_TOMTOM_KEY || "";
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const GROUP_COLOR = Object.fromEntries(SAT_GROUPS.map((g) => [g.id, g.color])) as Record<SatGroupId, string>;

const WMO: Record<number, string> = {
  0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Rime fog",
  51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 61: "Light rain", 63: "Rain", 65: "Heavy rain",
  71: "Light snow", 73: "Snow", 75: "Heavy snow", 80: "Rain showers", 81: "Heavy showers", 82: "Violent showers",
  95: "Thunderstorm", 96: "Thunderstorm, hail", 99: "Severe thunderstorm, hail",
};

function aqiLabel(aqi: number) {
  if (aqi <= 50) return "Good";
  if (aqi <= 100) return "Moderate";
  if (aqi <= 150) return "Unhealthy for sensitive groups";
  if (aqi <= 200) return "Unhealthy";
  if (aqi <= 300) return "Very unhealthy";
  return "Hazardous";
}

const timeOf = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const stampOf = (d: Date) => d.toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function firstLabelId(map: maplibregl.Map) {
  return map.getStyle().layers.find((l) => l.type === "symbol" && l.layout?.["text-field"] && !l.id.startsWith("km-"))?.id;
}

function removeLayerAndSource(map: maplibregl.Map, id: string) {
  if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(id)) map.removeSource(id);
}

type Props = {
  mapRef: React.RefObject<maplibregl.Map | null>;
  mapReady: boolean;
  mapMode: MapMode;
  open: boolean;
  userLocation: [number, number] | null;
  homeCenter: [number, number];
  homeZoom: number;
  onSetMapMode: (mode: MapMode) => void;
  onClose: () => void;
  onOpen: () => void;
};

export default function SatelliteHub({ mapRef, mapReady, mapMode, open, userLocation, homeCenter, homeZoom, onSetMapMode, onClose, onOpen }: Props) {
  const [tab, setTab] = useState<Tab>("imagery");
  const userLocRef = useRef(userLocation);
  userLocRef.current = userLocation;
  // ~1 km granularity, so GPS jitter does not trigger refetches / pass recomputation
  const locKey = userLocation ? `${userLocation[1].toFixed(2)},${userLocation[0].toFixed(2)}` : "none";

  // ───────────── Imagery (NASA GIBS) ─────────────
  const [gibsOn, setGibsOn] = useState<Record<string, boolean>>({});
  const [gibsOpacity, setGibsOpacity] = useState<Record<string, number>>({});
  const [dateMode, setDateMode] = useState<"live" | "custom">("live");
  const [liveOffset, setLiveOffset] = useState(0);
  const [customDate, setCustomDate] = useState(() => utcDateString(-1));
  const [fallbackNote, setFallbackNote] = useState("");
  const gibsTimeRef = useRef<Record<string, string>>({});
  const tileErrors = useRef(0);
  const tileOk = useRef(0);
  const effectiveDate = dateMode === "live" ? utcDateString(liveOffset) : customDate;
  const activeGibs = GIBS_LAYERS.filter((l) => gibsOn[l.id]);

  const raiseOverlays = useCallback(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const before = firstLabelId(map);
    map.getStyle().layers
      .filter((l) => l.id.startsWith("km-gibs-") || l.id.startsWith("km-rv-") || l.id === "km-traffic")
      .forEach((l) => map.moveLayer(l.id, before));
  }, [mapRef]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    for (const layer of GIBS_LAYERS) {
      const id = `km-gibs-${layer.id}`;
      if (!gibsOn[layer.id]) {
        removeLayerAndSource(map, id);
        delete gibsTimeRef.current[layer.id];
        continue;
      }
      const time = gibsTimeFor(layer, effectiveDate, dateMode === "live");
      const opacity = gibsOpacity[layer.id] ?? layer.opacity;
      if (map.getSource(id) && gibsTimeRef.current[layer.id] === time) {
        map.setPaintProperty(id, "raster-opacity", opacity);
        continue;
      }
      removeLayerAndSource(map, id);
      map.addSource(id, {
        type: "raster",
        tiles: [gibsTileUrl(layer, time)],
        tileSize: 256,
        maxzoom: layer.maxzoom,
        attribution: "Imagery: NASA GIBS / EOSDIS",
      });
      map.addLayer({
        id, type: "raster", source: id,
        paint: { "raster-opacity": opacity, "raster-fade-duration": 250, "raster-resampling": "linear" },
      }, firstLabelId(map));
      gibsTimeRef.current[layer.id] = time;
    }
  }, [mapReady, mapRef, gibsOn, gibsOpacity, effectiveDate, dateMode]);

  // Keep overlays above the Google satellite basemap, which CityMap adds lazily.
  useEffect(() => {
    const timer = window.setTimeout(raiseOverlays, 150);
    return () => window.clearTimeout(timer);
  }, [mapMode, raiseOverlays, gibsOn, effectiveDate]);

  // If *nothing* loads for today's date, the pass has not been published yet → fall back to yesterday.
  useEffect(() => {
    tileErrors.current = 0; tileOk.current = 0;
  }, [effectiveDate, gibsOn]);
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const onError = (event: { sourceId?: string; error?: { status?: number } }) => {
      if (!event.sourceId?.startsWith("km-gibs-")) return;
      tileErrors.current += 1;
      if (dateMode === "live" && liveOffset === 0 && tileErrors.current >= 6 && tileOk.current === 0) {
        setLiveOffset(-1);
        setFallbackNote("Today's satellite passes haven't been published for this area yet — showing yesterday.");
      }
    };
    const onData = (event: { sourceId?: string; tile?: unknown }) => {
      if (event.sourceId?.startsWith("km-gibs-") && event.tile) tileOk.current += 1;
    };
    map.on("error", onError as never);
    map.on("data", onData as never);
    return () => { map.off("error", onError as never); map.off("data", onData as never); };
  }, [mapReady, mapRef, dateMode, liveOffset]);

  // ───────────── Live sky (RainViewer radar / infrared + Open-Meteo) ─────────────
  const [skyMode, setSkyMode] = useState<SkyMode>("off");
  const [frames, setFrames] = useState<{ radar: Frame[]; infrared: Frame[]; host: string }>({ radar: [], infrared: [], host: "" });
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [skyOpacity, setSkyOpacity] = useState(0.75);
  const [skyError, setSkyError] = useState("");
  const [skyLoading, setSkyLoading] = useState(false);
  const activeFrames = skyMode === "radar" ? frames.radar : skyMode === "infrared" ? frames.infrared : [];

  const loadFrames = useCallback(async () => {
    setSkyLoading(true);
    try {
      const res = await fetch("https://api.rainviewer.com/public/weather-maps.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`RainViewer returned HTTP ${res.status}`);
      const data = await res.json();
      const radar: Frame[] = [
        ...(data.radar?.past || []).map((f: { time: number; path: string }) => ({ ...f, kind: "past" as const })),
        ...(data.radar?.nowcast || []).map((f: { time: number; path: string }) => ({ ...f, kind: "nowcast" as const })),
      ];
      const infrared: Frame[] = (data.satellite?.infrared || []).map((f: { time: number; path: string }) => ({ ...f, kind: "past" as const }));
      setFrames({ radar, infrared, host: data.host || "https://tilecache.rainviewer.com" });
      setSkyError(radar.length + infrared.length === 0 ? "No live frames are available right now." : "");
      const pastCount = radar.filter((f) => f.kind === "past").length;
      setFrameIndex(Math.max(0, (skyMode === "infrared" ? infrared.length : pastCount) - 1));
    } catch (error) {
      setSkyError(error instanceof Error ? error.message : "Live cloud and radar feed is unavailable");
    } finally {
      setSkyLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (skyMode === "off") return;
    void loadFrames();
    const timer = window.setInterval(() => void loadFrames(), 5 * 60_000); // feed updates every ~10 min
    return () => window.clearInterval(timer);
  }, [skyMode, loadFrames]);

  // One raster layer per frame; the animation only flips opacity, so there is no tile flicker.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    map.getStyle().layers.filter((l) => l.id.startsWith("km-rv-")).forEach((l) => removeLayerAndSource(map, l.id));
    if (skyMode === "off" || !frames.host || activeFrames.length === 0) return;
    const before = firstLabelId(map);
    activeFrames.forEach((frame, i) => {
      const id = `km-rv-${i}`;
      const suffix = skyMode === "radar" ? "/256/{z}/{x}/{y}/2/1_1.png" : "/256/{z}/{x}/{y}/0/0_0.png";
      map.addSource(id, { type: "raster", tiles: [`${frames.host}${frame.path}${suffix}`], tileSize: 256, maxzoom: 7, attribution: "Weather: RainViewer" });
      map.addLayer({ id, type: "raster", source: id, paint: { "raster-opacity": 0, "raster-fade-duration": 0 } }, before);
    });
    return () => {
      if (!map.getStyle()) return;
      map.getStyle().layers.filter((l) => l.id.startsWith("km-rv-")).forEach((l) => removeLayerAndSource(map, l.id));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, mapRef, skyMode, frames]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    activeFrames.forEach((_, i) => {
      const id = `km-rv-${i}`;
      if (map.getLayer(id)) map.setPaintProperty(id, "raster-opacity", i === frameIndex ? skyOpacity : 0);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, mapRef, frameIndex, skyOpacity, skyMode, frames]);

  useEffect(() => {
    if (!playing || activeFrames.length < 2) return;
    const timer = window.setInterval(() => setFrameIndex((i) => (i + 1) % activeFrames.length), 650);
    return () => window.clearInterval(timer);
  }, [playing, activeFrames.length]);

  const [trafficOn, setTrafficOn] = useState(false);
  const [trafficOpacity, setTrafficOpacity] = useState(0.9);
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    if (!trafficOn || !TOMTOM_KEY) { removeLayerAndSource(map, "km-traffic"); return; }
    if (!map.getSource("km-traffic")) {
      map.addSource("km-traffic", { type: "raster", tiles: [`https://api.tomtom.com/traffic/map/4/tile/flow/relative/{z}/{x}/{y}.png?key=${TOMTOM_KEY}`], tileSize: 256, maxzoom: 20, attribution: "Traffic © TomTom" });
      map.addLayer({ id: "km-traffic", type: "raster", source: "km-traffic", paint: { "raster-opacity": trafficOpacity, "raster-fade-duration": 200 } }, firstLabelId(map));
    } else map.setPaintProperty("km-traffic", "raster-opacity", trafficOpacity);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, mapRef, trafficOn, trafficOpacity]);

  const [weather, setWeather] = useState<Weather | null>(null);
  const [weatherError, setWeatherError] = useState("");
  const [weatherPlace, setWeatherPlace] = useState("");

  const loadWeather = useCallback(async () => {
    const map = mapRef.current;
    const userLoc = userLocRef.current;
    const point: [number, number] = userLoc ?? (map ? [map.getCenter().lng, map.getCenter().lat] : homeCenter);
    setWeatherPlace(userLoc ? "your GPS location" : "map centre");
    try {
      const [wx, aq] = await Promise.all([
        fetch(`https://api.open-meteo.com/v1/forecast?latitude=${point[1]}&longitude=${point[0]}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m&timezone=auto`).then((r) => r.json()),
        fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${point[1]}&longitude=${point[0]}&current=us_aqi,pm2_5,pm10&timezone=auto`).then((r) => r.json()).catch(() => null),
      ]);
      const c = wx?.current;
      if (!c) throw new Error("Weather service returned no data");
      setWeather({
        temp: c.temperature_2m, feels: c.apparent_temperature, humidity: c.relative_humidity_2m, precip: c.precipitation,
        cloud: c.cloud_cover, wind: c.wind_speed_10m, windDir: c.wind_direction_10m, code: c.weather_code, time: c.time,
        aqi: aq?.current?.us_aqi, pm25: aq?.current?.pm2_5, pm10: aq?.current?.pm10,
      });
      setWeatherError("");
    } catch (error) {
      setWeatherError(error instanceof Error ? error.message : "Live conditions unavailable");
    }
  }, [mapRef, homeCenter]);

  useEffect(() => {
    if (!open || tab !== "sky") return;
    void loadWeather();
    const timer = window.setInterval(() => void loadWeather(), 5 * 60_000);
    return () => window.clearInterval(timer);
  }, [open, tab, loadWeather, locKey]);

  // ───────────── Satellite tracker (CelesTrak elements + SGP4 in the browser) ─────────────
  const [groupsOn, setGroupsOn] = useState<Record<SatGroupId, boolean>>({ stations: false, navic: false, weather: false, gps: false, earth: false });
  const [loadState, setLoadState] = useState<Record<SatGroupId, "idle" | "loading" | "ok" | "error">>({ stations: "idle", navic: "idle", weather: "idle", gps: "idle", earth: "idle" });
  const [satError, setSatError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [satFilter, setSatFilter] = useState("");
  const [follow, setFollow] = useState(false);
  const [livePos, setLivePos] = useState<SatPosition | null>(null);
  const [passes, setPasses] = useState<SatPass[]>([]);
  const [observerLabel, setObserverLabel] = useState("");
  const [loadedVersion, setLoadedVersion] = useState(0);
  const satsRef = useRef<Record<SatGroupId, TrackedSat[]>>({ stations: [], navic: [], weather: [], gps: [], earth: [] });
  const selectedRef = useRef<string | null>(null);
  const followRef = useRef(false);
  const trackStampRef = useRef(0);
  const issFallbackRef = useRef<{ lng: number; lat: number; altKm: number } | null>(null);
  const [issFallback, setIssFallback] = useState(false);
  const anyTracker = Object.values(groupsOn).some(Boolean);
  useEffect(() => { selectedRef.current = selectedId; trackStampRef.current = 0; }, [selectedId]);
  useEffect(() => { followRef.current = follow; }, [follow]);

  const toggleGroup = useCallback(async (group: SatGroupId) => {
    const turningOn = !groupsOn[group];
    setGroupsOn((g) => ({ ...g, [group]: turningOn }));
    if (!turningOn) {
      if (selectedRef.current?.startsWith(`${group}:`)) setSelectedId(null);
      return;
    }
    if (satsRef.current[group].length > 0) return;
    setLoadState((s) => ({ ...s, [group]: "loading" }));
    setSatError("");
    try {
      const res = await fetch(`/api/v1/satellites/tle?group=${group}`);
      const data = await res.json();
      if (!res.ok || data.status !== "OK") throw new Error(data.error || "Satellite feed unavailable");
      const built = buildSatellites(data.satellites, group);
      if (!built.length) throw new Error("No usable orbit data in this group");
      satsRef.current[group] = built;
      setLoadState((s) => ({ ...s, [group]: "ok" }));
      setLoadedVersion((v) => v + 1);
    } catch (error) {
      setLoadState((s) => ({ ...s, [group]: "error" }));
      setSatError(error instanceof Error ? error.message : "Satellite feed unavailable");
      if (group === "stations") setIssFallback(true); // keep the ISS live even if CelesTrak is unreachable
    }
  }, [groupsOn]);

  // Live ISS fallback (wheretheiss.at), polled every 5 s while the CelesTrak feed is down.
  useEffect(() => {
    if (!issFallback || !groupsOn.stations) { issFallbackRef.current = null; return; }
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch("https://api.wheretheiss.at/v1/satellites/25544");
        const d = await res.json();
        if (!cancelled && Number.isFinite(d.latitude)) issFallbackRef.current = { lng: d.longitude, lat: d.latitude, altKm: d.altitude };
      } catch { /* keep last fix */ }
    };
    void poll();
    const timer = window.setInterval(poll, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [issFallback, groupsOn.stations]);

  // Map layers for the tracker
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || map.getSource("km-sats-source")) return;
    map.addSource("km-sats-source", { type: "geojson", data: EMPTY });
    map.addSource("km-sat-footprint-source", { type: "geojson", data: EMPTY });
    map.addSource("km-sat-track-source", { type: "geojson", data: EMPTY });
    const groupColor = ["match", ["get", "group"], ...SAT_GROUPS.flatMap((g) => [g.id, g.color]), "#5f6368"] as unknown as maplibregl.ExpressionSpecification;
    map.addLayer({ id: "km-sat-footprint-fill", type: "fill", source: "km-sat-footprint-source", paint: { "fill-color": "#1a73e8", "fill-opacity": 0.1 } });
    map.addLayer({ id: "km-sat-footprint-line", type: "line", source: "km-sat-footprint-source", paint: { "line-color": "#1a73e8", "line-width": 1.5, "line-opacity": 0.7 } });
    map.addLayer({ id: "km-sat-track-line", type: "line", source: "km-sat-track-source", layout: { "line-cap": "round" }, paint: { "line-color": "#d93025", "line-width": 2, "line-dasharray": [2, 2], "line-opacity": 0.85 } });
    map.addLayer({
      id: "km-sat-points", type: "circle", source: "km-sats-source",
      paint: {
        "circle-radius": ["case", ["get", "selected"], 9, 5],
        "circle-color": groupColor,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": ["case", ["get", "selected"], 3, 1.5],
      },
    });
    map.addLayer({
      id: "km-sat-labels", type: "symbol", source: "km-sats-source",
      filter: ["==", ["get", "showLabel"], true],
      layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-offset": [0, 1.2], "text-anchor": "top", "text-optional": true },
      paint: { "text-color": "#202124", "text-halo-color": "#ffffff", "text-halo-width": 1.6 },
    });
    const onClick = (event: maplibregl.MapLayerMouseEvent) => {
      const id = event.features?.[0]?.properties?.id;
      if (typeof id === "string") setSelectedId(id);
    };
    const pointer = () => { map.getCanvas().style.cursor = "pointer"; };
    const reset = () => { map.getCanvas().style.cursor = ""; };
    map.on("click", "km-sat-points", onClick);
    map.on("mouseenter", "km-sat-points", pointer);
    map.on("mouseleave", "km-sat-points", reset);
  }, [mapReady, mapRef]);

  // 1 Hz position loop
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !anyTracker) {
      (map?.getSource("km-sats-source") as GeoJSONSource | undefined)?.setData(EMPTY);
      (map?.getSource("km-sat-footprint-source") as GeoJSONSource | undefined)?.setData(EMPTY);
      (map?.getSource("km-sat-track-source") as GeoJSONSource | undefined)?.setData(EMPTY);
      return;
    }
    const tick = () => {
      const now = new Date();
      const features: GeoJSON.Feature[] = [];
      let total = 0;
      (Object.keys(groupsOn) as SatGroupId[]).forEach((g) => { if (groupsOn[g]) total += satsRef.current[g].length; });
      let selectedPos: SatPosition | null = null;
      let selectedSat: TrackedSat | null = null;
      (Object.keys(groupsOn) as SatGroupId[]).forEach((g) => {
        if (!groupsOn[g]) return;
        for (const s of satsRef.current[g]) {
          const p = positionAt(s, now);
          if (!p) continue;
          const selected = s.id === selectedRef.current;
          if (selected) { selectedPos = p; selectedSat = s; }
          features.push({
            type: "Feature", geometry: { type: "Point", coordinates: [p.lng, p.lat] },
            properties: { id: s.id, label: s.name, group: s.group, selected, showLabel: selected || total <= 30 },
          });
        }
      });
      if (groupsOn.stations && issFallbackRef.current && satsRef.current.stations.length === 0) {
        const p = issFallbackRef.current;
        features.push({ type: "Feature", geometry: { type: "Point", coordinates: [p.lng, p.lat] }, properties: { id: "iss-fallback", label: "ISS (live)", group: "stations", selected: false, showLabel: true } });
      }
      (map.getSource("km-sats-source") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features });

      const footprintSource = map.getSource("km-sat-footprint-source") as GeoJSONSource | undefined;
      const trackSource = map.getSource("km-sat-track-source") as GeoJSONSource | undefined;
      if (selectedPos && selectedSat) {
        const pos = selectedPos as SatPosition;
        const sat = selectedSat as TrackedSat;
        setLivePos(pos);
        footprintSource?.setData({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [footprint(pos.lng, pos.lat, pos.altKm)] } });
        if (now.getTime() - trackStampRef.current > 30_000) {
          trackStampRef.current = now.getTime();
          const span = Math.max(45, Math.min(sat.periodMin || 90, 240) / 2);
          trackSource?.setData({ type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: groundTrack(sat, now, span, span, 30) } });
        }
        if (followRef.current) map.easeTo({ center: [pos.lng, pos.lat], duration: 900, easing: (t) => t });
      } else {
        setLivePos(null);
        footprintSource?.setData(EMPTY);
        trackSource?.setData(EMPTY);
      }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, mapRef, anyTracker, groupsOn, loadedVersion, issFallback]);

  const allSats = useMemo(() => {
    void loadedVersion;
    return (Object.keys(groupsOn) as SatGroupId[]).flatMap((g) => (groupsOn[g] ? satsRef.current[g] : []));
  }, [groupsOn, loadedVersion]);
  const visibleSats = useMemo(() => {
    const q = satFilter.trim().toLowerCase();
    return allSats.filter((s) => !q || s.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 80);
  }, [allSats, satFilter]);
  const selectedSat = useMemo(() => allSats.find((s) => s.id === selectedId) || null, [allSats, selectedId]);

  // Pass prediction for the selected satellite
  useEffect(() => {
    if (!selectedSat) { setPasses([]); return; }
    const map = mapRef.current;
    const userLoc = userLocRef.current;
    const observer = userLoc ? { lng: userLoc[0], lat: userLoc[1] } : map ? { lng: map.getCenter().lng, lat: map.getCenter().lat } : { lng: homeCenter[0], lat: homeCenter[1] };
    setObserverLabel(userLoc ? "your GPS location" : "the current map centre");
    // LEO/MEO only — a geostationary satellite never "passes".
    setPasses(selectedSat.periodMin > 0 && selectedSat.periodMin < 400 ? nextPasses(selectedSat, observer, new Date(), 24, 10, 5) : []);
  }, [selectedSat, locKey, mapRef, homeCenter]);

  const selectSat = (sat: TrackedSat) => {
    setSelectedId(sat.id);
    const map = mapRef.current;
    const p = positionAt(sat, new Date());
    if (map && p) map.easeTo({ center: [p.lng, p.lat], zoom: Math.min(map.getZoom(), 3.2), pitch: 0, bearing: 0, duration: 800 });
  };

  const goHome = () => {
    setFollow(false);
    setSelectedId(null);
    mapRef.current?.flyTo({ center: userLocation ?? homeCenter, zoom: Math.max(homeZoom, 6), pitch: 0, duration: 1200 });
  };
  const worldView = () => mapRef.current?.easeTo({ center: [78.96, 20], zoom: 1.6, pitch: 0, bearing: 0, duration: 900 });

  // Cleanup when the whole hub unmounts
  useEffect(() => () => {
    const map = mapRef.current;
    if (!map || !map.getStyle()) return;
    map.getStyle().layers.filter((l) => l.id.startsWith("km-gibs-") || l.id.startsWith("km-rv-") || l.id.startsWith("km-sat")).forEach((l) => map.removeLayer(l.id));
    Object.keys(map.getStyle().sources).filter((s) => s.startsWith("km-gibs-") || s.startsWith("km-rv-") || s.startsWith("km-sat")).forEach((s) => map.removeSource(s));
  }, [mapRef]);

  const liveFrame = activeFrames[frameIndex];
  const liveSummary = [
    ...activeGibs.map((l) => l.label.split(" · ")[0]),
    skyMode !== "off" ? (skyMode === "radar" ? "Radar" : "Cloud IR") : "",
    trafficOn && TOMTOM_KEY ? "Traffic" : "",
    anyTracker ? `${allSats.length || "…"} satellites` : "",
  ].filter(Boolean);
  const groupedGibs = (Object.keys(GIBS_GROUP_LABEL) as GibsGroup[]).map((g) => ({ g, items: GIBS_LAYERS.filter((l) => l.group === g) }));

  return <>
    {!open && liveSummary.length > 0 && (
      <button className="km-live-chip" onClick={onOpen} aria-label="Open satellite hub">
        <span className="km-live-dot" aria-hidden="true" />
        <span>LIVE · {liveSummary.slice(0, 3).join(" · ")}{liveSummary.length > 3 ? ` +${liveSummary.length - 3}` : ""}</span>
      </button>
    )}

    {open && <aside className="km-panel" aria-label="Satellite hub">
      <header>
        <div><Satellite size={18} /><strong>Satellite hub</strong><span className="km-live-badge"><span className="km-live-dot" />LIVE DATA</span></div>
        <button onClick={onClose} aria-label="Close satellite hub"><X size={18} /></button>
      </header>
      <div className="km-tabs" role="tablist">
        {([["imagery", "Imagery", Layers], ["sky", "Live sky", Radar], ["tracker", "Tracker", Globe]] as const).map(([id, label, Icon]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}><Icon size={15} />{label}</button>
        ))}
      </div>

      <div className="km-body">
        {tab === "imagery" && <>
          <section>
            <h3>Base map</h3>
            <div className="mode-segment">
              {(["street", "satellite", "dark"] as MapMode[]).map((m) => <button key={m} className={mapMode === m ? "active" : ""} onClick={() => onSetMapMode(m)}>{m === "satellite" ? "hybrid satellite" : m}</button>)}
            </div>
            <p className="km-hint">Hybrid satellite is high-resolution Google imagery with road labels. The NASA layers below are <b>live</b> — captured by satellites in the last hours.</p>
          </section>
          <section>
            <h3>Imagery date <small>(UTC)</small></h3>
            <div className="km-date-row">
              <button className={dateMode === "live" && liveOffset === 0 ? "active" : ""} onClick={() => { setDateMode("live"); setLiveOffset(0); setFallbackNote(""); }}>Latest</button>
              <button className={dateMode === "live" && liveOffset === -1 ? "active" : ""} onClick={() => { setDateMode("live"); setLiveOffset(-1); setFallbackNote(""); }}>Yesterday</button>
              <input type="date" value={dateMode === "custom" ? customDate : effectiveDate} max={utcDateString(0)} min="2012-05-08" onChange={(e) => { if (e.target.value) { setCustomDate(e.target.value); setDateMode("custom"); setFallbackNote(""); } }} aria-label="Pick imagery date" />
            </div>
            <p className="km-hint">Showing <b>{effectiveDate}</b>{dateMode === "live" && liveOffset === 0 ? " (latest passes)" : ""}. Satellites pass India at different times of day, so partial coverage early in the day is normal.</p>
            {fallbackNote && <p className="km-note">{fallbackNote}</p>}
          </section>
          {groupedGibs.map(({ g, items }) => <section key={g}>
            <h3>{g === "fire" && <Flame size={14} />}{GIBS_GROUP_LABEL[g]}</h3>
            {items.map((l) => <div key={l.id} className="km-layer-row">
              <label className="toggle-row"><span>{l.label}</span><input type="checkbox" checked={!!gibsOn[l.id]} onChange={(e) => setGibsOn((s) => ({ ...s, [l.id]: e.target.checked }))} /></label>
              {gibsOn[l.id] && <>
                <p className="km-hint">{l.note}</p>
                <label className="range-row"><span>Opacity <b>{Math.round((gibsOpacity[l.id] ?? l.opacity) * 100)}%</b></span><input type="range" min="0.1" max="1" step="0.05" value={gibsOpacity[l.id] ?? l.opacity} onChange={(e) => setGibsOpacity((s) => ({ ...s, [l.id]: parseFloat(e.target.value) }))} /></label>
              </>}
            </div>)}
          </section>)}
          <p className="km-hint km-credit">Source: NASA GIBS / EOSDIS (public, no API key). Native resolution is 250 m–1 km, so zoom in beyond ~z9 will look soft — switch to hybrid satellite for street-level detail.</p>
        </>}

        {tab === "sky" && <>
          <section>
            <h3>Live cloud &amp; rain animation</h3>
            <div className="mode-segment">
              {(["off", "radar", "infrared"] as SkyMode[]).map((m) => <button key={m} className={skyMode === m ? "active" : ""} onClick={() => { setSkyMode(m); setFrameIndex(0); setPlaying(true); }}>{m === "infrared" ? "cloud (IR)" : m}</button>)}
            </div>
            {skyMode !== "off" && <>
              {skyLoading && frames.host === "" && <p className="km-hint"><span className="search-spinner" /> Loading live frames…</p>}
              {skyError && <p className="km-note">{skyError}</p>}
              {activeFrames.length > 0 && <>
                <div className="km-player">
                  <button onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Play"}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
                  <input type="range" min={0} max={activeFrames.length - 1} value={Math.min(frameIndex, activeFrames.length - 1)} onChange={(e) => { setPlaying(false); setFrameIndex(Number(e.target.value)); }} aria-label="Animation frame" />
                  <button onClick={() => void loadFrames()} aria-label="Refresh frames" title="Refresh live frames"><RefreshCw size={15} /></button>
                </div>
                <p className="km-frame-time">{liveFrame ? stampOf(new Date(liveFrame.time * 1000)) : ""}{liveFrame?.kind === "nowcast" ? " · forecast" : ""} <small>({activeFrames.length} frames · refreshes every 5 min)</small></p>
                <label className="range-row"><span>Opacity <b>{Math.round(skyOpacity * 100)}%</b></span><input type="range" min="0.2" max="1" step="0.05" value={skyOpacity} onChange={(e) => setSkyOpacity(parseFloat(e.target.value))} /></label>
              </>}
              <p className="km-hint">{skyMode === "radar" ? "Rain intensity from weather radar, past ~2 h plus a short nowcast. Radar coverage over India is patchy outside major cities." : "Infrared satellite cloud cover (cold, high clouds appear bright) — works across all of India, day and night."} Source: RainViewer.</p>
            </>}
          </section>
          <section>
            <h3>Live traffic <small>(TomTom)</small></h3>
            {TOMTOM_KEY ? <>
              <label className="toggle-row"><span>Show road traffic</span><input type="checkbox" checked={trafficOn} onChange={(e) => setTrafficOn(e.target.checked)} /></label>
              {trafficOn && <label className="range-row"><span>Opacity <b>{Math.round(trafficOpacity * 100)}%</b></span><input type="range" min="0.3" max="1" step="0.05" value={trafficOpacity} onChange={(e) => setTrafficOpacity(parseFloat(e.target.value))} /></label>}
              <p className="km-hint">Green = free-flowing, yellow/red = slower than normal. Zoom in to a city to see roads. Coverage of smaller Indian roads can be thin.</p>
            </> : <p className="km-hint">Needs a free TomTom key (no card). Add <code>NEXT_PUBLIC_TOMTOM_KEY</code> to <code>frontend/.env.local</code> and restart.</p>}
          </section>
          <section>
            <h3>Live conditions <small>at {weatherPlace || "map centre"}</small></h3>
            {weatherError && <p className="km-note">{weatherError}</p>}
            {!weather && !weatherError && <p className="km-hint"><span className="search-spinner" /> Fetching…</p>}
            {weather && <div className="km-weather">
              <div className="km-weather-main"><strong>{Math.round(weather.temp)}°C</strong><span>{WMO[weather.code] || "—"}<small>Feels {Math.round(weather.feels)}°C</small></span></div>
              <dl>
                <div><dt>Cloud cover</dt><dd>{weather.cloud}%</dd></div>
                <div><dt>Rain now</dt><dd>{weather.precip} mm</dd></div>
                <div><dt>Humidity</dt><dd>{weather.humidity}%</dd></div>
                <div><dt>Wind</dt><dd>{Math.round(weather.wind)} km/h · {Math.round(weather.windDir)}°</dd></div>
                {weather.aqi !== undefined && <div className="wide"><dt>Air quality (US AQI)</dt><dd><b className="km-aqi" data-level={weather.aqi <= 50 ? "good" : weather.aqi <= 100 ? "mod" : "bad"}>{Math.round(weather.aqi)}</b> {aqiLabel(weather.aqi)}{weather.pm25 !== undefined ? ` · PM2.5 ${Math.round(weather.pm25)} µg/m³` : ""}</dd></div>}
              </dl>
              <p className="km-hint">Updated {weather.time.replace("T", " ")} (local time of that place). Source: Open-Meteo.</p>
              <button className="km-secondary" onClick={() => void loadWeather()}><RefreshCw size={14} />Refresh now</button>
            </div>}
          </section>
        </>}

        {tab === "tracker" && <>
          <section>
            <h3>Track satellites in real time</h3>
            <p className="km-hint">Orbits are computed live in your browser (SGP4) from fresh CelesTrak element sets. Pick a group, then use World view to follow them around the globe.</p>
            <div className="km-group-grid">
              {SAT_GROUPS.map((g) => <button key={g.id} className={groupsOn[g.id] ? "active" : ""} onClick={() => void toggleGroup(g.id)} aria-pressed={groupsOn[g.id]} style={{ ["--km-color" as string]: g.color }}>
                <i aria-hidden="true" /><span><strong>{g.label}</strong><small>{loadState[g.id] === "loading" ? "Loading…" : loadState[g.id] === "error" ? "Feed unavailable" : groupsOn[g.id] && satsRef.current[g.id].length ? `${satsRef.current[g.id].length} tracked` : g.blurb}</small></span>
              </button>)}
            </div>
            {satError && <p className="km-note">{satError}{issFallback ? " Showing the ISS from a backup live feed." : ""}</p>}
            <div className="km-actions">
              <button className="km-secondary" onClick={worldView}><Globe size={14} />World view</button>
              <button className="km-secondary" onClick={goHome}><Crosshair size={14} />Back to my area</button>
            </div>
          </section>

          {selectedSat && <section className="km-sat-detail">
            <h3>{selectedSat.name}</h3>
            {livePos ? <dl>
              <div><dt>Over</dt><dd>{livePos.lat.toFixed(2)}°, {livePos.lng.toFixed(2)}°</dd></div>
              <div><dt>Altitude</dt><dd>{Math.round(livePos.altKm).toLocaleString()} km</dd></div>
              <div><dt>Speed</dt><dd>{(livePos.speedKmS * 3600).toLocaleString(undefined, { maximumFractionDigits: 0 })} km/h</dd></div>
              <div><dt>Orbit</dt><dd>{selectedSat.periodMin ? `${selectedSat.periodMin.toFixed(0)} min` : "—"}</dd></div>
            </dl> : <p className="km-hint">Waiting for position…</p>}
            <label className="toggle-row"><span>Follow on map</span><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /></label>
            <h4>Next passes over {observerLabel || "you"} <small>(above 10°)</small></h4>
            {passes.length === 0 ? <p className="km-hint">{selectedSat.periodMin >= 400 ? "Geostationary/high orbit — it stays at a fixed spot in the sky rather than passing." : "No passes above 10° in the next 24 hours."}</p> :
              <ul className="km-passes">{passes.map((p) => <li key={p.start.getTime()}><strong>{stampOf(p.start)}</strong><span>{p.ongoing ? "overhead now · " : ""}max {Math.round(p.maxElevationDeg)}° at {timeOf(p.maxAt)} · {Math.max(1, Math.round((p.end.getTime() - p.start.getTime()) / 60000))} min</span></li>)}</ul>}
            {selectedSat.epoch && <p className="km-hint">Element set epoch {selectedSat.epoch.slice(0, 16).replace("T", " ")} UTC.</p>}
          </section>}

          {allSats.length > 0 && <section>
            <h3>Satellites <small>({allSats.length})</small></h3>
            <input className="km-search" value={satFilter} onChange={(e) => setSatFilter(e.target.value)} placeholder="Filter by name" aria-label="Filter satellites" />
            <ul className="km-sat-list">
              {visibleSats.map((s) => <li key={s.id}><button className={s.id === selectedId ? "active" : ""} onClick={() => selectSat(s)}><i style={{ background: GROUP_COLOR[s.group] }} aria-hidden="true" /><span>{s.name}</span></button></li>)}
              {allSats.length > visibleSats.length && !satFilter && <li className="km-hint">Showing the first {visibleSats.length}. Use the filter to find others.</li>}
            </ul>
          </section>}
        </>}
      </div>
    </aside>}
  </>;
}
