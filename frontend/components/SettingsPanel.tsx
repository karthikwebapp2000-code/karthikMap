"use client";

import { RotateCcw, Settings as Cog, X } from "lucide-react";
import { useEffect, useState } from "react";
import { ACCENTS, resetSettings, updateSettings, useSettings, type LabelLang } from "@/lib/settings";

const LANGS: Array<[LabelLang, string]> = [["local", "Local"], ["en", "English"], ["ta", "தமிழ்"], ["hi", "हिन्दी"]];

export default function SettingsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useSettings();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!open || !window.speechSynthesis) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener?.("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener?.("voiceschanged", load);
  }, [open]);
  if (!open) return null;
  const preferred = voices.filter((v) => /^(en-IN|ta|hi|en-GB|en-US)/i.test(v.lang)).slice(0, 40);
  const custom = !ACCENTS.some(([, c]) => c.toLowerCase() === s.accent.toLowerCase());

  return <aside className="km-panel" aria-label="Settings">
    <header><div><Cog size={18} /><strong>Settings</strong></div><button onClick={onClose} aria-label="Close settings"><X size={17} /></button></header>
    <div className="km-body">
      <section>
        <h3>Appearance</h3>
        <div className="km-themes" role="radiogroup" aria-label="Theme">
          {([["light", "White"], ["dark", "Dark"], ["auto", "Auto"]] as const).map(([id, label]) => (
            <button key={id} role="radio" aria-checked={s.theme === id} className={s.theme === id ? "on" : ""} onClick={() => updateSettings({ theme: id })}><i className={`t-${id}`} />{label}</button>
          ))}
        </div>
        <h4>Accent colour</h4>
        <div className="km-swatches">
          {ACCENTS.map(([name, c]) => <button key={c} aria-label={name} title={name} className={s.accent.toLowerCase() === c ? "on" : ""} style={{ ["--c" as string]: c }} onClick={() => updateSettings({ accent: c })} />)}
          <input type="color" aria-label="Custom accent colour" value={s.accent} onChange={(e) => updateSettings({ accent: e.target.value })} title={custom ? "Custom colour" : "Pick any colour"} />
        </div>
        <label className="range-row"><span>Glass transparency <b>{Math.round((1 - s.glass) * 100)}%</b></span><input type="range" min="0.05" max="0.65" step="0.01" value={1 - s.glass} onChange={(e) => updateSettings({ glass: Math.round((1 - parseFloat(e.target.value)) * 100) / 100 })} /></label>
        <label className="range-row"><span>Blur <b>{s.blur}px</b></span><input type="range" min="0" max="40" step="1" value={s.blur} onChange={(e) => updateSettings({ blur: parseInt(e.target.value, 10) })} /></label>
        <div className="km-glass-preview"><span>Glass preview</span></div>
        <h4>Corners</h4>
        <div className="mode-segment">{(["compact", "round", "xl"] as const).map((r) => <button key={r} className={s.radius === r ? "active" : ""} onClick={() => updateSettings({ radius: r })}>{r === "xl" ? "Extra round" : r}</button>)}</div>
        <label className="range-row"><span>Text size <b>{Math.round(s.textScale * 100)}%</b></span><input type="range" min="0.9" max="1.25" step="0.05" value={s.textScale} onChange={(e) => updateSettings({ textScale: parseFloat(e.target.value) })} /></label>
      </section>

      <section>
        <h3>Map</h3>
        <label className="toggle-row"><span>Dark theme → dark map</span><input type="checkbox" checked={s.syncMap} onChange={(e) => updateSettings({ syncMap: e.target.checked })} /></label>
        <h4>Label language</h4>
        <div className="mode-segment">{LANGS.map(([id, label]) => <button key={id} className={s.labelLang === id ? "active" : ""} onClick={() => updateSettings({ labelLang: id })}>{label}</button>)}</div>
        <p className="km-hint">Uses names stored in OpenStreetMap. Places without a Tamil/Hindi name fall back to the local name; some glyphs may be missing in map fonts.</p>
        <h4>Units</h4>
        <div className="mode-segment">{(["km", "mi"] as const).map((u) => <button key={u} className={s.units === u ? "active" : ""} onClick={() => updateSettings({ units: u })}>{u === "km" ? "Kilometres" : "Miles"}</button>)}</div>
      </section>

      <section>
        <h3>Driving &amp; voice</h3>
        <label className="toggle-row"><span>Spoken turn-by-turn &amp; alerts</span><input type="checkbox" checked={s.voiceOn} onChange={(e) => updateSettings({ voiceOn: e.target.checked })} /></label>
        <label className="range-row"><span>Voice</span>
          <select value={s.voiceURI} onChange={(e) => updateSettings({ voiceURI: e.target.value })}>
            <option value="">Device default</option>
            {preferred.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>)}
          </select></label>
        <label className="range-row"><span>Speaking speed <b>{s.voiceRate.toFixed(2)}×</b></span><input type="range" min="0.7" max="1.3" step="0.05" value={s.voiceRate} onChange={(e) => updateSettings({ voiceRate: parseFloat(e.target.value) })} /></label>
        <button className="km-secondary" onClick={() => { const u = new SpeechSynthesisUtterance("Turn left in two hundred metres"); const v = voices.find((x) => x.voiceURI === s.voiceURI); if (v) u.voice = v; u.rate = s.voiceRate; u.lang = v?.lang || "en-IN"; window.speechSynthesis?.cancel(); window.speechSynthesis?.speak(u); }}>Test voice</button>
        <label className="range-row"><span>Over-speed alert {s.speedAlert ? <b>{s.speedAlert} km/h</b> : <b>off</b>}</span><input type="range" min="0" max="140" step="5" value={s.speedAlert} onChange={(e) => updateSettings({ speedAlert: parseInt(e.target.value, 10) })} /></label>
        <label className="range-row"><span>Vehicle mileage (km per litre)</span><input type="number" min="1" max="100" value={s.mileage} onChange={(e) => updateSettings({ mileage: Math.max(1, Number(e.target.value) || 1) })} /></label>
        <label className="range-row"><span>Fuel price (₹ per litre)</span><input type="number" min="1" max="500" value={s.fuelPrice} onChange={(e) => updateSettings({ fuelPrice: Math.max(1, Number(e.target.value) || 1) })} /></label>
      </section>

      <section>
        <h3>Performance</h3>
        <div className="mode-segment">{([["auto", "Auto"], ["on", "Light"], ["off", "Full"]] as const).map(([id, label]) => <button key={id} className={s.perf === id ? "active" : ""} onClick={() => updateSettings({ perf: id })}>{label}</button>)}</div>
        <p className="km-hint">Light mode lowers blur and animation so older phones stay smooth. Auto picks it for low-memory devices.</p>
      </section>

      <section className="plain"><button className="km-secondary" onClick={resetSettings}><RotateCcw size={14} />Reset appearance &amp; settings</button>
        <p className="km-hint">Karthik Map · map data © OpenStreetMap contributors, OpenFreeMap, NASA GIBS, and others listed in SPEC.md.</p></section>
    </div>
  </aside>;
}
