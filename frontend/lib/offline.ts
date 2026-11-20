/** Offline vector-map regions: pre-downloads OpenFreeMap tiles, style, sprites and glyphs into Cache Storage; the service worker serves them when offline. */
export const TILE_CACHE = "km-tiles-v1";
export type Bbox = { west: number; south: number; east: number; north: number };
export type Region = { id: string; name: string; bbox: Bbox; zmin: number; zmax: number; tiles: number; bytes: number; at: number; template: string };

const MAX_LAT = 85.0511287798;
export const lngToX = (lng: number, z: number) => Math.floor(((lng + 180) / 360) * 2 ** z);
export const latToY = (lat: number, z: number) => {
  const l = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * (Math.PI / 180);
  return Math.floor(((1 - Math.log(Math.tan(l) + 1 / Math.cos(l)) / Math.PI) / 2) * 2 ** z);
};

export function tileRange(b: Bbox, z: number) {
  const x0 = lngToX(b.west, z), x1 = lngToX(b.east, z), y0 = latToY(b.north, z), y1 = latToY(b.south, z);
  return { x0: Math.min(x0, x1), x1: Math.max(x0, x1), y0: Math.min(y0, y1), y1: Math.max(y0, y1) };
}
export function countTiles(b: Bbox, zmin: number, zmax: number) {
  let n = 0;
  for (let z = zmin; z <= zmax; z++) { const r = tileRange(b, z); n += (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1); }
  return n;
}
export function* tileList(b: Bbox, zmin: number, zmax: number) {
  for (let z = zmin; z <= zmax; z++) {
    const r = tileRange(b, z);
    for (let x = r.x0; x <= r.x1; x++) for (let y = r.y0; y <= r.y1; y++) yield { z, x, y };
  }
}
export const AVG_TILE_BYTES = 28_000;
export const MAX_TILES = 6000;

const REGIONS_KEY = "karthikmap:offline:regions";
export const loadRegions = (): Region[] => { try { return JSON.parse(localStorage.getItem(REGIONS_KEY) || "[]"); } catch { return []; } };
export const saveRegions = (r: Region[]) => { try { localStorage.setItem(REGIONS_KEY, JSON.stringify(r)); } catch { /* ignore */ } };

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const fill = (tpl: string, z: number, x: number, y: number) => tpl.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
const GLYPH_RANGES = ["0-255", "256-511", "8192-8447", "2304-2559", "2816-3071"];   // Latin, punctuation, Devanagari, Tamil

async function putUrl(cache: Cache, url: string, signal?: AbortSignal): Promise<number> {
  const res = await fetch(url, { mode: "cors", signal });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const len = Number(res.headers.get("content-length")) || 0;
  await cache.put(url, res.clone());
  return len || (await res.clone().arrayBuffer()).byteLength;
}

export type Progress = { done: number; total: number; bytes: number; failed: number };

export async function downloadRegion(name: string, bbox: Bbox, zmin: number, zmax: number, onProgress: (p: Progress) => void, signal: AbortSignal): Promise<Region> {
  const total = countTiles(bbox, zmin, zmax);
  if (total > MAX_TILES) throw new Error(`That area needs ${total.toLocaleString()} tiles (limit ${MAX_TILES.toLocaleString()}). Zoom in or lower the detail.`);
  const cache = await caches.open(TILE_CACHE);
  const style = await (await fetch(STYLE_URL, { signal })).json();
  await cache.put(STYLE_URL, new Response(JSON.stringify(style), { headers: { "content-type": "application/json" } }));
  let bytes = 0;
  // vector source → TileJSON → tile template
  const vec = Object.values(style.sources as Record<string, { type: string; url?: string; tiles?: string[] }>).find((s) => s.type === "vector");
  if (!vec) throw new Error("Unexpected map style (no vector source)");
  let template = vec.tiles?.[0];
  if (vec.url) {
    bytes += await putUrl(cache, vec.url, signal);
    const tj = await (await cache.match(vec.url))!.clone().json();
    template = tj.tiles?.[0];
  }
  if (!template) throw new Error("Could not find the tile address in the map style");
  // sprites + glyphs
  const extras: string[] = [];
  if (style.sprite) for (const s of ["", "@2x"]) extras.push(`${style.sprite}${s}.json`, `${style.sprite}${s}.png`);
  if (style.glyphs) {
    const stacks = new Set<string>();
    for (const l of style.layers as Array<{ layout?: { "text-font"?: string[] } }>) if (l.layout?.["text-font"]) stacks.add(l.layout["text-font"].join(","));
    for (const st of stacks) for (const r of GLYPH_RANGES) extras.push((style.glyphs as string).replace("{fontstack}", encodeURIComponent(st)).replace("{range}", r));
  }
  await Promise.all(extras.map((u) => putUrl(cache, u, signal).then((b) => { bytes += b; }).catch(() => undefined)));

  let done = 0, failed = 0;
  const queue = [...tileList(bbox, zmin, zmax)];
  const worker = async () => {
    for (let t = queue.shift(); t; t = queue.shift()) {
      if (signal.aborted) return;
      try { bytes += await putUrl(cache, fill(template as string, t.z, t.x, t.y), signal); } catch (e) { if (signal.aborted) return; failed++; }
      done++;
      if (done % 8 === 0 || done === total) onProgress({ done, total, bytes, failed });
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  onProgress({ done, total, bytes, failed });
  if (failed > total * 0.1) throw new Error(`${failed} tiles failed to download — check your connection and try again.`);
  return { id: `r_${Date.now().toString(36)}`, name, bbox, zmin, zmax, tiles: total, bytes, at: Date.now(), template };
}

export async function deleteRegion(r: Region) {
  const cache = await caches.open(TILE_CACHE);
  for (const t of tileList(r.bbox, r.zmin, r.zmax)) await cache.delete(fill(r.template, t.z, t.x, t.y));
}
export async function clearAllOffline() { await caches.delete(TILE_CACHE); saveRegions([]); }
