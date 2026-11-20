"use client";

import { useSyncExternalStore } from "react";
import { STORAGE_PREFIX } from "./brand";

export type ThemeMode = "auto" | "light" | "dark";
export type LabelLang = "local" | "en" | "ta" | "hi";
export type Settings = {
  theme: ThemeMode;
  accent: string;
  glass: number;          // 0.35 – 0.95 surface opacity
  blur: number;           // 0 – 40 px
  radius: "compact" | "round" | "xl";
  textScale: number;      // 0.9 – 1.2
  syncMap: boolean;       // dark theme ⇒ dark map
  perf: "auto" | "on" | "off";
  labelLang: LabelLang;
  units: "km" | "mi";
  voiceOn: boolean;
  voiceURI: string;
  voiceRate: number;
  speedAlert: number;     // km/h, 0 = off
  mileage: number;        // km per litre
  fuelPrice: number;      // ₹ per litre
};

export const DEFAULTS: Settings = {
  theme: "auto", accent: "#0a84ff", glass: 0.68, blur: 26, radius: "round", textScale: 1, syncMap: true, perf: "auto",
  labelLang: "local", units: "km", voiceOn: true, voiceURI: "", voiceRate: 0.95, speedAlert: 0, mileage: 40, fuelPrice: 100,
};

export const ACCENTS: Array<[string, string]> = [
  ["Blue", "#0a84ff"], ["Indigo", "#5e5ce6"], ["Teal", "#30b0c7"], ["Green", "#30d158"],
  ["Orange", "#ff9f0a"], ["Pink", "#ff375f"], ["Red", "#ff453a"], ["Graphite", "#8e8e93"],
];

const KEY = `${STORAGE_PREFIX}:settings`;
const listeners = new Set<() => void>();
let current: Settings = DEFAULTS;
let loaded = false;

function read(): Settings {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return DEFAULTS; }
}

export function isLowEnd() {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 3;
}

export function resolvedTheme(s: Settings): "light" | "dark" {
  if (s.theme !== "auto") return s.theme;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applySettings(s: Settings) {
  const root = document.documentElement;
  const theme = resolvedTheme(s);
  const low = s.perf === "on" || (s.perf === "auto" && isLowEnd());
  root.dataset.theme = theme;
  root.dataset.perf = low ? "low" : "full";
  root.dataset.radius = s.radius;
  root.style.colorScheme = theme;
  root.style.setProperty("--accent", s.accent);
  root.style.setProperty("--glass-alpha", String(s.glass));
  root.style.setProperty("--blur", `${low ? Math.min(s.blur, 10) : s.blur}px`);
  root.style.setProperty("--fs", String(s.textScale));
}

export function getSettings() {
  if (!loaded && typeof window !== "undefined") { current = read(); loaded = true; }
  return current;
}

export function updateSettings(patch: Partial<Settings>) {
  current = { ...getSettings(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* storage blocked */ }
  applySettings(current);
  listeners.forEach((l) => l());
}

export function resetSettings() { updateSettings({ ...DEFAULTS }); }

function subscribe(cb: () => void) {
  listeners.add(cb);
  const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
  const onScheme = () => { applySettings(getSettings()); cb(); };
  mq?.addEventListener?.("change", onScheme);
  return () => { listeners.delete(cb); mq?.removeEventListener?.("change", onScheme); };
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings, () => DEFAULTS);
}
