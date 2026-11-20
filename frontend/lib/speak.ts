import { getSettings } from "./settings";

let last = "";
let lastAt = 0;

/** Speak with the user's chosen voice/speed. `urgent` interrupts anything being said; identical text is not repeated within 4 s. */
export function speak(text: string, urgent = false) {
  const s = getSettings();
  if (!s.voiceOn || typeof window === "undefined" || !window.speechSynthesis) return;
  const now = Date.now();
  if (text === last && now - lastAt < 4000) return;
  last = text; lastAt = now;
  const synth = window.speechSynthesis;
  if (urgent) synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const voice = s.voiceURI ? synth.getVoices().find((v) => v.voiceURI === s.voiceURI) : undefined;
  if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = "en-IN";
  u.rate = s.voiceRate;
  synth.speak(u);
}

export function buzz(pattern: number | number[] = [120, 60, 120]) {
  try { navigator.vibrate?.(pattern); } catch { /* not supported */ }
}
