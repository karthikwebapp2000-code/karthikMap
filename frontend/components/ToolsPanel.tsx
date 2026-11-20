"use client";

import { Crosshair, Download, Eye, EyeOff, FileUp, Redo2, Ruler, Save, Trash2, Undo2, X } from "lucide-react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource } from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { boundsOf, parseGeoFile } from "@/lib/geofiles";
import { distM, fmtArea, fmtDist, lineLengthM, polygonAreaM2, toGpx, type LngLat } from "@/lib/geo";
import { idbAll, idbDelete, idbPut } from "@/lib/idb";
import { download } from "@/lib/work";

type Mode = "path" | "area";
type Saved = { id: string; kind: "measure" | "overlay"; name: string; mode?: Mode; points?: LngLat[]; geojson?: GeoJSON.FeatureCollection; at: number };
type Elev = { d: number; e: number }[];
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

type Props = { mapRef: React.RefObject<maplibregl.Map | null>; mapReady: boolean; open: boolean; units: "km" | "mi"; onClose: () => void };

async function elevationAlong(points: LngLat[], signal: AbortSignal): Promise<Elev> {
  const total = lineLengthM(points);
  const n = Math.min(80, Math.max(2, Math.ceil(total / 25) + 1));
  const samples: Array<{ p: LngLat; d: number }> = [];
  let acc = 0, seg = 0;
  for (let i = 0; i < n; i++) {
    const target = (total * i) / (n - 1);
    while (seg < points.length - 2 && acc + distM(points[seg], points[seg + 1]) < target) { acc += distM(points[seg], points[seg + 1]); seg++; }
    const len = distM(points[seg], points[seg + 1]) || 1;
    const t = Math.min(1, Math.max(0, (target - acc) / len));
    samples.push({ d: target, p: [points[seg][0] + (points[seg + 1][0] - points[seg][0]) * t, points[seg][1] + (points[seg + 1][1] - points[seg][1]) * t] });
  }
  const url = `https://api.open-meteo.com/v1/elevation?latitude=${samples.map((s) => s.p[1].toFixed(5)).join(",")}&longitude=${samples.map((s) => s.p[0].toFixed(5)).join(",")}`;
  const res = await fetch(url, { signal });
  const json = await res.json();
  if (!res.ok || !Array.isArray(json.elevation)) throw new Error(json.reason || "Elevation service unavailable");
  return samples.map((s, i) => ({ d: s.d, e: json.elevation[i] }));
}

