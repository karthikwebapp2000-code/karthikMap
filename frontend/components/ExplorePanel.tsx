"use client";

import { Banknote, Bath, Bed, Building2, Bus, Clapperboard, Compass, Copy, Fuel, GraduationCap, Landmark, Mail, ParkingSquare, Pill, Plane, ShieldAlert, ShoppingBag, Stethoscope, Store, Train, TramFront, TreePine, Utensils, Video, X, Zap } from "lucide-react";
import * as maplibregl from "maplibre-gl";
import { useEffect, useMemo, useState } from "react";
import { digipinEncode } from "@/lib/digipin";
import { dayDivisions, localDate, sunTimes } from "@/lib/sun";

const TILES: Array<[string, string, React.ElementType, string]> = [
  ["restaurant", "Food", Utensils, "#ff9f0a"], ["atm", "ATMs", Banknote, "#30d158"], ["bank", "Banks", Building2, "#0a84ff"], ["hospital", "Hospitals", Stethoscope, "#ff453a"],
  ["pharmacy", "Pharmacy", Pill, "#30b0c7"], ["fuel", "Petrol", Fuel, "#ff6482"], ["shopping", "Shops", ShoppingBag, "#bf5af2"], ["mall", "Malls", Store, "#5e5ce6"],
  ["hotel", "Hotels", Bed, "#ac8e68"], ["railway", "Railway", Train, "#d93025"], ["metro", "Metro", TramFront, "#0a84ff"], ["bus", "Bus stops", Bus, "#30b0c7"],
  ["airport", "Airports", Plane, "#64d2ff"], ["post_office", "Post office", Mail, "#ff9f0a"], ["school", "Schools", GraduationCap, "#5e5ce6"], ["police", "Police/Fire", ShieldAlert, "#ff453a"],
  ["parking", "Parking", ParkingSquare, "#8e8e93"], ["ev", "EV charging", Zap, "#30d158"], ["toilets", "Toilets", Bath, "#64d2ff"], ["park", "Parks", TreePine, "#30d158"],
  ["cinema", "Cinemas", Clapperboard, "#bf5af2"], ["temple", "Worship", Landmark, "#ff9f0a"],
];
const FAMOUS: Array<[string, [number, number]]> = [
  ["Taj Mahal", [78.0421, 27.1751]], ["Eiffel Tower", [2.2945, 48.8584]], ["Burj Khalifa", [55.2744, 25.1972]], ["Manhattan", [-74.0134, 40.7061]], ["Big Ben", [-0.1246, 51.5007]],
  ["Shibuya", [139.7005, 35.6595]], ["Marina Bay", [103.8607, 1.2834]], ["Sydney Opera", [151.2153, -33.8568]], ["Golden Gate", [-122.4786, 37.8199]], ["Colosseum", [12.4924, 41.8902]],
  ["Meenakshi Temple", [78.1198, 9.9195]], ["Gateway of India", [72.8347, 18.922]], ["India Gate", [77.2295, 28.6129]], ["Marina Beach", [80.2824, 13.0500]],
];

type Cam = { id: string; title: string; city?: string; country?: string; thumb: string; link: string };
type Props = {
  mapRef: React.RefObject<maplibregl.Map | null>; mapReady: boolean; open: boolean; userLocation: [number, number] | null;
  activeCategory: string | null; onCategory: (id: string) => void; onClose: () => void;
};

const clock = (d: Date, tz?: string) => d.toLocaleTimeString([], { timeZone: tz, hour: "numeric", minute: "2-digit" });

