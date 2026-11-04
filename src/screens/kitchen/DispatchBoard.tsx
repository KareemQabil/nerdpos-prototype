// The dispatch (expediter) view: one card per order round with every station's readiness. «جاهز للتسليم» and the
// hand-off exist only here (KDS_DISPATCH_ONLY is enforced by the server). An order collected by number (the server's
// `callable`, CallBoardPolicy) is called to the call board with «نداء» once every station of every open round is ready;
// calling again re-announces it. A ticket whose items were all voided is not waited for (ux-12c).
import React from 'react';
import { Check, Clock, Flame, Megaphone, Truck, ConciergeBell, ChefHat, Ban } from 'lucide-react';
import { Kbd } from '../../ui';
import { t, L } from '../../i18n';
import { cn, qty } from '../../lib/format';
import { stationName } from '../../demo/humanLog';
import { personName } from '../../demo/people';
import { clock } from '../../mock/clock';
import { TONE, toneOf, ageSeconds, mmss, orderType, headline } from './TicketCard';

export interface OrderGroup { key: string; list: any[]; first: any; ready: boolean; rush: boolean; oldest: any; calledAt: string | null; byNumber: boolean; orderReady: boolean; waitingRounds: number[] }

/** A ticket the guest still waits for: at least one item not voided. */
export const liveTicket = (tk: any) => (tk.items ?? []).some((i: any) => i.status !== 'CANCELLED');

export function groupOrders(tickets: any[]): OrderGroup[] {
  const m = new Map<string, any[]>();
  const byOrder = new Map<string, any[]>();
  for (const tk of tickets) { const k = `${tk.orderId}:${tk.round}`; m.set(k, [...(m.get(k) ?? []), tk]); byOrder.set(tk.orderId, [...(byOrder.get(tk.orderId) ?? []), tk]); }
  return [...m.entries()].map(([key, list]) => {
    const oldest = list.reduce((a, b) => (Number(a.createdAtMs) <= Number(b.createdAtMs) ? a : b));
    const live = list.filter(liveTicket);
    const ready = live.length ? live.every((x) => x.state === 'READY') : list.every((x) => x.state === 'READY');
    // the number is on «جاهز» only while every ticket of the order the guest waits for carries the call (as on the
    // call board: a recall, a refire or a new round clears it)
    const orderLive = (byOrder.get(list[0].orderId) ?? []).filter(liveTicket);
    const calledAt = orderLive.length && orderLive.every((x) => x.calledAt) ? orderLive.map((x) => x.calledAt).sort().pop() : null;
    // the guest collects the whole order: another round still cooking holds the call
    const waitingRounds = [...new Set((byOrder.get(list[0].orderId) ?? []).filter((x) => x.round !== list[0].round && liveTicket(x) && x.state !== 'READY').map((x) => Number(x.round)))].sort((a, b) => a - b);
    return { key, list, first: list[0], ready, rush: list.some((x) => x.priority === 'RUSH'), oldest, calledAt, byNumber: list[0].callable === true, orderReady: ready && !waitingRounds.length, waitingRounds };
  }).sort((a, b) => Number(b.ready) - Number(a.ready) || Number(b.rush) - Number(a.rush) || Number(a.oldest.createdAtMs) - Number(b.oldest.createdAtMs));
}

