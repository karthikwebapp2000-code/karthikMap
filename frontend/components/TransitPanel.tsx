"use client";

import { Bus, Crosshair, LocateFixed, Route as RouteIcon, Search, Train, X } from "lucide-react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource } from "maplibre-gl";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  departuresAt, fmtClock, inChennai, istMinutes, loadChennaiBus, nearestStops, routesServing, searchRoutes,
  type BusRoute, type ChennaiBus, type Departure,
} from "@/lib/chennaiBus";

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

const TOP_CITIES: Array<[string, [number, number]]> = [
  ["Chennai", [80.2707, 13.0827]], ["Coimbatore", [76.9558, 11.0168]], ["Madurai", [78.1198, 9.9252]],
  ["Tiruchirappalli", [78.7047, 10.7905]], ["Salem", [78.146, 11.6643]], ["Bengaluru", [77.5946, 12.9716]],
  ["Hyderabad", [78.4867, 17.385]], ["Mumbai", [72.8777, 19.076]], ["Delhi", [77.2090, 28.6139]],
  ["Kolkata", [88.3639, 22.5726]], ["Pune", [73.8567, 18.5204]],
];

type Tab = "bus" | "train";
type OsmRoute = { ref: string; from?: string; to?: string; name?: string; operator?: string };
type Stop = { key: string; name: string; lat: number; lng: number; dist: number; idx?: number; routes?: OsmRoute[] };
type TrainStop = { seq: number; code: string; name: string; status?: string; platform?: string; lat?: number; lng?: number; schArr?: string; schDep?: string; actArr?: string; actDep?: string; delay?: number };
type TrainResult = {
  train: { number: string; name: string; type?: string; from?: { name: string }; to?: { name: string } };
  runStatus?: string; isLive?: boolean; trackingMode?: string; startDate?: string; lastUpdatedAt?: string; delayMinutes?: number;
  currentLocation?: { stationName?: string; status?: string; speedKmh?: number }; nextHalt?: { stationName?: string }; previousHalt?: { stationName?: string };
  exceptions?: Array<{ type?: string; description?: string }>; route: TrainStop[]; cached?: boolean;
};

type Props = {
  mapRef: React.RefObject<maplibregl.Map | null>;
  mapReady: boolean;
  open: boolean;
  userLocation: [number, number] | null;
  onClose: () => void;
};

const hhmm = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }) : "—");

