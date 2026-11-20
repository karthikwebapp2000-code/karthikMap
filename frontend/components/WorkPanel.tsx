"use client";

import { Briefcase, Download, ExternalLink, LocateFixed, MapPin, Navigation, Plus, Route, Search, Train, Trash2, Upload, X, ArrowDown, ArrowUp } from "lucide-react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource } from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  WORK_TYPES, download, googleMapsMultiStopUrl, isWorkLocation, loadRouteStops, loadWorkLocations,
  nearestNeighbourOrder, newId, saveRouteStops, saveWorkLocations, toCsv, type WorkLocation, type WorkType,
} from "@/lib/work";
import { loadStations, prettyStationName, resolveStation, searchStations, type Station } from "@/lib/stations";

type Tab = "places" | "stations" | "route";
type Mode = "driving" | "cycling" | "walking";
type MapPlace = { place_id: string; name: string; category: string; address: string; lat: number; lng: number };
type Focus = { name: string; code: string; lat: number; lng: number; address: string };
type RouteResult = {
  distance_text: string; duration_text: string; geometry: GeoJSON.LineString;
  legs: Array<{ distance_text: string; duration_text: string }>;
};

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

type Props = {
  mapRef: React.RefObject<maplibregl.Map | null>;
  mapReady: boolean;
  open: boolean;
  userLocation: [number, number] | null;
  selectedPlace: MapPlace | null;
  travelMode: Mode;
  onClose: () => void;
  onFocusPlace: (place: MapPlace) => void;
  onDirectionsTo: (lat: number, lng: number, name: string) => void;
};

