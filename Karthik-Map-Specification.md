# Karthik Map — Product & Technical Specification

Version 1.3 · Personal daily-use work map · Web app + installable PWA + Android APK wrapper

---

## 1. Purpose

A single personal map for daily work travel in India (works worldwide): save the places you work at, find railway stations, plan multi-stop days, watch live satellite/weather data, see 3D cities, look at street-level imagery, and ask an AI assistant to do these things for you.

**Primary user:** one person (the owner) on an Android phone (Samsung S-series), occasionally a laptop.
**Design principles:** works with free data sources; your saved data stays on your device; every feature degrades gracefully when a key or service is missing.

## 2. Platforms

| Platform | How | Status |
|---|---|---|
| Website | Next.js app deployed to Vercel / Docker / any Node host | Built |
| Installable web app (PWA) | `manifest.webmanifest` + service worker; "Install / Add to Home screen" over HTTPS | Built |
| Android APK | Capacitor WebView shell around the deployed site, built by GitHub Actions (`mobile/`) | Config provided, **untested** |
| iOS | Use the PWA (Safari → Add to Home Screen) | Not packaged |

## 3. Functional specification

Each requirement has an ID for testing (section 12).

### 3.1 Map core (MAP)
- MAP-1 Vector street map worldwide (OpenFreeMap/OpenMapTiles), no API key.
- MAP-2 Modes: Street, Hybrid satellite (Google tiles), Dark. Colour customiser (buildings, roads, water).
- MAP-3 Camera is not region-locked; zoom 1–22, pitch up to 80°, rotate. Globe view toggle.
- MAP-4 3D buildings from zoom 13, smooth height fade-in, lighting, adjustable height multiplier, click to inspect. Buildings flagged `hide_3d` are skipped.
- MAP-5 3D terrain + hillshade (Terrarium DEM).
- MAP-6 "Fly to a 3D skyline" shortcuts: New York, London, Paris, Dubai, Tokyo, Singapore, San Francisco, Sydney, Chennai, Mumbai, Bengaluru, Delhi.
- MAP-7 Live GPS: position dot, heading, accuracy circle, off-route rerouting.

### 3.2 Search & places (SRC)
- SRC-1 Worldwide search (Nominatim + Photon + Overpass), ranked by distance to the map/GPS.
- SRC-2 Nearby categories: restaurants, ATMs/banks, hospitals, pharmacies, petrol, shopping, worship, hotels, **railway stations**.
- SRC-3 Place card: address, photos (Wikimedia), directions, save, share.

### 3.3 Directions (DIR)
- DIR-1 Car / motorcycle / walking routes (OSRM), alternatives, turn-by-turn, durations in days/hours/minutes.
- DIR-2 Multi-stop day route (up to 25 stops) with per-leg time & distance.

### 3.4 Work map (WRK)
- WRK-1 Save locations of type Office, Site, Client, Depot, Rail station, Other. Fields: name, type, lat, lng, address, notes, optional station code.
- WRK-2 Save from: selected place, map centre, GPS position, railway station.
- WRK-3 Edit type/notes, delete, filter, export CSV/JSON, import JSON.
- WRK-4 Railway station search over the bundled list of 4,868 Indian Railways stations (name or code). Coordinates resolved from OSM by code (Overpass), fallback to name search (Nominatim). "Show stations in this view" (Overpass bbox).
- WRK-5 Day route: reorder, nearest-neighbour optimise, start from GPS, car/bike/walk, open in Google Maps.
- WRK-6 All saved data is local to the device (localStorage).

### 3.5 Satellite hub (SAT)
- SAT-1 NASA GIBS live imagery: VIIRS Suomi-NPP/NOAA-20/NOAA-21 & MODIS Terra/Aqua true colour, false colour, active fires, rainfall (IMERG), aerosol, land temperature, night lights. Date selector (since 2012), per-layer opacity, automatic fall-back to yesterday if today has no tiles.
- SAT-2 Animated rain radar and infrared cloud satellite (RainViewer), refresh every 5 min.
- SAT-3 Live conditions: temperature, rain, cloud, wind, US AQI/PM2.5 (Open-Meteo).
- SAT-4 Satellite tracker: ISS/Tiangong, NavIC, weather, GPS, Earth-observation groups. SGP4 in the browser (satellite.js) from CelesTrak element sets (server cache 2 h). Selected satellite: altitude, speed, ground track, visibility footprint, follow, next 5 passes over GPS/map centre (≥10°).
- SAT-5 ISS fallback feed (wheretheiss.at) if CelesTrak is unreachable.
- SAT-6 "LIVE" chip while any live layer is on.

