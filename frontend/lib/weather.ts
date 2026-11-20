export const WMO: Record<number, string> = {
  0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Rime fog", 51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain", 71: "Light snow", 73: "Snow", 75: "Heavy snow", 80: "Rain showers", 81: "Heavy showers", 82: "Violent showers",
  95: "Thunderstorm", 96: "Thunderstorm, hail", 99: "Severe thunderstorm",
};
export type Wx = { temp: number; code: number; text: string };
export async function fetchWeather(lat: number, lng: number): Promise<Wx | null> {
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code&timezone=auto`, { signal: AbortSignal.timeout(6000) });
    const c = (await r.json()).current;
    return c ? { temp: Math.round(c.temperature_2m), code: c.weather_code, text: WMO[c.weather_code] || "—" } : null;
  } catch { return null; }
}
