import type { LngLat } from "./geo";

type FC = GeoJSON.FeatureCollection;
const num = (s: string | null | undefined) => Number(s);
const text = (el: Element | null, tag: string) => el?.getElementsByTagName(tag)[0]?.textContent?.trim() || "";

function parseCoords(s: string): LngLat[] {
  return s.trim().split(/\s+/).map((c) => c.split(",").map(Number)).filter((a) => a.length >= 2 && Number.isFinite(a[0]) && Number.isFinite(a[1])).map((a) => [a[0], a[1]] as LngLat);
}

export function parseGpx(xml: Document): FC {
  const features: GeoJSON.Feature[] = [];
  for (const trk of Array.from(xml.getElementsByTagName("trk"))) {
    const name = text(trk, "name") || "Track";
    for (const seg of Array.from(trk.getElementsByTagName("trkseg"))) {
      const coordinates = Array.from(seg.getElementsByTagName("trkpt")).map((p) => [num(p.getAttribute("lon")), num(p.getAttribute("lat"))] as LngLat).filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]));
      if (coordinates.length > 1) features.push({ type: "Feature", properties: { name }, geometry: { type: "LineString", coordinates } });
    }
  }
  for (const rte of Array.from(xml.getElementsByTagName("rte"))) {
    const coordinates = Array.from(rte.getElementsByTagName("rtept")).map((p) => [num(p.getAttribute("lon")), num(p.getAttribute("lat"))] as LngLat);
    if (coordinates.length > 1) features.push({ type: "Feature", properties: { name: text(rte, "name") || "Route" }, geometry: { type: "LineString", coordinates } });
  }
  for (const w of Array.from(xml.getElementsByTagName("wpt"))) {
    const c: LngLat = [num(w.getAttribute("lon")), num(w.getAttribute("lat"))];
    if (Number.isFinite(c[0]) && Number.isFinite(c[1])) features.push({ type: "Feature", properties: { name: text(w, "name") || "Waypoint" }, geometry: { type: "Point", coordinates: c } });
  }
  return { type: "FeatureCollection", features };
}

export function parseKml(xml: Document): FC {
  const features: GeoJSON.Feature[] = [];
  for (const pm of Array.from(xml.getElementsByTagName("Placemark"))) {
    const name = text(pm, "name") || "Placemark";
    const pt = pm.getElementsByTagName("Point")[0];
    if (pt) { const c = parseCoords(text(pt, "coordinates"))[0]; if (c) features.push({ type: "Feature", properties: { name }, geometry: { type: "Point", coordinates: c } }); }
    for (const ls of Array.from(pm.getElementsByTagName("LineString"))) {
      const coordinates = parseCoords(text(ls, "coordinates")); if (coordinates.length > 1) features.push({ type: "Feature", properties: { name }, geometry: { type: "LineString", coordinates } });
    }
    for (const pg of Array.from(pm.getElementsByTagName("Polygon"))) {
      const outer = pg.getElementsByTagName("outerBoundaryIs")[0]; const ring = parseCoords(text(outer, "coordinates"));
      if (ring.length > 2) features.push({ type: "Feature", properties: { name }, geometry: { type: "Polygon", coordinates: [ring] } });
    }
  }
  return { type: "FeatureCollection", features };
}

export function parseGeoJson(raw: string): FC {
  const j = JSON.parse(raw);
  if (j.type === "FeatureCollection" && Array.isArray(j.features)) return j;
  if (j.type === "Feature") return { type: "FeatureCollection", features: [j] };
  if (j.type && j.coordinates) return { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: j }] };
  throw new Error("Not a GeoJSON file");
}

/** Parse a user-chosen GPX / KML / GeoJSON file into GeoJSON. */
export async function parseGeoFile(file: File): Promise<FC> {
  if (file.size > 8_000_000) throw new Error("File is larger than 8 MB");
  const raw = await file.text();
  const name = file.name.toLowerCase();
  let fc: FC;
  if (name.endsWith(".json") || name.endsWith(".geojson") || raw.trimStart().startsWith("{")) fc = parseGeoJson(raw);
  else {
    const xml = new DOMParser().parseFromString(raw, "application/xml");
    if (xml.getElementsByTagName("parsererror").length) throw new Error("That file is not valid XML");
    fc = name.endsWith(".gpx") || xml.documentElement.nodeName.toLowerCase() === "gpx" ? parseGpx(xml) : parseKml(xml);
  }
  if (!fc.features.length) throw new Error("No tracks, routes, points or shapes found in that file");
  return fc;
}

export function boundsOf(fc: FC): [LngLat, LngLat] | null {
  let w = 180, s = 90, e = -180, n = -90, any = false;
  const visit = (c: unknown): void => { if (Array.isArray(c) && typeof c[0] === "number") { any = true; w = Math.min(w, c[0]); e = Math.max(e, c[0]); s = Math.min(s, c[1] as number); n = Math.max(n, c[1] as number); } else if (Array.isArray(c)) c.forEach(visit); };
  fc.features.forEach((f) => visit((f.geometry as { coordinates?: unknown })?.coordinates));
  return any ? [[w, s], [e, n]] : null;
}