### 3.6 Street view (STV) — built in, open data
- STV-1 **Four open sources merged**, nearest first: **Mapillary** (widest coverage incl. India; free token), **KartaView** (Grab; no key; strongest in Southeast Asia), **Panoramax** (open federated catalogue; no key; mostly Europe, thin in India), **Wikimedia Commons** geotagged photos (landmarks/temples; no key). Source chips show how many photos each found; any can be switched off.
- STV-2 **Viewer**: flat photos, and **true 360° panoramas** in a built-in WebGL viewer (drag, pinch/scroll zoom, optional look-around by moving the phone), compass, full-screen mode.
- STV-3 **Walk along the street** with forward/back arrows (nearest photo in the direction you look, falling back to the road direction), thumbnail strip, tap map dots to jump. Re-searches automatically as you move.
- STV-4 **Map**: coloured photo points by source, direction cone of the current view, optional coverage lines (Mapillary green with token, Panoramax blue).
- STV-5 **Credit & licence** shown for every photo (author, CC BY-SA / CC licence, link to the source). Photos load through the app's own server (host allow-list, same-origin) so the 360° viewer works.
- STV-6 Optional Google Street View embed tab if a Google Embed key is set; always a "Google" button that opens Google Street View for the spot.
- STV-7 Honest limits: coverage in India is patchy and uneven; KartaView/Panoramax may return nothing in a given city; KartaView changed hostnames in 2026 (both are tried); old photos may be archived; heading data is sometimes wrong. Not Google-quality, not continuous.

### 3.7 AI assistant (AI)
- AI-1 Chat panel with quick prompts and voice input (browsers with Web Speech API, e.g. Chrome/Samsung Internet).
- AI-2 Context sent with each question: map centre/zoom, GPS, selected place, saved work locations (max 40), active category/travel mode, current time, local weather. Nothing else is sent; no map tiles or other users' data.
- AI-3 The model may call one tool, `map_actions`, with up to 6 actions: `search`, `nearby`, `route_saved`, `fly_to`, `street_view`, `open_satellite`. The browser executes them with the app's own functions and shows what ran.
- AI-4 Typical uses: "Plan my day using my saved sites" (orders stops, loads and calculates the route), "Nearest railway station", "Tell me about this place", "Show Burj Khalifa in 3D".
- AI-5 Server-only API key; 20 requests/min per IP; message and context size limits; clear error when not configured.
- AI-6 Limits: the assistant cannot book, pay, message, or give live train running status; it must not invent coordinates/timings (enforced by instruction, not guaranteed).

### 3.8 Transit, traffic & place data (TRN)
- TRN-1 **Chennai buses (bundled, offline-capable):** MTC timetable from the community ChennaiGTFS feed (3,931 route variants, 5,477 stops, ~46,000 daily trips; collected April 2026). Nearest stops, next scheduled buses at a stop, all routes serving a stop, route search by number or place, route first/last bus, stop-by-stop times, route drawn on the map. Times are **scheduled, not live GPS**; route lines are straight between stops.
- TRN-2 **Other cities (Coimbatore, Madurai, Tiruchirappalli, Salem, Bengaluru, Hyderabad, Mumbai, Delhi, Kolkata, Pune and anywhere):** bus stops and the bus routes serving them from OpenStreetMap (Overpass). Route numbers and stops only — **no timetables**; completeness depends on local OSM mapping and is unverified for Coimbatore.
- TRN-3 **Live train status** (RailRadar): running status, delay, current/next halt, stop list with times. Free plan ≈ 100 lookups/month; replies cached 5 min. Needs `RAILRADAR_API_KEY`.
- TRN-4 **Live traffic** (TomTom flow tiles) as a map layer with opacity. Needs free `NEXT_PUBLIC_TOMTOM_KEY`.
- TRN-5 **Opening hours:** OSM `opening_hours` parsed into "Open · closes 9:00 pm" / "Closed · opens tomorrow 9:00 am" (common patterns; shows raw text otherwise). Only as good as OSM data — many Indian shops have none.
- TRN-6 **Your own ratings:** 1–5 stars and notes on saved work locations (replaces paid review data), included in CSV export.
- TRN-7 **Offline:** the service worker keeps the station list and Chennai bus data available offline; offline map tiles — see FLD-11.

