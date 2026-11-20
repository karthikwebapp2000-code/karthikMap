"use client";

import { Mic, Send, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type AssistantAction = {
  type: "search" | "nearby" | "route_saved" | "fly_to" | "street_view" | "open_satellite" | "open_transit";
  query?: string; category?: string; names?: string[]; lat?: number; lng?: number; label?: string;
};
type Msg = { role: "user" | "assistant"; content: string; ran?: string[]; error?: boolean };

type Props = {
  open: boolean;
  onClose: () => void;
  getContext: () => Record<string, unknown>;
  onAction: (action: AssistantAction) => Promise<string>;
};

const QUICK = [
  "Plan my day using my saved sites",
  "What's near me right now?",
  "Tell me about the selected place",
  "Nearest railway station",
  "Show Burj Khalifa in 3D",
];

async function weatherBrief(lat: number, lng: number) {
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,precipitation,cloud_cover,wind_speed_10m,weather_code&timezone=auto`, { signal: AbortSignal.timeout(3000) });
    const c = (await r.json()).current;
    return c ? `${c.temperature_2m}°C, rain ${c.precipitation} mm, cloud ${c.cloud_cover}%, wind ${c.wind_speed_10m} km/h (WMO code ${c.weather_code})` : undefined;
  } catch { return undefined; }
}

export default function AssistantPanel({ open, onClose, getContext, onAction }: Props) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const SR = typeof window !== "undefined" ? ((window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec }).SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: new () => SpeechRec }).webkitSpeechRecognition) : undefined;

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, busy]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    const history = [...messages, { role: "user" as const, content }];
    setMessages(history);
    setInput("");
    setBusy(true);
    try {
      const context = getContext() as { gps?: { lat: number; lng: number }; map?: { lat: number; lng: number } };
      const at = context.gps ?? context.map;
      const weather = at ? await weatherBrief(at.lat, at.lng) : undefined;
      const res = await fetch("/api/v1/ai/chat", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content })), context: { ...context, weather, now: new Date().toString() } }),
      });
      const data = await res.json();
      if (!res.ok || data.status !== "OK") throw new Error(data.error || "The assistant is unavailable");
      const ran: string[] = [];
      for (const action of (data.actions || []) as AssistantAction[]) {
        try { ran.push(await onAction(action)); } catch (e) { ran.push(`Could not ${action.label || action.type}: ${e instanceof Error ? e.message : "failed"}`); }
      }
      setMessages((m) => [...m, { role: "assistant", content: data.reply, ran }]);
    } catch (error) {
      setMessages((m) => [...m, { role: "assistant", content: error instanceof Error ? error.message : "Something went wrong", error: true }]);
    } finally {
      setBusy(false);
    }
  };

  const listen = () => {
    if (!SR || listening) return;
    const rec = new SR();
    rec.lang = "en-IN"; rec.interimResults = false;
    rec.onresult = (e) => { const t = e.results[0]?.[0]?.transcript; if (t) void send(t); };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    setListening(true);
    rec.start();
  };

  if (!open) return null;
  return <aside className="km-panel km-ai" aria-label="AI assistant">
    <header>
      <div><Sparkles size={18} /><strong>Ask Karthik Map</strong><span className="km-live-badge">AI</span></div>
      <button onClick={onClose} aria-label="Close assistant"><X size={18} /></button>
    </header>
    <div className="km-chat">
      {messages.length === 0 && <div className="km-chat-intro">
        <p>I can see your map, GPS, saved work sites and the weather. Ask me to find places, plan a route or explain what you're looking at.</p>
        <div className="km-quick">{QUICK.map((q) => <button key={q} onClick={() => void send(q)}>{q}</button>)}</div>
      </div>}
      {messages.map((m, i) => <div key={i} className={`km-msg ${m.role}${m.error ? " error" : ""}`}>
        <p>{m.content}</p>
        {m.ran && m.ran.length > 0 && <ul>{m.ran.map((r, j) => <li key={j}>✓ {r}</li>)}</ul>}
      </div>)}
      {busy && <div className="km-msg assistant"><p><span className="search-spinner" /> Thinking…</p></div>}
      <div ref={endRef} />
    </div>
    <form className="km-chat-input" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
      {SR && <button type="button" onClick={listen} className={listening ? "active" : ""} aria-label="Speak"><Mic size={17} /></button>}
      <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask or tell the map what to do…" aria-label="Message" />
      <button type="submit" disabled={busy || !input.trim()} aria-label="Send"><Send size={17} /></button>
    </form>
  </aside>;
}

type SpeechRec = {
  lang: string; interimResults: boolean; start: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null; onerror: (() => void) | null;
};
