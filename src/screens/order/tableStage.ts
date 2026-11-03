// One status language for a table, shared by the waiter's floor map and the cashier's collect view:
// free · seated (waiting to order) · ordered · waiting for food · food ready · pre-bill printed · waiting payment ·
// needs cleaning · reserved · stopped. Derived from what the server already returns (Table.List + the open dine-in
// checks with their rounds, kitchen progress and history) — the browser decides nothing about the check itself.
import { t } from '../../i18n';

export type TableStage = 'FREE' | 'SEATED' | 'ORDERED' | 'WAITING_FOOD' | 'FOOD_READY' | 'PREBILL' | 'PAYING' | 'DIRTY' | 'RESERVED' | 'INACTIVE';

const mix = (v: string, p: number) => `color-mix(in srgb, var(${v}) ${p}%, transparent)`;
/** Fill, edge and accent per stage (works in the three themes) and the plain label. */
export const STAGE_LOOK: Record<TableStage, { fill: string; edge: string; accent: string; label: string; short?: string }> = {
  FREE: { fill: mix('--success', 9), edge: mix('--success', 55), accent: 'var(--success)', label: 'متاحة' },
  SEATED: { fill: mix('--info', 14), edge: mix('--info', 70), accent: 'var(--info)', label: 'بانتظار الطلب' },
  ORDERED: { fill: 'rgba(236,72,153,.20)', edge: 'rgba(236,72,153,.75)', accent: '#ec4899', label: 'تم الطلب' },
  WAITING_FOOD: { fill: mix('--warning', 16), edge: mix('--warning', 75), accent: 'var(--warning-text, var(--warning))', label: 'بانتظار الطعام' },
  FOOD_READY: { fill: mix('--success', 22), edge: 'var(--success)', accent: 'var(--success)', label: 'الطعام جاهز' },
  PREBILL: { fill: mix('--violet', 18), edge: mix('--violet', 80), accent: 'var(--violet)', label: 'طُبع الشيك المبدئي', short: 'شيك مبدئي' },
  PAYING: { fill: mix('--primary', 18), edge: 'var(--primary)', accent: 'var(--primary)', label: 'بانتظار الدفع' },
  DIRTY: { fill: `repeating-linear-gradient(45deg, ${mix('--warning', 22)} 0 8px, ${mix('--warning', 7)} 8px 16px)`, edge: mix('--warning', 70), accent: 'var(--warning-text, var(--warning))', label: 'تحتاج تنظيفًا' },
  RESERVED: { fill: mix('--violet', 9), edge: mix('--violet', 50), accent: 'var(--violet)', label: 'محجوزة' },
  INACTIVE: { fill: 'transparent', edge: 'var(--glass-border)', accent: 'var(--text-dim)', label: 'موقوفة' },
};
export const stageLabel = (s: TableStage, short?: boolean) => t((short && STAGE_LOOK[s].short) || STAGE_LOOK[s].label);
/** The order the legend lists the stages in (the service cycle). */
export const STAGE_ORDER: TableStage[] = ['FREE', 'SEATED', 'ORDERED', 'WAITING_FOOD', 'FOOD_READY', 'PREBILL', 'PAYING', 'DIRTY', 'RESERVED'];

/** A pre-bill printed after the last item was added (the guest saw the current check). */
export function prebilledNow(o: any): boolean {
  const pre = (o.history ?? []).filter((h: any) => h.kind === 'PRE_BILL').map((h: any) => h.at as string);
  if (!pre.length) return false;
  const last = (o.lines ?? []).filter((l: any) => l.status === 'ACTIVE').map((l: any) => l.addedAt as string).sort().at(-1);
  return !last || pre.some((at: string) => at >= last);
}

/** The stage of one check (open dine-in check). */
export function checkStage(o: any): TableStage {
  if (o.status === 'CONFIRMED' || (o.settlement && o.settlement.paid !== '0.0000')) return 'PAYING';
  if (prebilledNow(o)) return 'PREBILL';
  const active = (o.lines ?? []).filter((l: any) => l.status === 'ACTIVE');
  const rounds: any[] = o.rounds ?? [];
  const cooking = rounds.filter((r) => r.kitchen && r.kitchen !== 'DONE');
  if (cooking.length) return cooking.every((r) => r.kitchen === 'READY') ? 'FOOD_READY' : 'WAITING_FOOD';
  if (active.length) return 'ORDERED';
  return 'SEATED';
}

const RANK: TableStage[] = ['SEATED', 'ORDERED', 'WAITING_FOOD', 'FOOD_READY', 'PREBILL', 'PAYING'];
/** The stage of a table from Table.List and the open dine-in checks (the most advanced check wins). */
export function tableStage(tb: any, openChecks: any[]): TableStage {
  if (!tb.occupancy) return !tb.active ? 'INACTIVE' : tb.turn?.state === 'DIRTY' ? 'DIRTY' : tb.reservation ? 'RESERVED' : 'FREE';
  const visitId = tb.occupancy.visitId;
  const mine = openChecks.filter((o) => o.visitId === visitId);
  if (!mine.length) return 'SEATED';
  return mine.map(checkStage).reduce((a, s) => (RANK.indexOf(s) > RANK.indexOf(a) ? s : a), 'SEATED' as TableStage);
}

/** Minutes since an ISO time on the (mock) server clock. */
export function minutesSince(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 60000));
}
