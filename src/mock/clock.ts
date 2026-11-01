// The mock server's own clock. The device clock is never the source of business time.
// Trusted time (round 3, F2-03 / E09): NOTHING in the UI can move this clock — transaction time and the business
// date come from the server and nobody (not even the owner) edits them. `advance`/`setCairoTime` remain only for
// headless tests; the offset is never persisted, and an offset saved by an older demo build is discarded on load.
// Scenarios that need "another time" age their own records instead (see src/demo/scripts.ts).

const KEY = 'nerdpos.clock.offset';
let offsetMs = 0;
let frozenAt: number | null = null;
let lastNow = 0;
try {
  localStorage.removeItem(KEY); // older builds let the demo move the clock: drop it, server time only
} catch { /* storage blocked */ }

const listeners = new Set<() => void>();

export const clock = {
  now(): number {
    // monotonic: if the device clock is set back, server time does not go backwards (P0-020 / A12 — the mock runs in
    // the browser, so the real product takes this from the server; here we at least never re-issue an earlier time)
    const n = (frozenAt ?? Date.now()) + offsetMs;
    if (n > lastNow) lastNow = n;
    return lastNow;
  },
  iso(): string {
    return new Date(clock.now()).toISOString();
  },
  offset(): number {
    return offsetMs;
  },
  /** Tests only (not reachable from the UI). */
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
    lastNow = 0;
    persist();
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

function persist() {
  listeners.forEach((l) => l()); // never saved: a reload is always server time
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

/**
 * Read-only previews (trusted time): the instant at Cairo wall time `hh:mm` on the current Cairo date, WITHOUT moving
 * the clock. Used e.g. by Catalog.Search `previewAt` ("the menu the cashier will see at 20:00"). Never a ledger time.
 */
export function cairoAt(hh: number, mm: number, baseMs = clock.now()): number {
  const p = cairoParts(baseMs);
  return baseMs + ((hh * 60 + mm) - (p.hour * 60 + p.minute)) * 60_000 - p.second * 1000;
}
/** "HH:MM" → preview instant, or null when absent/invalid. */
export function previewInstant(v: unknown, baseMs = clock.now()): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? ''));
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return cairoAt(+m[1], +m[2], baseMs);
}
