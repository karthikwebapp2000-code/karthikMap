# Karthik Map

A work-focused, all-India map platform with **live satellite data**. Built on Next.js 16, TypeScript and MapLibre GL (forked from the open-source City Maps project, MIT).

## What's new vs. City Maps

### Work map (briefcase button)
- **Saved work locations** — Office / Site / Client / Depot / Rail station / Other, each with notes (gate no., contact, timings). Stored on the device (localStorage); export CSV/JSON, import JSON.
- **Railway stations** — the bundled Indian Railways list (4,868 stations, `frontend/public/data/railway-stations.json`). Search by name or code (`MAS`, `TPJ`, `NDLS`) and tap to locate on the map. Coordinates come from OpenStreetMap (matched by station code, name search as fallback). "Show stations in this view" plots every station on screen. A "Railway Stations" chip is also in the nearby categories.
- **Day route** — pick stops, reorder, optimise by nearest next stop, start from your GPS position, get one combined car/bike/walk route with per-leg time and distance, and open it in Google Maps for phone navigation.

### Satellite hub (satellite button)
- **Imagery (NASA GIBS, no key)** — VIIRS (Suomi-NPP, NOAA-20, NOAA-21) and MODIS (Terra, Aqua) true colour, false colour, active fires, rainfall rate, aerosol/haze, land temperature, night lights. Latest / yesterday / any date since 2012, per-layer opacity. Falls back to yesterday automatically if today's passes aren't published yet.
- **Live sky** — animated rain radar and infrared cloud satellite (RainViewer, refreshed every 5 min), plus live temperature, rain, wind and air quality (Open-Meteo).
- **Tracker** — real-time positions of the ISS/Tiangong, NavIC, weather, GPS and Earth-observation satellites. Orbits are computed in the browser with SGP4 (satellite.js) from CelesTrak element sets (cached server-side for 2 h). Click a satellite for altitude, speed, ground track, visibility footprint, "follow", and **next passes over your location**. If CelesTrak is unreachable the ISS keeps updating from wheretheiss.at.
- A "LIVE" chip stays on the map while any live layer is on.

### Also new in 1.1
- **Ask AI** — assistant that sees your map, GPS, saved sites and weather, and can search, show nearby places, fly to 3D skylines, open street view and plan a route through your saved sites. Needs `ANTHROPIC_API_KEY`.
- **Street view** — Google Street View embed or Mapillary photos (free keys), or a no-key button that opens Google Street View.
- **Worldwide 3D** — no India lock, globe view, smoother 3D buildings, one-tap 3D skylines.
- **Install as app** — PWA over HTTPS; Android APK wrapper built by GitHub Actions (`mobile/`, untested).
- Full specification: `SPEC.md`. Copy `frontend/.env.example` to `frontend/.env.local` to add keys.

### Also new in 1.2
- **Transit panel** — Chennai MTC bus timetable bundled offline (community ChennaiGTFS, ODbL/PDDL), bus stops/routes for other cities from OpenStreetMap, live train status (RailRadar key), top-city shortcuts incl. Coimbatore.
- **Live traffic** (TomTom key), **opening hours** parsed from OpenStreetMap, **your own star ratings** on saved sites.
- Rebuild the Chennai dataset: `python3 scripts/build-chennai-bus.py chennai-unified-gtfs.zip`.

### Also new in 1.3 (from the Google Earth / GPS-camera / fleet / navigation screenshots)
Apple-style **glass UI** (light/dark/auto, accent colour, glass strength, corner style, performance mode) · **Measure** (distance, area, elevation, GPX/KML/GeoJSON import) · **Trips** with speed limit, bump/camera warnings, geofences, alarm log and playback · **Site photos** with GPS stamp · **Explore** (22 nearby categories, webcams, sunrise/Rahu Kalam, DIGIPIN) · **Offline maps** · voice guidance HUD · Tamil/Hindi labels. See SPEC.md §3.9–3.10.

### Street view (built in, open data)
Mapillary + KartaView + Panoramax + Wikimedia Commons merged in one viewer with true 360° panoramas, walk-along arrows and photo credits. Works with no keys; add a free Mapillary token for best coverage in India. See SPEC.md §3.6.

## Run
```bash
cd frontend
npm install
npm run dev      # http://localhost:3000
```
Geolocation needs HTTPS in production. Docker: `docker compose -f docker-compose.instabox.yml up -d --build`.

## Data sources / licences
OpenStreetMap (ODbL) · OpenFreeMap · OSRM · Google hybrid tiles (as in the original project; check Google's terms before commercial use) · NASA GIBS/EOSDIS · RainViewer · Open-Meteo · CelesTrak · wheretheiss.at.

## Where things are
| Area | Files |
|---|---|
| Work panel | `frontend/components/WorkPanel.tsx`, `lib/work.ts`, `lib/stations.ts` |
| Satellite hub | `frontend/components/SatelliteHub.tsx`, `lib/gibs.ts`, `lib/satellite.ts` |
| New APIs | `app/api/v1/stations/{resolve,bbox}`, `directions/multi`, `satellites/tle` |
| Branding | `frontend/lib/brand.ts` |

Add a GIBS layer with one entry in `GIBS_LAYERS` (verify its id and tile matrix in the GIBS WMTS capabilities: https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml).
