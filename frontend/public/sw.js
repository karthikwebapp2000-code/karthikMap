// Karthik Map service worker: installable PWA + offline data.
//  • /data/* and /icons/*      → stale-while-revalidate (station list, Chennai bus timetable)
//  • tiles.openfreemap.org     → serves pre-downloaded offline map tiles when the network is unavailable
// Everything else is network-only, so live data is never stale.
const DATA = "km-data-v1";
const TILES = "km-tiles-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== DATA && k !== TILES).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
));
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin && (url.pathname.startsWith("/data/") || url.pathname.startsWith("/icons/"))) {
    event.respondWith(caches.open(DATA).then(async (cache) => {
      const cached = await cache.match(req);
      const fresh = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => cached);
      return cached || fresh;
    }));
    return;
  }
  if (url.hostname === "tiles.openfreemap.org") {
    const isBinary = /\.(pbf|png|jpg|webp)$/.test(url.pathname);
    event.respondWith((async () => {
      const cache = await caches.open(TILES);
      if (isBinary) {                       // tiles, glyphs, sprites: cached copy first
        const hit = await cache.match(req.url);
        if (hit) return hit;
        return fetch(req);
      }
      try { return await fetch(req); }      // style / TileJSON: network first, cached copy when offline
      catch (e) { const hit = await cache.match(req.url); if (hit) return hit; throw e; }
    })());
  }
});
