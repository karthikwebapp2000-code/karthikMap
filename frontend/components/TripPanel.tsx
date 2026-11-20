"use client";

import { Bell, Circle, Download, MapPin, Navigation, Pause, Play, Plus, Square, Trash2, X } from "lucide-react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource } from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { acceptFix, bearing, circlePolygon, distM, fmtDist, fmtDuration, geofenceEvents, toGpx, trackStats, type GeoEvent, type Geofence, type LngLat, type TrackPoint } from "@/lib/geo";
import { idbAll, idbDelete, idbPut } from "@/lib/idb";
import { buzz, speak } from "@/lib/speak";
import { useSettings } from "@/lib/settings";
import { loadWorkLocations, download, newId } from "@/lib/work";

type Trip = { id: string; name: string; start: number; end: number; points: TrackPoint[]; events: GeoEvent[] };
type Tab = "record" | "fences" | "alarms" | "history";
type Hazard = { id: number; kind: string; lat: number; lng: number; dist: number };
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const FENCE_KEY = "karthikmap:geofences";
const ALARM_KEY = "karthikmap:alarms";
const COLORS = ["#0a84ff", "#30d158", "#ff9f0a", "#ff375f", "#bf5af2", "#64d2ff"];

const loadJson = <T,>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(k) || "") as T; } catch { return d; } };
const saveJson = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

function at(points: TrackPoint[], t: number): { p: LngLat; i: number } {
  if (t <= points[0].t) return { p: [points[0].lng, points[0].lat], i: 0 };
  let lo = 0, hi = points.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (points[mid].t <= t) lo = mid; else hi = mid; }
  const a = points[lo], b = points[hi], f = b.t === a.t ? 0 : Math.min(1, (t - a.t) / (b.t - a.t));
  return { p: [a.lng + (b.lng - a.lng) * f, a.lat + (b.lat - a.lat) * f], i: lo };
}

type Props = { mapRef: React.RefObject<maplibregl.Map | null>; mapReady: boolean; open: boolean; onClose: () => void };

