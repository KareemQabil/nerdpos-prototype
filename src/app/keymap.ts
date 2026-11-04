// Keyboard map per device: defaults come from the profile (SALE_KEYS), every key can be remapped on this device;
// assigning a key that another action already uses swaps the two (no conflicts, like the legacy POS).
// ux-04: one map per scope — 'sale' (the sale screen's F-keys) and 'kds' (a kitchen screen driven by a bump bar, which
// is a keyboard sending digits, arrows, Enter, Space…). Each scope has its defaults and its assignable keys.
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { SALE_KEYS, KDS_KEYS, type SaleAction, type KdsAction } from './profiles';
import { inScanBurst } from './scanburst';
import { keyPane } from './devices';

export type KeyScope = 'sale' | 'kds';
export type KeyAction = SaleAction | 'primary' | KdsAction;
type Map = Partial<Record<KeyAction, string>>;
const KEY = 'nerdpos.keymap.v1';
let all: Record<string, Map> = (() => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {}; } catch { return {}; } })();
const ls = new Set<() => void>();
const emit = () => { try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* ignore */ } ls.forEach((f) => f()); };

/** Keys that may be assigned: function keys (not F5 reload, F11 full screen, F12 tools) and a few navigation keys. */
export const ASSIGNABLE = ['F1', 'F2', 'F3', 'F4', 'F6', 'F7', 'F8', 'F9', 'F10', 'Insert', 'Home', 'End', 'PageUp', 'PageDown', 'Delete'];
/** Kitchen screen (bump bar): ←/→ and 1–9 stay fixed (move and pick a ticket); everything else a bump bar sends may be assigned. */
export const ASSIGNABLE_KDS = [...ASSIGNABLE, 'Enter', ' ', 'Backspace', 'ArrowUp', 'ArrowDown', '0', '+', '-', '*', '/', '.', ...'abcdefghijklmnopqrstuvwxyz'.split('')];
export const assignableOf = (scope: KeyScope) => (scope === 'kds' ? ASSIGNABLE_KDS : ASSIGNABLE);
const slot = (deviceId: string, scope: KeyScope) => (scope === 'sale' ? deviceId : `${deviceId}@${scope}`);
const defaultsOf = (scope: KeyScope): Map => (scope === 'kds' ? KDS_KEYS : SALE_KEYS);

export const keymap = {
  get(deviceId: string, scope: KeyScope = 'sale'): Map { return { ...defaultsOf(scope), ...(all[slot(deviceId, scope)] ?? {}) }; },
  /** Assign `key` to `action`; the action that had it takes this action's old key (swap). */
  assign(deviceId: string, action: KeyAction, key: string, scope: KeyScope = 'sale') {
    const cur = keymap.get(deviceId, scope);
    const old = cur[action];
    const other = (Object.keys(cur) as KeyAction[]).find((a) => a !== action && cur[a] === key);
    const next: Map = { ...cur, [action]: key };
    if (other) next[other] = old;
    all = { ...all, [slot(deviceId, scope)]: next };
    emit();
  },
  reset(deviceId: string, scope: KeyScope = 'sale') { const { [slot(deviceId, scope)]: _, ...rest } = all; all = rest; emit(); },
  subscribe(fn: () => void) { ls.add(fn); return () => { ls.delete(fn); }; },
  snapshot: () => all,
};

export function useKeymap(deviceId: string, scope: KeyScope = 'sale'): Map {
  useSyncExternalStore(keymap.subscribe, keymap.snapshot);
  return keymap.get(deviceId, scope);
}

/** Printable key name (F-keys stay Latin; Enter/Esc in words are not needed on a POS keyboard). */
const KEY_NAMES: Record<string, string> = { PageUp: 'PgUp', PageDown: 'PgDn', Insert: 'Ins', ' ': 'Space', Backspace: '⌫', Delete: 'Del', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc' };
export const keyLabel = (k?: string) => (!k ? '' : KEY_NAMES[k] ?? (k.length === 1 ? k.toUpperCase() : k));

const typing = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

/**
 * Runs actions from the device key map while no dialog is open. F-keys work even while typing in the search
 * field; Enter only when not typing. `handlers` maps an action to its run function (missing = not available).
 */
export function useHotkeys(deviceId: string, active: boolean, handlers: Partial<Record<KeyAction, () => void>>, scope: KeyScope = 'sale') {
  const map = useKeymap(deviceId, scope);
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
      if (typing(e) && (!isF || scope === 'kds')) return;
      if (e.key === '?' && hs.shortcuts) { e.preventDefault(); hs.shortcuts(); return; }
      const key = scope === 'kds' && e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const action = (Object.keys(m) as KeyAction[]).find((a) => m[a] === key);
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
