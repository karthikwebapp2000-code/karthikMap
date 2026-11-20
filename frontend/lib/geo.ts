export type LngLat = [number, number];
export type TrackPoint = { lng: number; lat: number; t: number; speed?: number | null; acc?: number | null; alt?: number | null };

const R = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;

export function distM(a: LngLat, b: LngLat) {
  const dLat = rad(b[1] - a[1]), dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
export function bearing(a: LngLat, b: LngLat) {
  const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
  const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
export const lineLengthM = (pts: LngLat[]) => pts.reduce((s, p, i) => (i ? s + distM(pts[i - 1], p) : 0), 0);

/** Geodesic polygon area in m² (ring need not be closed). */
export function polygonAreaM2(ring: LngLat[]) {
  if (ring.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [l1, p1] = ring[i], [l2, p2] = ring[(i + 1) % ring.length];
    sum += rad(l2 - l1) * (2 + Math.sin(rad(p1)) + Math.sin(rad(p2)));
  }
  return Math.abs((sum * R * R) / 2);
}

export const fmtDist = (m: number, units: "km" | "mi" = "km") => {
  if (units === "mi") { const mi = m / 1609.344; return mi < 0.1 ? `${Math.round(m * 3.28084)} ft` : `${mi.toFixed(mi < 10 ? 2 : 1)} mi`; }
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10_000 ? 2 : 1)} km`;
};
export const fmtArea = (m2: number, units: "km" | "mi" = "km") => {
  if (units === "mi") return m2 < 4046.86 * 100 ? `${(m2 * 10.7639).toFixed(0)} ft²` : `${(m2 / 4046.86).toFixed(2)} acres`;
  if (m2 < 10_000) return `${m2.toFixed(1)} m²`;
  return m2 < 1_000_000 ? `${(m2 / 10_000).toFixed(2)} ha · ${(m2 / 4046.86).toFixed(2)} acres` : `${(m2 / 1e6).toFixed(2)} km²`;
};
export const fmtDuration = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};

export type TrackStats = { distanceM: number; durationS: number; movingS: number; avgKmh: number; maxKmh: number };
export function trackStats(pts: TrackPoint[]): TrackStats {
  let distanceM = 0, movingS = 0, maxKmh = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = distM([pts[i - 1].lng, pts[i - 1].lat], [pts[i].lng, pts[i].lat]);
    const dt = (pts[i].t - pts[i - 1].t) / 1000;
    if (dt <= 0) continue;
    const v = (pts[i].speed != null && pts[i].speed! >= 0 ? pts[i].speed! : d / dt) * 3.6;
    if (d > 2) { distanceM += d; movingS += dt; }
    if (v > maxKmh && v < 250) maxKmh = v;
  }
  const durationS = pts.length > 1 ? (pts[pts.length - 1].t - pts[0].t) / 1000 : 0;
  return { distanceM, durationS, movingS, avgKmh: movingS > 0 ? (distanceM / movingS) * 3.6 : 0, maxKmh };
}

/** Drop GPS jitter: ignore fixes with poor accuracy or that imply an impossible jump. */
export function acceptFix(prev: TrackPoint | undefined, next: TrackPoint) {
  if (next.acc != null && next.acc > 60) return false;
  if (!prev) return true;
  const dt = (next.t - prev.t) / 1000;
  if (dt <= 0) return false;
  const d = distM([prev.lng, prev.lat], [next.lng, next.lat]);
  if (d / dt > 90) return false;                                   // > 324 km/h
  const noise = Math.max(3, Math.min(next.acc ?? 8, 25) * 0.5);
  return d >= noise || dt > 20;
}

export type Geofence = { id: string; name: string; lat: number; lng: number; radius: number; color: string; onEnter: boolean; onExit: boolean };
export type GeoEvent = { id: string; at: number; kind: "enter" | "exit" | "overspeed" | "hazard" | "start" | "stop"; severity: "info" | "warning" | "critical"; text: string; lat?: number; lng?: number };

/** Compare previous and current inside-state per geofence → events. */
export function geofenceEvents(fences: Geofence[], inside: Record<string, boolean>, p: LngLat, at: number): { events: GeoEvent[]; inside: Record<string, boolean> } {
  const next: Record<string, boolean> = {};
  const events: GeoEvent[] = [];
  for (const f of fences) {
    const now = distM([f.lng, f.lat], p) <= f.radius;
    next[f.id] = now;
    const was = inside[f.id];
    if (was === undefined) continue;                               // first sample: establish state silently
    if (now && !was && f.onEnter) events.push({ id: `${f.id}:${at}:e`, at, kind: "enter", severity: "info", text: `Arrived at ${f.name}`, lat: p[1], lng: p[0] });
    if (!now && was && f.onExit) events.push({ id: `${f.id}:${at}:x`, at, kind: "exit", severity: "info", text: `Left ${f.name}`, lat: p[1], lng: p[0] });
  }
  return { events, inside: next };
}

export function circlePolygon(center: LngLat, radiusM: number, steps = 64): LngLat[] {
  const out: LngLat[] = [];
  const dLat = radiusM / R, lat1 = rad(center[1]), lng1 = rad(center[0]);
  for (let i = 0; i <= steps; i++) {
    const b = (i / steps) * 2 * Math.PI;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(dLat) + Math.cos(lat1) * Math.sin(dLat) * Math.cos(b));
    const lng2 = lng1 + Math.atan2(Math.sin(b) * Math.sin(dLat) * Math.cos(lat1), Math.cos(dLat) - Math.sin(lat1) * Math.sin(lat2));
    out.push([(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
  }
  return out;
}

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c] as string));
export function toGpx(name: string, pts: TrackPoint[]) {
  const seg = pts.map((p) => `<trkpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}">${p.alt != null ? `<ele>${p.alt.toFixed(1)}</ele>` : ""}<time>${new Date(p.t).toISOString()}</time></trkpt>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Karthik Map" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${esc(name)}</name><trkseg>${seg}</trkseg></trk></gpx>`;
}

export type RouteIndex = { coords: LngLat[]; cum: number[]; total: number };
export function buildRouteIndex(coords: LngLat[]): RouteIndex {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + distM(coords[i - 1], coords[i]));
  return { coords, cum, total: cum[cum.length - 1] || 0 };
}
/** Distance travelled along the route (m) and sideways distance from it (m) for a point. */
export function projectOnRoute(ix: RouteIndex, p: LngLat): { along: number; off: number } {
  let best = { along: 0, off: Infinity };
  const kx = 111_320 * Math.cos(rad(p[1])), ky = 110_540;
  for (let i = 1; i < ix.coords.length; i++) {
    const a = ix.coords[i - 1], b = ix.coords[i];
    const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky, bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * ky;
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const off = Math.hypot(ax + t * dx, ay + t * dy);
    if (off < best.off) best = { off, along: ix.cum[i - 1] + t * (ix.cum[i] - ix.cum[i - 1]) };
  }
  return best;
}
