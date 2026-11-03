// The customer display is the second screen of a cashier terminal: the sale screen tells it, on the device, which check
// is on screen, which line was added last and what is being paid right now. Amounts and lines always come from the
// server (CustomerDisplay.View); this channel only carries the check id and what the cashier is typing in the payment
// popup (a Decimal preview of server amounts, the same one the cashier sees).
import { useSyncExternalStore } from 'react';

export interface PayingState { method: string; walletProvider?: string | null; due: string; entered: string; change: string | null; short: string | null }
export interface DisplayState {
  orderId: string | null;
  lastLineId: string | null;
  /** the payment popup is open on this check */
  paying: PayingState | null;
  /** the check was just paid: thank-you with the e-receipt QR until the next order (or a timeout on the display) */
  paid: { orderId: string; change: string; method: string; at: number } | null;
  at: number;
}
const EMPTY: DisplayState = { orderId: null, lastLineId: null, paying: null, paid: null, at: 0 };
let states: Record<string, DisplayState> = {};
const ls = new Set<() => void>();
const emit = () => ls.forEach((f) => f());

export const customerDisplay = {
  get: (hostDeviceId: string): DisplayState => states[hostDeviceId] ?? EMPTY,
  /** Called by the sale screen. A new check with lines ends the thank-you of the previous one. */
  publish(hostDeviceId: string, patch: Partial<DisplayState>) {
    const cur = states[hostDeviceId] ?? EMPTY;
    const next: DisplayState = { ...cur, ...patch, at: Date.now() };
    if (patch.orderId !== undefined && patch.orderId && cur.paid && patch.orderId !== cur.paid.orderId) next.paid = null;
    if (cur.orderId === next.orderId && cur.lastLineId === next.lastLineId && cur.paying === next.paying && cur.paid === next.paid) return;
    states = { ...states, [hostDeviceId]: next };
    emit();
  },
  subscribe(fn: () => void) { ls.add(fn); return () => { ls.delete(fn); }; },
};

export function useCustomerDisplay(hostDeviceId: string): DisplayState {
  return useSyncExternalStore(customerDisplay.subscribe, () => customerDisplay.get(hostDeviceId));
}
