/** Sunrise / sunset (NOAA "sunrise equation") and the traditional day-division timings (Rahu Kalam etc.) derived from them. */
const RAD = Math.PI / 180;
const toJulian = (ms: number) => ms / 86_400_000 + 2440587.5;
const fromJulian = (j: number) => new Date((j - 2440587.5) * 86_400_000);

export type SunTimes = { sunrise: Date; sunset: Date; solarNoon: Date; dayMinutes: number } | { polar: "day" | "night" };

export function sunTimes(year: number, month: number, day: number, lat: number, lng: number): SunTimes {
  const noonUtc = Date.UTC(year, month - 1, day, 12);
  const n = Math.ceil(toJulian(noonUtc) - 2451545.0 + 0.0008);
  const jStar = n - lng / 360;                                      // longitude: east positive
  const M = (357.5291 + 0.98560028 * jStar) % 360;
  const C = 1.9148 * Math.sin(M * RAD) + 0.02 * Math.sin(2 * M * RAD) + 0.0003 * Math.sin(3 * M * RAD);
  const lambda = (M + C + 180 + 102.9372) % 360;
  const jTransit = 2451545.0 + jStar + 0.0053 * Math.sin(M * RAD) - 0.0069 * Math.sin(2 * lambda * RAD);
  const sinDec = Math.sin(lambda * RAD) * Math.sin(23.4397 * RAD);
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosH = (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * sinDec) / (Math.cos(lat * RAD) * cosDec);
  if (cosH > 1) return { polar: "night" };
  if (cosH < -1) return { polar: "day" };
  const w0 = Math.acos(cosH) / RAD;
  const sunrise = fromJulian(jTransit - w0 / 360), sunset = fromJulian(jTransit + w0 / 360);
  return { sunrise, sunset, solarNoon: fromJulian(jTransit), dayMinutes: (sunset.getTime() - sunrise.getTime()) / 60_000 };
}

// Segment (1–8) of the day, counted from sunrise, indexed by weekday (0 = Sunday).
const RAHU = [8, 2, 7, 5, 6, 4, 3];
const YAMA = [5, 4, 3, 2, 1, 7, 6];
const GULIKA = [7, 6, 5, 4, 3, 2, 1];

export type Span = { start: Date; end: Date };
export function dayDivisions(sunrise: Date, sunset: Date, weekday: number): { rahu: Span; yamagandam: Span; gulika: Span; abhijit: Span } {
  const t0 = sunrise.getTime(), len = sunset.getTime() - t0;
  const seg = (k: number): Span => ({ start: new Date(t0 + (len / 8) * (k - 1)), end: new Date(t0 + (len / 8) * k) });
  const muhurta = len / 15;                                       // 8th of 15 daytime muhurtas
  return { rahu: seg(RAHU[weekday]), yamagandam: seg(YAMA[weekday]), gulika: seg(GULIKA[weekday]), abhijit: { start: new Date(t0 + muhurta * 7), end: new Date(t0 + muhurta * 8) } };
}

/** Calendar date + weekday of `now` in the given IANA time zone. */
export function localDate(now: Date, timeZone?: string) {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "numeric", day: "numeric", weekday: "short" }).formatToParts(now);
  const g = (t: string) => p.find((x) => x.type === t)?.value || "";
  return { year: +g("year"), month: +g("month"), day: +g("day"), weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(g("weekday")) };
}
