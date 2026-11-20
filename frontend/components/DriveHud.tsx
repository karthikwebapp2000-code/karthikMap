"use client";

import { ArrowLeft, ArrowRight, ArrowUp, CornerUpLeft, CornerUpRight, Flag, Fuel, RotateCcw, Volume2, VolumeX, X } from "lucide-react";
import * as maplibregl from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildRouteIndex, fmtDist, projectOnRoute, type LngLat } from "@/lib/geo";
import { buzz, speak } from "@/lib/speak";
import { updateSettings, useSettings } from "@/lib/settings";

export type HudRoute = {
  distance_meters: number; duration_seconds: number; geometry: GeoJSON.LineString;
  steps: Array<{ instruction: string; distance_meters: number; location?: [number, number]; maneuver_type?: string; maneuver_modifier?: string }>;
};
type Props = { mapRef: React.RefObject<maplibregl.Map | null>; route: HudRoute | null; active: boolean; onStop: () => void };

function icon(type?: string, mod?: string) {
  if (type === "arrive") return Flag;
  if (mod === "uturn") return RotateCcw;
  if (mod === "left" || mod === "sharp left") return ArrowLeft;
  if (mod === "right" || mod === "sharp right") return ArrowRight;
  if (mod === "slight left") return CornerUpLeft;
  if (mod === "slight right") return CornerUpRight;
  return ArrowUp;
}

export default function DriveHud({ route, active, onStop }: Props) {
  const s = useSettings();
  const [pos, setPos] = useState<{ p: LngLat; kmh: number; acc: number } | null>(null);
  const [limit, setLimit] = useState<number | undefined>();
  const [road, setRoad] = useState<string | undefined>();
  const announced = useRef<Set<string>>(new Set());
  const limitAt = useRef(0);
  const ix = useMemo(() => (route ? buildRouteIndex(route.geometry.coordinates as LngLat[]) : null), [route]);
  const stepAlong = useMemo(() => (route && ix ? route.steps.map((st) => (st.location ? projectOnRoute(ix, st.location).along : 0)) : []), [route, ix]);

  useEffect(() => { announced.current = new Set(); }, [route]);
  useEffect(() => {
    if (!active || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition((g) => {
      const c = g.coords;
      setPos((prev) => ({ p: [c.longitude, c.latitude], kmh: c.speed != null && c.speed >= 0 ? c.speed * 3.6 : prev?.kmh ?? 0, acc: c.accuracy }));
    }, () => undefined, { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 });
    return () => navigator.geolocation.clearWatch(id);
  }, [active]);

  const prog = useMemo(() => (pos && ix ? projectOnRoute(ix, pos.p) : null), [pos, ix]);
  const remaining = prog && ix ? Math.max(0, ix.total - prog.along) : route?.distance_meters ?? 0;
  const nextIdx = useMemo(() => {
    if (!prog || !route) return -1;
    const i = stepAlong.findIndex((a, k) => k > 0 && a > prog.along + 8);
    return i;
  }, [prog, stepAlong, route]);
  const next = route && nextIdx >= 0 ? route.steps[nextIdx] : null;
  const dNext = prog && nextIdx >= 0 ? Math.max(0, stepAlong[nextIdx] - prog.along) : 0;

  // voice guidance
  useEffect(() => {
    if (!active || !route || !prog || prog.off > 80) return;
    if (remaining < 35 && !announced.current.has("arrive")) { announced.current.add("arrive"); speak("You have arrived at your destination", true); buzz(); return; }
    if (!next || nextIdx < 0) return;
    const text = next.instruction.replace(/^Head /, "Head ");
    if (dNext <= 130 && !announced.current.has(`${nextIdx}:near`)) { announced.current.add(`${nextIdx}:near`); announced.current.add(`${nextIdx}:far`); speak(text, true); }
    else if (dNext <= 450 && dNext > 130 && !announced.current.has(`${nextIdx}:far`)) { announced.current.add(`${nextIdx}:far`); speak(`In ${Math.round(dNext / 50) * 50} metres, ${text}`); }
  }, [active, route, prog, next, nextIdx, dNext, remaining]);

  // speed limit
  useEffect(() => {
    if (!active || !pos || pos.kmh < 6 || Date.now() - limitAt.current < 25_000) return;
    limitAt.current = Date.now();
    fetch(`/api/v1/roads/context?lat=${pos.p[1]}&lng=${pos.p[0]}`).then((r) => r.json()).then((d) => { if (d.status === "OK") { setLimit(d.maxspeed); setRoad(d.road); } }).catch(() => undefined);
  }, [active, pos]);

  const timeLeft = route && ix && ix.total ? route.duration_seconds * (remaining / ix.total) : 0;
  const eta = new Date(Date.now() + timeLeft * 1000);
  const fuel = (remaining / 1000 / Math.max(1, s.mileage)) * s.fuelPrice;
  const Icon = next ? icon(next.maneuver_type, next.maneuver_modifier) : Flag;
  const over = pos && limit && pos.kmh > limit + 5;

  if (route && !active) {
    return <div className="km-trip-cost" aria-label="Trip cost estimate"><Fuel size={15} /><span>Fuel ≈ <b>₹{Math.round((route.distance_meters / 1000 / Math.max(1, s.mileage)) * s.fuelPrice)}</b> · {fmtDist(route.distance_meters, s.units)}</span><small>at {s.mileage} km/l, ₹{s.fuelPrice}/l · tolls not included</small></div>;
  }
  if (!active || !route) return null;
  return <>
    <div className="km-hud-top" role="status" aria-live="polite">
      <i><Icon size={34} strokeWidth={2.6} /></i>
      <span><b>{next ? fmtDist(dNext, s.units) : "Arriving"}</b><small>{next ? next.instruction : "Destination ahead"}</small></span>
    </div>
    <div className="km-hud-bottom">
      <div className="km-hud-stat"><b>{eta.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</b><small>arrive</small></div>
      <div className="km-hud-stat"><b>{Math.max(1, Math.round(timeLeft / 60))}</b><small>min</small></div>
      <div className="km-hud-stat"><b>{fmtDist(remaining, s.units)}</b><small>left</small></div>
      <div className={`km-hud-speed${over ? " over" : ""}`}><b>{Math.round(pos?.kmh ?? 0)}</b><small>km/h</small>{limit ? <em className="km-limit">{limit}</em> : null}</div>
      <button onClick={() => updateSettings({ voiceOn: !s.voiceOn })} aria-label={s.voiceOn ? "Mute voice" : "Unmute voice"}>{s.voiceOn ? <Volume2 size={18} /> : <VolumeX size={18} />}</button>
      <button className="stop" onClick={onStop} aria-label="End navigation"><X size={18} /></button>
      {road && <small className="km-hud-road">{road}</small>}
    </div>
  </>;
}
