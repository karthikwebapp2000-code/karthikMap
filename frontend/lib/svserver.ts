import type { SvItem, SvProvider, SvStatus } from "./streetview";
import { distMeters } from "./streetview";

const PANORAMAX = process.env.PANORAMAX_URL || "https://api.panoramax.xyz";
const KARTAVIEW_HOSTS = (process.env.KARTAVIEW_URLS || "https://api.kartaview.org,https://api.openstreetcam.org").split(",").map((s) => s.trim()).filter(Boolean);
const MAPILLARY_GRAPH = process.env.MAPILLARY_GRAPH_URL || "https://graph.mapillary.com";
const COMMONS = process.env.COMMONS_URL || "https://commons.wikimedia.org";
const UA = "KarthikMap/1.0 (street view; contact: owner of this deployment)";

const ALLOWED_SUFFIXES = ["openstreetcam.org", "kartaview.org", "panoramax.xyz", "panoramax.fr", "openstreetmap.fr", "ign.fr", "mapillary.com", "fbcdn.net", "wikimedia.org", ...(process.env.STREETVIEW_EXTRA_HOSTS || "").split(",").map((s) => s.trim()).filter(Boolean)];
export function allowedImageUrl(raw: string): URL | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "https:" && !(process.env.STREETVIEW_ALLOW_HTTP === "1" && u.protocol === "http:")) return null;
  const h = u.hostname.toLowerCase();
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) && process.env.STREETVIEW_ALLOW_HTTP !== "1") return null;
  return ALLOWED_SUFFIXES.some((s) => h === s || h.endsWith(`.${s}`)) ? u : null;
}
export const proxied = (urls: string[]) => `/api/v1/streetview/img?${urls.map((u) => `u=${encodeURIComponent(u)}`).join("&")}`;

