import { NextRequest, NextResponse } from "next/server";
import { formatDistanceText, formatDurationText } from "@/lib/format";

const OSRM: Record<string, string> = {
  driving: "https://routing.openstreetmap.de/routed-car/route/v1/driving",
  cycling: "https://routing.openstreetmap.de/routed-bike/route/v1/driving",
  walking: "https://routing.openstreetmap.de/routed-foot/route/v1/driving",
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("mode") || "driving";
  const raw = (searchParams.get("points") || "").split(";").filter(Boolean);
  const points = raw.map((p) => p.split(",").map(Number));
  if (!OSRM[mode]) return NextResponse.json({ status: "INVALID_REQUEST", error: "Unsupported travel mode" }, { status: 400 });
  if (points.length < 2 || points.length > 25 || points.some((p) => p.length !== 2 || p.some((n) => !Number.isFinite(n)) || Math.abs(p[0]) > 90 || Math.abs(p[1]) > 180)) {
    return NextResponse.json({ status: "INVALID_REQUEST", error: "Provide 2–25 stops as lat,lng;lat,lng" }, { status: 400 });
  }
  const path = points.map(([lat, lng]) => `${lng},${lat}`).join(";");
  try {
    const res = await fetch(`${OSRM[mode]}/${path}?overview=full&geometries=geojson&steps=false&continue_straight=false`, {
      signal: AbortSignal.timeout(20_000), cache: "no-store",
    });
    if (!res.ok) throw new Error(`Routing service returned HTTP ${res.status}`);
    const data = await res.json();
    const route = data.routes?.[0];
    if (data.code !== "Ok" || !route) return NextResponse.json({ status: "ZERO_RESULTS", error: "No drivable connection between these stops" }, { status: 404 });
    return NextResponse.json({
      status: "OK",
      distance_meters: Math.round(route.distance),
      distance_text: formatDistanceText(route.distance),
      duration_seconds: Math.round(route.duration),
      duration_text: formatDurationText(route.duration),
      geometry: route.geometry,
      legs: (route.legs || []).map((leg: { distance: number; duration: number }) => ({
        distance_meters: Math.round(leg.distance),
        distance_text: formatDistanceText(leg.distance),
        duration_seconds: Math.round(leg.duration),
        duration_text: formatDurationText(leg.duration),
      })),
    });
  } catch (error) {
    return NextResponse.json({ status: "ERROR", error: error instanceof Error ? error.message : "Routing failed" }, { status: 502 });
  }
}
