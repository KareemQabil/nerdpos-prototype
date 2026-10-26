// The in-memory mock database, persisted to localStorage, with change notifications.
import { buildSeed, buildEmpty } from './seed';
import { clock } from './clock';
import type { DB, HistoryEntry, Loc } from './types';

const KEY = 'nerdpos.mockdb.v3';
let db: DB = load();
let version = 0;
const listeners = new Set<(v: number) => void>();

function load(): DB {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DB;
      if (parsed.schema === 3) return parsed;
    }
  } catch { /* corrupted or blocked: reseed */ }
  return buildSeed(clock.now());
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function persistSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      localStorage.setItem(KEY, JSON.stringify(db));
    } catch { /* quota or blocked: keep in memory */ }
  }, 150);
}

export const store = {
  get db() {
    return db;
  },
  set db(next: DB) {
    db = next;
  },
  version: () => version,
  commit() {
    version++;
    persistSoon();
    listeners.forEach((l) => l(version));
  },
  reset(mode: 'DEMO' | 'ZERO' = 'DEMO') {
    db = mode === 'ZERO' ? buildEmpty(clock.now()) : buildSeed(clock.now());
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    store.commit();
  },
  subscribe(fn: (v: number) => void) {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
  exportJson() {
    return JSON.stringify(db, null, 1);
  },
  importJson(json: string) {
    const parsed = JSON.parse(json) as DB;
    if (parsed.schema !== 3) throw new Error('schema mismatch');
    db = parsed;
    store.commit();
  },
};

export function nextId(prefix: string): string {
  // starts above the seed's own keys (tbl_1..tbl_12, pr_1.., rc_1..) so new ids never collide
  db.seq[prefix] = (db.seq[prefix] ?? 100) + 1;
  return `${prefix}_${db.seq[prefix]}`;
}

export const nowIso = () => clock.iso();

export function hist(by: string, kind: string, text: Loc | string, data?: unknown, terminal?: string): HistoryEntry {
  const u = db.users.find((x) => x.id === by);
  return { at: clock.iso(), by, byName: u?.displayName ?? by, terminal, kind, text, data };
}

export function event(type: string, ref: string, text: string) {
  db.events.unshift({ id: nextId('ev'), at: clock.iso(), type, ref, text });
  if (db.events.length > 400) db.events.length = 400;
}
