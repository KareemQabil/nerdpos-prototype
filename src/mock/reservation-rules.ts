// ux-12: reservation and deposit rules shared by the floor handlers (reservations, seating) and the money handlers
// (deposit application and refund). ReservationPolicy (proposed, strictest operable defaults — PROTOTYPE_GAPS §15h):
// a seat lasts 90 minutes plus a 15-minute buffer (two bookings of the same table closer than that conflict); a
// cancellation within 2 hours of the time forfeits the deposit (FORFEIT_IF_LATE), an earlier one leaves it to be
// refunded out of a drawer with a manager's approval (DEPOSIT_REFUND); a table shows its reservation on the floor
// plan from 120 minutes before. All money is Decimal (decimal.js), never JavaScript floats.
import { policy } from './policies';
import { D, m4 } from './money';
import type { DB, Deposit, Reservation, ReservationEvent } from './types';

export type CancelDepositMode = 'REFUND_WITH_APPROVAL' | 'FORFEIT_IF_LATE' | 'ALWAYS_FORFEIT';
export const CANCEL_DEPOSIT_MODES: CancelDepositMode[] = ['REFUND_WITH_APPROVAL', 'FORFEIT_IF_LATE', 'ALWAYS_FORFEIT'];
export interface ReservationRules { seatMinutes: number; bufferMinutes: number; cancelDepositMode: CancelDepositMode; lateCancelHours: number; upcomingMinutes: number }
export const RESERVATION_DEFAULTS: ReservationRules = { seatMinutes: 90, bufferMinutes: 15, cancelDepositMode: 'FORFEIT_IF_LATE', lateCancelHours: 2, upcomingMinutes: 120 };

const whole = (v: unknown, dflt: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : dflt;
};
export function reservationRules(branchId?: string | null): ReservationRules {
  const v = policy<Partial<ReservationRules>>('ReservationPolicy', { branchId }) ?? {};
  const d = RESERVATION_DEFAULTS;
  return {
    seatMinutes: whole(v.seatMinutes, d.seatMinutes, 15, 600),
    bufferMinutes: whole(v.bufferMinutes, d.bufferMinutes, 0, 240),
    // an unknown mode falls back to the strictest operable one
    cancelDepositMode: CANCEL_DEPOSIT_MODES.find((m) => m === v.cancelDepositMode) ?? d.cancelDepositMode,
    lateCancelHours: whole(v.lateCancelHours, d.lateCancelHours, 0, 168),
    upcomingMinutes: whole(v.upcomingMinutes, d.upcomingMinutes, 0, 1440),
  };
}

/** The block a reservation holds on its table: seat duration + buffer, in ms. */
export const blockMs = (r: ReservationRules) => (r.seatMinutes + r.bufferMinutes) * 60_000;

/** Another reservation that holds the same table within the block (booked, or seated with its visit still open). */
export function tableConflict(db: DB, rules: ReservationRules, branchId: string, tableId: string, atMs: number, excludeId?: string | null): Reservation | null {
  const win = blockMs(rules);
  return db.reservations.find((o) => o.id !== excludeId && o.branchId === branchId && o.tableId === tableId
    && (o.state === 'BOOKED' || (o.state === 'SEATED' && db.visits.some((v) => v.id === o.visitId && v.state === 'OPEN')))
    && Math.abs(Date.parse(o.at) - atMs) < win) ?? null;
}

// ── deposits: amount (immutable) = applied + refunded + forfeited + remaining
export function depositBalances(d: Deposit) {
  // a deposit applied before ux-12 has no application records: its whole amount was applied
  const applied = d.applications?.length ? d.applications.reduce((a, x) => a.plus(D(x.amount)), D(0)) : d.state === 'APPLIED' ? D(d.amount) : D(0);
  const refunded = (d.refunds ?? []).reduce((a, x) => a.plus(D(x.amount)), D(0));
  const forfeited = d.forfeit ? D(d.forfeit.amount) : d.state === 'FORFEITED' ? D(d.amount).minus(applied).minus(refunded) : D(0);
  const remaining = D(d.amount).minus(applied).minus(refunded).minus(forfeited);
  return { applied: m4(applied), refunded: m4(refunded), forfeited: m4(forfeited), remaining: m4(remaining.lt(0) ? 0 : remaining) };
}
export const depVersion = (d: Deposit) => (d.version ??= 1);
export const resVersion = (r: Reservation) => (r.version ??= 1);

export function pushResEvent(r: Reservation, e: ReservationEvent) {
  (r.history ??= []).push(e);
}

/** The held remainder becomes income (no-show, late cancellation, or the ALWAYS_FORFEIT policy). */
export function forfeitDeposit(d: Deposit, by: string, at: string, cause: 'NO_SHOW' | 'LATE_CANCEL' | 'CANCEL_POLICY', reservationId: string | null, reason: string | null) {
  const b = depositBalances(d);
  d.forfeit = { at, by, amount: b.remaining, cause, reservationId, reason };
  d.state = 'FORFEITED';
  d.version = depVersion(d) + 1;
  return b.remaining;
}

/** What cancelling now does to the deposit, by the policy (the server decides; the screen shows the same answer). */
export function cancelOutcome(rules: ReservationRules, r: Reservation, d: Deposit | null | undefined, nowMs: number): { late: boolean; outcome: 'NONE' | 'REFUNDABLE' | 'FORFEITED'; amount: string; cutoffAt: string } {
  const atMs = Date.parse(r.at);
  const cutoff = atMs - rules.lateCancelHours * 3_600_000;
  const late = nowMs >= cutoff;
  const held = d && d.state === 'HELD' ? depositBalances(d).remaining : '0.0000';
  if (!d || D(held).lte(0)) return { late, outcome: 'NONE', amount: '0.0000', cutoffAt: new Date(cutoff).toISOString() };
  const forfeit = rules.cancelDepositMode === 'ALWAYS_FORFEIT' || (rules.cancelDepositMode === 'FORFEIT_IF_LATE' && late);
  return { late, outcome: forfeit ? 'FORFEITED' : 'REFUNDABLE', amount: held, cutoffAt: new Date(cutoff).toISOString() };
}

/** Why a deposit cannot be refunded now (null = it can), for the view and the command. */
export function refundBlock(db: DB, d: Deposit): string | null {
  const b = depositBalances(d);
  if (d.state === 'FORFEITED') return 'FORFEITED';
  if (D(b.remaining).lte(0)) return 'NOTHING_REMAINING';
  const r = d.reservationId ? db.reservations.find((x) => x.id === d.reservationId) : null;
  if (r && r.state === 'BOOKED') return 'RESERVATION_ACTIVE';
  return null;
}

export function depositView(db: DB, d: Deposit) {
  const r = d.reservationId ? db.reservations.find((x) => x.id === d.reservationId) : db.reservations.find((x) => x.depositId === d.id);
  const cust = d.customerId ? (db.customers ?? []).find((c) => c.id === d.customerId) : null;
  return {
    ...d, version: depVersion(d), ...depositBalances(d), refundBlock: refundBlock(db, d),
    customerName: cust?.name ?? d.customer, reservationId: r?.id ?? d.reservationId ?? null, reservationState: r?.state ?? null, reservationAt: r?.at ?? null, visitId: r?.visitId ?? null,
    applications: d.applications ?? [], refunds: d.refunds ?? [],
  };
}
