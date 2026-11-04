// The sale screen's second mode «تحصيل»: everything the cashier collects, without the side menu.
// - الترابيزات: a compact floor map in the same status language as the waiter's map; a table opens its check in the
//   cart (several checks on one table → a small chooser).
// - الشيكات: every open check (dine-in, takeaway, delivery, held) with instant search (number, table, name/customer)
//   and quick filters, waiting-for-payment first then the oldest, with age and amount.
// - المغلقة اليوم: today's closed checks for a reprint (approval rule applies) or starting a refund (in a popup).
// Scanning the number printed on a pre-bill / receipt opens that check. Keys: PgUp / PgDn / End switch views, F10 search.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Armchair, ClipboardList, CheckCheck, Clock, Printer, RotateCcw, Users, Search } from 'lucide-react';
import { useDev, useQuery } from '../../app/hooks';
import { Money, EmptyState, Skeleton, SearchInput, Pill, useNow, SegmentedControl, FilterChips, Popover, Kbd, Button, Popup, toast, DateTime } from '../../ui';
import { t } from '../../i18n';
import { cn } from '../../lib/format';
import { clock } from '../../mock/clock';
import { keyLabel } from '../../app/keymap';
import { inScanBurst } from '../../app/scanburst';
import { FloorBoard, useFloorData } from '../Floor';
import { minutesSince, checkStage, stageLabel, STAGE_LOOK } from '../order/tableStage';
import { placeOf } from './PaymentPopup';
import { ReprintDialog } from '../admin/output/ReprintDialog';
import { RefundForm } from '../Refunds';

export type CollectView = 'tables' | 'checks' | 'closed';
type Filter = 'all' | 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY' | 'waiting' | 'held';

export function collectState(o: any): { label: string; tone: 'primary' | 'warning' | 'success' | 'info' } {
  if (o.settlement && o.settlement.paid !== '0.0000') return { label: t('مدفوع جزئيًا'), tone: 'success' };
  if (o.status === 'CONFIRMED') return { label: t('بانتظار الدفع'), tone: 'warning' };
  if (o.unfiredCount > 0) return { label: t('لم يُرسل بعد'), tone: 'info' };
  return { label: t('مفتوح'), tone: 'primary' };
}
const waiting = (o: any) => o.status === 'CONFIRMED' || (o.settlement && o.settlement.paid !== '0.0000');
const held = (o: any) => !o.visitId && o.status === 'DRAFT' && o.channel !== 'DELIVERY';
const nameOf = (o: any) => o.label || o.customerName || o.customer?.name || '';
const codeOf = (raw: string) => raw.trim().replace(/^#/, '').replace(/^CHK[-:]/i, '');

export function CollectWorkspace({ view, onView, current, businessDate, showKeys, keys, onPick, toolbarStart }: { view: CollectView; onView: (v: CollectView) => void; current: string | null; sessionId: string; businessDate: string | null; showKeys: boolean; keys: Record<string, string | undefined>; onPick: (o: any) => void; toolbarStart?: React.ReactNode }) {
  useNow(30000);
  const floor = useFloorData();
  const openQ = useQuery<any>('Order.Find', { query: { lifecycle: 'DRAFT,CONFIRMED', sort: 'OLDEST' } });
  const closedQ = useQuery<any>(view === 'closed' && businessDate ? 'Order.Find' : null, { query: { lifecycle: 'COMPLETED', businessDate: businessDate ?? '' } });
  const open: any[] = (openQ.data?.items ?? []).filter((o: any) => o.kind !== 'STAFF_MEAL');
  const closed: any[] = (closedQ.data?.items ?? []).filter((o: any) => o.kind !== 'STAFF_MEAL');
  const [chooser, setChooser] = useState<null | { anchor: HTMLElement; checks: any[] }>(null);

  // a scan of the number printed on a pre-bill (or receipt) opens that check
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    let buf = '';
    let last = 0;
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && !inScanBurst()) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const now = performance.now();
      if (now - last > 60) buf = '';
      last = now;
      if (e.key === 'Enter') {
        if (buf.length >= 4) {
          const code = codeOf(buf);
          const o = openRef.current.find((x) => x.number === code || x.number.replace(/^0+/, '') === code.replace(/^0+/, ''));
          if (o) { e.preventDefault(); pickRef.current(o); if (el?.tagName === 'INPUT') (el as HTMLInputElement).blur(); }
          else toast('warning', t('لا يوجد شيك مفتوح بهذا الرقم'), code);
        }
        buf = '';
        return;
      }
      if (e.key.length === 1) buf += e.key;
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, []);

  const k = (a: string) => (showKeys && keys[a] ? <Kbd className="ms-1 !text-[10px]">{keyLabel(keys[a])}</Kbd> : null);
  const tablesBusy = floor.items.filter((x) => x.occupancy).length;
  return (
    <div className="flex flex-col gap-3 min-h-0 h-full" data-fb="collect-board" data-view={view}>
      <div className="flex items-center gap-2 shrink-0 flex-wrap">
        {toolbarStart}
        <SegmentedControl size="lg" value={view} onChange={onView} options={[
          { id: 'tables', label: <span className="inline-flex items-center">{t('الترابيزات')}{k('viewTables')}</span>, icon: <Armchair />, count: tablesBusy || undefined, fb: 'collect-view:tables' },
          { id: 'checks', label: <span className="inline-flex items-center">{t('الشيكات')}{k('viewChecks')}</span>, icon: <ClipboardList />, count: open.length || undefined, fb: 'collect-view:checks' },
          { id: 'closed', label: <span className="inline-flex items-center">{t('المغلقة اليوم')}{k('viewClosed')}</span>, icon: <CheckCheck />, fb: 'collect-view:closed' },
        ]} />
      </div>
      {view === 'tables' && (
        <FloorBoard data={floor} compact selectedId={floor.items.find((tb) => floor.checksOf(tb).some((c) => c.id === current))?.id ?? null} onTable={(tb, el) => {
          const cs = floor.checksOf(tb);
          if (!cs.length) return toast('info', t('لا يوجد شيك مفتوح على هذه الترابيزة'), `${t('ترابيزة')} ${tb.name}`);
          if (cs.length === 1) return onPick(cs[0]);
          setChooser({ anchor: el, checks: cs });
        }} />
      )}
      {view === 'checks' && <ChecksList list={open} loading={openQ.loading && !openQ.data} current={current} onPick={onPick} />}
      {view === 'closed' && <ClosedList list={closed} loading={closedQ.loading && !closedQ.data} />}
      {chooser && (
        <Popover anchor={chooser.anchor} open onClose={() => setChooser(null)} side="auto" align="start" width={300} fb="table-check-chooser" label={t('اختر الشيك')}>
          <div className="grid gap-0.5">
            {chooser.checks.map((c) => (
              <button key={c.id} role="menuitem" onClick={() => { setChooser(null); onPick(c); }} data-fb={`choose-check:${c.checkNo}`} className="min-h-14 px-3 rounded-xl flex items-center gap-3 text-sm hover:bg-[var(--surface-2)] text-start">
                <span className="flex-1 min-w-0"><span className="font-bold">{t('شيك')} <span className="num">{c.checkNo}</span></span><span className="block text-xs" style={{ color: STAGE_LOOK[checkStage(c)].accent }}>{stageLabel(checkStage(c))}</span></span>
                <Money v={c.settlement?.remaining ?? c.totals?.payable} />
              </button>
            ))}
          </div>
        </Popover>
      )}
    </div>
  );
}

