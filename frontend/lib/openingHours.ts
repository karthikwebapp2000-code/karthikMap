/** Small parser for the common subset of OpenStreetMap `opening_hours` (e.g. "Mo-Sa 09:00-21:00; Su off", "24/7"). Returns null when unsure. */
const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Interval = [number, number];            // minutes from midnight; end may exceed 1440 for overnight
type Week = Interval[][];                    // index 0 = Sunday

function parseDays(spec: string): number[] | null {
  const out = new Set<number>();
  for (const part of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (/^PH$/i.test(part)) continue;       // public holidays are ignored
    const m = /^([A-Z][a-z])(?:\s*-\s*([A-Z][a-z]))?$/.exec(part);
    if (!m) return null;
    const a = DAYS.indexOf(m[1]); const b = m[2] ? DAYS.indexOf(m[2]) : a;
    if (a < 0 || b < 0) return null;
    for (let d = a; ; d = (d + 1) % 7) { out.add(d); if (d === b) break; }
  }
  return [...out];
}

function parseTimes(spec: string): Interval[] | null {
  const out: Interval[] = [];
  for (const part of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(part);
    if (!m) return null;
    const s = +m[1] * 60 + +m[2]; let e = +m[3] * 60 + +m[4];
    if (e <= s) e += 1440;
    out.push([s, e]);
  }
  return out;
}

export function parseOpeningHours(raw: string): Week | null {
  const text = raw.trim();
  if (!text) return null;
  if (/^24\/7$/i.test(text)) return Array.from({ length: 7 }, () => [[0, 1440]] as Interval[]);
  const week: Week = Array.from({ length: 7 }, () => []);
  for (const rule of text.split(";").map((r) => r.trim()).filter(Boolean)) {
    const m = /^(?:([A-Za-z,\s-]+?)\s+)?(off|closed|[\d:,\-\s]+)$/i.exec(rule);
    if (!m) return null;
    const days = m[1] ? parseDays(m[1]) : [0, 1, 2, 3, 4, 5, 6];
    if (!days) return null;
    if (/^(off|closed)$/i.test(m[2])) { days.forEach((d) => (week[d] = [])); continue; }
    const times = parseTimes(m[2]);
    if (!times) return null;
    days.forEach((d) => (week[d] = times));
  }
  return week;
}

const clock = (m: number) => {
  const mm = ((m % 1440) + 1440) % 1440; const h = Math.floor(mm / 60);
  return `${((h + 11) % 12) + 1}:${String(mm % 60).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
};

export type OpenState = { open: boolean; label: string };

export function openingState(raw: string | null | undefined, now = new Date(), timeZone?: string): OpenState | null {
  if (!raw) return null;
  const week = parseOpeningHours(raw);
  if (!week) return null;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  const minute = (+get("hour") % 24) * 60 + +get("minute");
  if (day < 0) return null;
  const prev = (day + 6) % 7;
  // currently open? (today's intervals, or yesterday's overnight spill)
  if (/^24\/7$/i.test(raw.trim())) return { open: true, label: "Open 24 hours" };
  for (const [s, e] of week[day]) if (minute >= s && minute < e) return { open: true, label: e - minute <= 60 ? `Open · closes ${clock(e)} (soon)` : `Open · closes ${clock(e)}` };
  for (const [s, e] of week[prev]) if (e > 1440 && minute < e - 1440) return { open: true, label: `Open · closes ${clock(e)}` };
  // next opening
  for (let i = 0; i < 8; i++) {
    const d = (day + i) % 7;
    const next = week[d].map(([s]) => s).filter((s) => i > 0 || s > minute).sort((a, b) => a - b)[0];
    if (next !== undefined) return { open: false, label: `Closed · opens ${i === 0 ? "today" : i === 1 ? "tomorrow" : DAY_NAMES[d]} ${clock(next)}` };
  }
  return { open: false, label: "Closed" };
}
