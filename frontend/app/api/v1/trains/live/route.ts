import { NextRequest, NextResponse } from "next/server";

/**
 * Live train running status via RailRadar (https://railradar.in/docs). Needs RAILRADAR_API_KEY (server-side).
 * The free plan is only ~100 requests/month, so replies are cached for 5 minutes per train/date.
 */
const cache = new Map<string, { at: number; body: unknown }>();
const TTL = 5 * 60_000;

export async function GET(req: NextRequest) {
  const key = process.env.RAILRADAR_API_KEY;
  const p = new URL(req.url).searchParams;
  const number = (p.get("number") || "").trim();
  const date = (p.get("date") || "").trim();
  if (!/^[0-9A-Za-z _/-]{1,20}$/.test(number)) return NextResponse.json({ status: "INVALID_REQUEST", error: "Enter a valid train number, e.g. 12627" }, { status: 400 });
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ status: "INVALID_REQUEST", error: "Date must be YYYY-MM-DD" }, { status: 400 });
  if (!key) return NextResponse.json({ status: "NOT_CONFIGURED", error: "Live train status needs a free RailRadar key. Add RAILRADAR_API_KEY to frontend/.env.local and restart." }, { status: 501 });

  const ck = `${number}|${date}`;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < TTL) return NextResponse.json({ ...(hit.body as object), cached: true });

  try {
    const url = `https://api.railradar.in/v1/trains/${encodeURIComponent(number)}/live?haltsOnly=true&includeCoordinates=true${date ? `&date=${date}` : ""}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000), cache: "no-store" });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success) {
      const code = json?.error?.code as string | undefined;
      const message = code === "TRAIN_NOT_FOUND" ? "Train not found — check the number."
        : code === "TRAIN_NOT_RUNNING" ? "That train does not run on this date."
        : res.status === 429 ? "Monthly free quota used up — try later or upgrade your RailRadar plan."
        : res.status === 401 ? "RailRadar rejected the key — check RAILRADAR_API_KEY."
        : json?.error?.message || `Train service returned HTTP ${res.status}`;
      return NextResponse.json({ status: "ERROR", error: message, code, candidates: json?.error?.candidates }, { status: res.status === 429 ? 429 : res.status >= 500 ? 502 : res.status });
    }
    const d = json.data;
    const body = {
      status: "OK",
      train: { number: d.trainNumber, name: d.trainName, type: d.train?.type, from: d.train?.source, to: d.train?.destination },
      runStatus: d.status, isLive: d.isLive, trackingMode: d.trackingMode, startDate: d.startDate, lastUpdatedAt: d.lastUpdatedAt,
      delayMinutes: d.delayMinutes, currentLocation: d.currentLocation, previousHalt: d.previousHalt, nextHalt: d.nextHalt, exceptions: d.exceptions || [],
      route: (d.route || []).map((s: any) => ({
        seq: s.sequence, code: s.stationCode, name: s.stationName, status: s.status, platform: s.platform,
        lat: s.lat ?? s.latitude ?? s.coordinates?.lat, lng: s.lng ?? s.lon ?? s.longitude ?? s.coordinates?.lng,
        schArr: s.scheduledArrival, schDep: s.scheduledDeparture, actArr: s.actualArrival, actDep: s.actualDeparture,
        delay: s.delayArrival ?? s.delayDeparture,
      })),
    };
    cache.set(ck, { at: Date.now(), body });
    return NextResponse.json(body);
  } catch (error) {
    return NextResponse.json({ status: "ERROR", error: error instanceof Error ? error.message : "Train service unavailable" }, { status: 502 });
  }
}
