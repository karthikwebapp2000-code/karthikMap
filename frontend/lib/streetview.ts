export type SvProvider = "mapillary" | "kartaview" | "panoramax" | "commons";
export type SvItem = {
  id: string; provider: SvProvider; lat: number; lng: number; heading: number | null; pano: boolean; at: number | null;
  author?: string; license?: string; title?: string; seq?: string; thumb: string; full: string; link: string; dist: number;
};
export const SV_LABEL: Record<SvProvider, string> = { mapillary: "Mapillary", kartaview: "KartaView", panoramax: "Panoramax", commons: "Landmarks" };
export const SV_COLOR: Record<SvProvider, string> = { mapillary: "#05cb63", kartaview: "#8f8aff", panoramax: "#0a84ff", commons: "#ff9f0a" };
export type SvStatus = Record<SvProvider, { ok: boolean; count: number; error?: string; skipped?: string }>;

const rad = (d: number) => (d * Math.PI) / 180;
export function bearingDeg(aLat: number, aLng: number, bLat: number, bLng: number) {
  const y = Math.sin(rad(bLng - aLng)) * Math.cos(rad(bLat));
  const x = Math.cos(rad(aLat)) * Math.sin(rad(bLat)) - Math.sin(rad(aLat)) * Math.cos(rad(bLat)) * Math.cos(rad(bLng - aLng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
export const angleDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
export function distMeters(aLat: number, aLng: number, bLat: number, bLng: number) {
  const dLat = rad(bLat - aLat), dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 12_742_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "Walk" along the street: nearest photo in the direction of travel (dir = +1 forward, −1 back), from the current photo's heading. */
export function stepAlong(items: SvItem[], cur: SvItem, dir: 1 | -1): SvItem | null {
  const facing = cur.heading ?? 0;
  const want = dir === 1 ? facing : (facing + 180) % 360;
  let best: SvItem | null = null, bestScore = Infinity;
  for (const it of items) {
    if (it.id === cur.id || it.provider === "commons") continue;
    const d = distMeters(cur.lat, cur.lng, it.lat, it.lng);
    if (d < 2 || d > 70) continue;
    const diff = angleDiff(bearingDeg(cur.lat, cur.lng, it.lat, it.lng), want);
    if (diff > 55) continue;
    const score = d + diff * 0.6 + (it.provider === cur.provider ? 0 : 12);
    if (score < bestScore) { best = it; bestScore = score; }
  }
  return best;
}