export default function TripPanel({ mapRef, mapReady, open, onClose }: Props) {
  const settings = useSettings();
  const [tab, setTab] = useState<Tab>("record");
  const [state, setState] = useState<"idle" | "recording" | "paused">("idle");
  const [points, setPoints] = useState<TrackPoint[]>([]);
  const [live, setLive] = useState<{ kmh: number; heading: number | null; acc: number | null; maxspeed?: number; road?: string } | null>(null);
  const [follow, setFollow] = useState(true);
  const [fences, setFences] = useState<Geofence[]>([]);
  const [monitor, setMonitor] = useState(true);
  const [alarms, setAlarms] = useState<GeoEvent[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [banner, setBanner] = useState<GeoEvent | null>(null);
  const [error, setError] = useState("");
  const [filterRange, setFilterRange] = useState<"today" | "week" | "all">("today");
  const [filterSev, setFilterSev] = useState<"all" | GeoEvent["severity"]>("all");
  const [newFenceSite, setNewFenceSite] = useState("");
  const [newRadius, setNewRadius] = useState(150);
  // playback
  const [play, setPlay] = useState<{ trip: Trip; t: number; playing: boolean; speed: number } | null>(null);

  const stateRef = useRef(state); stateRef.current = state;
  const pointsRef = useRef<TrackPoint[]>([]);
  const eventsRef = useRef<GeoEvent[]>([]);
  const insideRef = useRef<Record<string, boolean>>({});
  const fencesRef = useRef<Geofence[]>([]); fencesRef.current = fences;
  const followRef = useRef(follow); followRef.current = follow;
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const hazardsRef = useRef<Hazard[]>([]);
  const alertedRef = useRef<Record<string, number>>({});
  const roadRef = useRef<{ at: number; lat: number; lng: number; maxspeed?: number; road?: string }>({ at: 0, lat: 0, lng: 0 });
  const wakeRef = useRef<WakeLockSentinel | null>(null);
  const startRef = useRef(0);
  const needWatch = state !== "idle" || (monitor && fences.length > 0);

  useEffect(() => { setFences(loadJson<Geofence[]>(FENCE_KEY, [])); setAlarms(loadJson<GeoEvent[]>(ALARM_KEY, [])); void idbAll<Trip>("trips").then((t) => setTrips(t.sort((a, b) => b.start - a.start))); }, []);
  useEffect(() => { saveJson(FENCE_KEY, fences); }, [fences]);

  const pushEvent = useCallback((e: GeoEvent, say?: string) => {
    eventsRef.current.push(e);
    setAlarms((a) => { const n = [e, ...a].slice(0, 300); saveJson(ALARM_KEY, n); return n; });
    if (e.severity !== "info" || e.kind === "enter" || e.kind === "exit") { setBanner(e); window.setTimeout(() => setBanner((b) => (b?.id === e.id ? null : b)), 6000); }
    if (say) speak(say, e.severity === "critical"); if (e.severity !== "info") buzz();
  }, []);

  // ───────── map layers ─────────
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || map.getSource("km-trip-source")) return;
    map.addSource("km-fence-source", { type: "geojson", data: EMPTY });
    map.addSource("km-trip-source", { type: "geojson", data: EMPTY });
    map.addSource("km-trip-marker", { type: "geojson", data: EMPTY });
    map.addLayer({ id: "km-fence-fill", type: "fill", source: "km-fence-source", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.16 } });
    map.addLayer({ id: "km-fence-line", type: "line", source: "km-fence-source", paint: { "line-color": ["get", "color"], "line-width": 2, "line-dasharray": [2, 1.5] } });
    map.addLayer({ id: "km-trip-casing", type: "line", source: "km-trip-source", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#fff", "line-width": 9, "line-opacity": 0.9 } });
    map.addLayer({ id: "km-trip-line", type: "line", source: "km-trip-source", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#30d158", "line-width": 5.5 } });
    map.addLayer({ id: "km-trip-dot", type: "circle", source: "km-trip-marker", paint: { "circle-radius": 9, "circle-color": "#30d158", "circle-stroke-color": "#fff", "circle-stroke-width": 3.5 } });
  }, [mapReady, mapRef]);
  useEffect(() => {
    (mapRef.current?.getSource("km-fence-source") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: fences.map((f) => ({ type: "Feature", properties: { color: f.color }, geometry: { type: "Polygon", coordinates: [circlePolygon([f.lng, f.lat], f.radius)] } })) });
  }, [mapRef, fences, mapReady]);
  const shownPoints = play ? play.trip.points : points;
  useEffect(() => {
    (mapRef.current?.getSource("km-trip-source") as GeoJSONSource | undefined)?.setData(shownPoints.length > 1 ? { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: shownPoints.map((p) => [p.lng, p.lat]) } } : EMPTY);
  }, [mapRef, shownPoints, mapReady]);
  useEffect(() => () => {
    const map = mapRef.current;
    if (!map || !map.getStyle()) return;
    map.getStyle().layers.filter((l) => l.id.startsWith("km-fence") || l.id.startsWith("km-trip")).forEach((l) => map.removeLayer(l.id));
    ["km-fence-source", "km-trip-source", "km-trip-marker"].forEach((s) => map.getSource(s) && map.removeSource(s));
  }, [mapRef]);

  // ───────── GPS engine ─────────
  const onFix = useCallback((pos: GeolocationPosition) => {
    const c = pos.coords, t = pos.timestamp || Date.now();
    const p: TrackPoint = { lng: c.longitude, lat: c.latitude, t, speed: c.speed, acc: c.accuracy, alt: c.altitude };
    const last = pointsRef.current[pointsRef.current.length - 1];
    const ok = acceptFix(last, p);
    const kmh = c.speed != null && c.speed >= 0 ? c.speed * 3.6 : last ? (distM([last.lng, last.lat], [p.lng, p.lat]) / Math.max(1, (t - last.t) / 1000)) * 3.6 : 0;
    const heading = c.heading != null && !Number.isNaN(c.heading) ? c.heading : last && ok ? bearing([last.lng, last.lat], [p.lng, p.lat]) : null;
    setLive((l) => ({ kmh: Math.round(ok ? kmh : l?.kmh ?? 0), heading, acc: Math.round(c.accuracy), maxspeed: roadRef.current.maxspeed, road: roadRef.current.road }));
    if (!ok) return;
    const s = settingsRef.current;
    // geofences work whenever monitoring is on
    const res = geofenceEvents(fencesRef.current, insideRef.current, [p.lng, p.lat], t);
    insideRef.current = res.inside;
    res.events.forEach((e) => pushEvent(e, e.text));
    if (stateRef.current !== "recording") return;
    pointsRef.current.push(p); setPoints([...pointsRef.current]);
    (mapRef.current?.getSource("km-trip-marker") as GeoJSONSource | undefined)?.setData({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [p.lng, p.lat] } });
    if (followRef.current && mapRef.current) mapRef.current.easeTo({ center: [p.lng, p.lat], zoom: Math.max(mapRef.current.getZoom(), 16.3), pitch: 55, bearing: kmh > 4 && heading != null ? heading : mapRef.current.getBearing(), duration: 900, easing: (x) => x });
    // speed alerts
    const limit = roadRef.current.maxspeed;
    const over = (s.speedAlert > 0 && kmh > s.speedAlert) || (limit && kmh > limit + 5);
    if (over && t - (alertedRef.current.speed || 0) > 30_000) {
      alertedRef.current.speed = t;
      const ref = limit && kmh > limit + 5 ? limit : s.speedAlert;
      pushEvent({ id: `sp:${t}`, at: t, kind: "overspeed", severity: kmh > ref * 1.2 ? "critical" : "warning", text: `Over speed: ${Math.round(kmh)} km/h${limit ? ` (limit ${limit})` : ""}`, lat: p.lat, lng: p.lng }, "Slow down. You are over the speed limit.");
    }
    // road context (speed limit + hazards) every 25 s while moving
    const rc = roadRef.current;
    if (kmh > 6 && t - rc.at > 25_000) {
      roadRef.current = { ...rc, at: t };
      fetch(`/api/v1/roads/context?lat=${p.lat}&lng=${p.lng}`).then((r) => r.json()).then((d) => {
        if (d.status !== "OK") return;
        roadRef.current = { at: Date.now(), lat: p.lat, lng: p.lng, maxspeed: d.maxspeed, road: d.road };
        hazardsRef.current = d.hazards || [];
      }).catch(() => undefined);
    }
    const heading2 = heading ?? 0;
    for (const h of hazardsRef.current) {
      const d = distM([p.lng, p.lat], [h.lng, h.lat]);
      const diff = Math.abs(((bearing([p.lng, p.lat], [h.lng, h.lat]) - heading2 + 540) % 360) - 180);
      if (d < 160 && diff < 60 && kmh > 5 && t - (alertedRef.current[`h${h.id}`] || 0) > 180_000) {
        alertedRef.current[`h${h.id}`] = t;
        pushEvent({ id: `hz:${h.id}:${t}`, at: t, kind: "hazard", severity: "warning", text: `${h.kind} ahead in ${Math.round(d / 10) * 10} m`, lat: h.lat, lng: h.lng }, `${h.kind} ahead`);
      }
    }
  }, [mapRef, pushEvent]);

  useEffect(() => {
    if (!needWatch || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(onFix, (e) => setError(e.code === e.PERMISSION_DENIED ? "Location is blocked for this site — allow it in the browser to record trips." : "Waiting for a GPS fix…"), { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 });
    return () => navigator.geolocation.clearWatch(id);
  }, [needWatch, onFix]);

  const start = async () => {
    setError(""); pointsRef.current = []; eventsRef.current = []; insideRef.current = {}; alertedRef.current = {}; hazardsRef.current = []; roadRef.current = { at: 0, lat: 0, lng: 0 };
    setPoints([]); setPlay(null); startRef.current = Date.now(); setState("recording");
    try { wakeRef.current = (await navigator.wakeLock?.request("screen")) ?? null; } catch { /* optional */ }
    pushEvent({ id: `st:${Date.now()}`, at: Date.now(), kind: "start", severity: "info", text: "Trip started" }, "Trip started");
  };
  const finish = async () => {
    setState("idle"); wakeRef.current?.release().catch(() => undefined); wakeRef.current = null;
    const pts = pointsRef.current;
    pushEvent({ id: `sp:${Date.now()}`, at: Date.now(), kind: "stop", severity: "info", text: "Trip finished" });
    if (pts.length > 2) {
      const trip: Trip = { id: `trip_${Date.now().toString(36)}`, name: `Trip · ${new Date(startRef.current).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`, start: startRef.current, end: Date.now(), points: pts, events: eventsRef.current };
      await idbPut("trips", trip); setTrips((t) => [trip, ...t]); setTab("history");
    }
  };
  useEffect(() => () => { wakeRef.current?.release().catch(() => undefined); }, []);

  // playback loop
  useEffect(() => {
    if (!play?.playing) return;
    const id = window.setInterval(() => setPlay((p) => {
      if (!p) return p;
      const end = p.trip.points[p.trip.points.length - 1].t;
      const t = p.t + 100 * p.speed;
      return t >= end ? { ...p, t: end, playing: false } : { ...p, t };
    }), 100);
    return () => window.clearInterval(id);
  }, [play?.playing]);
  useEffect(() => {
    const map = mapRef.current;
    if (!play || !map) { (map?.getSource("km-trip-marker") as GeoJSONSource | undefined)?.setData(EMPTY); return; }
    const { p } = at(play.trip.points, play.t);
    (map.getSource("km-trip-marker") as GeoJSONSource | undefined)?.setData({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: p } });
    if (play.playing) map.easeTo({ center: p, duration: 120, easing: (x) => x });
  }, [play, mapRef]);

  const openTrip = (trip: Trip) => {
    setPlay({ trip, t: trip.points[0].t, playing: false, speed: 4 });
    const b = trip.points.reduce((bb, p) => bb.extend([p.lng, p.lat]), new maplibregl.LngLatBounds([trip.points[0].lng, trip.points[0].lat], [trip.points[0].lng, trip.points[0].lat]));
    mapRef.current?.fitBounds(b, { padding: { top: 90, bottom: 90, left: 60, right: 420 }, duration: 900, pitch: 0 });
  };

  const addFence = (lat: number, lng: number, name: string) => setFences((f) => [...f, { id: newId(), name, lat, lng, radius: newRadius, color: COLORS[f.length % COLORS.length], onEnter: true, onExit: true }]);
  const sites = useMemo(() => (open ? loadWorkLocations() : []), [open]);

  const cur = points.length ? trackStats(points) : null;
  const filteredAlarms = alarms.filter((a) => (filterSev === "all" || a.severity === filterSev) && (filterRange === "all" || Date.now() - a.at < (filterRange === "today" ? 86_400_000 : 7 * 86_400_000)));
  const units = settings.units;
  const sevColor = (s: GeoEvent["severity"]) => (s === "critical" ? "var(--danger)" : s === "warning" ? "var(--warn)" : "var(--accent)");

  return <>
    {banner && <div className="km-alert-banner" role="alert" style={{ ["--c" as string]: sevColor(banner.severity) }}><Bell size={16} /><span>{banner.text}</span></div>}
    {state !== "idle" && !open && live && <div className="km-speedo" aria-label="Current speed"><b>{live.kmh}</b><small>km/h</small>{live.maxspeed ? <i className="km-limit">{live.maxspeed}</i> : null}</div>}
    {open && <aside className="km-panel" aria-label="Trips">
      <header><div><Navigation size={18} /><strong>Trips</strong>{state !== "idle" && <span className="km-live-badge"><span className="km-live-dot" />REC</span>}</div><button onClick={onClose} aria-label="Close trips"><X size={17} /></button></header>
      <div className="km-tabs" role="tablist">{([["record", "Record"], ["fences", "Geofences"], ["alarms", `Alarms${alarms.length ? ` (${alarms.length})` : ""}`], ["history", "History"]] as const).map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}</div>
      <div className="km-body">
        {error && <p className="km-note">{error}</p>}
        {tab === "record" && <>
          <section className="km-trip-hud">
            <div className="km-big-speed"><b>{live ? live.kmh : 0}</b><small>km/h</small>{live?.maxspeed ? <i className="km-limit" title="Speed limit (OpenStreetMap)">{live.maxspeed}</i> : null}</div>
            <p className="km-hint">{live?.road ? `${live.road} · ` : ""}{live?.acc != null ? `GPS ±${live.acc} m` : "Waiting for GPS…"}{live?.heading != null ? ` · ${Math.round(live.heading)}°` : ""}</p>
            <dl>
              <div><dt>Distance</dt><dd>{fmtDist(cur?.distanceM ?? 0, units)}</dd></div>
              <div><dt>Time</dt><dd>{fmtDuration(cur?.durationS ?? 0)}</dd></div>
              <div><dt>Average</dt><dd>{Math.round(cur?.avgKmh ?? 0)} km/h</dd></div>
              <div><dt>Top speed</dt><dd>{Math.round(cur?.maxKmh ?? 0)} km/h</dd></div>
            </dl>
            <div className="km-actions">
              {state === "idle" && <button className="km-primary" onClick={() => void start()}><Play size={15} />Start trip</button>}
              {state === "recording" && <button className="km-secondary" onClick={() => setState("paused")}><Pause size={15} />Pause</button>}
              {state === "paused" && <button className="km-primary" onClick={() => setState("recording")}><Play size={15} />Resume</button>}
              {state !== "idle" && <button className="km-secondary km-danger" onClick={() => void finish()}><Square size={14} />Finish</button>}
            </div>
            <label className="toggle-row"><span>Follow &amp; tilt camera</span><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /></label>
            <p className="km-hint">Keep this page open and the screen on — browsers pause GPS when the screen is off (a wake-lock is requested while recording). Speed limits and bump/camera warnings come from OpenStreetMap and may be missing on some roads. Over-speed alert: {settings.speedAlert ? `${settings.speedAlert} km/h` : "off"} (Settings).</p>
          </section>
        </>}

        {tab === "fences" && <>
          <section>
            <h3>New geofence</h3>
            <label className="range-row"><span>Radius <b>{newRadius} m</b></span><input type="range" min="30" max="1500" step="10" value={newRadius} onChange={(e) => setNewRadius(Number(e.target.value))} /></label>
            <select value={newFenceSite} onChange={(e) => setNewFenceSite(e.target.value)} aria-label="Saved work location">
              <option value="">Choose a saved work location…</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <div className="km-actions">
              <button className="km-primary" disabled={!newFenceSite} onClick={() => { const s = sites.find((x) => x.id === newFenceSite); if (s) addFence(s.lat, s.lng, s.name); }}><Plus size={14} />Around site</button>
              <button className="km-secondary" onClick={() => { const c = mapRef.current?.getCenter(); if (c) addFence(c.lat, c.lng, `Zone ${fences.length + 1}`); }}><MapPin size={14} />At map centre</button>
            </div>
            <label className="toggle-row"><span>Alert me while the app is open</span><input type="checkbox" checked={monitor} onChange={(e) => setMonitor(e.target.checked)} /></label>
          </section>
          <section>
            <h3>Your geofences <small>({fences.length})</small></h3>
            {fences.length === 0 && <p className="km-hint">Add a ring around an office, site or depot. You get a spoken and on-screen alert when you arrive or leave.</p>}
            <ul className="km-loc-list">{fences.map((f) => <li key={f.id}>
              <div className="km-loc-head"><i style={{ background: f.color }} /><button className="km-loc-name" onClick={() => mapRef.current?.flyTo({ center: [f.lng, f.lat], zoom: 15.5, duration: 900 })}><strong>{f.name}</strong><small>{f.radius} m · {insideRef.current[f.id] ? "you are inside" : "outside"}</small></button></div>
              <div className="km-loc-tools">
                <input type="range" min="30" max="1500" step="10" value={f.radius} onChange={(e) => setFences((a) => a.map((x) => (x.id === f.id ? { ...x, radius: Number(e.target.value) } : x)))} aria-label={`Radius of ${f.name}`} />
                <input type="color" value={f.color} onChange={(e) => setFences((a) => a.map((x) => (x.id === f.id ? { ...x, color: e.target.value } : x)))} aria-label="Colour" className="km-color" />
                <button onClick={() => setFences((a) => a.filter((x) => x.id !== f.id))} aria-label={`Delete ${f.name}`}><Trash2 size={14} /></button>
              </div>
            </li>)}</ul>
          </section>
        </>}

        {tab === "alarms" && <>
          <section>
            <div className="mode-segment">{(["today", "week", "all"] as const).map((r) => <button key={r} className={filterRange === r ? "active" : ""} onClick={() => setFilterRange(r)}>{r === "today" ? "24 h" : r === "week" ? "7 days" : "All"}</button>)}</div>
            <div className="mode-segment">{(["all", "info", "warning", "critical"] as const).map((r) => <button key={r} className={filterSev === r ? "active" : ""} onClick={() => setFilterSev(r)}>{r}</button>)}</div>
            {filteredAlarms.length === 0 ? <p className="km-hint">No alarms in this range.</p> :
              <ul className="km-alarms">{filteredAlarms.map((a) => <li key={a.id} style={{ ["--c" as string]: sevColor(a.severity) }}><i /><span><strong>{a.text}</strong><small>{new Date(a.at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {a.severity}</small></span>{a.lat != null && a.lng != null && <button aria-label="Show on map" onClick={() => mapRef.current?.flyTo({ center: [a.lng as number, a.lat as number], zoom: 16, duration: 800 })}><MapPin size={14} /></button>}</li>)}</ul>}
            <div className="km-actions"><button className="km-secondary" onClick={() => { setAlarms([]); saveJson(ALARM_KEY, []); }} disabled={!alarms.length}>Clear log</button></div>
          </section>
        </>}

        {tab === "history" && <>
          {play && <section className="km-focus-card">
            <h3>{play.trip.name}</h3>
            <div className="km-player">
              <button onClick={() => setPlay((p) => (p ? { ...p, playing: !p.playing, t: p.t >= p.trip.points[p.trip.points.length - 1].t ? p.trip.points[0].t : p.t } : p))} aria-label={play.playing ? "Pause" : "Play"}>{play.playing ? <Pause size={16} /> : <Play size={16} />}</button>
              <input type="range" min={play.trip.points[0].t} max={play.trip.points[play.trip.points.length - 1].t} value={play.t} onChange={(e) => setPlay((p) => (p ? { ...p, t: Number(e.target.value), playing: false } : p))} aria-label="Playback position" />
            </div>
            <div className="mode-segment">{[1, 4, 10, 30].map((x) => <button key={x} className={play.speed === x ? "active" : ""} onClick={() => setPlay((p) => (p ? { ...p, speed: x } : p))}>{x}×</button>)}</div>
            <p className="km-hint">{(() => { const { i } = at(play.trip.points, play.t); const pt = play.trip.points[i]; const sp = pt.speed != null && pt.speed >= 0 ? Math.round(pt.speed * 3.6) : null; return `${new Date(play.t).toLocaleTimeString()}${sp != null ? ` · ${sp} km/h` : ""}`; })()}</p>
            <ul className="km-alarms">{play.trip.events.filter((e) => e.kind !== "start" && e.kind !== "stop").slice(0, 8).map((e) => <li key={e.id} style={{ ["--c" as string]: sevColor(e.severity) }}><i /><span><strong>{e.text}</strong><small>{new Date(e.at).toLocaleTimeString()}</small></span></li>)}</ul>
            <div className="km-actions"><button className="km-secondary" onClick={() => setPlay(null)}>Close playback</button></div>
          </section>}
          <section>
            <h3>Past trips <small>({trips.length})</small></h3>
            {trips.length === 0 && <p className="km-hint">Finish a recorded trip and it appears here for playback and export.</p>}
            <ul className="km-loc-list">{trips.map((t) => { const s = trackStats(t.points); return <li key={t.id}>
              <div className="km-loc-head"><Circle size={10} fill="var(--ok)" color="var(--ok)" style={{ marginTop: 5, flex: "none" }} /><button className="km-loc-name" onClick={() => openTrip(t)}><strong>{t.name}</strong><small>{fmtDist(s.distanceM, units)} · {fmtDuration(s.durationS)} · avg {Math.round(s.avgKmh)} · top {Math.round(s.maxKmh)} km/h · {t.events.filter((e) => e.severity !== "info").length} alerts</small></button></div>
              <div className="km-loc-tools"><button onClick={() => download(`${t.name}.gpx`, toGpx(t.name, t.points), "application/gpx+xml")} aria-label="Export GPX"><Download size={14} /></button><button onClick={async () => { await idbDelete("trips", t.id); setTrips((x) => x.filter((y) => y.id !== t.id)); if (play?.trip.id === t.id) setPlay(null); }} aria-label={`Delete ${t.name}`}><Trash2 size={14} /></button></div>
            </li>; })}</ul>
          </section>
        </>}
      </div>
    </aside>}
  </>;
}
