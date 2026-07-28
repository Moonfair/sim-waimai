/** Formats the gap between two ISO timestamps as "m分s秒" (or "s秒" when under a minute). */
export function formatWaitDuration(fromIso: string, toIso: string): string {
  const ms = Math.max(0, new Date(toIso).getTime() - new Date(fromIso).getTime());
  const totalSeconds = Math.round(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}
