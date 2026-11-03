// Settings of a display screen, kept on the display device itself (like a TV's own menu): which terminal it follows,
// its look (the app theme or the high-contrast display style), and for the call board how long a number stays ready.
import { useSyncExternalStore } from 'react';
import { DISPLAY_DEVICES } from '../../app/devices';

export type DisplayStyle = 'theme' | 'display';
export interface DisplaySettings { host: string; style: DisplayStyle; readyMinutes: number; autoCall: boolean; branding: boolean }
const KEY = 'nerdpos.display.v1';
let all: Record<string, Partial<DisplaySettings>> = (() => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {}; } catch { return {}; } })();
const ls = new Set<() => void>();
const cache = new Map<string, DisplaySettings>();

export function displaySettings(id: string): DisplaySettings {
  const hit = cache.get(id);
  if (hit) return hit;
  const d = DISPLAY_DEVICES[id];
  const v: DisplaySettings = { host: d?.host ?? 't_cash', style: 'theme', readyMinutes: 10, autoCall: false, branding: true, ...(all[id] ?? {}) };
  cache.set(id, v);
  return v;
}
export function setDisplaySettings(id: string, patch: Partial<DisplaySettings>) {
  all = { ...all, [id]: { ...(all[id] ?? {}), ...patch } };
  cache.delete(id);
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* ignore */ }
  ls.forEach((f) => f());
}
export function useDisplaySettings(id: string): DisplaySettings {
  return useSyncExternalStore((cb) => { ls.add(cb); return () => { ls.delete(cb); }; }, () => displaySettings(id));
}
