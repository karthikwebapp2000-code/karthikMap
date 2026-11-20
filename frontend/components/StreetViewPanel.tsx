"use client";

import { ArrowDown, ArrowUp, Compass, Crosshair, ExternalLink, LocateFixed, Maximize2, Minimize2, Smartphone, X } from "lucide-react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource } from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanoView } from "@/lib/equirect";
import { SV_COLOR, SV_LABEL, stepAlong, type SvItem, type SvProvider, type SvStatus } from "@/lib/streetview";

const GOOGLE_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY || "";
const MAPILLARY = process.env.NEXT_PUBLIC_MAPILLARY_TOKEN || "";
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const PROVIDERS: SvProvider[] = ["mapillary", "kartaview", "panoramax", "commons"];

type Props = {
  mapRef: React.RefObject<maplibregl.Map | null>;
  mapReady: boolean;
  open: boolean;
  point: { lat: number; lng: number } | null;
  userLocation: [number, number] | null;
  onPoint: (p: { lat: number; lng: number }) => void;
  onClose: () => void;
};

const ahead = (lat: number, lng: number, deg: number, m: number): [number, number] => {
  const r = (deg * Math.PI) / 180;
  return [lng + (Math.sin(r) * m) / (111_320 * Math.cos((lat * Math.PI) / 180)), lat + (Math.cos(r) * m) / 110_540];
};
const when = (t: number | null) => (t ? new Date(t).toLocaleDateString([], { month: "short", year: "numeric" }) : "date unknown");

