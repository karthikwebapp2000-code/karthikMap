import * as sat from "satellite.js";

export type SatGroupId = "stations" | "navic" | "weather" | "gps" | "earth";

export const SAT_GROUPS: Array<{ id: SatGroupId; label: string; blurb: string; color: string }> = [
  { id: "stations", label: "Space stations", blurb: "ISS, Tiangong and visiting craft", color: "#d93025" },
  { id: "navic", label: "NavIC (IRNSS)", blurb: "India's regional navigation constellation", color: "#188038" },
  { id: "weather", label: "Weather", blurb: "NOAA, Meteosat, INSAT-class weather satellites", color: "#1a73e8" },
  { id: "gps", label: "GPS", blurb: "US GPS operational constellation", color: "#e8710a" },
  { id: "earth", label: "Earth observation", blurb: "Landsat, Sentinel, Resourcesat and more", color: "#9334e6" },
];

export type TrackedSat = {
  id: string;
  name: string;
  noradId: number;
  group: SatGroupId;
  rec: sat.SatRec;
  epoch: string;
  periodMin: number;
};

export type SatPosition = { lng: number; lat: number; altKm: number; speedKmS: number };
export type SatPass = { start: Date; end: Date; maxElevationDeg: number; maxAt: Date; ongoing: boolean };

const EARTH_RADIUS_KM = 6371;

export function buildSatellites(records: unknown, group: SatGroupId): TrackedSat[] {
  if (!Array.isArray(records)) return [];
  const out: TrackedSat[] = [];
  for (const raw of records) {
    try {
      const omm = raw as sat.OMMJsonObject;
      const rec = sat.json2satrec(omm);
      const noradId = Number((omm as unknown as { NORAD_CAT_ID?: number }).NORAD_CAT_ID);
      const meanMotion = Number((omm as unknown as { MEAN_MOTION?: number }).MEAN_MOTION);
      out.push({
        id: `${group}:${noradId || omm.OBJECT_ID}`,
        name: String(omm.OBJECT_NAME || "UNKNOWN").trim(),
        noradId: Number.isFinite(noradId) ? noradId : 0,
        group,
        rec,
        epoch: String((omm as unknown as { EPOCH?: string }).EPOCH || ""),
        periodMin: meanMotion > 0 ? 1440 / meanMotion : 0,
      });
    } catch { /* skip malformed element sets */ }
  }
  return out;
}

export function positionAt(s: TrackedSat, date: Date): SatPosition | null {
  const pv = sat.propagate(s.rec, date);
  if (!pv || !pv.position || !pv.velocity) return null;
  const gmst = sat.gstime(date);
  const geo = sat.eciToGeodetic(pv.position, gmst);
  const lat = sat.degreesLat(geo.latitude);
  const lng = sat.degreesLong(geo.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(geo.height)) return null;
  const v = pv.velocity;
  return { lng, lat, altKm: geo.height, speedKmS: Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) };
}

/** Ground track as line segments, split wherever it crosses the antimeridian. */
export function groundTrack(s: TrackedSat, center: Date, minutesBefore: number, minutesAfter: number, stepSec = 30): [number, number][][] {
  const segments: [number, number][][] = [];
  let current: [number, number][] = [];
  let prevLng: number | null = null;
  for (let t = -minutesBefore * 60; t <= minutesAfter * 60; t += stepSec) {
    const p = positionAt(s, new Date(center.getTime() + t * 1000));
    if (!p) continue;
    if (prevLng !== null && Math.abs(p.lng - prevLng) > 180) {
      if (current.length > 1) segments.push(current);
      current = [];
    }
    current.push([p.lng, p.lat]);
    prevLng = p.lng;
  }
  if (current.length > 1) segments.push(current);
  return segments;
}

/** Circle on the ground that can currently "see" the satellite (0° elevation). */
export function footprint(lng: number, lat: number, altKm: number, points = 72): [number, number][] {
  const angular = Math.acos(EARTH_RADIUS_KM / (EARTH_RADIUS_KM + Math.max(altKm, 1)));
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;
  const ring: [number, number][] = [];
  for (let i = 0; i <= points; i++) {
    const bearing = (i / points) * 2 * Math.PI;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing));
    const lng2 = lng1 + Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1), Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2));
    ring.push([(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
  }
  return ring;
}

export function elevationDeg(s: TrackedSat, date: Date, observer: { lat: number; lng: number }): number | null {
  const pv = sat.propagate(s.rec, date);
  if (!pv || !pv.position) return null;
  const gmst = sat.gstime(date);
  const ecf = sat.eciToEcf(pv.position, gmst);
  const look = sat.ecfToLookAngles({
    longitude: sat.degreesToRadians(observer.lng),
    latitude: sat.degreesToRadians(observer.lat),
    height: 0,
  }, ecf);
  return sat.radiansToDegrees(look.elevation);
}

/** Upcoming passes above `minElevationDeg` for an observer on the ground. */
export function nextPasses(
  s: TrackedSat,
  observer: { lat: number; lng: number },
  from = new Date(),
  hours = 24,
  minElevationDeg = 10,
  maxPasses = 5,
): SatPass[] {
  const passes: SatPass[] = [];
  const stepMs = 20_000;
  const end = from.getTime() + hours * 3_600_000;
  let active: SatPass | null = null;
  for (let t = from.getTime(); t <= end; t += stepMs) {
    const date = new Date(t);
    const el = elevationDeg(s, date, observer);
    if (el === null) continue;
    if (el >= minElevationDeg) {
      if (!active) active = { start: date, end: date, maxElevationDeg: el, maxAt: date, ongoing: t === from.getTime() };
      active.end = date;
      if (el > active.maxElevationDeg) { active.maxElevationDeg = el; active.maxAt = date; }
    } else if (active) {
      passes.push(active);
      active = null;
      if (passes.length >= maxPasses) return passes;
    }
  }
  if (active && passes.length < maxPasses) passes.push(active);
  return passes;
}
