"use client";

import { Briefcase, Bus, Camera, CloudDownload, Compass, Eye, LayoutGrid, Layers, Navigation, Ruler, Satellite, Settings as Cog, Sparkles } from "lucide-react";
import { useState } from "react";

export type PanelId = "explore" | "work" | "transit" | "tools" | "trips" | "photos" | "satellite" | "assistant" | "offline" | "settings";
type Item = { id: PanelId | "street" | "layers"; label: string; icon: React.ElementType; tile: string };

const ITEMS: Item[] = [
  { id: "explore", label: "Explore", icon: Compass, tile: "#0a84ff" },
  { id: "work", label: "Work", icon: Briefcase, tile: "#ff9f0a" },
  { id: "transit", label: "Transit", icon: Bus, tile: "#30b0c7" },
  { id: "tools", label: "Measure", icon: Ruler, tile: "#5e5ce6" },
  { id: "trips", label: "Trips", icon: Navigation, tile: "#30d158" },
  { id: "photos", label: "Site photos", icon: Camera, tile: "#ff375f" },
  { id: "satellite", label: "Satellite", icon: Satellite, tile: "#bf5af2" },
  { id: "assistant", label: "Ask AI", icon: Sparkles, tile: "#ff6482" },
  { id: "street", label: "Street view", icon: Eye, tile: "#64d2ff" },
  { id: "offline", label: "Offline", icon: CloudDownload, tile: "#8e8e93" },
  { id: "layers", label: "Map style", icon: Layers, tile: "#ac8e68" },
  { id: "settings", label: "Settings", icon: Cog, tile: "#636366" },
];
const PRIMARY: Array<Item["id"]> = ["explore", "work", "satellite", "assistant"];

type Props = {
  active: PanelId | null;
  streetOn: boolean;
  layersOn: boolean;
  onPanel: (id: PanelId) => void;
  onStreet: () => void;
  onLayers: () => void;
};

export default function Dock({ active, streetOn, layersOn, onPanel, onStreet, onLayers }: Props) {
  const [more, setMore] = useState(false);
  const pressed = (id: Item["id"]) => (id === "street" ? streetOn : id === "layers" ? layersOn : active === id);
  const choose = (id: Item["id"]) => {
    setMore(false);
    if (id === "street") onStreet(); else if (id === "layers") onLayers(); else onPanel(id);
  };
  const primary = ITEMS.filter((i) => PRIMARY.includes(i.id));
  const morePressed = more || ITEMS.some((i) => !PRIMARY.includes(i.id) && pressed(i.id));
  return <>
    {more && <div className="km-sheet" role="dialog" aria-label="All tools">
      <h2>Tools</h2>
      <div className="km-sheet-grid">
        {ITEMS.map(({ id, label, icon: Icon, tile }) => (
          <button key={id} aria-pressed={pressed(id)} onClick={() => choose(id)}><i style={{ ["--tile" as string]: tile }}><Icon size={20} /></i>{label}</button>
        ))}
      </div>
    </div>}
    <nav className="km-dock" aria-label="Karthik Map tools">
      {primary.map(({ id, label, icon: Icon }) => <button key={id} aria-pressed={pressed(id)} onClick={() => choose(id)}><Icon size={22} />{label}</button>)}
      <button aria-pressed={morePressed} onClick={() => setMore((m) => !m)} aria-expanded={more}><LayoutGrid size={22} />More</button>
    </nav>
  </>;
}
