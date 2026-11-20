/** DIGIPIN — India Post's open 10-character geo-code (https://www.indiapost.gov.in/digipin). ~4 m × 4 m cells inside India's bounding box. */
const GRID = [["F", "C", "9", "8"], ["J", "3", "2", "7"], ["K", "4", "5", "6"], ["L", "M", "P", "T"]];
const B = { minLat: 2.5, maxLat: 38.5, minLon: 63.5, maxLon: 99.5 };
const CHARS = GRID.flat().join("");

export function digipinEncode(lat: number, lon: number): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < B.minLat || lat > B.maxLat || lon < B.minLon || lon > B.maxLon) return null;
  let { minLat, maxLat, minLon, maxLon } = B;
  let code = "";
  for (let level = 1; level <= 10; level++) {
    const latDiv = (maxLat - minLat) / 4, lonDiv = (maxLon - minLon) / 4;
    let row = 3 - Math.floor((lat - minLat) / latDiv), col = Math.floor((lon - minLon) / lonDiv);
    row = Math.max(0, Math.min(3, row)); col = Math.max(0, Math.min(3, col));
    code += GRID[row][col];
    if (level === 3 || level === 6) code += "-";
    maxLat = minLat + latDiv * (4 - row); minLat = minLat + latDiv * (3 - row);
    minLon = minLon + lonDiv * col; maxLon = minLon + lonDiv;
  }
  return code;
}

export function digipinDecode(input: string): { lat: number; lng: number } | null {
  const code = input.replace(/[-\s]/g, "").toUpperCase();
  if (code.length !== 10 || [...code].some((c) => !CHARS.includes(c))) return null;
  let { minLat, maxLat, minLon, maxLon } = B;
  for (const ch of code) {
    let row = -1, col = -1;
    GRID.forEach((r, i) => { const j = r.indexOf(ch); if (j >= 0) { row = i; col = j; } });
    const latDiv = (maxLat - minLat) / 4, lonDiv = (maxLon - minLon) / 4;
    const lat2 = maxLat - latDiv * row, lat1 = lat2 - latDiv;
    const lon1 = minLon + lonDiv * col, lon2 = lon1 + lonDiv;
    minLat = lat1; maxLat = lat2; minLon = lon1; maxLon = lon2;
  }
  return { lat: (minLat + maxLat) / 2, lng: (minLon + maxLon) / 2 };
}

export const looksLikeDigipin = (q: string) => /^[FC98J327K456LMPT]{3}-?[FC98J327K456LMPT]{3}-?[FC98J327K456LMPT]{4}$/i.test(q.trim());