export default function StreetViewPanel({ mapRef, mapReady, open, point, userLocation, onPoint, onClose }: Props) {
  const [items, setItems] = useState<SvItem[]>([]);
  const [status, setStatus] = useState<SvStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [on, setOn] = useState<Record<SvProvider, boolean>>({ mapillary: true, kartaview: true, panoramax: true, commons: true });
  const [curId, setCurId] = useState<string | null>(null);
  const [imgState, setImgState] = useState<"loading" | "ok" | "error">("loading");
  const [full, setFull] = useState(false);
  const [viewDir, setViewDir] = useState(0);
  const [gyro, setGyro] = useState(false);
  const [coverage, setCoverage] = useState(true);
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  const [useGoogle, setUseGoogle] = useState(false);
  const pano = useRef<PanoView | null>(null);
  const pending = useRef<string | null>(null);
  const fetchedAt = useRef<{ lat: number; lng: number } | null>(null);

  const visible = useMemo(() => items.filter((i) => on[i.provider]), [items, on]);
  const cur = useMemo(() => visible.find((i) => i.id === curId) || null, [visible, curId]);
  const googleLink = point ? `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${point.lat},${point.lng}` : "#";

  const useCentre = useCallback(() => { const c = mapRef.current?.getCenter(); if (c) onPoint({ lat: c.lat, lng: c.lng }); }, [mapRef, onPoint]);
  useEffect(() => { if (open && !point) useCentre(); }, [open, point, useCentre]);

  // ───────── fetch imagery around the point ─────────
  useEffect(() => {
    if (!open || !point) return;
    const ctrl = new AbortController();
    setLoading(true); setError("");
    fetchedAt.current = point;
    fetch(`/api/v1/streetview/nearby?lat=${point.lat}&lng=${point.lng}&radius=140`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((d) => {
        if (d.status !== "OK") throw new Error(d.error || "Street imagery unavailable");
        setItems(d.items as SvItem[]); setStatus(d.providers as SvStatus);
        setCurId((prev) => {
          const want = pending.current || prev; pending.current = null;
          const list = d.items as SvItem[];
          if (want && list.some((i) => i.id === want)) return want;
          return (list.find((i) => i.provider !== "commons") || list[0])?.id ?? null;
        });
      })
      .catch((e) => { if (e.name !== "AbortError") setError(e.message || "Street imagery unavailable"); })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [open, point]);

  // if the selected source is hidden by a filter, pick the nearest visible one
  useEffect(() => { if (!cur && visible.length) setCurId((visible.find((i) => i.provider !== "commons") || visible[0]).id); }, [cur, visible]);

  // ───────── viewer ─────────
  useEffect(() => {
    if (!canvasEl) return;
    let v: PanoView;
    try { v = new PanoView(canvasEl); } catch { setImgState("error"); return; }
    pano.current = v; setGyro(false);
    let last = 0;
    v.onChange = () => { const t = performance.now(); if (t - last > 120) { last = t; setViewDir(v.yawDeg); } };
    return () => { v.dispose(); if (pano.current === v) pano.current = null; };
  }, [canvasEl]);

  useEffect(() => {
    setImgState("loading"); setViewDir(0);
    if (!cur?.pano || !canvasEl) return;
    const v = pano.current; if (!v) return;
    let alive = true;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => { if (!alive) return; v.look({ yaw: 0, pitch: 0, fov: 80 }); v.setImage(img); setImgState("ok"); };
    img.onerror = () => { if (alive) setImgState("error"); };
    img.src = cur.full;
    return () => { alive = false; img.onload = img.onerror = null; };
  }, [cur?.id, cur?.pano, cur?.full, canvasEl]);

  const facing = cur ? ((cur.heading ?? 0) + (cur.pano ? viewDir : 0) + 360) % 360 : 0;

  // Walk along the road: prefer the direction you are looking; if nothing is there (e.g. you are looking sideways), follow the road direction.
  const target = (dir: 1 | -1) => {
    if (!cur) return null;
    return stepAlong(visible, { ...cur, heading: facing }, dir) || (cur.heading != null ? stepAlong(visible, cur, dir) : null);
  };
  const go = (dir: 1 | -1) => {
    const next = target(dir);
    if (!next) return;
    setCurId(next.id);
    const f = fetchedAt.current;
    if (f && Math.hypot((next.lat - f.lat) * 110_540, (next.lng - f.lng) * 111_320 * Math.cos((f.lat * Math.PI) / 180)) > 45) { pending.current = next.id; onPoint({ lat: next.lat, lng: next.lng }); }
    mapRef.current?.easeTo({ center: [next.lng, next.lat], duration: 600 });
  };
  const canGo = (dir: 1 | -1) => !!target(dir);

  const toggleGyro = async () => {
    const v = pano.current; if (!v) return;
    if (v.gyroOn) { v.disableGyro(); setGyro(false); return; }
    setGyro(await v.enableGyro());
  };

  // ───────── map layers ─────────
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    if (!open) {
      ["km-sv-photos", "km-sv-active", "km-sv-point", "km-sv-cone", "km-mly-seq", "km-pnx-seq"].forEach((id) => map.getLayer(id) && map.removeLayer(id));
      ["km-sv-source", "km-mly", "km-pnx"].forEach((id) => map.getSource(id) && map.removeSource(id));
      return;
    }
    if (coverage) {
      if (MAPILLARY && !map.getSource("km-mly")) {
        map.addSource("km-mly", { type: "vector", tiles: [`https://tiles.mapillary.com/maps/vtp/mly1_public/2/{z}/{x}/{y}?access_token=${MAPILLARY}`], minzoom: 6, maxzoom: 14 });
        map.addLayer({ id: "km-mly-seq", type: "line", source: "km-mly", "source-layer": "sequence", paint: { "line-color": SV_COLOR.mapillary, "line-width": 2.2, "line-opacity": 0.75 } });
      }
      if (!map.getSource("km-pnx")) {
        map.addSource("km-pnx", { type: "vector", tiles: ["https://api.panoramax.xyz/api/map/{z}/{x}/{y}.mvt"], minzoom: 0, maxzoom: 15 });
        map.addLayer({ id: "km-pnx-seq", type: "line", source: "km-pnx", "source-layer": "sequences", paint: { "line-color": SV_COLOR.panoramax, "line-width": 2.2, "line-opacity": 0.75 } });
      }
    } else {
      ["km-mly-seq", "km-pnx-seq"].forEach((id) => map.getLayer(id) && map.removeLayer(id));
      ["km-mly", "km-pnx"].forEach((id) => map.getSource(id) && map.removeSource(id));
    }
    if (!map.getSource("km-sv-source")) {
      map.addSource("km-sv-source", { type: "geojson", data: EMPTY });
      const col = ["match", ["get", "provider"], ...PROVIDERS.flatMap((p) => [p, SV_COLOR[p]]), "#fff"] as unknown as maplibregl.ExpressionSpecification;
      map.addLayer({ id: "km-sv-cone", type: "line", source: "km-sv-source", filter: ["==", ["get", "kind"], "cone"], paint: { "line-color": "#ffd60a", "line-width": 5, "line-opacity": 0.95 }, layout: { "line-cap": "round" } });
      map.addLayer({ id: "km-sv-photos", type: "circle", source: "km-sv-source", filter: ["==", ["get", "kind"], "photo"], paint: { "circle-radius": 4.5, "circle-color": col, "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 } });
      map.addLayer({ id: "km-sv-active", type: "circle", source: "km-sv-source", filter: ["==", ["get", "kind"], "active"], paint: { "circle-radius": 9, "circle-color": col, "circle-stroke-color": "#fff", "circle-stroke-width": 3 } });
      map.addLayer({ id: "km-sv-point", type: "circle", source: "km-sv-source", filter: ["==", ["get", "kind"], "point"], paint: { "circle-radius": 6, "circle-color": "#ffd60a", "circle-stroke-color": "#000", "circle-stroke-width": 1.5, "circle-opacity": 0.9 } });
      map.on("click", "km-sv-photos", (e) => { const id = e.features?.[0]?.properties?.id; if (typeof id === "string") setCurId(id); });
      map.on("mouseenter", "km-sv-photos", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "km-sv-photos", () => { map.getCanvas().style.cursor = ""; });
    }
    const f: GeoJSON.Feature[] = [];
    if (point) f.push({ type: "Feature", properties: { kind: "point" }, geometry: { type: "Point", coordinates: [point.lng, point.lat] } });
    visible.forEach((i) => f.push({ type: "Feature", properties: { kind: i.id === curId ? "active" : "photo", provider: i.provider, id: i.id }, geometry: { type: "Point", coordinates: [i.lng, i.lat] } }));
    if (cur && cur.provider !== "commons") f.push({ type: "Feature", properties: { kind: "cone" }, geometry: { type: "LineString", coordinates: [[cur.lng, cur.lat], ahead(cur.lat, cur.lng, facing, 22)] } });
    (map.getSource("km-sv-source") as GeoJSONSource).setData({ type: "FeatureCollection", features: f });
  }, [mapReady, mapRef, open, point, visible, curId, cur, facing, coverage]);

  if (!open) return null;
  const counts = (p: SvProvider) => status?.[p];
  const anyStreet = visible.some((i) => i.provider !== "commons");
  const strip = visible.slice(0, 24);

  return <>
    <div className="km-crosshair" aria-hidden="true"><Crosshair size={26} /></div>
    <aside className={`km-panel km-street${full ? " full" : ""}`} aria-label="Street view">
      <header>
        <div><Compass size={18} /><strong>Street view</strong>{point && <span className="km-count">{point.lat.toFixed(4)}, {point.lng.toFixed(4)}</span>}</div>
        <div className="km-street-hdr">
          <button onClick={() => setFull((f) => !f)} aria-label={full ? "Exit full screen" : "Full screen"}>{full ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
          <button onClick={onClose} aria-label="Close street view"><X size={17} /></button>
        </div>
      </header>

      <div className="km-sv-chips" role="group" aria-label="Photo sources">
        {PROVIDERS.map((p) => {
          const s = counts(p);
          return <button key={p} className={on[p] ? "on" : ""} style={{ ["--c" as string]: SV_COLOR[p] }} onClick={() => setOn((o) => ({ ...o, [p]: !o[p] }))} title={s?.skipped && s.skipped !== "off" ? s.skipped : s?.error || ""}>
            <i />{SV_LABEL[p]}<b>{s ? (s.skipped && s.skipped !== "off" ? "key" : s.error ? "!" : s.count) : "…"}</b>
          </button>;
        })}
        {GOOGLE_KEY && <button className={useGoogle ? "on" : ""} style={{ ["--c" as string]: "#ea4335" }} onClick={() => setUseGoogle((g) => !g)}><i />Google</button>}
      </div>

      <div className="km-street-view">
        {useGoogle && GOOGLE_KEY && point ? (
          <iframe title="Google Street View" loading="lazy" allowFullScreen referrerPolicy="no-referrer-when-downgrade" src={`https://www.google.com/maps/embed/v1/streetview?key=${GOOGLE_KEY}&location=${point.lat},${point.lng}&heading=0&pitch=0&fov=90`} />
        ) : cur ? (
          <div className="km-sv-stage">
            {cur.pano ? <canvas ref={setCanvasEl} className="km-pano" aria-label="360° photo — drag to look around" /> : (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={cur.id} src={cur.full} alt={cur.title || `Street-level photo by ${cur.author || "a contributor"}`} className="km-flat" onLoad={() => setImgState("ok")} onError={() => setImgState("error")} />
            )}
            {imgState === "loading" && <div className="km-sv-msg"><span className="search-spinner" /> Loading photo…</div>}
            {imgState === "error" && <div className="km-sv-msg">This photo could not be loaded (it may be archived). Try another one below.</div>}
            <div className="km-sv-badges"><span style={{ background: SV_COLOR[cur.provider] }}>{SV_LABEL[cur.provider]}</span>{cur.pano && <span>360°</span>}</div>
            <div className="km-sv-walk">
              <button onClick={() => go(1)} disabled={!canGo(1)} aria-label="Move forward"><ArrowUp size={20} /></button>
              <button onClick={() => go(-1)} disabled={!canGo(-1)} aria-label="Move back"><ArrowDown size={20} /></button>
              {cur.pano && typeof DeviceOrientationEvent !== "undefined" && <button className={gyro ? "on" : ""} onClick={() => void toggleGyro()} aria-label="Look around by moving your phone" aria-pressed={gyro}><Smartphone size={18} /></button>}
            </div>
            <div className="km-sv-compass" aria-hidden="true" style={{ transform: `rotate(${-facing}deg)` }}><span>N</span></div>
          </div>
        ) : (
          <div className="km-street-empty">
            {loading ? <p><span className="search-spinner" /> Searching open street-level photo sources…</p> : error ? <p>{error}</p> : <p>No street-level photos here yet.<br />Move the map so the cross-hair is on a road with <b style={{ color: SV_COLOR.panoramax }}>blue</b> or <b style={{ color: SV_COLOR.mapillary }}>green</b> lines, then tap “Look here”. Coverage in India is patchy — Mapillary is usually the best source.</p>}
          </div>
        )}
      </div>

      {cur && <p className="km-sv-meta">
        <b>{cur.title || SV_LABEL[cur.provider]}</b> · {when(cur.at)} · {cur.dist} m from the pin{cur.author ? ` · © ${cur.author}` : ""}{cur.license ? ` · ${cur.license}` : ""} · <a href={cur.link} target="_blank" rel="noreferrer">open source <ExternalLink size={11} /></a>
      </p>}

      {strip.length > 0 && <div className="km-sv-strip" role="listbox" aria-label="Nearby photos">
        {strip.map((i) => <button key={i.id} role="option" aria-selected={i.id === curId} className={i.id === curId ? "on" : ""} style={{ ["--c" as string]: SV_COLOR[i.provider] }} onClick={() => setCurId(i.id)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={i.thumb} alt="" loading="lazy" /><span>{i.dist} m</span>{i.pano && <em>360</em>}
        </button>)}
      </div>}
      {!anyStreet && !loading && status && visible.length > 0 && <p className="km-sv-meta">Only landmark photos found here — no street-level coverage within 140 m.</p>}

      <div className="km-street-actions">
        <button className="km-primary" onClick={useCentre}><Crosshair size={14} />Look here</button>
        <button className="km-secondary" onClick={() => userLocation && onPoint({ lat: userLocation[1], lng: userLocation[0] })} disabled={!userLocation}><LocateFixed size={14} />My location</button>
        <label className="km-sv-cov"><input type="checkbox" checked={coverage} onChange={(e) => setCoverage(e.target.checked)} />Coverage lines</label>
        <a className="km-secondary" href={googleLink} target="_blank" rel="noreferrer"><ExternalLink size={14} />Google</a>
      </div>
      <p className="km-hint km-street-hint">Open data: Mapillary, KartaView, Panoramax and Wikimedia Commons (CC BY-SA / CC). Photos load through this app&apos;s server. Mapillary needs a free token; the others need no key.</p>
    </aside>
  </>;
}
