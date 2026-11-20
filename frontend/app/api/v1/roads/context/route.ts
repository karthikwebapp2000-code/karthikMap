import { NextRequest, NextResponse } from "next/server";
import { queryOverpass } from "@/lib/overpass";

/** Speed limit of the nearest mapped road + road hazards (speed bumps, speed cameras) around a point — from OpenStreetMap. */
const KINDS: Record<string, string> = {
  bump: "Speed bump", hump: "Speed hump", table: "Raised crossing", cushion: "Speed cushion", rumble_strip: "Rumble strip", chicane: "Chicane", island: "Traffic island",
};

function segDist(p: [number, number], a: [number, number], b: [number, number]) {
  const kx = 111_320 * Math.cos((p[1] * Math.PI) / 180), ky = 110_540;
  const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky, bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * ky;
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}
function parseSpeed(v?: string) {
  if (!v) return undefined;
  const m = /^(\d{1,3})\s*(mph)?$/.exec(v.trim());
  if (!m) return undefined;
  return Math.round(+m[1] * (m[2] ? 1.609 : 1));
}

export async function GET(req: NextRequest) {
  const p = new URL(req.url).searchParams;
  const lat = Number(p.get("lat")), lng = Number(p.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ status: "INVALID_REQUEST", error: "lat and lng are required", hazards: [] }, { status: 400 });
  }
  const q = `[out:json][timeout:12];way(around:35,${lat},${lng})["highway"]["maxspeed"]->.w;.w out tags geom 8;(node(around:350,${lat},${lng})["traffic_calming"];node(around:350,${lat},${lng})["highway"="speed_camera"];node(around:350,${lat},${lng})["enforcement"="maxspeed"];node(around:350,${lat},${lng})["hazard"];);out tags 40;`;
  try {
    const els = await queryOverpass(q, 12_000);
    let best: { d: number; speed?: number; name?: string } | null = null;
    for (const e of els) {
      if (e.type !== "way" || !e.geometry?.length) continue;
      const pts = e.geometry.map((g: { lon: number; lat: number }) => [g.lon, g.lat] as [number, number]);
      let d = Infinity;
      for (let i = 1; i < pts.length; i++) d = Math.min(d, segDist([lng, lat], pts[i - 1], pts[i]));
      const speed = parseSpeed(e.tags?.maxspeed);
      if (speed && (!best || d < best.d)) best = { d, speed, name: e.tags?.name };
    }
    const rad = Math.PI / 180;
    const hazards = els.filter((e) => e.type === "node" && e.lat && e.lon).map((e) => {
      const t = e.tags || {};
      const kind = t.highway === "speed_camera" || t.enforcement === "maxspeed" ? "Speed camera" : t.traffic_calming ? KINDS[t.traffic_calming] || "Traffic calming" : `Hazard${t.hazard ? `: ${t.hazard.replace(/_/g, " ")}` : ""}`;
      const dx = (e.lon - lng) * rad * Math.cos(lat * rad), dy = (e.lat - lat) * rad;
      return { id: e.id, kind, lat: e.lat, lng: e.lon, dist: Math.round(6_371_000 * Math.hypot(dx, dy)) };
    }).sort((a, b) => a.dist - b.dist).slice(0, 20);
    return NextResponse.json({ status: "OK", maxspeed: best?.speed, road: best?.name, hazards });
  } catch (error) {
    return NextResponse.json({ status: "ERROR", error: error instanceof Error ? error.message : "Road data unavailable", hazards: [] }, { status: 502 });
  }
}
