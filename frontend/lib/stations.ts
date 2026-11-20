export type Station = { n: string; c: string };

export type ResolvedStation = {
  code: string;
  name: string;
  lat: number;
  lng: number;
  address: string;
  source: "overpass" | "nominatim";
};

let cache: Station[] | null = null;
let inflight: Promise<Station[]> | null = null;

/** Lazy-load the bundled Indian Railways station list (name + code). */
export async function loadStations(): Promise<Station[]> {
  if (cache) return cache;
  if (!inflight) {
    inflight = fetch("/data/railway-stations.json")
      .then((r) => {
        if (!r.ok) throw new Error(`Station list unavailable (HTTP ${r.status})`);
        return r.json() as Promise<Station[]>;
      })
      .then((list) => (cache = list))
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/** Pretty-print dataset names: "TIRUCHCHIRAPPALLI Jn." -> "Tiruchchirappalli Jn." */
export function prettyStationName(name: string) {
  return name
    .toLowerCase()
    .replace(/\b([a-z])([a-z]*)/g, (_m, a: string, b: string) => a.toUpperCase() + b)
    .replace(/\bJn\b\.?/g, "Jn.")
    .replace(/\bCantt\b\.?/g, "Cantt.")
    .replace(/\bCst\b/g, "CST");
}

/** Rank: exact code > code prefix > name prefix > word prefix > substring. */
export function searchStations(list: Station[], query: string, limit = 30): Station[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: Array<{ s: Station; score: number }> = [];
  for (const s of list) {
    const name = s.n.toLowerCase();
    const code = s.c.toLowerCase();
    let score = 0;
    if (code === q) score = 100;
    else if (name === q) score = 95;
    else if (code.startsWith(q) && q.length >= 2) score = 80;
    else if (name.startsWith(q)) score = 70;
    else if (name.split(/[\s.]+/).some((w) => w.startsWith(q))) score = 55;
    else if (name.includes(q)) score = 40;
    if (score) scored.push({ s, score: score - Math.min(name.length, 30) / 100 });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.s);
}

export async function resolveStation(station: Station, signal?: AbortSignal): Promise<ResolvedStation> {
  const params = new URLSearchParams({ code: station.c, name: station.n });
  const response = await fetch(`/api/v1/stations/resolve?${params}`, { signal });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.status !== "OK") throw new Error(data.error || "Could not locate this station on the map");
  return data.station as ResolvedStation;
}