### 3.9 Field tools (FLD) — added from the reference screenshots
- FLD-1 **Measure** (Google-Earth style): cross-hair point adding, undo/redo, distance/path, area + perimeter (geodesic), elevation profile with climb/drop (Open-Meteo elevation), save, export GeoJSON/GPX.
- FLD-2 **Import** GPX, KML or GeoJSON files (tracks, routes, waypoints, shapes) as a purple overlay; show/hide/remove; persisted on device.
- FLD-3 **Trips**: record with live speed, average/top speed, distance, time, heading; follow & tilt camera; screen wake-lock; GPS-jitter filter; pause/resume; saved trip history with playback (1×–30×, scrubber) and GPX export.
- FLD-4 **Speed limit & road hazards** from OpenStreetMap: speed-limit sign, over-speed alert (your threshold or road limit + 5), spoken/visual warnings for speed bumps/humps/cameras ahead.
- FLD-5 **Geofences**: circles (30 m–1.5 km, colour) around saved sites or any point; arrive/leave alerts; **alarm log** with 24 h/7 d/all and info/warning/critical filters.
- FLD-6 **Site photos** (GPS camera): take/import photo, stamp place, address, coordinates, DIGIPIN, date/time, weather, note, mini-map; drag/resize/opacity; save to gallery (on device) with filters; share/download; pins on map. Photos only — no video stamping.
- FLD-7 **Voice guidance + driving HUD** on the existing live navigation: next-turn banner, spoken prompts at ~450 m and ~120 m, arrival, ETA, distance/time left, speed, speed limit, mute; fuel-cost estimate (mileage × price) — tolls not included.
- FLD-8 **DIGIPIN** (India Post digital address): shown on place cards and the Explore panel; search by DIGIPIN or by "lat, lng".
- FLD-9 **Today here**: sunrise, sunset, daylight, solar noon; Rahu Kalam, Yamagandam, Gulika, Abhijit (India) computed from sunrise/sunset. Tithi/nakshatra/festivals are **not** included.
- FLD-10 **Explore**: 22 nearby-place categories, live webcams (Windy key), famous places in 3D.
- FLD-11 **Offline maps**: download the current view (zoom up to 14, ≤6,000 tiles) of the OpenFreeMap street map with sprites and Latin/Devanagari/Tamil glyphs; served by the service worker when offline. Satellite, terrain, search, routing and live data still need internet.
- FLD-12 **Map label language**: Local / English / Tamil / Hindi (uses OSM `name:*`; falls back to local name).
- FLD-13 **Voice search** in the search bar (Chrome/Samsung Internet; not Firefox).

### 3.10 Design system (UI)
- UI-1 Apple-style frosted glass: translucent surfaces with blur + saturation, hairline edges, soft shadows, SF/Inter type, spring animations, floating dock with an "All tools" sheet, round map buttons, side panels (bottom sheets on phones).
- UI-2 **Light / Dark / Auto** theme; dark theme can switch the map to dark; no flash on load.
- UI-3 Customisable: accent colour (8 presets + any colour), glass transparency, blur, corner style (compact/round/extra round), text size, units (km/mi), voice, over-speed alert, mileage & fuel price.
- UI-4 **Performance**: Auto/Light/Full. Light mode lowers blur/animation; Auto chooses it on low-memory devices. Heavy panels are code-split and loaded on demand; blur is skipped on small elements (chips).
- UI-5 Honours `prefers-reduced-transparency`, `prefers-reduced-motion`; browsers without `backdrop-filter` get solid surfaces.

### 3.11 App shell (APP)
- APP-1 Responsive: desktop side panels, phone bottom sheets.
- APP-2 PWA installable, standalone display, blue icon.
- APP-3 Panels: right side (Transit / Ask AI / Work / Satellite — one at a time), Street view bottom-left (can coexist).

## 4. Architecture

```
Browser / PWA / APK WebView
  Next.js 16 UI (React, MapLibre GL, satellite.js)
        │ fetch
        ▼
Next.js route handlers (/api/v1/*)  ── server-side proxies, caching, validation
        │
        ├─ OSRM (routing)            ├─ Nominatim / Photon / Overpass (places, stations)
        ├─ CelesTrak (orbit data)    ├─ Anthropic API (AI, key on server)
Browser also calls directly: NASA GIBS tiles, RainViewer, Open-Meteo, Mapillary, OpenFreeMap, Google tiles, wheretheiss.at
Local storage: saved work locations, day route, saved places, recents
```
The optional FastAPI/PostGIS/Redis/Meilisearch stack in `backend/` and `docker-compose.*.yml` is inherited from City Maps and **not required**.