const num = (v: unknown) => { const n = typeof v === "string" ? parseFloat(v) : (v as number); return Number.isFinite(n) ? n : null; };
const strip = (html?: string) => (html || "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
async function getJson(url: string, init: RequestInit = {}, ms = 9000) {
  const res = await fetch(url, { ...init, headers: { "User-Agent": UA, Accept: "application/json", ...(init.headers || {}) }, signal: AbortSignal.timeout(ms), cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
const bboxOf = (lat: number, lng: number, r: number) => {
  const dLat = r / 110_540, dLng = r / (111_320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return { w: lng - dLng, s: lat - dLat, e: lng + dLng, n: lat + dLat };
};

type Fetcher = (lat: number, lng: number, r: number) => Promise<SvItem[]>;

const panoramax: Fetcher = async (lat, lng, r) => {
  const b = bboxOf(lat, lng, r);
  const j = await getJson(`${PANORAMAX}/api/search?bbox=${b.w},${b.s},${b.e},${b.n}&limit=80`);
  return ((j.features || []) as any[]).flatMap((f) => {
    const c = f.geometry?.coordinates; if (!Array.isArray(c)) return [];
    const p = f.properties || {};
    const io = p["pers:interior_orientation"] || {};
    const fov = num(io.field_of_view ?? io.fov);
    const pano = (fov !== null && fov >= 300) || /equirect|spheric/i.test(String(io.projection_type || io.type || ""));
    const id = String(f.id);
    const sd = `${PANORAMAX}/api/pictures/${id}/sd.jpg`, hd = `${PANORAMAX}/api/pictures/${id}/hd.jpg`;
    return [{
      id: `px:${id}`, provider: "panoramax" as const, lat: c[1], lng: c[0], heading: num(p["view:azimuth"]), pano, at: p.datetime ? Date.parse(p.datetime) : null,
      author: p["geovisio:producer"] || f.providers?.find?.((x: any) => (x.roles || []).includes("producer"))?.name, license: p.license || p["geovisio:license"], seq: f.collection,
      thumb: proxied([`${PANORAMAX}/api/pictures/${id}/thumb.jpg`]), full: proxied([sd, hd]), link: `https://api.panoramax.xyz/#focus=pic&pic=${id}`, dist: 0,
    }];
  });
};

const kartaview: Fetcher = async (lat, lng) => {
  let lastErr: unknown = new Error("no host");
  for (const host of KARTAVIEW_HOSTS) {
    try {
      const j = await getJson(`${host}/2.0/photo/?lat=${lat}&lng=${lng}&zoomLevel=18&join=sequence&orderBy=id&orderDirection=desc`);
      if (j.status?.apiCode && Number(j.status.apiCode) !== 600) throw new Error(j.status.apiMessage || `API code ${j.status.apiCode}`);
      const data: any[] = j.result?.data || [];
      return data.flatMap((p) => {
        const la = num(p.lat), lo = num(p.lng); if (la === null || lo === null) return [];
        const proc = p.fileurlProc || p.fileurl?.replace?.("[[sizeprefix]]", "proc");
        const lth = p.fileurlLTh, th = p.fileurlTh;
        const urls = [proc, lth, th].filter(Boolean) as string[];
        if (!urls.length) return [];
        const storage = p.storage as string | undefined;
        const alts = storage ? urls.map((u) => u.replace(/storage\d+/, storage)).filter((u) => !urls.includes(u)) : [];
        const sphere = /sphere|equirect/i.test(String(p.projection || ""));
        return [{
          id: `kv:${p.id}`, provider: "kartaview" as const, lat: la, lng: lo, heading: num(p.heading), pano: sphere, at: p.shotDate ? Date.parse(p.shotDate) : p.dateAdded ? Date.parse(p.dateAdded) : null,
          author: p.username || p.user?.username, seq: String(p.sequenceId ?? p.sequence_id ?? ""),
          license: "CC BY-SA 4.0", thumb: proxied([th || lth || proc, ...alts]), full: proxied([...(sphere ? [proc, lth] : [lth, proc]).filter(Boolean) as string[], ...alts]), link: `https://kartaview.org/map/@${la},${lo},18z`, dist: 0,
        }];
      });
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
};

const mapillary: Fetcher = async (lat, lng, r) => {
  const token = process.env.MAPILLARY_TOKEN || process.env.NEXT_PUBLIC_MAPILLARY_TOKEN;
  if (!token) throw Object.assign(new Error("needs a free Mapillary token"), { skipped: true });
  const b = bboxOf(lat, lng, r);
  const j = await getJson(`${MAPILLARY_GRAPH}/images?access_token=${encodeURIComponent(token)}&fields=id,thumb_1024_url,thumb_2048_url,computed_compass_angle,compass_angle,is_pano,captured_at,computed_geometry,geometry,sequence,creator&bbox=${b.w},${b.s},${b.e},${b.n}&limit=100`);
  return ((j.data || []) as any[]).flatMap((x) => {
    const g = x.computed_geometry || x.geometry; const c = g?.coordinates; if (!Array.isArray(c) || !x.thumb_2048_url) return [];
    return [{
      id: `ml:${x.id}`, provider: "mapillary" as const, lat: c[1], lng: c[0], heading: num(x.computed_compass_angle ?? x.compass_angle), pano: !!x.is_pano, at: num(x.captured_at),
      author: x.creator?.username, license: "CC BY-SA 4.0", seq: x.sequence,
      thumb: proxied([x.thumb_1024_url || x.thumb_2048_url]), full: proxied([x.thumb_2048_url, x.thumb_1024_url].filter(Boolean)), link: `https://www.mapillary.com/app/?pKey=${x.id}&focus=photo`, dist: 0,
    }];
  });
};

const commons: Fetcher = async (lat, lng) => {
  const j = await getJson(`${COMMONS}/w/api.php?action=query&generator=geosearch&ggscoord=${lat}%7C${lng}&ggsradius=700&ggslimit=24&ggsnamespace=6&prop=imageinfo%7Ccoordinates&iiprop=url%7Cextmetadata%7Cmime&iiurlwidth=1280&colimit=1&format=json&origin=*`);
  const pages = Object.values((j.query?.pages || {}) as Record<string, any>);
  return pages.flatMap((p) => {
    const ii = p.imageinfo?.[0]; const c = p.coordinates?.[0];
    if (!ii || !c || !/^image\/(jpeg|png)/.test(ii.mime || "")) return [];
    const url = ii.thumburl || ii.url; const md = ii.extmetadata || {};
    return [{
      id: `cm:${p.pageid}`, provider: "commons" as const, lat: c.lat, lng: c.lon, heading: null, pano: false, at: md.DateTimeOriginal?.value ? Date.parse(strip(md.DateTimeOriginal.value)) || null : null,
      author: strip(md.Artist?.value) || undefined, license: strip(md.LicenseShortName?.value) || undefined, title: String(p.title || "").replace(/^File:/, "").replace(/\.[a-z]+$/i, ""),
      thumb: proxied([url]), full: proxied([url]), link: ii.descriptionshorturl || `https://commons.wikimedia.org/?curid=${p.pageid}`, dist: 0,
    }];
  });
};

const FETCHERS: Record<SvProvider, Fetcher> = { mapillary, kartaview, panoramax, commons };

export async function nearbyImagery(lat: number, lng: number, radius: number, want: SvProvider[]): Promise<{ items: SvItem[]; status: SvStatus }> {
  const status = {} as SvStatus; const all: SvItem[] = [];
  const names = Object.keys(FETCHERS) as SvProvider[];
  await Promise.all(names.map(async (name) => {
    if (!want.includes(name)) { status[name] = { ok: false, count: 0, skipped: "off" }; return; }
    try {
      const raw = await FETCHERS[name](lat, lng, radius);
      const items = raw.map((i) => ({ ...i, dist: Math.round(distMeters(lat, lng, i.lat, i.lng)) })).filter((i) => name === "commons" || i.dist <= radius * 1.6).sort((a, b) => a.dist - b.dist).slice(0, 40);
      status[name] = { ok: true, count: items.length }; all.push(...items);
    } catch (e) {
      const err = e as Error & { skipped?: boolean };
      status[name] = err.skipped ? { ok: false, count: 0, skipped: err.message } : { ok: false, count: 0, error: err.name === "TimeoutError" ? "timed out" : err.message };
    }
  }));
  return { items: all.sort((a, b) => a.dist - b.dist), status };
}
