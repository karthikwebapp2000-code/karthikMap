/**
 * NASA GIBS (Global Imagery Browse Services) — free, no API key.
 * https://nasa-gibs.github.io/gibs-api-docs/
 * Tiles are served as WMTS in Web-Mercator (epsg3857) so MapLibre can use them as plain raster tiles.
 */
export type GibsGroup = "truecolor" | "fire" | "weather" | "night" | "land";

export type GibsLayer = {
  id: string;
  label: string;
  group: GibsGroup;
  layer: string;
  tms: string;
  ext: "jpg" | "png";
  maxzoom: number;
  cadence: "daily" | "halfhour";
  /** How old (hours) the newest published data usually is — used to pick the "live" timestamp. */
  lagHours: number;
  opacity: number;
  note: string;
};

export const GIBS_LAYERS: GibsLayer[] = [
  { id: "viirs-snpp", label: "VIIRS Suomi-NPP · true colour", group: "truecolor", layer: "VIIRS_SNPP_CorrectedReflectance_TrueColor", tms: "GoogleMapsCompatible_Level9", ext: "jpg", maxzoom: 9, cadence: "daily", lagHours: 0, opacity: 1, note: "Daily 250 m view of India, refreshed through the day as satellite passes arrive." },
  { id: "viirs-n20", label: "VIIRS NOAA-20 · true colour", group: "truecolor", layer: "VIIRS_NOAA20_CorrectedReflectance_TrueColor", tms: "GoogleMapsCompatible_Level9", ext: "jpg", maxzoom: 9, cadence: "daily", lagHours: 0, opacity: 1, note: "Second VIIRS satellite — fills gaps between Suomi-NPP passes." },
  { id: "viirs-n21", label: "VIIRS NOAA-21 · true colour", group: "truecolor", layer: "VIIRS_NOAA21_CorrectedReflectance_TrueColor", tms: "GoogleMapsCompatible_Level9", ext: "jpg", maxzoom: 9, cadence: "daily", lagHours: 0, opacity: 1, note: "Third VIIRS satellite in the same orbit family." },
  { id: "modis-terra", label: "MODIS Terra · true colour", group: "truecolor", layer: "MODIS_Terra_CorrectedReflectance_TrueColor", tms: "GoogleMapsCompatible_Level9", ext: "jpg", maxzoom: 9, cadence: "daily", lagHours: 0, opacity: 1, note: "Morning pass (~10:30 local). Long-running 250 m record." },
  { id: "modis-aqua", label: "MODIS Aqua · true colour", group: "truecolor", layer: "MODIS_Aqua_CorrectedReflectance_TrueColor", tms: "GoogleMapsCompatible_Level9", ext: "jpg", maxzoom: 9, cadence: "daily", lagHours: 0, opacity: 1, note: "Afternoon pass (~13:30 local)." },
  { id: "viirs-false", label: "VIIRS false colour (veg / burn scars)", group: "land", layer: "VIIRS_SNPP_CorrectedReflectance_BandsM11-I2-I1", tms: "GoogleMapsCompatible_Level9", ext: "jpg", maxzoom: 9, cadence: "daily", lagHours: 0, opacity: 1, note: "Vegetation shows green, burn scars red-brown, water black." },
  { id: "fires", label: "Active fires (VIIRS 375 m)", group: "fire", layer: "VIIRS_SNPP_Thermal_Anomalies_375m_All", tms: "GoogleMapsCompatible_Level9", ext: "png", maxzoom: 9, cadence: "daily", lagHours: 0, opacity: 1, note: "Thermal anomalies detected in the last satellite passes." },
  { id: "imerg", label: "Rainfall rate (IMERG, 30-min)", group: "weather", layer: "IMERG_Precipitation_Rate", tms: "GoogleMapsCompatible_Level6", ext: "png", maxzoom: 6, cadence: "halfhour", lagHours: 4, opacity: 0.8, note: "Satellite-estimated rain intensity; published roughly 4 hours behind real time." },
  { id: "aod", label: "Aerosol / haze (AOD)", group: "weather", layer: "MODIS_Combined_Value_Added_AOD", tms: "GoogleMapsCompatible_Level6", ext: "png", maxzoom: 6, cadence: "daily", lagHours: 0, opacity: 0.8, note: "Smoke, dust and smog optical depth." },
  { id: "lst", label: "Land surface temperature (day)", group: "land", layer: "MODIS_Terra_Land_Surface_Temp_Day", tms: "GoogleMapsCompatible_Level7", ext: "png", maxzoom: 7, cadence: "daily", lagHours: 0, opacity: 0.75, note: "Heat map of ground temperature from Terra." },
  { id: "night", label: "Night lights (VIIRS Day/Night band)", group: "night", layer: "VIIRS_SNPP_DayNightBand_ENCC", tms: "GoogleMapsCompatible_Level8", ext: "png", maxzoom: 8, cadence: "daily", lagHours: 0, opacity: 1, note: "City lights, power outages and gas flares at night." },
];

export const GIBS_GROUP_LABEL: Record<GibsGroup, string> = {
  truecolor: "Satellite photos",
  fire: "Fire",
  weather: "Weather & air",
  land: "Land",
  night: "Night",
};

const pad = (n: number) => String(n).padStart(2, "0");

export function utcDateString(offsetDays = 0, now = new Date()) {
  const d = new Date(now.getTime() + offsetDays * 86_400_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Newest half-hour slot that is at least `lagHours` old, formatted for GIBS. */
export function latestHalfHourStamp(lagHours: number, now = new Date()) {
  const t = new Date(now.getTime() - lagHours * 3_600_000);
  t.setUTCMinutes(t.getUTCMinutes() < 30 ? 0 : 30, 0, 0);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:00Z`;
}

/** `date` is YYYY-MM-DD (daily layers use it as-is; half-hourly layers use it only for non-live dates). */
export function gibsTimeFor(layer: GibsLayer, date: string, isLive: boolean) {
  if (layer.cadence === "daily") return date;
  return isLive ? latestHalfHourStamp(layer.lagHours) : `${date}T12:00:00Z`;
}

export function gibsTileUrl(layer: GibsLayer, time: string) {
  return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer.layer}/default/${time}/${layer.tms}/{z}/{y}/{x}.${layer.ext}`;
}
