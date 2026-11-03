// Keyboard map per device: defaults come from the profile (SALE_KEYS), every key can be remapped on this device;
// assigning a key that another action already uses swaps the two (no conflicts, like the legacy POS).
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { SALE_KEYS, type SaleAction } from './profiles';
import { inScanBurst } from './scanburst';
import { keyPane } from './devices';

export type KeyAction = SaleAction | 'primary';
type Map = Partial<Record<KeyAction, string>>;
const KEY = 'nerdpos.keymap.v1';
let all: Record<string, Map> = (() => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {}; } catch { return {}; } })();
const ls = new Set<() => void>();
const emit = () => { try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* ignore */ } ls.forEach((f) => f()); };

/** Keys that may be assigned: function keys (not F5 reload, F11 full screen, F12 tools) and a few navigation keys. */
export const ASSIGNABLE = ['F1', 'F2', 'F3', 'F4', 'F6', 'F7', 'F8', 'F9', 'F10', 'Insert', 'Home', 'End', 'PageUp', 'PageDown'];

export const keymap = {
  get(deviceId: string): Map { return { ...SALE_KEYS, ...(all[deviceId] ?? {}) }; },
  /** Assign `key` to `action`; the action that had it takes this action's old key (swap). */
  assign(deviceId: string, action: KeyAction, key: string) {
    const cur = keymap.get(deviceId);
    const old = cur[action];
    const other = (Object.keys(cur) as KeyAction[]).find((a) => a !== action && cur[a] === key);
    const next: Map = { ...cur, [action]: key };
    if (other) next[other] = old;
    all = { ...all, [deviceId]: next };
    emit();
  },
  reset(deviceId: string) { const { [deviceId]: _, ...rest } = all; all = rest; emit(); },
  subscribe(fn: () => void) { ls.add(fn); return () => { ls.delete(fn); }; },
  snapshot: () => all,
};

export function useKeymap(deviceId: string): Map {
  useSyncExternalStore(keymap.subscribe, keymap.snapshot);
  return keymap.get(deviceId);
}

/** Printable key name (F-keys stay Latin; Enter/Esc in words are not needed on a POS keyboard). */
export const keyLabel = (k?: string) => (!k ? '' : k === 'PageUp' ? 'PgUp' : k === 'PageDown' ? 'PgDn' : k === 'Insert' ? 'Ins' : k);

const typing = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

/**
 * Runs actions from the device key map while no dialog is open. F-keys work even while typing in the search
 * field; Enter only when not typing. `handlers` maps an action to its run function (missing = not available).
 */
export function useHotkeys(deviceId: string, active: boolean, handlers: Partial<Record<KeyAction, () => void>>) {
  const map = useKeymap(deviceId);
  const ref = useRef({ map, handlers });
  ref.current = { map, handlers };
  useEffect(() => {
    if (!active) return;
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      if (e.key === 'Enter' && inScanBurst()) return; // the end of a barcode scan, not the primary action
      if (keyPane() !== deviceId) return; // two panes side by side: only the one last touched
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      const { map: m, handlers: hs } = ref.current;
      const isF = /^F\d{1,2}$/.test(e.key) || ASSIGNABLE.includes(e.key);
      if (typing(e) && !isF) return;
      if (e.key === '?' && hs.shortcuts) { e.preventDefault(); hs.shortcuts(); return; }
      const action = (Object.keys(m) as KeyAction[]).find((a) => m[a] === e.key);
      if (!action) { if (e.key === 'F1') e.preventDefault(); return; }
      const fn = hs[action];
      if (!fn) return;
      e.preventDefault();
      fn();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [active]);
}
