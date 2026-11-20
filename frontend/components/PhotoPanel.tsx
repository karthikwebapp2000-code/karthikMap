"use client";

import { Camera, Download, ImagePlus, MapPin, Share2, Trash2, X } from "lucide-react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource } from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { digipinEncode } from "@/lib/digipin";
import { idbAll, idbDelete, idbPut } from "@/lib/idb";
import { drawStamp, miniMap, type StampOpts } from "@/lib/stamp";
import { fetchWeather } from "@/lib/weather";
import { loadWorkLocations, download } from "@/lib/work";

type Photo = { id: string; at: number; lat: number; lng: number; address: string; site: string; note: string; blob: Blob };
type Src = "gps" | "centre" | "place" | "site";
type Place = { name: string; address: string; lat: number; lng: number } | null;
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const SHOW0: StampOpts["show"] = { address: true, coords: true, time: true, weather: true, digipin: true, note: true, map: true };
const LABELS: Record<keyof StampOpts["show"], string> = { address: "Address", coords: "Coordinates", time: "Date & time", weather: "Weather", digipin: "DIGIPIN", note: "Note", map: "Mini map" };

type Props = { mapRef: React.RefObject<maplibregl.Map | null>; mapReady: boolean; open: boolean; userLocation: [number, number] | null; selectedPlace: Place; onClose: () => void };

