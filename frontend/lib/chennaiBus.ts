export type BusRoute = { n: string; l: string; s: number[]; o: number[]; t: number[] };
export type ChennaiBus = { stops: Array<[string, number, number]>; routes: BusRoute[]; attribution: string; collected: string };
export type NearStop = { idx: number; name: string; lat: number; lng: number; dist: number };
export type Departure = { route: string; to: string; at: number; wait: number; routeIdx: number };

export const CHENNAI_BOX = { west: 79.9, south: 12.75, east: 80.45, north: 13.4 };
export const inChennai = (lat: number, lng: number) =>
  lat >= CHENNAI_BOX.south && lat <= CHENNAI_BOX.north && lng >= CHENNAI_BOX.west && lng <= CHENNAI_BOX.east;

let cache: ChennaiBus | null = null;
let inflight: Promise<ChennaiBus> | null = null;
let stopRoutes: Map<number, Array<[number, number]>> | null = null;

export function loadChennaiBus(): Promise<ChennaiBus> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = fetch("/data/chennai-bus.json")
      .then((r) => { if (!r.ok) throw new Error(`Chennai bus data unavailable (HTTP ${r.status})`); return r.json() as Promise<ChennaiBus>; })
      .then((d) => (cache = d))
      .finally(() => { inflight = null; });
  }
  return inflight;
}

const meters = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const r = Math.PI / 180;
  const x = (bLng - aLng) * r * Math.cos(((aLat + bLat) / 2) * r);
  const y = (bLat - aLat) * r;
  return 6_371_000 * Math.sqrt(x * x + y * y);
};

export function nearestStops(d: ChennaiBus, lat: number, lng: number, limit = 15, maxM = 1500): NearStop[] {
  const out: NearStop[] = [];
  d.stops.forEach(([name, sLat, sLng], idx) => {
    const dist = meters(lat, lng, sLat, sLng);
    if (dist <= maxM) out.push({ idx, name, lat: sLat, lng: sLng, dist });
  });
  return out.sort((a, b) => a.dist - b.dist).slice(0, limit);
}

function routesAtStopMap(d: ChennaiBus) {
  if (stopRoutes) return stopRoutes;
  stopRoutes = new Map();
  d.routes.forEach((r, ri) => r.s.forEach((si, pos) => {
    const list = stopRoutes!.get(si);
    if (list) list.push([ri, pos]); else stopRoutes!.set(si, [[ri, pos]]);
  }));
  return stopRoutes;
}

/** Current time in Chennai, minutes since midnight. */
export function istMinutes(now = new Date()) {
  const [h, m] = now.toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour12: false, hour: "2-digit", minute: "2-digit" }).split(":").map(Number);
  return (h % 24) * 60 + m;
}

export function fmtClock(minutes: number) {
  const m = ((minutes % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  return `${((h24 + 11) % 12) + 1}:${String(m % 60).padStart(2, "0")} ${h24 < 12 ? "am" : "pm"}`;
}

/** Next scheduled buses at a stop (timetable, not live GPS). */
export function departuresAt(d: ChennaiBus, stopIdx: number, nowMin: number, limit = 14): Departure[] {
  const list = routesAtStopMap(d).get(stopIdx) || [];
  const out: Departure[] = [];
  const seen = new Set<string>();
  for (const [ri, pos] of list) {
    const r = d.routes[ri];
    if (pos === r.s.length - 1) continue;                  // bus ends here
    const offset = r.o[pos];
    const target = nowMin - offset;
    let lo = 0, hi = r.t.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (r.t[mid] < target) lo = mid + 1; else hi = mid; }
    for (let k = lo; k < Math.min(lo + 2, r.t.length); k++) {
      const at = r.t[k] + offset;
      const to = d.stops[r.s[r.s.length - 1]][0];
      const key = `${r.n}|${to}|${at}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ route: r.n, to, at, wait: at - nowMin, routeIdx: ri });
    }
  }
  return out.sort((a, b) => a.at - b.at).slice(0, limit);
}

export function routesServing(d: ChennaiBus, stopIdx: number) {
  const names = new Map<string, string>();
  for (const [ri] of routesAtStopMap(d).get(stopIdx) || []) {
    const r = d.routes[ri];
    names.set(r.n, d.stops[r.s[r.s.length - 1]][0]);
  }
  return [...names.entries()].map(([n, to]) => ({ n, to })).sort((a, b) => a.n.localeCompare(b.n, undefined, { numeric: true }));
}

export function searchRoutes(d: ChennaiBus, query: string, limit = 25): Array<{ idx: number; r: BusRoute }> {
  const q = query.trim().toLowerCase().replace(/\s+/g, "");
  if (!q) return [];
  const scored: Array<{ idx: number; r: BusRoute; score: number }> = [];
  d.routes.forEach((r, idx) => {
    const n = r.n.toLowerCase().replace(/\s+/g, "");
    let score = 0;
    if (n === q) score = 100; else if (n.startsWith(q)) score = 80; else if (r.l.toLowerCase().includes(query.trim().toLowerCase())) score = 40;
    if (score) scored.push({ idx, r, score: score + Math.min(r.t.length, 60) / 100 });
  });
  const seen = new Set<string>();
  return scored.sort((a, b) => b.score - a.score).filter(({ r }) => { const k = `${r.n}|${r.l}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, limit);
}
