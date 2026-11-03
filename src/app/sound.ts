// Short sound cues for the kitchen screen and the call board, made with Web Audio (no files). Browsers only allow sound
// after a person touched the page, so the audio context is created on the first pointer or key press; until then a cue
// is skipped and `audioReady()` says so (the screens show a «تفعيل الصوت» chip). Mute is per device and remembered.
import { useSyncExternalStore } from 'react';

type Cue = 'new' | 'late' | 'ready';
let ctx: AudioContext | null = null;
const ls = new Set<() => void>();
const emit = () => ls.forEach((f) => f());
const KEY = 'nerdpos.sound.muted.v1';
let muted: Record<string, boolean> = (() => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {}; } catch { return {}; } })();
/** Played cues (QA aid: the e2e checks read window.__nerdCues). */
const played: Record<Cue, number> = { new: 0, late: 0, ready: 0 };
if (typeof window !== 'undefined') (window as unknown as { __nerdCues?: Record<Cue, number> }).__nerdCues = played;

function unlock() {
  if (ctx) return;
  try {
    const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    void ctx.resume?.();
  } catch { ctx = null; }
  emit();
}
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', unlock, { capture: true });
  window.addEventListener('keydown', unlock, { capture: true });
}

const NOTES: Record<Cue, [number, number][]> = {
  new: [[880, 0], [1175, 0.12]], // a light two-note "ding-ding"
  late: [[440, 0], [440, 0.22], [440, 0.44]], // three low beeps
  ready: [[659, 0], [784, 0.16], [1047, 0.32]], // a gentle rising chime
};

/** Plays a cue unless this device is muted. Returns whether it played (false before the first touch). */
export function cue(kind: Cue, deviceId: string): boolean {
  if (muted[deviceId]) return false;
  played[kind]++;
  if (!ctx) return false;
  try {
    const now = ctx.currentTime;
    for (const [f, at] of NOTES[kind]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = kind === 'late' ? 'square' : 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, now + at);
      g.gain.exponentialRampToValueAtTime(kind === 'late' ? 0.08 : 0.18, now + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + at + (kind === 'ready' ? 0.5 : 0.25));
      o.connect(g).connect(ctx.destination);
      o.start(now + at);
      o.stop(now + at + 0.6);
    }
    return true;
  } catch { return false; }
}

export const sound = {
  muted: (deviceId: string) => !!muted[deviceId],
  setMuted(deviceId: string, v: boolean) { muted = { ...muted, [deviceId]: v }; try { localStorage.setItem(KEY, JSON.stringify(muted)); } catch { /* ignore */ } emit(); },
  ready: () => !!ctx,
  subscribe(fn: () => void) { ls.add(fn); return () => { ls.delete(fn); }; },
};

export function useSound(deviceId: string) {
  const snap = useSyncExternalStore(sound.subscribe, () => `${muted[deviceId] ? 1 : 0}${ctx ? 1 : 0}`);
  return { muted: snap[0] === '1', ready: snap[1] === '1', setMuted: (v: boolean) => sound.setMuted(deviceId, v) };
}
