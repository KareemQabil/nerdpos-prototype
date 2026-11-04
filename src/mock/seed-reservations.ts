// ux-12 seed — reservations complete: the permissions (reservations are managed by the host, the floor captain, the
// cashier — who takes the deposit at the till — and the manager; deposits are refunded at the till with a manager's
// approval), and today's book: three reservations linked to customers and one legacy free-text reservation (kept
// readable), plus one tomorrow. No seeded deposit: a deposit is cash in a drawer, so it is taken live in a shift.
// Prototype additions (demoAdded), listed in PROTOTYPE_GAPS §15h.
import type { DB, Reservation } from './types';

export const UX12_ROLE_ADDITIONS: Record<string, string[]> = {
  role_manager: ['reservation:manage', 'deposit:refund', 'approve:deposit_refund'],
  role_cashier: ['reservation:manage', 'deposit:refund'],
  role_host: ['reservation:manage'],
  role_captain: ['reservation:manage'],
};

export function seedReservations(db: DB, nowMs: number) {
  for (const r of db.roles) {
    const fresh = (UX12_ROLE_ADDITIONS[r.id] ?? []).filter((p) => !r.permissionIds.includes(p));
    if (!fresh.length) continue;
    r.permissionIds = [...r.permissionIds, ...fresh];
    (r as any).demoAdded = [...((r as any).demoAdded ?? []), ...fresh];
  }
  if (db.reservations.length || !db.tables.length) return;
  const q = 15 * 60_000;
  const at = (min: number) => new Date(Math.ceil((nowMs + min * 60_000) / q) * q).toISOString();
  const tbl = (name: string) => db.tables.find((t) => t.name === name && t.branchId === 'branch_main')?.id ?? null;
  const cust = db.customers ?? [];
  const rows: [number, number, string | null, number | null, string | null][] = [
    // minutes from now, party, table, customer index (null = legacy free text), notes
    [105, 4, '3', 4, 'عيد ميلاد — تحضير كعكة'],
    [195, 2, '5', 5, null],
    [285, 6, '12', 6, null],
    [135, 3, '11', null, null],
    [24 * 60 + 60, 5, '3', 7, null],
  ];
  let n = 0;
  for (const [min, party, table, ci, notes] of rows) {
    const c = ci === null ? null : cust[ci];
    if (ci !== null && !c) continue;
    const createdAt = new Date(nowMs - (3 - n) * 3_600_000).toISOString();
    const r: Reservation = {
      id: `resv_s${++n}`, branchId: 'branch_main', customer: c?.name ?? 'منى فؤاد', phone: c?.phone ?? '01223344556', customerId: c?.id ?? null, partySize: party, at: at(min), tableId: table ? tbl(table) : null,
      depositId: null, noShowFee: '0.0000', state: 'BOOKED', createdAt, createdBy: 'u_host', visitId: null, notes, version: 1,
      history: [{ at: createdAt, by: 'u_host', kind: 'CREATED' }],
    };
    db.reservations.push(r);
  }
}