export default function ExplorePanel({ mapRef, open, userLocation, activeCategory, onCategory, onClose }: Props) {
  const [point, setPoint] = useState<{ lat: number; lng: number; src: string } | null>(null);
  const [cams, setCams] = useState<Cam[] | null>(null);
  const [camErr, setCamErr] = useState("");
  const [camLoading, setCamLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    const c = mapRef.current?.getCenter();
    setPoint(userLocation ? { lat: userLocation[1], lng: userLocation[0], src: "your location" } : c ? { lat: c.lat, lng: c.lng, src: "map centre" } : null);
  }, [open, userLocation, mapRef]);

  const today = useMemo(() => {
    if (!point) return null;
    const inIndia = point.lat > 6 && point.lat < 37.5 && point.lng > 68 && point.lng < 98;
    const tz = inIndia ? "Asia/Kolkata" : undefined;
    const d = localDate(new Date(), tz);
    const t = sunTimes(d.year, d.month, d.day, point.lat, point.lng);
    const dp = digipinEncode(point.lat, point.lng);
    if ("polar" in t) return { tz, polar: t.polar, dp, inIndia } as const;
    const div = dayDivisions(t.sunrise, t.sunset, d.weekday);
    const now = Date.now();
    const inRahu = now >= div.rahu.start.getTime() && now < div.rahu.end.getTime();
    return { tz, t, div, dp, inRahu, inIndia } as const;
  }, [point]);

  const findCams = async () => {
    const c = mapRef.current?.getCenter(); if (!c) return;
    setCamLoading(true); setCamErr(""); setCams(null);
    try {
      const r = await fetch(`/api/v1/webcams?lat=${c.lat}&lng=${c.lng}&radius=150`);
      const j = await r.json();
      if (!r.ok || j.status !== "OK") throw new Error(j.error || "Webcams unavailable");
      setCams(j.webcams); if (!j.webcams.length) setCamErr("No webcams within 150 km of the map centre.");
    } catch (e) { setCamErr(e instanceof Error ? e.message : "Webcams unavailable"); } finally { setCamLoading(false); }
  };

  if (!open) return null;
  return <aside className="km-panel" aria-label="Explore">
    <header><div><Compass size={18} /><strong>Explore</strong></div><button onClick={onClose} aria-label="Close explore"><X size={17} /></button></header>
    <div className="km-body">
      <section>
        <h3>Nearby places</h3>
        <div className="km-tile-grid">{TILES.map(([id, label, Icon, color]) => <button key={id} aria-pressed={activeCategory === id} onClick={() => onCategory(id)}><i style={{ ["--tile" as string]: color }}><Icon size={19} /></i><span>{label}</span></button>)}</div>
        <p className="km-hint">Shows places around the map centre. Tap again to clear. Data: OpenStreetMap.</p>
      </section>

      {today && <section>
        <h3>Today here <small>({point?.src})</small></h3>
        {"polar" in today && today.polar ? <p className="km-hint">{today.polar === "day" ? "The sun does not set today at this latitude." : "The sun does not rise today at this latitude."}</p> : <>
          <dl>
            <div><dt>Sunrise</dt><dd>{clock(today.t!.sunrise, today.tz)}</dd></div>
            <div><dt>Sunset</dt><dd>{clock(today.t!.sunset, today.tz)}</dd></div>
            <div><dt>Daylight</dt><dd>{Math.floor(today.t!.dayMinutes / 60)} h {Math.round(today.t!.dayMinutes % 60)} min</dd></div>
            <div><dt>Solar noon</dt><dd>{clock(today.t!.solarNoon, today.tz)}</dd></div>
            {today.inIndia && today.div && <>
              <div className="wide"><dt>Rahu Kalam {today.inRahu && <b style={{ color: "var(--danger)" }}>· now</b>}</dt><dd>{clock(today.div.rahu.start, today.tz)} – {clock(today.div.rahu.end, today.tz)}</dd></div>
              <div><dt>Yamagandam</dt><dd>{clock(today.div.yamagandam.start, today.tz)} – {clock(today.div.yamagandam.end, today.tz)}</dd></div>
              <div><dt>Gulika</dt><dd>{clock(today.div.gulika.start, today.tz)} – {clock(today.div.gulika.end, today.tz)}</dd></div>
              <div className="wide"><dt>Abhijit muhurta</dt><dd>{clock(today.div.abhijit.start, today.tz)} – {clock(today.div.abhijit.end, today.tz)}</dd></div>
            </>}
          </dl>
          {today.inIndia && <p className="km-hint">Rahu Kalam, Yamagandam, Gulika and Abhijit are the traditional day-division timings worked out from today&apos;s sunrise and sunset. Tithi, nakshatra and festivals are not included — confirm with your local panchang.</p>}
        </>}
        {today.dp ? <div className="km-digipin"><span><small>DIGIPIN of this spot</small><b>{today.dp}</b></span><button className="km-secondary" onClick={() => { void navigator.clipboard?.writeText(today.dp as string); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }}><Copy size={13} />{copied ? "Copied" : "Copy"}</button></div> : <p className="km-hint">DIGIPIN covers locations inside India only.</p>}
      </section>}

      <section>
        <h3><Video size={15} />Live webcams</h3>
        <button className="km-secondary" onClick={() => void findCams()} disabled={camLoading}>{camLoading ? <span className="search-spinner" /> : <Video size={14} />}Webcams near map centre</button>
        {camErr && <p className="km-note">{camErr}</p>}
        {cams && cams.length > 0 && <div className="km-cam-grid">{cams.map((c) => <a key={c.id} href={c.link} target="_blank" rel="noreferrer"><img src={c.thumb} alt={c.title} loading="lazy" /><span><b>LIVE</b>{c.title}</span><small>{[c.city, c.country].filter(Boolean).join(", ")}</small></a>)}</div>}
        <p className="km-hint">Powered by Windy Webcams (free key). Snapshots refresh when you search again; tap one to watch on Windy.</p>
      </section>

      <section>
        <h3>Famous places in 3D</h3>
        <div className="km-city-chips">{FAMOUS.map(([name, c]) => <button key={name} onClick={() => mapRef.current?.flyTo({ center: c, zoom: 16.2, pitch: 62, bearing: -25, duration: 2800, essential: true })}>{name}</button>)}</div>
        <p className="km-hint">3D comes from OpenStreetMap building shapes (not photo-realistic). Turn on 3D buildings in Map style if needed.</p>
      </section>
    </div>
  </aside>;
}
