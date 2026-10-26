// "Technical details" switch. Off by default: demo users see plain wording only. When on, the team sees
// operation ids, error codes, raw policy values and the request log. Wrap anything technical in <Tech>.
import React, { useSyncExternalStore } from 'react';

const KEY = 'nerdpos.tech';
let on = (() => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } })();
const ls = new Set<() => void>();

export const techMode = {
  get: () => on,
  set(v: boolean) { on = v; try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* ignore */ } ls.forEach((f) => f()); },
  subscribe(fn: () => void) { ls.add(fn); return () => { ls.delete(fn); }; },
};

export function useTech(): boolean {
  return useSyncExternalStore(techMode.subscribe, techMode.get);
}

/** Renders children only when technical details are on (optionally a plain fallback otherwise). */
export function Tech({ children, fallback = null }: { children: React.ReactNode; fallback?: React.ReactNode }) {
  return <>{useTech() ? children : fallback}</>;
}
