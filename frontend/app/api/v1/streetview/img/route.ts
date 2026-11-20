import { NextRequest, NextResponse } from "next/server";
import { allowedImageUrl } from "@/lib/svserver";

/**
 * Same-origin image proxy for street-level photos. The browser can then draw them in WebGL (360° viewer) without cross-origin
 * restrictions, and photos stored on a different KartaView host can be retried. Only a fixed list of image hosts is allowed.
 */
const MAX_BYTES = 25_000_000;

export async function GET(req: NextRequest) {
  const urls = new URL(req.url).searchParams.getAll("u").slice(0, 5);
  if (!urls.length) return new NextResponse("missing u", { status: 400 });
  let lastStatus = 404;
  for (const raw of urls) {
    const u = allowedImageUrl(raw);
    if (!u) { lastStatus = 400; continue; }
    try {
      const res = await fetch(u, { headers: { "User-Agent": "KarthikMap/1.0 (street view)", Accept: "image/*" }, signal: AbortSignal.timeout(20_000), redirect: "follow", cache: "no-store" });
      const type = res.headers.get("content-type") || "";
      const len = Number(res.headers.get("content-length") || 0);
      if (!res.ok || !type.startsWith("image/") || len > MAX_BYTES) { lastStatus = res.ok ? 415 : res.status; await res.body?.cancel(); continue; }
      return new NextResponse(res.body, { status: 200, headers: { "Content-Type": type, "Cache-Control": "public, max-age=86400, immutable" } });
    } catch { lastStatus = 502; }
  }
  return new NextResponse("image unavailable", { status: lastStatus === 400 ? 400 : 502 });
}