export default function PhotoPanel({ mapRef, mapReady, open, userLocation, selectedPlace, onClose }: Props) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [filterSite, setFilterSite] = useState("all");
  const [filterRange, setFilterRange] = useState<"all" | "today" | "week">("all");
  const [view, setView] = useState<Photo | null>(null);
  const [msg, setMsg] = useState("");
  // editor
  const [img, setImg] = useState<ImageBitmap | null>(null);
  const [when, setWhen] = useState(Date.now());
  const [src, setSrc] = useState<Src>("gps");
  const [siteId, setSiteId] = useState("");
  const [loc, setLoc] = useState<{ lat: number; lng: number; title: string } | null>(null);
  const [address, setAddress] = useState("");
  const [wx, setWx] = useState("");
  const [note, setNote] = useState("");
  const [map, setMap] = useState<HTMLCanvasElement | null>(null);
  const [opts, setOpts] = useState<Omit<StampOpts, "show">>({ x: 0.04, y: 0.96, scale: 1, opacity: 1 });
  const [show, setShow] = useState(SHOW0);
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const camRef = useRef<HTMLInputElement | null>(null);
  const galRef = useRef<HTMLInputElement | null>(null);
  const sites = useMemo(() => (open ? loadWorkLocations() : []), [open]);

  const flash = (m: string) => { setMsg(m); window.setTimeout(() => setMsg((x) => (x === m ? "" : x)), 3000); };
  useEffect(() => { void idbAll<Photo>("photos").then((l) => setPhotos(l.sort((a, b) => b.at - a.at))); }, []);
  useEffect(() => {
    setUrls((prev) => { const next = { ...prev }; photos.forEach((p) => { if (!next[p.id]) next[p.id] = URL.createObjectURL(p.blob); }); return next; });
  }, [photos]);
  useEffect(() => () => { Object.values(urls).forEach(URL.revokeObjectURL); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // photo pins on the map
  useEffect(() => {
    const m = mapRef.current;
    if (!mapReady || !m) return;
    if (!m.getSource("km-photo-source")) {
      m.addSource("km-photo-source", { type: "geojson", data: EMPTY });
      m.addLayer({ id: "km-photo-pts", type: "circle", source: "km-photo-source", paint: { "circle-radius": 7, "circle-color": "#ff375f", "circle-stroke-color": "#fff", "circle-stroke-width": 2.5 } });
    }
    (m.getSource("km-photo-source") as GeoJSONSource).setData({ type: "FeatureCollection", features: photos.map((p) => ({ type: "Feature", properties: { id: p.id }, geometry: { type: "Point", coordinates: [p.lng, p.lat] } })) });
  }, [mapReady, mapRef, photos]);
  useEffect(() => () => { const m = mapRef.current; if (!m || !m.getStyle()) return; m.getLayer("km-photo-pts") && m.removeLayer("km-photo-pts"); m.getSource("km-photo-source") && m.removeSource("km-photo-source"); }, [mapRef]);

  // resolve location for the chosen source
  const pickLocation = useCallback((s: Src, site: string) => {
    const c = mapRef.current?.getCenter();
    if (s === "gps" && userLocation) return { lat: userLocation[1], lng: userLocation[0], title: "Site photo" };
    if (s === "place" && selectedPlace) return { lat: selectedPlace.lat, lng: selectedPlace.lng, title: selectedPlace.name };
    if (s === "site") { const x = sites.find((y) => y.id === site); if (x) return { lat: x.lat, lng: x.lng, title: x.name }; }
    return c ? { lat: c.lat, lng: c.lng, title: "Site photo" } : null;
  }, [mapRef, userLocation, selectedPlace, sites]);
  useEffect(() => { if (img) setLoc(pickLocation(src, siteId)); }, [img, src, siteId, pickLocation]);
  useEffect(() => {
    if (!loc) return;
    let alive = true;
    setAddress(""); setWx(""); setMap(null);
    fetch(`/api/v1/geocode/reverse?lat=${loc.lat}&lng=${loc.lng}`).then((r) => r.json()).then((d) => { if (alive) setAddress(d.address || d.display_name || d.result?.address || ""); }).catch(() => undefined);
    void fetchWeather(loc.lat, loc.lng).then((w) => { if (alive && w) setWx(`${w.temp}°C · ${w.text}`); });
    void miniMap(loc.lat, loc.lng).then((c) => { if (alive) setMap(c); });
    return () => { alive = false; };
  }, [loc]);

  const stampData = useMemo(() => loc ? { title: loc.title, address, lat: loc.lat, lng: loc.lng, when, weather: wx, digipin: digipinEncode(loc.lat, loc.lng), note, mapImg: map } : null, [loc, address, when, wx, note, map]);

  // live preview
  useEffect(() => {
    const c = canvas.current; if (!c || !img || !stampData) return;
    const maxW = 640, k = Math.min(1, maxW / Math.max(img.width, img.height));
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    const g = c.getContext("2d")!; g.drawImage(img, 0, 0, c.width, c.height);
    drawStamp(g, c.width, c.height, stampData, { ...opts, show });
  }, [img, stampData, opts, show]);

  const onFile = async (file: File | undefined, fromCamera: boolean) => {
    if (!file) return;
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      setImg(bmp); setWhen(fromCamera ? Date.now() : file.lastModified || Date.now()); setNote(""); setView(null);
      setSrc(fromCamera && userLocation ? "gps" : userLocation && fromCamera ? "gps" : "centre");
    } catch { flash("Could not open that image"); }
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => { (e.target as Element).setPointerCapture(e.pointerId); drag.current = { sx: e.clientX, sy: e.clientY, ox: opts.x, oy: opts.y }; };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current, c = canvas.current; if (!d || !c) return;
    const r = c.getBoundingClientRect();
    setOpts((o) => ({ ...o, x: Math.min(1, Math.max(0, d.ox + (e.clientX - d.sx) / (r.width * 0.5))), y: Math.min(1, Math.max(0, d.oy + (e.clientY - d.sy) / (r.height * 0.5))) }));
  };

  const save = async () => {
    if (!img || !stampData || !loc) return;
    setBusy(true);
    try {
      const k = Math.min(1, 2400 / Math.max(img.width, img.height));
      const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const g = c.getContext("2d")!; g.drawImage(img, 0, 0, c.width, c.height);
      drawStamp(g, c.width, c.height, stampData, { ...opts, show });
      const blob: Blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("encode"))), "image/jpeg", 0.9));
      const rec: Photo = { id: `ph_${Date.now().toString(36)}`, at: when, lat: loc.lat, lng: loc.lng, address, site: src === "site" ? loc.title : src === "place" ? loc.title : "", note, blob };
      await idbPut("photos", rec); setPhotos((p) => [rec, ...p]); setImg(null); setView(rec); flash("Saved to Site photos");
    } catch { flash("Could not save the photo"); } finally { setBusy(false); }
  };

  const share = async (p: Photo) => {
    const file = new File([p.blob], `site-photo-${new Date(p.at).toISOString().slice(0, 10)}.jpg`, { type: "image/jpeg" });
    try { if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: p.site || "Site photo", text: p.address }); else download(file.name, "", ""); } catch { /* cancelled */ }
  };
  const save2disk = (p: Photo) => { const a = document.createElement("a"); a.href = urls[p.id]; a.download = `site-photo-${new Date(p.at).toISOString().slice(0, 10)}-${p.id}.jpg`; a.click(); };
  const remove = async (p: Photo) => { await idbDelete("photos", p.id); URL.revokeObjectURL(urls[p.id]); setPhotos((l) => l.filter((x) => x.id !== p.id)); setView(null); };

  const siteNames = useMemo(() => [...new Set(photos.map((p) => p.site).filter(Boolean))], [photos]);
  const shown = photos.filter((p) => (filterSite === "all" || p.site === filterSite) && (filterRange === "all" || Date.now() - p.at < (filterRange === "today" ? 86_400_000 : 7 * 86_400_000)));

  if (!open) return null;
  return <aside className="km-panel" aria-label="Site photos">
    <header><div><Camera size={18} /><strong>Site photos</strong><span className="km-count">{photos.length}</span></div><button onClick={onClose} aria-label="Close site photos"><X size={17} /></button></header>
    {msg && <p className="km-toast" role="status">{msg}</p>}
    <div className="km-body">
      {!img && !view && <section>
        <div className="km-actions" style={{ marginTop: 0 }}>
          <button className="km-primary" onClick={() => camRef.current?.click()}><Camera size={15} />Take photo</button>
          <button className="km-secondary" onClick={() => galRef.current?.click()}><ImagePlus size={15} />From gallery</button>
        </div>
        <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void onFile(e.target.files?.[0], true); e.target.value = ""; }} />
        <input ref={galRef} type="file" accept="image/*" hidden onChange={(e) => { void onFile(e.target.files?.[0], false); e.target.value = ""; }} />
        <p className="km-hint">Adds place, coordinates, date/time, weather, DIGIPIN and a mini-map to the picture — proof of site visits. Photos are stored only on this device. (Photos only; no video stamping.)</p>
      </section>}

      {img && stampData && <section>
        <canvas ref={canvas} className="km-photo-canvas" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => (drag.current = null)} aria-label="Photo preview — drag the stamp to move it" />
        <p className="km-hint">Drag the label to move it.</p>
        <h4>Location</h4>
        <div className="mode-segment">{([["gps", "My GPS"], ["centre", "Map centre"], ["place", "Selected"], ["site", "Saved site"]] as const).map(([id, l]) => <button key={id} className={src === id ? "active" : ""} onClick={() => setSrc(id)} disabled={(id === "gps" && !userLocation) || (id === "place" && !selectedPlace)}>{l}</button>)}</div>
        {src === "site" && <select value={siteId} onChange={(e) => setSiteId(e.target.value)} aria-label="Saved site"><option value="">Choose…</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
        <p className="km-hint"><MapPin size={12} /> {address || "Looking up address…"}</p>
        <input type="text" placeholder="Note (e.g. Panel B inspected)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
        <h4>Show on photo</h4>
        <div className="km-chips">{(Object.keys(LABELS) as Array<keyof StampOpts["show"]>).map((k) => <button key={k} className={show[k] ? "on" : ""} onClick={() => setShow((s) => ({ ...s, [k]: !s[k] }))}>{LABELS[k]}</button>)}</div>
        <label className="range-row"><span>Label size <b>{Math.round(opts.scale * 100)}%</b></span><input type="range" min="0.6" max="1.8" step="0.05" value={opts.scale} onChange={(e) => setOpts((o) => ({ ...o, scale: Number(e.target.value) }))} /></label>
        <label className="range-row"><span>Opacity <b>{Math.round(opts.opacity * 100)}%</b></span><input type="range" min="0.3" max="1" step="0.05" value={opts.opacity} onChange={(e) => setOpts((o) => ({ ...o, opacity: Number(e.target.value) }))} /></label>
        <div className="km-actions"><button className="km-primary" onClick={() => void save()} disabled={busy || !loc}>{busy ? <span className="search-spinner" /> : null}Save photo</button><button className="km-secondary" onClick={() => setImg(null)}>Cancel</button></div>
      </section>}

      {view && !img && <section className="km-focus-card">
        <img src={urls[view.id]} alt={view.site || "Site photo"} className="km-photo-view" />
        <p className="km-hint"><b>{view.site || "Site photo"}</b> · {new Date(view.at).toLocaleString()}<br />{view.address}</p>
        <div className="km-actions">
          <button className="km-primary" onClick={() => void share(view)}><Share2 size={14} />Share</button>
          <button className="km-secondary" onClick={() => save2disk(view)}><Download size={14} />Save</button>
          <button className="km-secondary" onClick={() => mapRef.current?.flyTo({ center: [view.lng, view.lat], zoom: 17, duration: 900 })}><MapPin size={14} />Map</button>
          <button className="km-secondary km-danger" onClick={() => void remove(view)}><Trash2 size={14} /></button>
          <button className="km-secondary" onClick={() => setView(null)}>Back</button>
        </div>
      </section>}

      {!img && !view && <section>
        <h3>Gallery</h3>
        <div className="mode-segment">{(["all", "today", "week"] as const).map((r) => <button key={r} className={filterRange === r ? "active" : ""} onClick={() => setFilterRange(r)}>{r === "all" ? "All dates" : r === "today" ? "Today" : "7 days"}</button>)}</div>
        {siteNames.length > 0 && <select value={filterSite} onChange={(e) => setFilterSite(e.target.value)} aria-label="Filter by site"><option value="all">All locations</option>{siteNames.map((s) => <option key={s} value={s}>{s}</option>)}</select>}
        {shown.length === 0 ? <p className="km-hint">No photos yet.</p> : <div className="km-photo-grid">{shown.map((p) => <button key={p.id} onClick={() => setView(p)} aria-label={`Open photo ${p.site || ""}`}><img src={urls[p.id]} alt="" loading="lazy" /><span>{new Date(p.at).toLocaleDateString([], { day: "numeric", month: "short" })}</span></button>)}</div>}
      </section>}
    </div>
  </aside>;
}
