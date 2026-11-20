import { NextRequest, NextResponse } from "next/server";
import { queryOverpass } from "@/lib/overpass";
import { USER_AGENT } from "@/lib/brand";

// Station codes -> coordinates never change often; keep a small in-memory cache per server instance.
const memo = new Map<string, unknown>();

function cleanForSearch(name: string) {
  return name
    .replace(/\bJn\.?/gi, "Junction")
    .replace(/\bCantt\.?/gi, "Cantonment")
    .replace(/\bCst\b/gi, "CST")
    .replace(/\s+/g, " ")
    .trim();
}

function title(name: string) {
  return name.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = (searchParams.get("code") || "").trim().toUpperCase();
  const name = (searchParams.get("name") || "").trim();
  if (!/^[A-Z0-9]{1,6}$/.test(code)) {
    return NextResponse.json({ status: "INVALID_REQUEST", error: "A valid station code is required" }, { status: 400 });
  }
  const cached = memo.get(code);
  if (cached) return NextResponse.json({ status: "OK", station: cached, cached: true });

  // 1) OSM: railway=station tagged with this Indian Railways code in `ref` (or `railway:ref`).
  try {
    const query = `[out:json][timeout:12];area["ISO3166-1"="IN"]->.in;(nwr["railway"="station"]["ref"="${code}"](area.in);nwr["railway"="station"]["railway:ref"="${code}"](area.in);nwr["railway"="halt"]["ref"="${code}"](area.in););out center tags 6;`;
    const elements = await queryOverpass(query, 12_000);
    const hit = elements.find((e) => (e.lat ?? e.center?.lat) && (e.lon ?? e.center?.lon));
    if (hit) {
      const station = {
        code,
        name: hit.tags?.name || hit.tags?.["name:en"] || title(name) || code,
        lat: hit.lat ?? hit.center.lat,
        lng: hit.lon ?? hit.center.lon,
        address: [hit.tags?.["addr:city"] || hit.tags?.["addr:district"], hit.tags?.["addr:state"], "India"].filter(Boolean).join(", ") || "Indian Railways station",
        source: "overpass" as const,
      };
      memo.set(code, station);
      return NextResponse.json({ status: "OK", station });
    }
  } catch { /* fall through to Nominatim */ }

  // 2) Nominatim text search by name inside India.
  if (name) {
    try {
      const q = `${cleanForSearch(name)} railway station`;
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&countrycodes=in&limit=6&addressdetails=1`,
        { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(10_000), cache: "no-store" },
      );
      if (res.ok) {
        const items: any[] = await res.json();
        const hit = items.find((i) => i.class === "railway" || /station|halt/.test(i.type)) || items[0];
        if (hit) {
          const station = {
            code,
            name: hit.name || title(name),
            lat: parseFloat(hit.lat),
            lng: parseFloat(hit.lon),
            address: hit.display_name || "India",
            source: "nominatim" as const,
          };
          memo.set(code, station);
          return NextResponse.json({ status: "OK", station });
        }
      }
    } catch { /* handled below */ }
  }
  return NextResponse.json({ status: "ZERO_RESULTS", error: `Could not find ${code} on the map right now. Try again in a moment.` }, { status: 404 });
}
