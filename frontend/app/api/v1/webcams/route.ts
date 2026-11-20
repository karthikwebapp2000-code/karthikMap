import { NextRequest, NextResponse } from "next/server";

/** Live webcams near a point via Windy Webcams API v3 (free key: api.windy.com/keys). Preview images on the free plan expire after ~10 minutes. */
const cache = new Map<string, { at: number; body: unknown }>();

export async function GET(req: NextRequest) {
  const key = process.env.WINDY_WEBCAMS_KEY;
  const p = new URL(req.url).searchParams;
  const lat = Number(p.get("lat")), lng = Number(p.get("lng"));
  const radius = Math.min(Math.max(Number(p.get("radius")) || 100, 5), 250);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return NextResponse.json({ status: "INVALID_REQUEST", error: "lat and lng are required", webcams: [] }, { status: 400 });
  if (!key) return NextResponse.json({ status: "NOT_CONFIGURED", error: "Live webcams need a free Windy Webcams key. Add WINDY_WEBCAMS_KEY to frontend/.env.local.", webcams: [] }, { status: 501 });
  const ck = `${lat.toFixed(1)},${lng.toFixed(1)},${radius}`;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < 5 * 60_000) return NextResponse.json(hit.body);
  try {
    const url = `https://api.windy.com/webcams/api/v3/webcams?lang=en&limit=24&offset=0&nearby=${lat.toFixed(4)},${lng.toFixed(4)},${radius}&include=images,location,player,urls`;
    const res = await fetch(url, { headers: { "x-windy-api-key": key }, signal: AbortSignal.timeout(15_000), cache: "no-store" });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json) return NextResponse.json({ status: "ERROR", error: res.status === 401 || res.status === 403 ? "Windy rejected the key" : `Webcam service returned HTTP ${res.status}`, webcams: [] }, { status: 502 });
    const webcams = ((json.webcams || []) as any[]).map((w) => ({
      id: String(w.webcamId), title: w.title, status: w.status,
      lat: w.location?.latitude, lng: w.location?.longitude, city: w.location?.city, country: w.location?.country,
      thumb: w.images?.current?.preview || w.images?.current?.thumbnail, live: w.player?.live || w.player?.day,
      link: w.urls?.detail || `https://www.windy.com/webcams/${w.webcamId}`,
    })).filter((w) => w.thumb);
    const body = { status: "OK", count: webcams.length, webcams };
    cache.set(ck, { at: Date.now(), body });
    return NextResponse.json(body);
  } catch (error) {
    return NextResponse.json({ status: "ERROR", error: error instanceof Error ? error.message : "Webcam service unavailable", webcams: [] }, { status: 502 });
  }
}
