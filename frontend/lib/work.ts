import { STORAGE_PREFIX } from "./brand";

export type WorkType = "office" | "site" | "client" | "depot" | "station" | "other";

export const WORK_TYPES: Array<{ id: WorkType; label: string; color: string }> = [
  { id: "office", label: "Office", color: "#1a73e8" },
  { id: "site", label: "Site", color: "#e8710a" },
  { id: "client", label: "Client", color: "#188038" },
  { id: "depot", label: "Depot", color: "#9334e6" },
  { id: "station", label: "Rail station", color: "#d93025" },
  { id: "other", label: "Other", color: "#5f6368" },
];

export type WorkLocation = {
  id: string;
  name: string;
  type: WorkType;
  lat: number;
  lng: number;
  address: string;
  notes?: string;
  rating?: number; // your own 1–5 stars
  code?: string;
  createdAt: number;
};

const KEY = `${STORAGE_PREFIX}:work:locations`;
const ROUTE_KEY = `${STORAGE_PREFIX}:work:route`;

export function loadWorkLocations(): WorkLocation[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter(isWorkLocation) : [];
  } catch { return []; }
}

export function saveWorkLocations(list: WorkLocation[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage may be blocked */ }
}

export function loadRouteStops(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(ROUTE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch { return []; }
}

export function saveRouteStops(ids: string[]) {
  try { localStorage.setItem(ROUTE_KEY, JSON.stringify(ids)); } catch { /* ignore */ }
}

export function isWorkLocation(value: unknown): value is WorkLocation {
  const v = value as WorkLocation;
  return !!v && typeof v.id === "string" && typeof v.name === "string"
    && Number.isFinite(v.lat) && Number.isFinite(v.lng)
    && v.lat >= -90 && v.lat <= 90 && v.lng >= -180 && v.lng <= 180;
}

export function newId() {
  return `work_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function haversineMeters(a: [number, number], b: [number, number]) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Greedy nearest-neighbour ordering starting from `start` (keeps first stop fixed when `fixFirst`). */
export function nearestNeighbourOrder<T extends { lat: number; lng: number }>(
  stops: T[], start: [number, number] | null, fixFirst: boolean,
): T[] {
  if (stops.length < 3 && !start) return stops;
  const remaining = [...stops];
  const ordered: T[] = [];
  let current: [number, number] | null = start;
  if (fixFirst && remaining.length) {
    const first = remaining.shift() as T;
    ordered.push(first);
    current = [first.lng, first.lat];
  }
  while (remaining.length) {
    let best = 0;
    if (current) {
      let bestDist = Infinity;
      remaining.forEach((s, i) => {
        const d = haversineMeters(current as [number, number], [s.lng, s.lat]);
        if (d < bestDist) { bestDist = d; best = i; }
      });
    }
    const [next] = remaining.splice(best, 1);
    ordered.push(next);
    current = [next.lng, next.lat];
  }
  return ordered;
}

const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export function toCsv(list: WorkLocation[]) {
  const head = ["name", "type", "lat", "lng", "address", "code", "rating", "notes"];
  const rows = list.map((l) => [l.name, l.type, l.lat, l.lng, l.address, l.code ?? "", l.rating ?? "", l.notes ?? ""].map(csvCell).join(","));
  return [head.join(","), ...rows].join("\n");
}

export function download(filename: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function googleMapsMultiStopUrl(points: Array<[number, number]>, mode: "driving" | "cycling" | "walking") {
  if (points.length < 2) return "";
  const fmt = (p: [number, number]) => `${p[1]},${p[0]}`;
  const params = new URLSearchParams({
    api: "1",
    origin: fmt(points[0]),
    destination: fmt(points[points.length - 1]),
    travelmode: mode === "cycling" ? "bicycling" : mode,
  });
  if (points.length > 2) params.set("waypoints", points.slice(1, -1).map(fmt).join("|"));
  return `https://www.google.com/maps/dir/?${params}`;
}