## 5. External services

| Service | Used for | Key | Notes |
|---|---|---|---|
| OpenFreeMap | Base vector map | No | |
| Google satellite tiles | Hybrid imagery | No (unofficial) | Check Google terms before commercial/public use |
| AWS Terrarium | Terrain | No | |
| Nominatim / Photon | Geocoding | No | Fair-use limits; identify with User-Agent |
| Overpass | Nearby, stations | No | May time out under load |
| OSRM (routing.openstreetmap.de) | Routes | No | Public demo server, no SLA |
| NASA GIBS | Satellite imagery | No | Public |
| RainViewer | Radar/IR animation | No | Zoom/coverage limits |
| Open-Meteo | Weather, AQI | No | Free for non-commercial |
| CelesTrak | Orbit elements | No | Cached 2 h server-side |
| Mapillary | Street photos (+coverage tiles) | Free token | Best India coverage of the open sources; CC BY-SA |
| KartaView (api.kartaview.org) | Street photos | No | ~3 concurrent requests; hostname changed in 2026 |
| Panoramax (api.panoramax.xyz) | Street photos + coverage tiles | No | Open licences; Europe-heavy |
| Wikimedia Commons | Landmark photos | No | Per-file CC licences |
| Google Maps Embed | Street View | Free key | Restrict key by HTTP referrer |
| Anthropic API | AI assistant | **Paid key** | Pay per use |
| ChennaiGTFS (GitHub, bundled) | Chennai MTC timetable | No | ODbL/PDDL — attribute "UngalSoththu / ChennaiGTFS", keep derivatives open. Community scrape, may be out of date |
| RailRadar | Live train status | Free key | **~100 requests/month** on free plan; independent, not official |
| Windy Webcams | Live webcams | Free key | Preview images expire after ~10 min on the free plan |
| OpenStreetMap (Overpass) | Speed limits, bumps/cameras | No | Coverage varies by road |
| TomTom | Traffic tiles | Free key | Free quota applies (check dashboard); attribution "© TomTom" |

## 6. Internal API (`/api/v1`)

| Endpoint | Purpose |
|---|---|
| `GET places/search`, `places/nearby`, `places/details`, `geocode/reverse` | Places |
| `GET directions`, `GET directions/multi?mode=&points=lat,lng;…` | Routes (multi: 2–25 points) |
| `GET stations/resolve?code=&name=` | Station coordinates |
| `GET stations/bbox?south&west&north&east` | Stations in view (≤6° wide) |
| `GET satellites/tle?group=stations\|navic\|weather\|gps\|earth` | Orbit elements |
| `GET transit/osm-bus?lat&lng&radius` | Bus stops + routes from OSM |
| `GET streetview/nearby?lat&lng&radius&providers` | Merged street-level photos from open sources |
| `GET streetview/img?u=` | Same-origin image proxy (host allow-list) |
| `GET trains/live?number=&date=` | Live train status (key on server) |
| `GET roads/context?lat&lng` | Speed limit + hazards near a point |
| `GET webcams?lat&lng&radius` | Live webcams (key on server) |
| `POST ai/chat` `{messages, context}` → `{reply, actions[]}` | Assistant |

Errors: `{status, error}` with 400 invalid input, 404 no result, 422 too large, 429 rate limit, 501 not configured, 502 upstream failure.

## 7. Data model (device storage)

`karthikmap:work:locations` — array of
```json
{ "id":"work_…", "name":"Site A", "type":"site|office|client|depot|station|other",
  "lat":13.08, "lng":80.27, "address":"…", "notes":"…", "code":"MAS", "createdAt":1700000000000 }
```
`karthikmap:work:route` — ordered array of location ids. Other keys: saved places, recent searches (per region).
Backup = Work panel → JSON export.

## 8. Configuration (`frontend/.env.local`)

| Variable | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | For AI | Server-only |
| `ANTHROPIC_MODEL` | No | Default `claude-sonnet-5-5` |
| `NEXT_PUBLIC_MAPILLARY_TOKEN` | For Mapillary | Visible to browser (public token) |
| `NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY` | For inline Street View | Visible to browser — restrict by referrer |
| `NEXT_PUBLIC_TOMTOM_KEY` | For traffic | Visible to browser — restrict by referrer |
| `RAILRADAR_API_KEY` | For live trains | Server-only |
| `WINDY_WEBCAMS_KEY` | For webcams | Server-only |

