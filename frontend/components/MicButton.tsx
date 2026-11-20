"use client";

import { Mic } from "lucide-react";
import { useEffect, useState } from "react";

type Rec = { lang: string; interimResults: boolean; start: () => void; stop: () => void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };
type Ctor = new () => Rec;

/** Voice search via the Web Speech API (Chrome / Samsung Internet; hidden where unsupported, e.g. Firefox). */
export default function MicButton({ onText }: { onText: (t: string) => void }) {
  const [Sr, setSr] = useState<Ctor | null>(null);
  const [on, setOn] = useState(false);
  useEffect(() => { const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor }; setSr(() => w.SpeechRecognition || w.webkitSpeechRecognition || null); }, []);
  if (!Sr) return null;
  const listen = () => {
    if (on) return;
    const r = new Sr(); r.lang = "en-IN"; r.interimResults = false;
    r.onresult = (e) => { const t = e.results[0]?.[0]?.transcript; if (t) onText(t); };
    r.onend = () => setOn(false); r.onerror = () => setOn(false);
    setOn(true); r.start();
  };
  return <button className={`km-mic${on ? " on" : ""}`} onClick={listen} aria-label="Search by voice" title="Search by voice"><Mic size={18} /></button>;
}