export default function ToolsPanel({ mapRef, mapReady, open, units, onClose }: Props) {
  const [mode, setMode] = useState<Mode>("path");
  const [points, setPoints] = useState<LngLat[]>([]);
  const [redo, setRedo] = useState<LngLat[]>([]);
  const [elev, setElev] = useState<Elev | null>(null);
  const [elevErr, setElevErr] = useState("");
  const [saved, setSaved] = useState<Saved[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { void idbAll<Saved>("measures").then((l) => setSaved(l.sort((a, b) => b.at - a.at))); }, []);
  const flash = (m: string) => { setMsg(m); window.setTimeout(() => setMsg((x) => (x === m ? "" : x)), 3000); };

  // map layers
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || map.getSource("km-measure-source")) return;
    map.addSource("km-import-source", { type: "geojson", data: EMPTY });
    map.addSource("km-measure-source", { type: "geojson", data: EMPTY });
    map.addLayer({ id: "km-import-fill", type: "fill", source: "km-import-source", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#bf5af2", "fill-opacity": 0.2 } });
    map.addLayer({ id: "km-import-line", type: "line", source: "km-import-source", filter: ["any", ["==", ["geometry-type"], "LineString"], ["==", ["geometry-type"], "Polygon"]], paint: { "line-color": "#bf5af2", "line-width": 3 } });
    map.addLayer({ id: "km-import-pts", type: "circle", source: "km-import-source", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 6, "circle-color": "#bf5af2", "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
    map.addLayer({ id: "km-measure-fill", type: "fill", source: "km-measure-source", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#ffd60a", "fill-opacity": 0.25 } });
    map.addLayer({ id: "km-measure-line", type: "line", source: "km-measure-source", filter: ["any", ["==", ["geometry-type"], "LineString"], ["==", ["geometry-type"], "Polygon"]], layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#ffd60a", "line-width": 3.5 } });
    map.addLayer({ id: "km-measure-pts", type: "circle", source: "km-measure-source", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 6, "circle-color": "#ffd60a", "circle-stroke-color": "#fff", "circle-stroke-width": 2.5 } });
  }, [mapReady, mapRef]);

  const measureFc = useMemo<GeoJSON.FeatureCollection>(() => {
    const f: GeoJSON.Feature[] = points.map((p) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: p } }));
    if (mode === "area" && points.length >= 3) f.unshift({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...points, points[0]]] } });
    else if (points.length >= 2) f.unshift({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: points } });
    return { type: "FeatureCollection", features: f };
  }, [points, mode]);
  useEffect(() => { (mapRef.current?.getSource("km-measure-source") as GeoJSONSource | undefined)?.setData(measureFc); }, [mapRef, measureFc, mapReady]);

  const overlayFc = useMemo<GeoJSON.FeatureCollection>(() => ({ type: "FeatureCollection", features: saved.filter((s) => s.kind === "overlay" && !hidden.has(s.id)).flatMap((s) => s.geojson?.features || []) }), [saved, hidden]);
  useEffect(() => { (mapRef.current?.getSource("km-import-source") as GeoJSONSource | undefined)?.setData(overlayFc); }, [mapRef, overlayFc, mapReady]);

  // elevation profile (path mode)
  useEffect(() => {
    setElev(null); setElevErr("");
    if (mode !== "path" || points.length < 2 || lineLengthM(points) < 20) return;
    const ctrl = new AbortController();
    const t = window.setTimeout(() => { elevationAlong(points, ctrl.signal).then(setElev).catch((e) => { if (e.name !== "AbortError") setElevErr(e.message || "Elevation unavailable"); }); }, 500);
    return () => { window.clearTimeout(t); ctrl.abort(); };
  }, [points, mode]);

  useEffect(() => () => {
    const map = mapRef.current;
    if (!map || !map.getStyle()) return;
    map.getStyle().layers.filter((l) => l.id.startsWith("km-measure") || l.id.startsWith("km-import")).forEach((l) => map.removeLayer(l.id));
    ["km-measure-source", "km-import-source"].forEach((s) => map.getSource(s) && map.removeSource(s));
  }, [mapRef]);

  const addPoint = useCallback(() => { const c = mapRef.current?.getCenter(); if (c) { setPoints((p) => [...p, [c.lng, c.lat]]); setRedo([]); } }, [mapRef]);
  const undo = () => setPoints((p) => { if (!p.length) return p; setRedo((r) => [...r, p[p.length - 1]]); return p.slice(0, -1); });
  const redoPt = () => setRedo((r) => { if (!r.length) return r; setPoints((p) => [...p, r[r.length - 1]]); return r.slice(0, -1); });

  const length = lineLengthM(points);
  const perimeter = mode === "area" && points.length > 2 ? length + distM(points[points.length - 1], points[0]) : length;
  const area = mode === "area" ? polygonAreaM2(points) : 0;
  const stats = useMemo(() => {
    if (!elev || elev.length < 2) return null;
    let gain = 0, loss = 0;
    for (let i = 1; i < elev.length; i++) { const d = elev[i].e - elev[i - 1].e; if (d > 0) gain += d; else loss -= d; }
    return { min: Math.min(...elev.map((x) => x.e)), max: Math.max(...elev.map((x) => x.e)), gain, loss };
  }, [elev]);

  const save = async () => {
    if (points.length < 2) return;
    const rec: Saved = { id: `m_${Date.now().toString(36)}`, kind: "measure", name: `${mode === "area" ? "Area" : "Path"} · ${new Date().toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`, mode, points, at: Date.now() };
    await idbPut("measures", rec); setSaved((s) => [rec, ...s]); flash("Saved");
  };
  const remove = async (id: string) => { await idbDelete("measures", id); setSaved((s) => s.filter((x) => x.id !== id)); };
  const load = (s: Saved) => {
    if (s.kind === "measure" && s.points) { setMode(s.mode || "path"); setPoints(s.points); const b = s.points.reduce((bb, p) => bb.extend(p), new maplibregl.LngLatBounds(s.points[0], s.points[0])); mapRef.current?.fitBounds(b, { padding: 90, duration: 900, maxZoom: 18 }); }
    if (s.kind === "overlay" && s.geojson) { const b = boundsOf(s.geojson); if (b) mapRef.current?.fitBounds(b, { padding: 90, duration: 900, maxZoom: 17 }); }
  };
  const exportGeo = (s: { name: string; mode?: Mode; points?: LngLat[] }, fmt: "geojson" | "gpx") => {
    const pts = s.points || points; if (pts.length < 2) return;
    if (fmt === "gpx") download(`${s.name}.gpx`, toGpx(s.name, pts.map((p, i) => ({ lng: p[0], lat: p[1], t: Date.now() + i * 1000 }))), "application/gpx+xml");
    else download(`${s.name}.geojson`, JSON.stringify({ type: "Feature", properties: { name: s.name, mode: s.mode }, geometry: s.mode === "area" ? { type: "Polygon", coordinates: [[...pts, pts[0]]] } : { type: "LineString", coordinates: pts } }, null, 2), "application/geo+json");
  };
  const importFile = async (file: File) => {
    try {
      const fc = await parseGeoFile(file);
      const rec: Saved = { id: `o_${Date.now().toString(36)}`, kind: "overlay", name: file.name.replace(/\.[^.]+$/, ""), geojson: fc, at: Date.now() };
      await idbPut("measures", rec); setSaved((s) => [rec, ...s]); load(rec); flash(`Imported ${fc.features.length} feature${fc.features.length === 1 ? "" : "s"}`);
    } catch (e) { flash(e instanceof Error ? e.message : "Could not read that file"); }
  };

  if (!open) return null;
  const chart = (() => {
    if (!elev || elev.length < 2) return null;
    const W = 320, H = 100, min = Math.min(...elev.map((x) => x.e)), max = Math.max(...elev.map((x) => x.e)), span = Math.max(max - min, 1), dmax = elev[elev.length - 1].d || 1;
    const xy = elev.map((p) => `${((p.d / dmax) * W).toFixed(1)},${(H - ((p.e - min) / span) * (H - 12) - 6).toFixed(1)}`);
    return <svg viewBox={`0 0 ${W} ${H}`} className="km-elev" role="img" aria-label="Elevation profile"><path d={`M0,${H} L${xy.join(" L")} L${W},${H}Z`} fill="var(--accent-soft)" /><polyline points={xy.join(" ")} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" /></svg>;
  })();

  return <>
    <div className="km-crosshair" aria-hidden="true"><Crosshair size={30} /></div>
    <aside className="km-panel km-tools" aria-label="Measure">
      <header><div><Ruler size={18} /><strong>Measure</strong></div><button onClick={onClose} aria-label="Close measure"><X size={17} /></button></header>
      {msg && <p className="km-toast" role="status">{msg}</p>}
      <div className="km-body">
        <section>
          <div className="mode-segment">{(["path", "area"] as Mode[]).map((m) => <button key={m} className={mode === m ? "active" : ""} onClick={() => setMode(m)}>{m === "path" ? "Distance / path" : "Area / polygon"}</button>)}</div>
          <p className="km-hint">Move the map so the cross-hair sits on a spot, then tap <b>Add point</b>.</p>
          <div className="km-actions">
            <button className="km-primary" onClick={addPoint}><Crosshair size={14} />Add point</button>
            <button className="km-secondary" onClick={undo} disabled={!points.length} aria-label="Undo"><Undo2 size={14} /></button>
            <button className="km-secondary" onClick={redoPt} disabled={!redo.length} aria-label="Redo"><Redo2 size={14} /></button>
            <button className="km-secondary" onClick={() => { setPoints([]); setRedo([]); }} disabled={!points.length}>Clear</button>
          </div>
        </section>
        {points.length >= 2 && <section>
          <dl>
            <div><dt>{mode === "area" ? "Perimeter" : "Length"}</dt><dd>{fmtDist(perimeter, units)}</dd></div>
            {mode === "area" && points.length > 2 && <div><dt>Area</dt><dd>{fmtArea(area, units)}</dd></div>}
            <div><dt>Points</dt><dd>{points.length}</dd></div>
            {stats && <div><dt>Climb / drop</dt><dd>+{Math.round(stats.gain)} m / −{Math.round(stats.loss)} m</dd></div>}
          </dl>
          {mode === "path" && <>
            <h4>Elevation profile {stats && <small>{Math.round(stats.min)}–{Math.round(stats.max)} m</small>}</h4>
            {chart || (elevErr ? <p className="km-note">{elevErr}</p> : <p className="km-hint">{length < 20 ? "Path is too short for a profile." : "Loading elevation…"}</p>)}
          </>}
          <div className="km-actions">
            <button className="km-primary" onClick={() => void save()}><Save size={14} />Save</button>
            <button className="km-secondary" onClick={() => exportGeo({ name: "measurement", mode, points }, "geojson")}><Download size={14} />GeoJSON</button>
            {mode === "path" && <button className="km-secondary" onClick={() => exportGeo({ name: "measurement", mode, points }, "gpx")}><Download size={14} />GPX</button>}
          </div>
        </section>}
        <section>
          <h3>Saved &amp; imported</h3>
          <button className="km-secondary" onClick={() => fileRef.current?.click()}><FileUp size={14} />Import GPX / KML / GeoJSON</button>
          <input ref={fileRef} type="file" accept=".gpx,.kml,.geojson,.json,application/gpx+xml,application/vnd.google-earth.kml+xml,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ""; }} />
          {saved.length === 0 && <p className="km-hint">Nothing saved yet. Imported tracks (from GPS apps, Google Earth, survey tools) are drawn in purple.</p>}
          <ul className="km-loc-list">{saved.map((s) => <li key={s.id}>
            <div className="km-loc-head"><i style={{ background: s.kind === "overlay" ? "#bf5af2" : "#ffd60a" }} /><button className="km-loc-name" onClick={() => load(s)}><strong>{s.name}</strong><small>{s.kind === "overlay" ? `${s.geojson?.features.length} features` : s.mode === "area" ? `Area · ${fmtArea(polygonAreaM2(s.points || []), units)}` : `Path · ${fmtDist(lineLengthM(s.points || []), units)}`}</small></button></div>
            <div className="km-loc-tools">
              {s.kind === "overlay" && <button onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n; })} aria-label="Show or hide">{hidden.has(s.id) ? <EyeOff size={14} /> : <Eye size={14} />}</button>}
              {s.kind === "measure" && <button onClick={() => exportGeo(s, "geojson")} aria-label="Export GeoJSON"><Download size={14} /></button>}
              <button onClick={() => void remove(s.id)} aria-label={`Delete ${s.name}`}><Trash2 size={14} /></button>
            </div>
          </li>)}</ul>
        </section>
      </div>
    </aside>
  </>;
}
