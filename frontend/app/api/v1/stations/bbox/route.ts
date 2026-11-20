import { NextRequest, NextResponse } from "next/server";
import { queryOverpass } from "@/lib/overpass";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const [south, west, north, east] = ["south", "west", "north", "east"].map((k) => Number(searchParams.get(k)));
  if ([south, west, north, east].some((v) => !Number.isFinite(v)) || south >= north || west >= east) {
    return NextResponse.json({ status: "INVALID_REQUEST", error: "south, west, north, east are required", stations: [] }, { status: 400 });
  }
  if (north - south > 6 || east - west > 6) {
    return NextResponse.json({ status: "TOO_LARGE", error: "Zoom in a little to list stations in view", stations: [] }, { status: 422 });
  }
  const query = `[out:json][timeout:15];nwr["railway"="station"]["name"]["station"!~"subway|light_rail|monorail|tram"](${south},${west},${north},${east});out center tags 500;`;
  try {
    const elements = await queryOverpass(query, 15_000);
    const seen = new Set<string>();
    const stations = elements.flatMap((e) => {
      const lat = e.lat ?? e.center?.lat;
      const lng = e.lon ?? e.center?.lon;
      if (!lat || !lng) return [];
      const id = `${e.type}_${e.id}`;
      if (seen.has(id)) return [];
      seen.add(id);
      return [{ id, name: e.tags.name || e.tags["name:en"], code: e.tags.ref || e.tags["railway:ref"] || "", lat, lng }];
    });
    return NextResponse.json({ status: "OK", count: stations.length, stations });
  } catch (error) {
    return NextResponse.json({ status: "ERROR", error: error instanceof Error ? error.message : "Overpass unavailable", stations: [] }, { status: 502 });
  }
}
