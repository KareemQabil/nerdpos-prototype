// Visual aging of a board card: a subtle accent that warms with age, and a clear late state from configured
// thresholds. Heat 0 = fresh, 1 = half way to the warning, 2 = past the warning, 3 = late.
export type Heat = 0 | 1 | 2 | 3;
export interface Aging { heat: Heat; late: boolean; /** short timer text on the card (e.g. «12 د») */ timer?: string; title?: string }

export const FRESH: Aging = { heat: 0, late: false };

/** Heat from an age and the two thresholds (same unit). Without a late threshold nothing warms. */
export function heatOf(age: number, warn: number | null | undefined, late: number | null | undefined): Heat {
  if (late == null || !Number.isFinite(late) || late <= 0) return 0;
  const w = warn != null && Number.isFinite(warn) && warn > 0 && warn < late ? warn : late * 0.6;
  if (age >= late) return 3;
  if (age >= w) return 2;
  if (age >= w / 2) return 1;
  return 0;
}

/** Whole minutes between an ISO time (or epoch ms) and now. */
export function minutesSince(at: string | number | null | undefined, now: number): number {
  if (at == null) return 0;
  const ms = typeof at === 'number' ? at : Date.parse(at);
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.floor((now - ms) / 60000));
}
