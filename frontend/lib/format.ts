export function formatDurationText(totalSeconds: number): string {
  if (!totalSeconds || !Number.isFinite(totalSeconds) || totalSeconds <= 0) return "—";
  const mins = Math.round(totalSeconds / 60);
  if (mins < 1) return "< 1 min";
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hours < 24) return rem ? `${hours} hr ${rem} min` : `${hours} hr`;
  const days = Math.floor(hours / 24);
  const h = hours % 24;
  return h ? `${days} ${days === 1 ? "day" : "days"} ${h} hr` : `${days} ${days === 1 ? "day" : "days"}`;
}

export function formatDistanceText(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}