function ChecksList({ list, loading, current, onPick }: { list: any[]; loading: boolean; current: string | null; onPick: (o: any) => void }) {
  const [q, setQ] = useState('');
  const [f, setF] = useState<Filter>('all');
  const now = clock.now();
  const match = (o: any) => !q || `${o.number} ${o.tableName ?? ''} ${nameOf(o)} ${o.customerPhone ?? ''}`.toLowerCase().includes(q.trim().toLowerCase());
  const byF = (o: any, x: Filter) => x === 'all' || (x === 'waiting' ? waiting(o) : x === 'held' ? held(o) && o.channel !== 'DINE_IN' : o.channel === x);
  const shown = useMemo(() => list.filter((o) => match(o) && byF(o, f)).sort((a, b) => (waiting(b) ? 1 : 0) - (waiting(a) ? 1 : 0) || a.createdAt.localeCompare(b.createdAt)), [list, q, f]); // eslint-disable-line react-hooks/exhaustive-deps
  const n = (x: Filter) => list.filter((o) => byF(o, x)).length;
  return (
    <div className="flex flex-col gap-2.5 min-h-0 flex-1">
      <div className="flex items-center gap-2 flex-wrap shrink-0">
        <SearchInput value={q} onChange={setQ} placeholder={t('ابحث بالرقم أو الترابيزة أو الاسم')} className="!max-w-sm flex-1 min-w-[220px] [&_input]:!h-12" data-fb="collect-search"
          onKeyDown={(e) => { if (e.key === 'Enter' && shown.length === 1) { e.preventDefault(); onPick(shown[0]); } if (e.key === 'Escape' && q) { e.stopPropagation(); setQ(''); } }} />
        <FilterChips value={f} onChange={setF} options={[
          { id: 'all', label: t('الكل'), count: list.length, fb: 'collect-filter:all' },
          { id: 'DINE_IN', label: t('صالة'), count: n('DINE_IN'), fb: 'collect-filter:dine' },
          { id: 'TAKEAWAY', label: t('تيك أواي'), count: n('TAKEAWAY'), fb: 'collect-filter:takeaway' },
          { id: 'DELIVERY', label: t('دليفري'), count: n('DELIVERY'), fb: 'collect-filter:delivery' },
          { id: 'waiting', label: t('بانتظار الدفع'), count: n('waiting'), tone: 'warning', fb: 'collect-filter:waiting' },
          { id: 'held', label: t('المعلقة'), count: n('held'), fb: 'collect-filter:held' },
        ]} />
      </div>
      {loading ? <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>
        : shown.length === 0 ? <EmptyState icon={<Search />} title={q || f !== 'all' ? t('لا توجد نتائج') : t('لا توجد شيكات مفتوحة')} />
          : (
            <div className="grid gap-2.5 overflow-y-auto pe-1 pb-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gridAutoRows: 'max-content', alignContent: 'start' }} data-fb="collect-list">
              {shown.map((o) => {
                const s = collectState(o);
                const on = o.id === current;
                const m = minutesSince(o.createdAt, now);
                const who = nameOf(o);
                return (
                  <button key={o.id} onClick={() => onPick(o)} data-fb={`collect:${o.tableName ?? o.number}:${o.checkNo ?? 1}`} data-check={o.number} aria-pressed={on}
                    className={cn('text-start rounded-2xl border p-3 flex flex-col gap-1.5 min-h-[112px] transition-[border-color,background,transform] active:scale-[.98]', on ? 'border-[var(--primary)] bg-[var(--primary-container)] shadow-[0_0_0_1px_var(--primary)]' : 'border-[var(--glass-border)] bg-[var(--card-raised)] hover:border-[color-mix(in_srgb,var(--primary)_45%,var(--glass-border))]')}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-lg font-bold font-display leading-tight truncate">{o.tableName ? `${t('ترابيزة')} ${o.tableName}` : who || placeOf(o)}</div>
                        <div className="text-xs text-dim mt-0.5 truncate"><span className="num">#{o.number}</span>{o.tableName ? <> · {t('شيك')} <span className="num">{o.checkNo}</span></> : who ? <> · {placeOf(o)}</> : null}</div>
                      </div>
                      <Pill tone={s.tone} size="sm" dot>{s.label}</Pill>
                    </div>
                    <div className="mt-auto flex items-end justify-between gap-2">
                      <span className="text-xs text-dim flex items-center gap-2">
                        {o.guestCount ? <span className="inline-flex items-center gap-1"><Users className="w-3.5 h-3.5" /><span className="num">{o.guestCount}</span></span> : null}
                        {m !== null && <span className={cn('inline-flex items-center gap-1', m >= 30 && 'text-[var(--warning-text)] font-bold')}><Clock className="w-3.5 h-3.5" /><span className="num">{m}</span>{t('د')}</span>}
                      </span>
                      <Money v={o.settlement?.remaining ?? o.totals?.payable} className="text-xl" />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
    </div>
  );
}

function ClosedList({ list, loading }: { list: any[]; loading: boolean }) {
  const { can, terminal } = useDev();
  const [q, setQ] = useState('');
  const [reprint, setReprint] = useState<any>(null);
  const [refund, setRefund] = useState<any>(null);
  const shown = list.filter((o) => !q || `${o.number} ${o.tableName ?? ''} ${nameOf(o)}`.toLowerCase().includes(q.trim().toLowerCase())).sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
  return (
    <div className="flex flex-col gap-2.5 min-h-0 flex-1" data-fb="collect-closed">
      <SearchInput value={q} onChange={setQ} placeholder={t('ابحث بالرقم أو الترابيزة أو الاسم')} className="!max-w-sm [&_input]:!h-12" data-fb="collect-search" />
      {loading ? <Skeleton lines={5} /> : shown.length === 0 ? <EmptyState icon={<CheckCheck />} title={t('لا توجد شيكات مغلقة اليوم')} /> : (
        <div className="overflow-y-auto pe-1 space-y-1.5">
          {shown.map((o) => (
            <div key={o.id} className="rounded-2xl border border-[var(--glass-border)] bg-[var(--card-raised)] px-3 py-2 flex items-center gap-3" data-fb={`closed:${o.number}`}>
              <div className="flex-1 min-w-0">
                <div className="font-bold truncate"><span className="num">#{o.number}</span> · {o.tableName ? `${t('ترابيزة')} ${o.tableName}` : nameOf(o) || placeOf(o)}</div>
                <div className="text-xs text-dim"><DateTime v={o.completedAt} time /></div>
              </div>
              <Money v={o.totals?.payable} className="text-lg" />
              <Button size="lg" variant="secondary" disabled={!can('print:reprint')} onClick={() => setReprint(o)} data-fb={`closed-reprint:${o.number}`}><Printer className="w-4 h-4" />{t('إعادة الطباعة')}</Button>
              <Button size="lg" variant="secondary" disabled={!can('refund:request') && !can('refund:read')} onClick={() => setRefund(o)} data-fb={`closed-refund:${o.number}`}><RotateCcw className="w-4 h-4" />{t('مرتجع')}</Button>
            </div>
          ))}
        </div>
      )}
      {reprint && <ReprintDialog job={{ documentType: 'RECEIPT', documentId: reprint.id, label: `${t('إيصال')} ${reprint.number}` }} terminalId={terminal?.id ?? null} onClose={() => setReprint(null)} />}
      {refund && (
        <Popup open onClose={() => setRefund(null)} size="xl" title={<span className="flex items-center gap-2"><RotateCcw className="w-5 h-5" />{t('مرتجع')} <span className="num">#{refund.number}</span></span>} fb="refund-popup">
          <RefundForm orderId={refund.id} onDone={() => setRefund(null)} />
        </Popup>
      )}
    </div>
  );
}
