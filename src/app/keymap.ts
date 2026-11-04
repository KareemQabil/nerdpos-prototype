// Keyboard map per device: defaults (SALE_KEYS / KDS_KEYS) ← the work profile's keys ← this device's own changes.
// ux-09 (owner decision pending; default used): the keys come from the profile and the device may override any of them.
// The device stores only its changes (action → key); they are replayed over the profile's map with swap-on-conflict,
// so whichever profile signs in, two actions never share a key. Assigning a key that another action uses swaps the two.
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

/** Keys that may be assigned: function keys (not F5 reload, F11 full screen, F12 tools) and a few navigation keys.
 *  ux-10: the same function keys with Shift («Shift+F2») — the plain keys were all taken by the sale screen. */
const F_KEYS = ['F1', 'F2', 'F3', 'F4', 'F6', 'F7', 'F8', 'F9', 'F10'];
export const ASSIGNABLE = [...F_KEYS, 'Insert', 'Home', 'End', 'PageUp', 'PageDown', 'Delete', ...F_KEYS.map((k) => `Shift+${k}`)];
/** The key name of a keyboard event as the maps store it: «Shift+F2» for a shifted function key, else `e.key`. */
export const keyName = (e: KeyboardEvent) => (e.shiftKey && /^F\d{1,2}$/.test(e.key) ? `Shift+${e.key}` : e.key);
/** Kitchen screen (bump bar): ←/→ and 1–9 stay fixed (move and pick a ticket); everything else a bump bar sends may be assigned. */
export const ASSIGNABLE_KDS = [...ASSIGNABLE, 'Enter', ' ', 'Backspace', 'ArrowUp', 'ArrowDown', '0', '+', '-', '*', '/', '.', ...'abcdefghijklmnopqrstuvwxyz'.split('')];
export const assignableOf = (scope: KeyScope) => (scope === 'kds' ? ASSIGNABLE_KDS : ASSIGNABLE);
const slot = (deviceId: string, scope: KeyScope) => (scope === 'sale' ? deviceId : `${deviceId}@${scope}`);
const defaultsOf = (scope: KeyScope): Map => (scope === 'kds' ? KDS_KEYS : SALE_KEYS);

/** Replays the device's changes over a base map: each change takes its key and the action that had it takes the old one. */
function apply(base: Map, changes: Map): Map {
  const out: Map = { ...base };
  for (const [a, k] of Object.entries(changes) as [KeyAction, string | undefined][]) {
    if (!k) continue;
    const old = out[a];
    const other = (Object.keys(out) as KeyAction[]).find((x) => x !== a && out[x] === k);
    out[a] = k;
    if (other) out[other] = old;
  }
  return out;
}

export const keymap = {
  /** The profile's map for a scope: defaults ← the profile's keys (swap on conflict). */
  base(scope: KeyScope = 'sale', profileKeys?: Map): Map { return apply(defaultsOf(scope), profileKeys ?? {}); },
  /** The effective map on this device: the profile's map ← the device's changes. */
  get(deviceId: string, scope: KeyScope = 'sale', profileKeys?: Map): Map { return apply(keymap.base(scope, profileKeys), all[slot(deviceId, scope)] ?? {}); },
  /** Assign `key` to `action` on this device; the action that had it takes this action's old key (swap). */
  assign(deviceId: string, action: KeyAction, key: string, scope: KeyScope = 'sale', profileKeys?: Map) {
    const cur = keymap.get(deviceId, scope, profileKeys);
    const old = cur[action];
    const other = (Object.keys(cur) as KeyAction[]).find((a) => a !== action && cur[a] === key);
    const changes: Map = { ...(all[slot(deviceId, scope)] ?? {}) };
    delete changes[action];
    changes[action] = key;
    if (other && old) { delete changes[other]; changes[other] = old; }
    all = { ...all, [slot(deviceId, scope)]: changes };
    emit();
  },
  /** Back to the profile's keys on this device. */
  reset(deviceId: string, scope: KeyScope = 'sale') { const { [slot(deviceId, scope)]: _, ...rest } = all; all = rest; emit(); },
  subscribe(fn: () => void) { ls.add(fn); return () => { ls.delete(fn); }; },
  snapshot: () => all,
};

export function useKeymap(deviceId: string, scope: KeyScope = 'sale', profileKeys?: Map): Map {
  useSyncExternalStore(keymap.subscribe, keymap.snapshot);
  return keymap.get(deviceId, scope, profileKeys);
}

/** Printable key name (F-keys stay Latin; Enter/Esc in words are not needed on a POS keyboard). */
const KEY_NAMES: Record<string, string> = { PageUp: 'PgUp', PageDown: 'PgDn', Insert: 'Ins', ' ': 'Space', Backspace: '⌫', Delete: 'Del', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc' };
export const keyLabel = (k?: string): string => (!k ? '' : k.startsWith('Shift+') ? `⇧${keyLabel(k.slice(6))}` : KEY_NAMES[k] ?? (k.length === 1 ? k.toUpperCase() : k));

const typing = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

/**
 * Runs actions from the effective key map (profile ← device) while no dialog is open. F-keys work even while typing in the search
 * field; Enter only when not typing. `handlers` maps an action to its run function (missing = not available).
 */
export function useHotkeys(deviceId: string, active: boolean, handlers: Partial<Record<KeyAction, () => void>>, scope: KeyScope = 'sale', profileKeys?: Map) {
  const map = useKeymap(deviceId, scope, profileKeys);
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
      const key = scope === 'kds' && e.key.length === 1 ? e.key.toLowerCase() : keyName(e);
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
