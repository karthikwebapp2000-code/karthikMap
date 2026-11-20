import { STORAGE_PREFIX } from "./brand";
const KEY = `${STORAGE_PREFIX}:settings`;

/** Inline script run before first paint so there is no white flash in dark mode. */
export const THEME_BOOT_SCRIPT = `(function(){try{var s=JSON.parse(localStorage.getItem("${KEY}")||"{}");var t=s.theme||"auto";if(t==="auto")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";var r=document.documentElement;r.dataset.theme=t;r.style.colorScheme=t;if(s.accent)r.style.setProperty("--accent",s.accent);if(s.glass)r.style.setProperty("--glass-alpha",s.glass);if(s.radius)r.dataset.radius=s.radius;var n=navigator;if(s.perf==="on"||(s.perf!=="off"&&((n.hardwareConcurrency||8)<=4||(n.deviceMemory||8)<=3)))r.dataset.perf="low"}catch(e){}})();`;
