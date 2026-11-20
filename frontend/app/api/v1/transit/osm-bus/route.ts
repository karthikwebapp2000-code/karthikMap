import { NextRequest, NextResponse } from "next/server";
import { queryOverpass } from "@/lib/overpass";

/** Bus stops + the bus routes (OSM relations) that serve them, for any city. Quality depends on OSM mapping in that city. */
export async function GET(req: NextRequest) {
  const p = new URL(req.url).searchParams;
  const lat = Number(p.get("lat")), lng = Number(p.get("lng"));
  const radius = Math.min(Math.max(Number(p.get("radius")) || 700, 100), 1500);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ status: "INVALID_REQUEST", error: "lat and lng are required", stops: [] }, { status: 400 });
  }
  const query = `[out:json][timeout:20];(node(around:${radius},${lat},${lng})["highway"="bus_stop"];node(around:${radius},${lat},${lng})["public_transport"="platform"]["bus"="yes"];)->.s;rel(bn.s)["type"="route"]["route"="bus"]->.r;(.s;.r;);out body qt;`;
  try {
    const elements = await queryOverpass(query, 20_000);
    const nodes = elements.filter((e) => e.type === "node" && e.lat && e.lon);
    const rels = elements.filter((e) => e.type === "relation");
    const byStop = new Map<number, Array<{ ref: string; from?: string; to?: string; name?: string; operator?: string }>>();
    for (const r of rels) {
      const info = { ref: r.tags?.ref || r.tags?.name || "?", from: r.tags?.from, to: r.tags?.to, name: r.tags?.name, operator: r.tags?.operator };
      for (const m of r.members || []) {
        if (m.type !== "node") continue;
        const list = byStop.get(m.ref) || [];
        if (!list.some((x) => x.ref === info.ref && x.to === info.to)) list.push(info);
        byStop.set(m.ref, list);
      }
    }
    const rad = Math.PI / 180;
    const stops = nodes.map((n) => {
      const dx = (n.lon - lng) * rad * Math.cos(lat * rad), dy = (n.lat - lat) * rad;
      return {
        id: n.id, name: n.tags?.name || n.tags?.["name:en"] || "Bus stop", lat: n.lat, lng: n.lon,
        dist: Math.round(6_371_000 * Math.sqrt(dx * dx + dy * dy)),
        routes: (byStop.get(n.id) || []).sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true })),
      };
    }).sort((a, b) => a.dist - b.dist).slice(0, 40);
    return NextResponse.json({ status: "OK", count: stops.length, withRoutes: stops.filter((s) => s.routes.length).length, stops });
  } catch (error) {
    return NextResponse.json({ status: "ERROR", error: error instanceof Error ? error.message : "Overpass unavailable", stops: [] }, { status: 502 });
  }
}
