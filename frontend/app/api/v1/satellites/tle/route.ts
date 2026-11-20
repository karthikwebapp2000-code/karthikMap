import { NextRequest, NextResponse } from "next/server";
import { USER_AGENT } from "@/lib/brand";

// CelesTrak asks clients not to re-download a group more than about once per 2 hours,
// so the upstream fetch is cached for 2h and shared by every visitor of this server.
const QUERIES: Record<string, string> = {
  stations: "GROUP=stations",
  navic: "NAME=IRNSS",
  weather: "GROUP=weather",
  gps: "GROUP=gps-ops",
  earth: "GROUP=resource",
};

export async function GET(req: NextRequest) {
  const group = new URL(req.url).searchParams.get("group") || "stations";
  const query = QUERIES[group];
  if (!query) return NextResponse.json({ status: "INVALID_REQUEST", error: "Unknown satellite group", satellites: [] }, { status: 400 });
  try {
    const res = await fetch(`https://celestrak.org/NORAD/elements/gp.php?${query}&FORMAT=json`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
      next: { revalidate: 7200 },
    });
    if (!res.ok) throw new Error(`CelesTrak returned HTTP ${res.status}`);
    const text = await res.text();
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return NextResponse.json({ status: "ZERO_RESULTS", error: "No element sets returned for this group", satellites: [] }, { status: 404 });
    }
    return NextResponse.json(
      { status: "OK", group, count: Math.min(parsed.length, 250), fetched_at: new Date().toISOString(), source: "CelesTrak", satellites: parsed.slice(0, 250) },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=7200" } },
    );
  } catch (error) {
    return NextResponse.json({ status: "ERROR", error: error instanceof Error ? error.message : "Satellite feed unavailable", satellites: [] }, { status: 502 });
  }
}