export default function TransitPanel({ mapRef, mapReady, open, userLocation, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("bus");
  const [data, setData] = useState<ChennaiBus | null>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [selected, setSelected] = useState<Stop | null>(null);
  const [departures, setDepartures] = useState<Departure[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [source, setSource] = useState<"" | "chennai" | "osm">("");
  const [query, setQuery] = useState("");
  const [activeRoute, setActiveRoute] = useState<BusRoute | null>(null);

  const [trainNo, setTrainNo] = useState("");
  const [train, setTrain] = useState<TrainResult | null>(null);
  const [trainLoading, setTrainLoading] = useState(false);
  const [trainError, setTrainError] = useState("");

  // ───────── map layers ─────────
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || map.getSource("km-bus-stops-source")) return;
    map.addSource("km-bus-route-source", { type: "geojson", data: EMPTY });
    map.addSource("km-bus-stops-source", { type: "geojson", data: EMPTY });
    map.addSource("km-train-source", { type: "geojson", data: EMPTY });
    map.addLayer({ id: "km-bus-route-line", type: "line", source: "km-bus-route-source", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#e8710a", "line-width": 4.5, "line-opacity": 0.9 } });
    map.addLayer({ id: "km-train-line", type: "line", source: "km-train-source", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": "#9334e6", "line-width": 3.5, "line-dasharray": [2, 1.5] } });
    map.addLayer({ id: "km-bus-stops-points", type: "circle", source: "km-bus-stops-source", paint: { "circle-radius": ["case", ["get", "selected"], 9, 5.5], "circle-color": ["case", ["get", "selected"], "#e8710a", "#0f9d8a"], "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
    map.addLayer({ id: "km-bus-stops-labels", type: "symbol", source: "km-bus-stops-source", minzoom: 13.5, layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-offset": [0, 1.1], "text-anchor": "top", "text-optional": true }, paint: { "text-color": "#0b5c50", "text-halo-color": "#fff", "text-halo-width": 1.6 } });
    map.addLayer({ id: "km-train-points", type: "circle", source: "km-train-source", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": ["case", ["get", "current"], 9, 4.5], "circle-color": ["case", ["get", "current"], "#d93025", "#9334e6"], "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
    map.addLayer({ id: "km-train-labels", type: "symbol", source: "km-train-source", filter: ["==", ["geometry-type"], "Point"], minzoom: 5, layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 10.5, "text-offset": [0, 1.1], "text-anchor": "top", "text-optional": true }, paint: { "text-color": "#4a148c", "text-halo-color": "#fff", "text-halo-width": 1.6 } });
    const pointer = (id: string) => {
      map.on("mouseenter", id, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", id, () => { map.getCanvas().style.cursor = ""; });
    };
    pointer("km-bus-stops-points");
  }, [mapReady, mapRef]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    (map.getSource("km-bus-stops-source") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: (activeRoute && data ? activeRoute.s.map((si, i) => ({ name: data.stops[si][0], lat: data.stops[si][1], lng: data.stops[si][2], key: `r${i}` })) : stops).map((s) => ({
        type: "Feature" as const, geometry: { type: "Point" as const, coordinates: [s.lng, s.lat] },
        properties: { key: s.key, label: s.name, selected: !activeRoute && selected?.key === s.key },
      })),
    });
    (map.getSource("km-bus-route-source") as GeoJSONSource | undefined)?.setData(activeRoute && data ? {
      type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: activeRoute.s.map((si) => [data.stops[si][2], data.stops[si][1]]) },
    } : EMPTY);
  }, [mapReady, mapRef, stops, selected, activeRoute, data]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const features: GeoJSON.Feature[] = [];
    if (train) {
      const pts = train.route.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
      if (pts.length > 1) features.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: pts.map((s) => [s.lng as number, s.lat as number]) } });
      const cur = train.currentLocation?.stationName;
      pts.forEach((s) => features.push({ type: "Feature", properties: { label: s.name, current: !!cur && s.name === cur }, geometry: { type: "Point", coordinates: [s.lng as number, s.lat as number] } }));
    }
    (map.getSource("km-train-source") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features });
  }, [mapReady, mapRef, train]);

  useEffect(() => () => {
    const map = mapRef.current;
    if (!map || !map.getStyle()) return;
    map.getStyle().layers.filter((l) => l.id.startsWith("km-bus") || l.id.startsWith("km-train")).forEach((l) => map.removeLayer(l.id));
    Object.keys(map.getStyle().sources).filter((s) => s.startsWith("km-bus") || s.startsWith("km-train")).forEach((s) => map.removeSource(s));
  }, [mapRef]);

  // ───────── bus actions ─────────
  const loadStopsAt = useCallback(async (lat: number, lng: number) => {
    setLoading(true); setError(""); setSelected(null); setDepartures([]); setActiveRoute(null);
    try {
      if (inChennai(lat, lng)) {
        const d = data ?? await loadChennaiBus();
        setData(d); setSource("chennai");
        const list = nearestStops(d, lat, lng, 25, 1200).map((s): Stop => ({ key: `c${s.idx}`, name: s.name, lat: s.lat, lng: s.lng, dist: s.dist, idx: s.idx }));
        setStops(list);
        if (!list.length) setError("No Chennai bus stops within 1.2 km of this point.");
      } else {
        setSource("osm");
        const res = await fetch(`/api/v1/transit/osm-bus?lat=${lat}&lng=${lng}&radius=900`);
        const json = await res.json();
        if (!res.ok || json.status !== "OK") throw new Error(json.error || "Could not load bus stops");
        const list = (json.stops as Array<{ id: number; name: string; lat: number; lng: number; dist: number; routes: OsmRoute[] }>).map((s): Stop => ({ key: `o${s.id}`, name: s.name, lat: s.lat, lng: s.lng, dist: s.dist, routes: s.routes }));
        setStops(list);
        if (!list.length) setError("No bus stops are mapped in OpenStreetMap near this point. Coverage differs a lot between cities.");
        else if (!json.withRoutes) setError("Stops found, but OpenStreetMap has no bus-route data linked to them here, so route numbers can't be shown.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load bus data");
    } finally {
      setLoading(false);
    }
  }, [data]);

  const useMapCentre = () => { const c = mapRef.current?.getCenter(); if (c) void loadStopsAt(c.lat, c.lng); };
  const useMe = () => { if (userLocation) void loadStopsAt(userLocation[1], userLocation[0]); };
  const goCity = (centre: [number, number]) => {
    mapRef.current?.flyTo({ center: centre, zoom: 14, pitch: 0, duration: 1600 });
    void loadStopsAt(centre[1], centre[0]);
  };

  const pickStop = (s: Stop) => {
    setSelected(s);
    mapRef.current?.flyTo({ center: [s.lng, s.lat], zoom: Math.max(mapRef.current.getZoom(), 16), duration: 900 });
    if (s.idx !== undefined && data) setDepartures(departuresAt(data, s.idx, istMinutes()));
    else setDepartures([]);
  };

  const [routeHits, setRouteHits] = useState<Array<{ idx: number; r: BusRoute }>>([]);
  const runRouteSearch = async (q: string) => {
    setQuery(q);
    if (!q.trim()) { setRouteHits([]); return; }
    try {
      const d = data ?? await loadChennaiBus();
      setData(d);
      setRouteHits(searchRoutes(d, q));
    } catch (e) { setError(e instanceof Error ? e.message : "Route data unavailable"); }
  };

  const showRoute = (r: BusRoute) => {
    if (!data) return;
    setActiveRoute(r); setSelected(null); setDepartures([]);
    const pts = r.s.map((si) => [data.stops[si][2], data.stops[si][1]] as [number, number]);
    const b = pts.reduce((bb, p) => bb.extend(p), new maplibregl.LngLatBounds(pts[0], pts[0]));
    mapRef.current?.fitBounds(b, { padding: { top: 90, bottom: 90, left: 60, right: 420 }, duration: 1000, pitch: 0 });
  };

  const nowMin = istMinutes();
  const routeStops = useMemo(() => (activeRoute && data ? activeRoute.s.map((si, i) => ({ name: data.stops[si][0], off: activeRoute.o[i] })) : []), [activeRoute, data]);
  const nextStarts = useMemo(() => (activeRoute ? activeRoute.t.filter((t) => t >= nowMin).slice(0, 5) : []), [activeRoute, nowMin]);

  // ───────── train actions ─────────
  const lookupTrain = async () => {
    if (!trainNo.trim()) return;
    setTrainLoading(true); setTrainError(""); setTrain(null);
    try {
      const res = await fetch(`/api/v1/trains/live?number=${encodeURIComponent(trainNo.trim())}`);
      const json = await res.json();
      if (!res.ok || json.status !== "OK") throw new Error(json.error || "Could not get train status");
      setTrain(json);
      const pts = (json.route as TrainStop[]).filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
      if (pts.length > 1) {
        const b = pts.reduce((bb, p) => bb.extend([p.lng as number, p.lat as number]), new maplibregl.LngLatBounds([pts[0].lng as number, pts[0].lat as number], [pts[0].lng as number, pts[0].lat as number]));
        mapRef.current?.fitBounds(b, { padding: { top: 90, bottom: 90, left: 60, right: 420 }, duration: 1200, pitch: 0 });
      }
    } catch (e) {
      setTrainError(e instanceof Error ? e.message : "Could not get train status");
    } finally {
      setTrainLoading(false);
    }
  };

  if (!open) return null;

  return <aside className="km-panel km-transit" aria-label="Transit">
    <header>
      <div><Bus size={18} /><strong>Bus &amp; trains</strong></div>
      <button onClick={onClose} aria-label="Close transit"><X size={18} /></button>
    </header>
    <div className="km-tabs" role="tablist">
      {([["bus", "Buses", Bus], ["train", "Live trains", Train]] as const).map(([id, label, Icon]) => (
        <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}><Icon size={15} />{label}</button>
      ))}
    </div>

    <div className="km-body">
      {tab === "bus" && <>
        <section>
          <h3>Top cities</h3>
          <div className="km-city-chips">{TOP_CITIES.map(([name, c]) => <button key={name} onClick={() => goCity(c)}>{name}</button>)}</div>
          <div className="km-actions">
            <button className="km-primary" onClick={useMapCentre} disabled={loading}>{loading ? <span className="search-spinner" /> : <Crosshair size={14} />}Stops at map centre</button>
            <button className="km-secondary" onClick={useMe} disabled={!userLocation || loading}><LocateFixed size={14} />Near me</button>
          </div>
          {error && <p className="km-note">{error}</p>}
          <p className="km-hint">
            {source === "chennai" ? "Chennai: MTC bus timetable (community dataset, collected April 2026 — scheduled times, not live GPS)."
              : source === "osm" ? "Other cities: stops and route numbers from OpenStreetMap. No timetables are free for these cities."
              : "Chennai has bundled MTC timetables. Coimbatore and other cities use OpenStreetMap stop/route data, which varies in completeness."}
          </p>
        </section>

        {selected && <section className="km-focus-card">
          <h3><Bus size={15} />{selected.name}</h3>
          {selected.idx !== undefined && data ? <>
            {departures.length === 0 ? <p className="km-hint">No more scheduled departures today from this stop.</p> :
              <ul className="km-deps">{departures.map((d, i) => <li key={i}><b>{d.route}</b><span>to {d.to}</span><em>{fmtClock(d.at)}<small>{d.wait <= 0 ? "now" : `in ${d.wait} min`}</small></em></li>)}</ul>}
            <p className="km-hint">All routes here: {routesServing(data, selected.idx).slice(0, 30).map((r) => r.n).join(", ") || "—"}</p>
          </> : selected.routes && selected.routes.length ? (
            <ul className="km-deps">{selected.routes.map((r, i) => <li key={i}><b>{r.ref}</b><span>{r.to ? `to ${r.to}` : r.name || ""}</span><em><small>{r.operator || ""}</small></em></li>)}</ul>
          ) : <p className="km-hint">No route data for this stop in OpenStreetMap.</p>}
        </section>}

        {stops.length > 0 && !activeRoute && <section>
          <h3>Nearby stops <small>({stops.length})</small></h3>
          <ul className="km-stop-pick">{stops.map((s) => <li key={s.key}><button className={selected?.key === s.key ? "active" : ""} onClick={() => pickStop(s)}><span>{s.name}</span><em>{s.dist} m</em></button></li>)}</ul>
        </section>}

        <section>
          <h3><RouteIcon size={14} />Chennai route finder</h3>
          <div className="km-searchrow"><Search size={16} /><input value={query} onChange={(e) => void runRouteSearch(e.target.value)} placeholder="Route number or place — e.g. 29A, Tambaram" aria-label="Search Chennai bus routes" /></div>
          <ul className="km-stop-pick">{routeHits.map(({ idx, r }) => <li key={idx}><button onClick={() => showRoute(r)} className={activeRoute === r ? "active" : ""}><span><b>{r.n}</b> {r.l}</span><em>{r.s.length} stops</em></button></li>)}</ul>
          {activeRoute && <div className="km-route-detail">
            <p className="km-hint"><b>{activeRoute.n}</b> · first bus {fmtClock(activeRoute.t[0])} · last {fmtClock(activeRoute.t[activeRoute.t.length - 1])} · {activeRoute.t.length} trips a day · ~{activeRoute.o[activeRoute.o.length - 1]} min end to end.</p>
            {nextStarts.length > 0 && <p className="km-hint">Next from the first stop: {nextStarts.map((t) => fmtClock(t)).join(" · ")}</p>}
            <ol className="km-route-stops">{routeStops.map((s, i) => <li key={i}><span>{s.name}</span><em>+{s.off} min</em></li>)}</ol>
            <button className="km-secondary" onClick={() => setActiveRoute(null)}>Hide route</button>
          </div>}
          {data && <p className="km-hint km-credit-line">Data: {data.attribution}. Straight lines between stops, not the exact road path.</p>}
        </section>
      </>}

      {tab === "train" && <>
        <section>
          <h3>Live train running status</h3>
          <form className="km-searchrow" onSubmit={(e) => { e.preventDefault(); void lookupTrain(); }}>
            <Train size={16} /><input value={trainNo} onChange={(e) => setTrainNo(e.target.value)} placeholder="Train number — e.g. 12627" inputMode="numeric" aria-label="Train number" />
            <button type="submit" className="km-go" disabled={trainLoading || !trainNo.trim()}>{trainLoading ? <span className="search-spinner" /> : "Go"}</button>
          </form>
          {trainError && <p className="km-note">{trainError}</p>}
          <p className="km-hint">Free RailRadar plan ≈ 100 lookups a month, so results are cached for 5 minutes. Needs <code>RAILRADAR_API_KEY</code>.</p>
        </section>
        {train && <section>
          <h3>{train.train.number} {train.train.name}</h3>
          <p className="km-hint">{train.train.from?.name} → {train.train.to?.name}{train.train.type ? ` · ${train.train.type}` : ""}</p>
          <div className="km-train-status" data-late={(train.delayMinutes ?? 0) > 15 ? "late" : "ok"}>
            <strong>{train.runStatus || "—"}</strong>
            <span>{train.delayMinutes === undefined ? "" : train.delayMinutes <= 0 ? "On time" : `${train.delayMinutes} min late`}</span>
          </div>
          <dl>
            <div><dt>Now</dt><dd>{train.currentLocation?.stationName || "—"}{train.currentLocation?.status ? ` (${train.currentLocation.status})` : ""}</dd></div>
            <div><dt>Next halt</dt><dd>{train.nextHalt?.stationName || "—"}</dd></div>
            <div><dt>Speed</dt><dd>{train.currentLocation?.speedKmh ?? "—"} km/h</dd></div>
            <div><dt>Data</dt><dd>{train.isLive ? "live" : "schedule only"}{train.cached ? " · cached" : ""}</dd></div>
          </dl>
          {train.exceptions && train.exceptions.length > 0 && <p className="km-note">{train.exceptions.map((x) => x.description || x.type).join("; ")}</p>}
          <ol className="km-route-stops km-train-stops">{train.route.map((s) => <li key={s.seq} data-status={s.status}><span>{s.name}<small>{s.code}{s.platform ? ` · PF ${s.platform}` : ""}</small></span><em>{hhmm(s.actDep || s.actArr || s.schDep || s.schArr)}{s.delay ? <small>{s.delay > 0 ? `+${s.delay}` : s.delay} min</small> : null}</em></li>)}</ol>
          <p className="km-hint">Updated {train.lastUpdatedAt ? hhmm(train.lastUpdatedAt) : "—"}. Source: RailRadar (independent, not official Indian Railways).</p>
        </section>}
      </>}
    </div>
  </aside>;
}
