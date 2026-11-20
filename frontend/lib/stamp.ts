/** Draws a GPS "site photo" stamp (place, coordinates, time, weather, mini-map) onto a canvas. */
export type StampData = { title: string; address: string; lat: number; lng: number; when: number; weather?: string; digipin?: string | null; note?: string; mapImg?: HTMLCanvasElement | null };
export type StampOpts = { x: number; y: number; scale: number; opacity: number; show: { address: boolean; coords: boolean; time: boolean; weather: boolean; digipin: boolean; note: boolean; map: boolean } };

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number) {
  const words = text.split(/\s+/); const lines: string[] = []; let cur = "";
  for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { const k = lines.slice(0, maxLines); k[maxLines - 1] = k[maxLines - 1].replace(/\s*\S*$/, "…"); return k; }
  return lines;
}

export function drawStamp(ctx: CanvasRenderingContext2D, W: number, H: number, d: StampData, o: StampOpts) {
  const fs = (Math.max(W, H) / 1000) * 21 * o.scale;
  const pad = fs * 0.7, lh = fs * 1.32;
  const maxW = W * 0.92 - pad * 2 - (o.show.map && d.mapImg ? fs * 7.2 : 0);
  ctx.save(); ctx.globalAlpha = o.opacity; ctx.textBaseline = "top";
  const lines: Array<{ t: string; bold?: boolean; dim?: boolean }> = [];
  ctx.font = `700 ${fs * 1.15}px Inter, system-ui, sans-serif`;
  wrap(ctx, d.title || "Site photo", maxW, 1).forEach((t) => lines.push({ t, bold: true }));
  ctx.font = `500 ${fs}px Inter, system-ui, sans-serif`;
  if (o.show.address && d.address) wrap(ctx, d.address, maxW, 2).forEach((t) => lines.push({ t }));
  if (o.show.coords) lines.push({ t: `Lat ${d.lat.toFixed(6)}°  Long ${d.lng.toFixed(6)}°` });
  if (o.show.digipin && d.digipin) lines.push({ t: `DIGIPIN ${d.digipin}` });
  if (o.show.time) lines.push({ t: new Date(d.when).toLocaleString([], { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }), dim: true });
  if (o.show.weather && d.weather) lines.push({ t: d.weather, dim: true });
  if (o.show.note && d.note) wrap(ctx, d.note, maxW, 2).forEach((t) => lines.push({ t }));
  let textW = 0;
  lines.forEach((l) => { ctx.font = `${l.bold ? 700 : 500} ${l.bold ? fs * 1.15 : fs}px Inter, system-ui, sans-serif`; textW = Math.max(textW, ctx.measureText(l.t).width); });
  const mapW = o.show.map && d.mapImg ? fs * 6.6 : 0;
  const boxW = Math.min(W * 0.94, textW + pad * 2 + (mapW ? mapW + pad : 0));
  const boxH = Math.max(lines.length * lh + pad * 2, mapW ? mapW + pad * 2 : 0);
  const bx = o.x * (W - boxW), by = o.y * (H - boxH), r = fs * 0.9;
  ctx.fillStyle = "rgba(15,15,18,.62)";
  ctx.beginPath(); ctx.roundRect(bx, by, boxW, boxH, r); ctx.fill();
  let tx = bx + pad;
  if (mapW && d.mapImg) { ctx.save(); ctx.beginPath(); ctx.roundRect(tx, by + pad, mapW, mapW, r * 0.6); ctx.clip(); ctx.drawImage(d.mapImg, tx, by + pad, mapW, mapW); ctx.restore(); tx += mapW + pad; }
  lines.forEach((l, i) => {
    ctx.font = `${l.bold ? 700 : 500} ${l.bold ? fs * 1.15 : fs}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = l.dim ? "rgba(255,255,255,.72)" : "#fff";
    ctx.fillText(l.t, tx, by + pad + i * lh);
  });
  ctx.restore();
}

/** Small OSM map image (≈128 px) centred on the point with a pin. Resolves null if tiles can't be fetched. */
export async function miniMap(lat: number, lng: number): Promise<HTMLCanvasElement | null> {
  const z = 16, n = 2 ** z, size = 256, view = 160;
  const fx = ((lng + 180) / 360) * n, l = (lat * Math.PI) / 180;
  const fy = ((1 - Math.log(Math.tan(l) + 1 / Math.cos(l)) / Math.PI) / 2) * n;
  const px = fx * size, py = fy * size, x0 = px - view / 2, y0 = py - view / 2;
  const tiles: Array<Promise<{ img: HTMLImageElement; dx: number; dy: number } | null>> = [];
  for (let tx = Math.floor(x0 / size); tx <= Math.floor((x0 + view) / size); tx++) for (let ty = Math.floor(y0 / size); ty <= Math.floor((y0 + view) / size); ty++) {
    tiles.push(new Promise((res) => { const img = new Image(); img.crossOrigin = "anonymous"; img.onload = () => res({ img, dx: tx * size - x0, dy: ty * size - y0 }); img.onerror = () => res(null); img.src = `https://tile.openstreetmap.org/${z}/${tx}/${ty}.png`; setTimeout(() => res(null), 6000); }));
  }
  const loaded = (await Promise.all(tiles)).filter(Boolean) as Array<{ img: HTMLImageElement; dx: number; dy: number }>;
  if (!loaded.length) return null;
  const c = document.createElement("canvas"); c.width = c.height = view;
  const g = c.getContext("2d")!; g.fillStyle = "#e5e3df"; g.fillRect(0, 0, view, view);
  loaded.forEach((t) => g.drawImage(t.img, t.dx, t.dy));
  g.fillStyle = "#ff3b30"; g.strokeStyle = "#fff"; g.lineWidth = 4; g.beginPath(); g.arc(view / 2, view / 2, 11, 0, Math.PI * 2); g.fill(); g.stroke();
  return c;
}
