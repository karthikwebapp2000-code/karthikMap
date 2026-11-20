"use client";

import { CloudDownload, Trash2, WifiOff, X } from "lucide-react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { AVG_TILE_BYTES, MAX_TILES, clearAllOffline, countTiles, deleteRegion, downloadRegion, loadRegions, saveRegions, type Bbox, type Progress, type Region } from "@/lib/offline";

const mb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`);
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

type Props = { mapRef: React.RefObject<maplibregl.Map | null>; mapReady: boolean; open: boolean; onClose: () => void };

export default function OfflinePanel({ mapRef, mapReady, open, onClose }: Props) {
  const [regions, setRegions] = useState<Region[]>([]);
  const [bbox, setBbox] = useState<Bbox | null>(null);
  const [zmax, setZmax] = useState(14);
  const [name, setName] = useState("");
  const [prog, setProg] = useState<Progress | null>(null);
  const [err, setErr] = useState("");
  const [online, setOnline] = useState(true);
  const [quota, setQuota] = useState<{ used: number; total: number } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const zmin = Math.max(3, zmax - 9);

  useEffect(() => { setRegions(loadRegions()); setOnline(navigator.onLine); const on = () => setOnline(true), off = () => setOnline(false); window.addEventListener("online", on); window.addEventListener("offline", off); return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); }; }, []);
  const readView = () => { const b = mapRef.current?.getBounds(); if (b) setBbox({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() }); };
  useEffect(() => { if (open) { readView(); void navigator.storage?.estimate?.().then((e) => setQuota({ used: e.usage || 0, total: e.quota || 0 })); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open, regions]);
  useEffect(() => {
    if (!open) return;
    const m = mapRef.current; if (!m) return;
    const on = () => readView();
    m.on("moveend", on);
    return () => { m.off("moveend", on); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mapRef, mapReady]);

  // outline of saved regions on the map
  useEffect(() => {
    const m = mapRef.current; if (!mapReady || !m) return;
    if (!m.getSource("km-offline-source")) {
      m.addSource("km-offline-source", { type: "geojson", data: EMPTY });
      m.addLayer({ id: "km-offline-line", type: "line", source: "km-offline-source", paint: { "line-color": "#30d158", "line-width": 2.5, "line-dasharray": [3, 2] } });
    }
    (m.getSource("km-offline-source") as GeoJSONSource).setData(open ? { type: "FeatureCollection", features: regions.map((r) => ({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[r.bbox.west, r.bbox.south], [r.bbox.east, r.bbox.south], [r.bbox.east, r.bbox.north], [r.bbox.west, r.bbox.north], [r.bbox.west, r.bbox.south]]] } })) } : EMPTY);
  }, [mapReady, mapRef, regions, open]);
  useEffect(() => () => { const m = mapRef.current; if (!m || !m.getStyle()) return; m.getLayer("km-offline-line") && m.removeLayer("km-offline-line"); m.getSource("km-offline-source") && m.removeSource("km-offline-source"); }, [mapRef]);

  const tiles = useMemo(() => (bbox ? countTiles(bbox, zmin, zmax) : 0), [bbox, zmin, zmax]);
  const tooBig = tiles > MAX_TILES;
  const busy = !!prog;

  const start = async () => {
    if (!bbox || tooBig) return;
    setErr(""); setProg({ done: 0, total: tiles, bytes: 0, failed: 0 });
    const ctrl = new AbortController(); abort.current = ctrl;
    try {
      await navigator.storage?.persist?.();
      const r = await downloadRegion(name.trim() || `Area ${new Date().toLocaleDateString([], { day: "numeric", month: "short" })}`, bbox, zmin, zmax, setProg, ctrl.signal);
      const next = [r, ...regions]; setRegions(next); saveRegions(next); setName("");
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setErr(e instanceof Error ? e.message : "Download failed");
    } finally { setProg(null); abort.current = null; }
  };
  const remove = async (r: Region) => { await deleteRegion(r); const next = regions.filter((x) => x.id !== r.id); setRegions(next); saveRegions(next); };

  if (!open) return null;
  return <aside className="km-panel" aria-label="Offline maps">
    <header><div><CloudDownload size={18} /><strong>Offline maps</strong>{!online && <span className="km-count"><WifiOff size={11} /> offline</span>}</div><button onClick={onClose} aria-label="Close offline maps"><X size={17} /></button></header>
    <div className="km-body">
      <section>
        <h3>Download this view</h3>
        <p className="km-hint">Frame the area you need (a city or district) on the map, then download. Roads, buildings, labels and 3D building shapes work without internet. Satellite imagery, terrain, live data, search and routing still need a connection.</p>
        <input type="text" placeholder="Name — e.g. Chennai South" value={name} onChange={(e) => setName(e.target.value)} aria-label="Region name" />
        <label className="range-row"><span>Detail <b>up to zoom {zmax}</b> ({zmax >= 14 ? "streets & buildings" : zmax >= 13 ? "streets" : zmax >= 12 ? "main roads" : "overview"})</span><input type="range" min="10" max="14" step="1" value={zmax} onChange={(e) => setZmax(Number(e.target.value))} /></label>
        <dl><div><dt>Map tiles</dt><dd>{tiles.toLocaleString()}</dd></div><div><dt>Approx. size</dt><dd>{mb(tiles * AVG_TILE_BYTES)}</dd></div></dl>
        {tooBig && <p className="km-note">That is too large (limit {MAX_TILES.toLocaleString()} tiles). Zoom in on a smaller area or lower the detail.</p>}
        {err && <p className="km-note">{err}</p>}
        {prog ? <>
          <div className="km-progress" role="progressbar" aria-valuenow={prog.done} aria-valuemax={prog.total}><i style={{ width: `${Math.round((prog.done / Math.max(1, prog.total)) * 100)}%` }} /></div>
          <p className="km-hint">{prog.done.toLocaleString()} / {prog.total.toLocaleString()} tiles · {mb(prog.bytes)}{prog.failed ? ` · ${prog.failed} failed` : ""}</p>
          <button className="km-secondary km-danger" onClick={() => abort.current?.abort()}>Cancel</button>
        </> : <button className="km-primary" onClick={() => void start()} disabled={!online || !bbox || tooBig}><CloudDownload size={15} />Download for offline</button>}
        {!online && <p className="km-hint">You are offline — connect to download.</p>}
      </section>
      <section>
        <h3>Saved areas <small>({regions.length})</small></h3>
        {regions.length === 0 && <p className="km-hint">None yet. Chennai bus timetables and the railway station list already work offline.</p>}
        <ul className="km-loc-list">{regions.map((r) => <li key={r.id}>
          <div className="km-loc-head"><i style={{ background: "var(--ok)" }} /><button className="km-loc-name" onClick={() => mapRef.current?.fitBounds([[r.bbox.west, r.bbox.south], [r.bbox.east, r.bbox.north]], { padding: 40, duration: 900 })}><strong>{r.name}</strong><small>{mb(r.bytes)} · {r.tiles.toLocaleString()} tiles · zoom {r.zmin}–{r.zmax} · {new Date(r.at).toLocaleDateString()}</small></button></div>
          <div className="km-loc-tools"><button onClick={() => void remove(r)} aria-label={`Delete ${r.name}`}><Trash2 size={14} /></button></div>
        </li>)}</ul>
        {quota && <p className="km-hint">Browser storage used: {mb(quota.used)} of {mb(quota.total)} available.</p>}
        {regions.length > 0 && <button className="km-secondary km-danger" onClick={async () => { await clearAllOffline(); setRegions([]); }}>Delete all offline maps</button>}
      </section>
    </div>
  </aside>;
}
