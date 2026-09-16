export const TZ = 'Africa/Johannesburg';
export function nowIso(): string {
  return new Date().toISOString();
}
/** 16 Sep 2026 · 09:40 (SAST) */
export function formatSast(iso: string | Date, opts: { date?: boolean; time?: boolean } = { date: true, time: true }): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const parts: string[] = [];
  if (opts.date !== false)
    parts.push(new Intl.DateTimeFormat('en-ZA', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' }).format(d));
  if (opts.time !== false)
    parts.push(new Intl.DateTimeFormat('en-ZA', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d));
  return parts.join(' · ');
}
export function minutesBetween(a: string | Date, b: string | Date): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);
}
export function addMinutes(iso: string | Date, m: number): string {
  return new Date(new Date(iso).getTime() + m * 60000).toISOString();
}
export function todaySast(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}
