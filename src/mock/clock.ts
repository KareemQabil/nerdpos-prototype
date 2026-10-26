// The mock server's own clock. The device clock is never the source of business time.
// A demo control moves it (business-day cutoff, scheduled prices, happy hour, e-receipt alerts).

const KEY = 'nerdpos.clock.offset';
let offsetMs = 0;
let frozenAt: number | null = null;
try {
  offsetMs = Number(localStorage.getItem(KEY) ?? 0) || 0;
} catch { /* storage blocked: start at real time */ }

const listeners = new Set<() => void>();

export const clock = {
  now(): number {
    return (frozenAt ?? Date.now()) + offsetMs;
  },
  iso(): string {
    return new Date(clock.now()).toISOString();
  },
  offset(): number {
    return offsetMs;
  },
  advance(ms: number) {
    offsetMs += ms;
    persist();
  },
  /** Set the mock clock so that Cairo local time is `hh:mm` on the current Cairo date (+dayShift days). */
  setCairoTime(hh: number, mm: number, dayShift = 0) {
    const now = clock.now();
    const parts = cairoParts(now);
    const currentMinutes = parts.hour * 60 + parts.minute;
    const targetMinutes = hh * 60 + mm;
    const delta = (targetMinutes - currentMinutes) * 60_000 + dayShift * 86_400_000 - parts.second * 1000;
    offsetMs += delta;
    persist();
  },
  reset() {
    offsetMs = 0;
    persist();
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

function persist() {
  try {
    localStorage.setItem(KEY, String(offsetMs));
  } catch { /* ignore */ }
  listeners.forEach((l) => l());
}

export interface ZonedParts { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number }

const fmtCache = new Map<string, Intl.DateTimeFormat>();
export function zonedParts(ms: number, timeZone = 'Africa/Cairo'): ZonedParts {
  let f = fmtCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short' });
    fmtCache.set(timeZone, f);
  }
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(new Date(ms))) p[part.type] = part.value;
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour % 24, minute: +p.minute, second: +p.second, weekday: wd };
}
export const cairoParts = (ms: number) => zonedParts(ms, 'Africa/Cairo');

/** Business date = server rule per branch: local date in the branch timezone, shifted back before the cutoff. */
export function businessDate(ms: number, timeZone = 'Africa/Cairo', cutoff = '04:00'): string {
  const [ch, cm] = cutoff.split(':').map(Number);
  const p = zonedParts(ms, timeZone);
  let d = new Date(Date.UTC(p.year, p.month - 1, p.day));
  if (p.hour * 60 + p.minute < ch * 60 + cm) d = new Date(d.getTime() - 86_400_000);
  return d.toISOString().slice(0, 10);
}

export function localTime(ms: number, timeZone = 'Africa/Cairo'): string {
  const p = zonedParts(ms, timeZone);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}