export default function WorkPanel({ mapRef, mapReady, open, userLocation, selectedPlace, travelMode, onClose, onFocusPlace, onDirectionsTo }: Props) {
  const [tab, setTab] = useState<Tab>("places");
  const [locations, setLocations] = useState<WorkLocation[]>([]);
  const [routeIds, setRouteIds] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [newType, setNewType] = useState<WorkType>("site");
  const [filter, setFilter] = useState("");
  const [notice, setNotice] = useState("");
  const importRef = useRef<HTMLInputElement | null>(null);

  // Stations
  const [stationQuery, setStationQuery] = useState("");
  const [stationList, setStationList] = useState<Station[]>([]);
  const [stationsLoading, setStationsLoading] = useState(false);
  const [locating, setLocating] = useState<string | null>(null);
  const [stationError, setStationError] = useState("");
  const [focus, setFocus] = useState<Focus | null>(null);
  const [viewStations, setViewStations] = useState<Focus[]>([]);
  const [viewLoading, setViewLoading] = useState(false);
  const resolved = useRef(new Map<string, Focus>());

  // Route
  const [mode, setMode] = useState<Mode>(travelMode);
  const [fromMe, setFromMe] = useState(false);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [routing, setRouting] = useState(false);
  const [routeError, setRouteError] = useState("");

  useEffect(() => { setMode(travelMode); }, [travelMode]);
  useEffect(() => {
    setLocations(loadWorkLocations());
    setRouteIds(loadRouteStops());
    setHydrated(true);
  }, []);
  useEffect(() => { if (hydrated) saveWorkLocations(locations); }, [locations, hydrated]);
  useEffect(() => { if (hydrated) saveRouteStops(routeIds); }, [routeIds, hydrated]);
  useEffect(() => {
    setRouteIds((ids) => ids.filter((id) => locations.some((l) => l.id === id)));
  }, [locations]);

  useEffect(() => {
    if (tab !== "stations" || stationList.length || stationsLoading) return;
    setStationsLoading(true);
    loadStations().then(setStationList).catch((e) => setStationError(e instanceof Error ? e.message : "Station list unavailable")).finally(() => setStationsLoading(false));
  }, [tab, stationList.length, stationsLoading]);

  const stationResults = useMemo(() => searchStations(stationList, stationQuery), [stationList, stationQuery]);
  const stops = useMemo(() => routeIds.map((id) => locations.find((l) => l.id === id)).filter(Boolean) as WorkLocation[], [routeIds, locations]);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? locations.filter((l) => `${l.name} ${l.address} ${l.code ?? ""} ${l.type}`.toLowerCase().includes(q)) : locations;
  }, [locations, filter]);

  const flash = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice((m) => (m === message ? "" : m)), 3500);
  }, []);

  // ───────── Map layers ─────────
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || map.getSource("km-work-source")) return;
    const typeColor = ["match", ["get", "type"], ...WORK_TYPES.flatMap((t) => [t.id, t.color]), "#5f6368"] as unknown as maplibregl.ExpressionSpecification;
    map.addSource("km-work-route-source", { type: "geojson", data: EMPTY });
    map.addSource("km-work-source", { type: "geojson", data: EMPTY });
    map.addSource("km-station-source", { type: "geojson", data: EMPTY });
    map.addSource("km-work-stops-source", { type: "geojson", data: EMPTY });
    map.addLayer({ id: "km-work-route-casing", type: "line", source: "km-work-route-source", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#0b3d91", "line-width": 9, "line-opacity": 0.9 } });
    map.addLayer({ id: "km-work-route-line", type: "line", source: "km-work-route-source", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#4285f4", "line-width": 5.5 } });
    map.addLayer({
      id: "km-station-points", type: "circle", source: "km-station-source",
      paint: { "circle-radius": ["case", ["get", "focus"], 9, 6], "circle-color": "#d93025", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 },
    });
    map.addLayer({
      id: "km-station-labels", type: "symbol", source: "km-station-source", minzoom: 8,
      layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-offset": [0, 1.1], "text-anchor": "top", "text-optional": true },
      paint: { "text-color": "#8c1d18", "text-halo-color": "#ffffff", "text-halo-width": 1.6 },
    });
    map.addLayer({
      id: "km-work-points", type: "circle", source: "km-work-source",
      paint: { "circle-radius": 8, "circle-color": typeColor, "circle-stroke-color": "#ffffff", "circle-stroke-width": 2.5 },
    });
    map.addLayer({
      id: "km-work-labels", type: "symbol", source: "km-work-source", minzoom: 6,
      layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 12, "text-offset": [0, 1.2], "text-anchor": "top", "text-optional": true },
      paint: { "text-color": "#202124", "text-halo-color": "#ffffff", "text-halo-width": 1.8 },
    });
    map.addLayer({ id: "km-work-stops-circle", type: "circle", source: "km-work-stops-source", paint: { "circle-radius": 12, "circle-color": "#202124", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } });
    map.addLayer({
      id: "km-work-stops-num", type: "symbol", source: "km-work-stops-source",
      layout: { "text-field": ["get", "n"], "text-font": ["Noto Sans Regular"], "text-size": 12, "text-allow-overlap": true, "text-ignore-placement": true },
      paint: { "text-color": "#ffffff" },
    });
    const pointer = (layer: string) => {
      map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
    };
    pointer("km-work-points");
    pointer("km-station-points");
  }, [mapReady, mapRef]);

  // Click handlers (re-bound so they always see the latest callbacks)
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !map.getLayer("km-work-points")) return;
    const onWork = (event: maplibregl.MapLayerMouseEvent) => {
      const id = event.features?.[0]?.properties?.id;
      const loc = locations.find((l) => l.id === id);
      if (loc) onFocusPlace({ place_id: loc.id, name: loc.name, category: loc.type, address: loc.address, lat: loc.lat, lng: loc.lng });
    };
    const onStation = (event: maplibregl.MapLayerMouseEvent) => {
      const p = event.features?.[0]?.properties;
      const g = event.features?.[0]?.geometry;
      if (!p || !g || g.type !== "Point") return;
      setFocus({ name: String(p.name), code: String(p.code || ""), lat: g.coordinates[1], lng: g.coordinates[0], address: String(p.address || "Railway station") });
      setTab("stations");
    };
    map.on("click", "km-work-points", onWork);
    map.on("click", "km-station-points", onStation);
    return () => { map.off("click", "km-work-points", onWork); map.off("click", "km-station-points", onStation); };
  }, [mapReady, mapRef, locations, onFocusPlace]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    (map.getSource("km-work-source") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: locations.map((l) => ({
        type: "Feature", geometry: { type: "Point", coordinates: [l.lng, l.lat] },
        properties: { id: l.id, label: l.code ? `${l.name} (${l.code})` : l.name, type: l.type },
      })),
    });
  }, [mapReady, mapRef, locations]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const features: GeoJSON.Feature[] = [...viewStations, ...(focus ? [focus] : [])].map((s) => ({
      type: "Feature", geometry: { type: "Point", coordinates: [s.lng, s.lat] },
      properties: { name: s.name, code: s.code, address: s.address, label: s.code ? `${s.name} (${s.code})` : s.name, focus: !!focus && s.lat === focus.lat && s.lng === focus.lng },
    }));
    (map.getSource("km-station-source") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features });
  }, [mapReady, mapRef, viewStations, focus]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    (map.getSource("km-work-stops-source") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: stops.map((s, i) => ({ type: "Feature", geometry: { type: "Point", coordinates: [s.lng, s.lat] }, properties: { n: String(i + 1) } })),
    });
  }, [mapReady, mapRef, stops]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    (map.getSource("km-work-route-source") as GeoJSONSource | undefined)?.setData(route ? { type: "Feature", properties: {}, geometry: route.geometry } : EMPTY);
  }, [mapReady, mapRef, route]);

  useEffect(() => { setRoute(null); }, [routeIds, mode, fromMe]);

  // The AI assistant (or anything else) can load a route and ask for it to be calculated.
  const pendingCalc = useRef(false);
  const [calcTick, setCalcTick] = useState(0);
  useEffect(() => {
    const onSet = (event: Event) => {
      setRouteIds(loadRouteStops());
      setTab("route");
      pendingCalc.current = !!(event as CustomEvent).detail?.autoCalc;
      setCalcTick((t) => t + 1);
    };
    window.addEventListener("km:route-set", onSet);
    return () => window.removeEventListener("km:route-set", onSet);
  }, []);
  useEffect(() => {
    if (!pendingCalc.current || routeIds.length === 0) return;
    pendingCalc.current = false;
    const timer = window.setTimeout(() => void calculate(), 50);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeIds, calcTick]);

  useEffect(() => () => {
    const map = mapRef.current;
    if (!map || !map.getStyle()) return;
    map.getStyle().layers.filter((l) => l.id.startsWith("km-work") || l.id.startsWith("km-station")).forEach((l) => map.removeLayer(l.id));
    Object.keys(map.getStyle().sources).filter((s) => s.startsWith("km-work") || s.startsWith("km-station")).forEach((s) => map.removeSource(s));
  }, [mapRef]);

  // ───────── Actions ─────────
  const addLocation = (loc: Omit<WorkLocation, "id" | "createdAt">) => {
    if (loc.code && locations.some((l) => l.code === loc.code)) { flash(`${loc.name} is already saved`); return; }
    setLocations((list) => [{ ...loc, id: newId(), createdAt: Date.now() }, ...list]);
    flash(`Saved “${loc.name}” as ${WORK_TYPES.find((t) => t.id === loc.type)?.label.toLowerCase()}`);
  };

  const saveSelected = () => {
    if (!selectedPlace) return;
    addLocation({ name: selectedPlace.name, type: newType, lat: selectedPlace.lat, lng: selectedPlace.lng, address: selectedPlace.address });
  };
  const saveCentre = () => {
    const c = mapRef.current?.getCenter();
    if (!c) return;
    addLocation({ name: `Pin ${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}`, type: newType, lat: c.lat, lng: c.lng, address: "Dropped at map centre" });
  };
  const saveMe = () => {
    if (!userLocation) { flash("Turn on “My location” first"); return; }
    addLocation({ name: "My location", type: newType, lat: userLocation[1], lng: userLocation[0], address: "Saved from GPS" });
  };
  const patchLocation = (id: string, patch: Partial<WorkLocation>) => setLocations((list) => list.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const removeLocation = (id: string) => setLocations((list) => list.filter((l) => l.id !== id));
  const flyTo = (lat: number, lng: number, zoom = 15) => mapRef.current?.flyTo({ center: [lng, lat], zoom, pitch: 30, duration: 1100 });

  const exportJson = () => download("karthik-map-work-locations.json", JSON.stringify(locations, null, 2), "application/json");
  const exportCsv = () => download("karthik-map-work-locations.csv", toCsv(locations), "text/csv");
  const importFile = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text());
      const valid = (Array.isArray(parsed) ? parsed : []).filter(isWorkLocation);
      if (!valid.length) throw new Error("No valid locations found in that file");
      setLocations((list) => {
        const known = new Set(list.map((l) => l.id));
        return [...list, ...valid.filter((l) => !known.has(l.id))];
      });
      flash(`Imported ${valid.length} location${valid.length === 1 ? "" : "s"}`);
    } catch (error) {
      flash(error instanceof Error ? error.message : "Could not read that file");
    }
  };

  const locateStation = async (station: Station) => {
    setLocating(station.c);
    setStationError("");
    try {
      let hit = resolved.current.get(station.c);
      if (!hit) {
        const r = await resolveStation(station);
        hit = { name: r.name, code: r.code, lat: r.lat, lng: r.lng, address: r.address };
        resolved.current.set(station.c, hit);
      }
      setFocus(hit);
      flyTo(hit.lat, hit.lng, 15);
    } catch (error) {
      setStationError(error instanceof Error ? error.message : "Could not locate this station");
    } finally {
      setLocating(null);
    }
  };

  const stationsInView = async () => {
    const map = mapRef.current;
    if (!map) return;
    const b = map.getBounds();
    setViewLoading(true);
    setStationError("");
    try {
      const res = await fetch(`/api/v1/stations/bbox?south=${b.getSouth()}&west=${b.getWest()}&north=${b.getNorth()}&east=${b.getEast()}`);
      const data = await res.json();
      if (!res.ok || data.status !== "OK") throw new Error(data.error || "Could not list stations here");
      const byCode = new Map(stationList.map((s) => [s.c, s.n]));
      setViewStations((data.stations as Array<{ name: string; code: string; lat: number; lng: number }>).map((s) => ({
        name: s.code && byCode.has(s.code.toUpperCase()) ? prettyStationName(byCode.get(s.code.toUpperCase()) as string) : s.name,
        code: s.code?.toUpperCase() || "", lat: s.lat, lng: s.lng, address: "Railway station",
      })));
      flash(`${data.count} station${data.count === 1 ? "" : "s"} in view`);
    } catch (error) {
      setStationError(error instanceof Error ? error.message : "Could not list stations here");
    } finally {
      setViewLoading(false);
    }
  };

  const addToRoute = (id: string) => setRouteIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
  const moveStop = (index: number, delta: number) => setRouteIds((ids) => {
    const next = [...ids]; const j = index + delta;
    if (j < 0 || j >= next.length) return ids;
    [next[index], next[j]] = [next[j], next[index]];
    return next;
  });

  const saveStationAndRoute = (f: Focus, thenRoute: boolean) => {
    const existing = f.code ? locations.find((l) => l.code === f.code) : undefined;
    if (existing) { if (thenRoute) { addToRoute(existing.id); setTab("route"); } else flash("Already saved"); return; }
    const id = newId();
    setLocations((list) => [{ id, name: prettyStationName(f.name), type: "station", lat: f.lat, lng: f.lng, address: f.address, code: f.code || undefined, createdAt: Date.now() }, ...list]);
    if (thenRoute) { setRouteIds((ids) => [...ids, id]); setTab("route"); } else flash(`Saved ${f.name}`);
  };

  const optimise = () => {
    const start: [number, number] | null = fromMe && userLocation ? userLocation : null;
    const ordered = nearestNeighbourOrder(stops, start, !start);
    setRouteIds(ordered.map((s) => s.id));
    flash("Reordered by nearest next stop");
  };

  const calculate = async () => {
    const points: Array<[number, number]> = [
      ...(fromMe && userLocation ? [[userLocation[0], userLocation[1]] as [number, number]] : []),
      ...stops.map((s) => [s.lng, s.lat] as [number, number]),
    ];
    if (points.length < 2) { setRouteError("Add at least two stops (or one stop plus “start from my location”)."); return; }
    setRouting(true); setRouteError("");
    try {
      const q = points.map(([lng, lat]) => `${lat},${lng}`).join(";");
      const res = await fetch(`/api/v1/directions/multi?mode=${mode}&points=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok || data.status !== "OK") throw new Error(data.error || "Routing failed");
      setRoute(data as RouteResult);
      const coords = (data.geometry as GeoJSON.LineString).coordinates;
      const bounds = coords.reduce((b, c) => b.extend(c as [number, number]), new maplibregl.LngLatBounds(coords[0] as [number, number], coords[0] as [number, number]));
      mapRef.current?.fitBounds(bounds, { padding: { top: 90, bottom: 90, left: 60, right: 420 }, duration: 1000, pitch: 0 });
    } catch (error) {
      setRouteError(error instanceof Error ? error.message : "Routing failed");
    } finally {
      setRouting(false);
    }
  };

  const routePoints: Array<[number, number]> = [
    ...(fromMe && userLocation ? [[userLocation[0], userLocation[1]] as [number, number]] : []),
    ...stops.map((s) => [s.lng, s.lat] as [number, number]),
  ];
  const typeLabel = (t: WorkType) => WORK_TYPES.find((x) => x.id === t)?.label ?? "Other";
  const typeColor = (t: WorkType) => WORK_TYPES.find((x) => x.id === t)?.color ?? "#5f6368";

  if (!open) return null;

  return <aside className="km-panel km-work" aria-label="Work map">
    <header>
      <div><Briefcase size={18} /><strong>Work map</strong><span className="km-count">{locations.length} saved</span></div>
      <button onClick={onClose} aria-label="Close work map"><X size={18} /></button>
    </header>
    <div className="km-tabs" role="tablist">
      {([["places", "Locations", MapPin], ["stations", "Rail stations", Train], ["route", `Day route${stops.length ? ` (${stops.length})` : ""}`, Route]] as const).map(([id, label, Icon]) => (
        <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id as Tab)}><Icon size={15} />{label}</button>
      ))}
    </div>
    {notice && <p className="km-toast" role="status">{notice}</p>}

    <div className="km-body">
      {tab === "places" && <>
        <section>
          <h3>Save a work location</h3>
          <div className="km-type-row" role="group" aria-label="Location type">
            {WORK_TYPES.map((t) => <button key={t.id} className={newType === t.id ? "active" : ""} style={{ ["--km-color" as string]: t.color }} onClick={() => setNewType(t.id)}>{t.label}</button>)}
          </div>
          <div className="km-save-grid">
            <button onClick={saveSelected} disabled={!selectedPlace} title={selectedPlace ? selectedPlace.name : "Search or tap a place on the map first"}><Plus size={15} />{selectedPlace ? `Selected: ${selectedPlace.name.slice(0, 22)}${selectedPlace.name.length > 22 ? "…" : ""}` : "Selected place"}</button>
            <button onClick={saveCentre}><Plus size={15} />Map centre</button>
            <button onClick={saveMe}><LocateFixed size={15} />My location</button>
          </div>
        </section>
        <section>
          <h3>Your locations</h3>
          {locations.length > 4 && <input className="km-search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter locations" aria-label="Filter locations" />}
          {locations.length === 0 && <p className="km-hint">Nothing saved yet. Search for an office, site or client on the map, open it, then save it here — or save the map centre / your GPS position. Everything stays on this device.</p>}
          <ul className="km-loc-list">
            {shown.map((l) => <li key={l.id}>
              <div className="km-loc-head">
                <i style={{ background: typeColor(l.type) }} aria-hidden="true" />
                <button className="km-loc-name" onClick={() => { flyTo(l.lat, l.lng, 16); onFocusPlace({ place_id: l.id, name: l.name, category: l.type, address: l.address, lat: l.lat, lng: l.lng }); }}>
                  <strong>{l.name}{l.code ? ` · ${l.code}` : ""}</strong><small>{l.address}</small>
                </button>
              </div>
              <div className="km-loc-tools">
                <select value={l.type} onChange={(e) => patchLocation(l.id, { type: e.target.value as WorkType })} aria-label={`Type for ${l.name}`}>
                  {WORK_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
                <button onClick={() => onDirectionsTo(l.lat, l.lng, l.name)} title="Directions"><Navigation size={14} /></button>
                <button onClick={() => { addToRoute(l.id); flash(`Added “${l.name}” to day route`); }} title="Add to day route" disabled={routeIds.includes(l.id)}><Route size={14} /></button>
                <button onClick={() => removeLocation(l.id)} title="Delete" aria-label={`Delete ${l.name}`}><Trash2 size={14} /></button>
              </div>
              <div className="km-stars" role="group" aria-label={`Your rating for ${l.name}`}>{[1, 2, 3, 4, 5].map((n) => <button key={n} className={(l.rating ?? 0) >= n ? "on" : ""} onClick={() => patchLocation(l.id, { rating: l.rating === n ? undefined : n })} aria-label={`${n} star${n === 1 ? "" : "s"}`}>★</button>)}</div>
              <input className="km-notes" value={l.notes ?? ""} onChange={(e) => patchLocation(l.id, { notes: e.target.value })} placeholder="Notes (gate no., contact, timings…)" aria-label={`Notes for ${l.name}`} />
            </li>)}
          </ul>
        </section>
        <section className="km-actions">
          <button className="km-secondary" onClick={exportCsv} disabled={!locations.length}><Download size={14} />CSV</button>
          <button className="km-secondary" onClick={exportJson} disabled={!locations.length}><Download size={14} />JSON</button>
          <button className="km-secondary" onClick={() => importRef.current?.click()}><Upload size={14} />Import</button>
          <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ""; }} />
        </section>
      </>}

      {tab === "stations" && <>
        <section>
          <h3>Indian Railways stations <small>({stationList.length ? stationList.length.toLocaleString() : "…"})</small></h3>
          <div className="km-searchrow"><Search size={16} /><input value={stationQuery} onChange={(e) => setStationQuery(e.target.value)} placeholder="Station name or code — e.g. MAS, Trichy, NDLS" aria-label="Search railway stations" autoFocus /></div>
          {stationsLoading && <p className="km-hint"><span className="search-spinner" /> Loading station list…</p>}
          {stationError && <p className="km-note">{stationError}</p>}
          {stationQuery.trim() && stationResults.length === 0 && !stationsLoading && <p className="km-hint">No station matches “{stationQuery}”.</p>}
          <ul className="km-station-list">
            {stationResults.map((s) => <li key={s.c}><button onClick={() => void locateStation(s)} disabled={locating === s.c}>
              <Train size={15} /><span><strong>{prettyStationName(s.n)}</strong><small>{locating === s.c ? "Locating on map…" : "Tap to find on map"}</small></span><em>{s.c}</em>
            </button></li>)}
          </ul>
        </section>
        {focus && <section className="km-focus-card">
          <h3><Train size={15} />{prettyStationName(focus.name)}{focus.code ? ` · ${focus.code}` : ""}</h3>
          <p className="km-hint">{focus.address}</p>
          <div className="km-save-grid">
            <button onClick={() => saveStationAndRoute(focus, false)}><Plus size={15} />Save</button>
            <button onClick={() => onDirectionsTo(focus.lat, focus.lng, prettyStationName(focus.name))}><Navigation size={15} />Directions</button>
            <button onClick={() => saveStationAndRoute(focus, true)}><Route size={15} />Add to route</button>
          </div>
        </section>}
        <section>
          <h3>Stations on the map</h3>
          <div className="km-actions">
            <button className="km-secondary" onClick={() => void stationsInView()} disabled={viewLoading}>{viewLoading ? <span className="search-spinner" /> : <Train size={14} />}Show stations in this view</button>
            {viewStations.length > 0 && <button className="km-secondary" onClick={() => setViewStations([])}>Clear ({viewStations.length})</button>}
          </div>
          <p className="km-hint">Zoom to a state or city first (up to ~6° wide). Tap a red dot to see the station and save it. Positions come from OpenStreetMap, so a few small halts may be missing.</p>
        </section>
      </>}

      {tab === "route" && <>
        <section>
          <h3>Day route <small>({stops.length} stop{stops.length === 1 ? "" : "s"})</small></h3>
          {stops.length === 0 && <p className="km-hint">Add stops from the Locations tab (route icon) or from a railway station, then calculate one combined route in your chosen order.</p>}
          <ol className="km-stop-list">
            {stops.map((s, i) => <li key={s.id}>
              <b>{i + 1}</b>
              <span><strong>{s.name}</strong><small>{s.address}</small></span>
              <button onClick={() => moveStop(i, -1)} disabled={i === 0} aria-label="Move up"><ArrowUp size={14} /></button>
              <button onClick={() => moveStop(i, 1)} disabled={i === stops.length - 1} aria-label="Move down"><ArrowDown size={14} /></button>
              <button onClick={() => setRouteIds((ids) => ids.filter((id) => id !== s.id))} aria-label={`Remove ${s.name}`}><X size={14} /></button>
            </li>)}
          </ol>
          <label className="toggle-row"><span>Start from my location</span><input type="checkbox" checked={fromMe} disabled={!userLocation} onChange={(e) => setFromMe(e.target.checked)} /></label>
          {!userLocation && <p className="km-hint">Turn on “My location” on the map to start from where you are.</p>}
          <div className="travel-tabs">{(["driving", "cycling", "walking"] as Mode[]).map((m) => <button key={m} className={mode === m ? "active" : ""} onClick={() => setMode(m)}>{m === "driving" ? "Car" : m === "cycling" ? "Bike" : "Walk"}</button>)}</div>
          <div className="km-actions">
            <button className="km-primary" onClick={() => void calculate()} disabled={routing}>{routing ? <span className="search-spinner" /> : <Route size={15} />}Calculate route</button>
            <button className="km-secondary" onClick={optimise} disabled={stops.length < 2}>Optimise order</button>
            <button className="km-secondary" onClick={() => { setRouteIds([]); setRoute(null); }} disabled={!stops.length}>Clear</button>
          </div>
          {routeError && <p className="km-note">{routeError}</p>}
        </section>
        {route && <section className="km-route-summary">
          <div className="km-route-total"><strong>{route.duration_text}</strong><span>{route.distance_text} · {mode === "driving" ? "by car" : mode === "cycling" ? "by bike" : "on foot"}</span></div>
          <ul>
            {route.legs.map((leg, i) => {
              const labels = [...(fromMe && userLocation ? ["My location"] : []), ...stops.map((s) => s.name)];
              return <li key={i}><span>{labels[i]} → {labels[i + 1]}</span><em>{leg.distance_text} · {leg.duration_text}</em></li>;
            })}
          </ul>
          <a className="km-link" href={googleMapsMultiStopUrl(routePoints, mode)} target="_blank" rel="noreferrer"><ExternalLink size={14} />Open this route in Google Maps for turn-by-turn on your phone</a>
          {routePoints.length > 10 && <p className="km-hint">Google Maps accepts at most 9 intermediate stops; extra stops may be dropped there.</p>}
        </section>}
      </>}
    </div>
  </aside>;
}