export function DispatchBoard({ groups, sel, onSelect, onServe, onCall, busy, keys }: { groups: OrderGroup[]; sel: number; onSelect: (i: number) => void; onServe: (g: OrderGroup) => void; onCall: (g: OrderGroup) => void; busy: boolean; keys: { bump?: string; call?: string } }) {
  if (!groups.length) return <div className="h-full flex flex-col items-center justify-center gap-3 text-dim" data-fb="kds-expo"><ChefHat className="w-14 h-14 opacity-40" /><div className="text-lg font-bold">{t('لا توجد طلبات في المطبخ')}</div></div>;
  return (
    <div className="grid gap-3 items-start content-start" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))' }} data-fb="kds-expo">
      {groups.map((g, i) => {
        const tone = g.ready ? null : TONE[toneOf(g.oldest)];
        const type = orderType(g.first);
        const calledMin = g.calledAt ? Math.max(0, Math.floor((clock.now() - Date.parse(g.calledAt)) / 60000)) : null;
        return (
          <article key={g.key} onPointerDown={() => onSelect(i)} data-fb={`expo:${g.first.orderNumber}:r${g.first.round}`} data-ready={g.ready || undefined} data-called={g.calledAt ? 'true' : undefined} data-selected={sel === i || undefined}
            className={cn('rounded-2xl bg-[var(--card-raised)] border-2 overflow-hidden flex flex-col', sel === i && 'kds-selected')} style={{ borderColor: g.ready ? 'var(--success)' : g.rush ? 'var(--error)' : tone!.ring }}>
            <header className="px-3 py-2 flex items-start gap-2" style={g.ready ? { background: 'color-mix(in srgb, var(--success) 22%, transparent)' } : { background: tone!.bg, color: tone!.fg }}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap leading-tight">
                  {g.rush && <Flame className="w-5 h-5" />}
                  {g.first.shortNo && g.byNumber && <span className="num text-[28px] font-black leading-none">{g.first.shortNo}</span>}
                  <span className="text-[19px] font-extrabold truncate">{g.byNumber && g.first.shortNo ? g.first.orderLabel || g.first.customerName || '' : headline(g.first)}</span>
                </div>
                <div className="mt-1 flex items-center gap-1.5 flex-wrap text-[12px] font-bold opacity-90">
                  <span className="inline-flex items-center gap-1 px-1.5 h-5 rounded-md bg-black/15"><type.Icon className="w-3.5 h-3.5" />{type.label}</span>
                  <span>{t('الدفعة')} <span className="num">{g.first.round}</span></span>
                  <span className="num">#{g.first.orderNumber}</span>
                  {g.first.serverName && <span className="truncate">· {personName(null, g.first.serverName)}</span>}
                </div>
              </div>
              <span className="num text-[26px] font-black leading-none shrink-0">{mmss(ageSeconds(g.oldest))}</span>
            </header>
            <div className="p-2 space-y-1.5 flex-1">
              {g.list.map((tk) => {
                const st = tk.state === 'READY' ? 'ready' : tk.state === 'NEW' ? 'new' : 'cooking';
                return (
                  <div key={tk.id} className={cn('rounded-xl px-2.5 py-2 border', st === 'ready' ? 'border-[color-mix(in_srgb,var(--success)_45%,transparent)] bg-[color-mix(in_srgb,var(--success)_8%,transparent)]' : 'border-[var(--glass-border)] surface-1')} data-fb={`expo-station:${tk.stationName}`} data-state={tk.state}>
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <b className="text-[15px]">{stationName(tk.stationName)}</b>
                      <span className={cn('h-7 px-2 rounded-lg text-xs font-extrabold inline-flex items-center gap-1', st === 'ready' ? 'bg-[var(--success)] text-white' : st === 'new' ? 'surface-3 text-soft' : 'bg-[color-mix(in_srgb,var(--warning)_22%,transparent)] text-[var(--warning-text)]')}>
                        {st === 'ready' ? <><Check className="w-3.5 h-3.5" />{t('جاهز')}</> : st === 'new' ? t('لم يبدأ') : <><Clock className="w-3.5 h-3.5" />{t('قيد التحضير')}</>}
                      </span>
                    </div>
                    <div className="text-[15px] leading-snug">{tk.items.map((it: any) => <span key={it.lineId} className={cn('inline-block me-2', it.status === 'CANCELLED' && 'line-through text-[var(--error)]')}>{it.status === 'CANCELLED' && <Ban className="inline w-3.5 h-3.5 me-0.5" />}<span className="num font-bold">{qty(it.quantity)}×</span> {L(it.name)}</span>)}</div>
                  </div>
                );
              })}
            </div>
            <footer className="p-2 pt-0 flex gap-1.5 items-center">
              {i < 9 && <Kbd className={cn('!h-8 !min-w-8 !text-sm shrink-0', sel === i && '!border-[var(--primary)] !text-[var(--primary)]')}>{i + 1}</Kbd>}
              {g.ready ? (
                <>
                  {g.byNumber && !g.orderReady && <span className="h-14 px-2 rounded-xl surface-1 border border-dashed border-[var(--glass-border)] inline-flex items-center gap-1 text-xs text-soft font-bold shrink-0" data-fb="expo-call-wait"><Megaphone className="w-4 h-4 rtl:-scale-x-100" />{t('بانتظار الدفعة {n}', { n: g.waitingRounds.join(t('، ')) })}</span>}
                  {g.byNumber && g.orderReady && <button type="button" disabled={busy} onClick={() => onCall(g)} data-fb="expo-call" className={cn('h-14 px-3 rounded-xl font-extrabold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50', g.calledAt ? 'btn-secondary' : 'bg-[var(--primary)] text-[var(--primary-foreground)]')}>
                    <Megaphone className="w-5 h-5 rtl:-scale-x-100" />{g.calledAt ? t('إعادة النداء') : t('نداء')}{keys.call && sel === i && <Kbd className="!bg-black/10 !border-black/10 !text-current">{keys.call}</Kbd>}
                  </button>}
                  <button type="button" disabled={busy} onClick={() => onServe(g)} data-fb="expo-serve" className="flex-1 h-14 rounded-xl bg-[var(--success)] text-white text-lg font-extrabold inline-flex items-center justify-center gap-2 disabled:opacity-50"><Truck className="w-5 h-5 rtl:-scale-x-100" />{t('تسليم')}{keys.bump && sel === i && <Kbd className="!bg-black/15 !border-black/10 !text-current">{keys.bump}</Kbd>}</button>
                </>
              ) : <div className="h-14 flex-1 rounded-xl surface-1 border border-dashed border-[var(--glass-border)] flex items-center justify-center gap-1.5 text-sm text-soft font-bold"><ConciergeBell className="w-4 h-4" />{t('بانتظار: {s}', { s: g.list.filter((x) => liveTicket(x) && x.state !== 'READY').map((x) => stationName(x.stationName)).join(t('، ')) })}</div>}
            </footer>
            {calledMin !== null && <div className="px-3 pb-2 -mt-1 text-xs font-bold text-[var(--primary)] flex items-center gap-1" data-fb="expo-called"><Megaphone className="w-3.5 h-3.5 rtl:-scale-x-100" />{t('على شاشة النداء منذ {m} د', { m: calledMin })}</div>}
          </article>
        );
      })}
    </div>
  );
}
