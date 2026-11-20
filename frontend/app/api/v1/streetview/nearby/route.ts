import { NextRequest, NextResponse } from "next/server";
import { nearbyImagery } from "@/lib/svserver";
import type { SvProvider } from "@/lib/streetview";

const cache = new Map<string, { at: number; body: unknown }>();
const ALL: SvProvider[] = ["mapillary", "kartaview", "panoramax", "commons"];

/** Street-level imagery near a point from several open sources, merged and sorted by distance. */
export async function GET(req: NextRequest) {
  const p = new URL(req.url).searchParams;
  const lat = Number(p.get("lat")), lng = Number(p.get("lng"));
  const radius = Math.min(Math.max(Number(p.get("radius")) || 120, 30), 500);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ status: "INVALID_REQUEST", error: "lat and lng are required", items: [] }, { status: 400 });
  }
  const want = (p.get("providers") || ALL.join(",")).split(",").filter((x): x is SvProvider => (ALL as string[]).includes(x));
  const key = `${lat.toFixed(4)},${lng.toFixed(4)},${radius},${want.join("+")}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 120_000) return NextResponse.json(hit.body);
  const { items, status } = await nearbyImagery(lat, lng, radius, want);
  const body = { status: "OK", count: items.length, providers: status, items };
  if (cache.size > 200) cache.clear();
  if (items.length) cache.set(key, { at: Date.now(), body });
  return NextResponse.json(body);
}