## 9. Security & privacy

- AI key stays on the server; browser never sees it. Rate-limited.
- Saved locations never leave the device, except the saved-site names/coordinates (max 40) and your position **are sent to the AI provider when you ask the assistant a question**.
- Position is sent to Open-Meteo, Mapillary (bbox), OSRM/Nominatim/Overpass (as part of queries) while you use the related features.
- Put a login (e.g., Vercel password protection or Cloudflare Access) in front of the site if it is public: otherwise anyone with the link can spend your AI credit (rate limit only slows them).
- HTTPS required for GPS and installation.

## 10. Performance & limits

- First load downloads the map style and tiles; on a phone the first page compile in dev mode (Termux) can take 1–2 minutes. Bundle sizes have not been measured.
- Tracker: ≤250 satellites per group, 1 Hz updates; pass search 24 h at 20 s steps.
- GIBS imagery native resolution 250 m–1 km (zoom ≥9 is upscaled). Hybrid satellite for street level.
- Public OSM services are best-effort; heavy daily use should move to your own or paid instances.

## 11. Deployment

1. **Local:** `cd frontend && npm install && npm run dev` (Termux: add `-- --webpack`).
2. **Vercel:** deploy `frontend/`; add env variables; enable password protection.
3. **Docker:** `frontend/Dockerfile` (standalone output).
4. **APK:** push repo to GitHub, set variable `APP_URL`, run workflow *Build Android APK*, install `app-debug.apk`.

## 12. Acceptance checklist

| ID | Test | Expected |
|---|---|---|
| MAP-3 | Pan to New York, zoom 16, tilt | 3D buildings visible, no region lock |
| MAP-6 | Tap "Dubai" | Flies to Burj Khalifa in 3D |
| SRC-1 | Search "Eiffel Tower" | Place found outside India |
| WRK-2/3 | Save selected place as Site, export CSV, reload page | Still listed; CSV downloads |
| WRK-4 | Search "TPJ" → tap | Map flies to Tiruchirappalli Jn.; Save works |
| WRK-5 | 3 stops → Calculate | Route + legs; Google Maps link opens |
| SAT-1 | Turn on VIIRS true colour | Imagery over the map; date change updates it |
| SAT-4 | Enable Space stations → select ISS | Moving marker, track, footprint, passes |
| STV-1 | Street view on a covered road, no keys | KartaView / Panoramax / Commons chips show counts; a photo opens |
| STV-2 | Open a 360° photo, drag | Looks around; compass rotates |
| STV-3 | Tap the forward arrow | Moves to the next photo along the street |
| AI-3 | "Plan my day using my saved sites" (≥2 saved) | Work panel opens with a calculated route |
| AI-5 | No API key | Panel shows setup message |
| TRN-1 | Transit → Chennai → Stops at map centre → tap a stop | Next buses with times; route finder "29A" draws a line |
| TRN-2 | Transit → Coimbatore | OSM stops (and routes if mapped); note says no timetable |
| TRN-3 | Trains → 12627 (with key) | Status, delay, stops |
| TRN-4 | Satellite → Live sky → traffic on (with key) | Coloured roads |
| TRN-5 | Open a place that has hours in OSM | "Open · closes …" shown |
| APP-2 | Open over HTTPS in Chrome/Samsung Internet | Install option appears; opens standalone |

## 13. Known gaps vs Google Maps / roadmap

Not built / not possible with free data: video stamping, photo-realistic 3D (Google Earth style), historical satellite imagery back to 1985, tree-canopy layers, junction-view images, crowd-sourced safety alerts (need a backend), fleet tracking of other vehicles (needs GPS trackers), multimodal metro/rail routing, panchang tithi/nakshatra, background GPS tracking when the screen is off (browser limitation).
Also still not available with free data: Google-quality business hours/reviews/photos, Google-quality 3D photogrammetry, live bus GPS positions, bus timetables outside Chennai, indoor maps, offline map tiles (PMTiles file per city is the free route; not built).
Possible next steps: PMTiles offline city maps, more city GTFS feeds as they are published (Bengaluru BMTC/BMRCL, Delhi OTD), Google Places (paid) for hours/reviews, route "leave by" times, shared work lists via a small database, signed Play Store release build, login.
