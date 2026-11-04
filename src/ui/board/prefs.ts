// Per-user board preferences on this device: board or list view, density, collapsed columns and grouping.
// UI only (not business state); kept per signed-in user so two people sharing a terminal keep their own layout.
import { useCallback, useSyncExternalStore } from 'react';

export type BoardView = 'board' | 'list';
export type BoardDensity = 'comfortable' | 'compact';
export type BoardGroup = 'status' | 'priority' | 'time';
export interface BoardPrefs { view?: BoardView; density?: BoardDensity; collapsed?: string[]; groupBy?: BoardGroup }

const KEY = 'nerdpos.boards.v1';
type All = Record<string, Record<string, BoardPrefs>>; // userId → boardId → prefs
let all: All = (() => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {}; } catch { return {}; } })();
const ls = new Set<() => void>();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* storage unavailable: keep in memory */ } ls.forEach((f) => f()); };

export function getBoardPrefs(userId: string | null | undefined, boardId: string): BoardPrefs {
  return all[userId ?? 'anon']?.[boardId] ?? {};
}
export function setBoardPrefs(userId: string | null | undefined, boardId: string, patch: Partial<BoardPrefs>) {
  const u = userId ?? 'anon';
  all = { ...all, [u]: { ...(all[u] ?? {}), [boardId]: { ...(all[u]?.[boardId] ?? {}), ...patch } } };
  save();
}

/** Preferences of one board for the signed-in user, and a setter. */
export function useBoardPrefs(userId: string | null | undefined, boardId: string): [BoardPrefs, (patch: Partial<BoardPrefs>) => void] {
  const snap = useSyncExternalStore((cb) => { ls.add(cb); return () => ls.delete(cb); }, () => all);
  const prefs = snap[userId ?? 'anon']?.[boardId] ?? {};
  const set = useCallback((patch: Partial<BoardPrefs>) => setBoardPrefs(userId, boardId, patch), [userId, boardId]);
  return [prefs, set];
}
