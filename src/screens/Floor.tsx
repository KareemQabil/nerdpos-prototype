// C1 Floor: the real floor plan per section (main hall, terrace, upper floor) scaled to fit the screen, with live
// table stages in one status language (free · waiting to order · ordered · waiting for food · food ready · pre-bill
// printed · waiting payment · needs cleaning · reserved), guests, time seated, waiter and the check total; a
// "my tables" filter and a list view. On the waiter's tablet a table opens its check IN PLACE (products | check |
// action bar); a free table opens a short centered popup (guests). No side panels.
import { useCollect } from './cashier/PaymentPopup';
import React, { useState } from 'react';
import { Users, Clock, Plus, ArrowRightLeft, Link2, Unlink, DoorClosed, Wallet, ClipboardList, UserCog, CalendarClock, Minus, Sparkles, Map as MapIcon, LayoutGrid, Brush, ZoomIn, ZoomOut, Maximize2, Receipt, ChevronLeft, Armchair, Send } from 'lucide-react';
import { useDev, useQuery, useCommand, errorText } from '../app/hooks';
import { PageHeader, StateBadge, Pill, Modal, Button, Banner, Money, EmptyState, Tabs, SegmentedControl, Skeleton, useNow, FilterChips } from '../ui';
import { Tech } from '../app/tech';
import { personName, userLabel } from '../demo/people';
import { t, L } from '../i18n';
import { cn, money, time } from '../lib/format';
import { sumAmounts } from '../lib/cash';
import { StatusPill } from './order/CheckPanel';
import { FloorCanvas, Seats, shapeClass } from './ops/FloorCanvas';
import { STAGE_LOOK, STAGE_ORDER, stageLabel, tableStage, type TableStage } from './order/tableStage';
import { WaiterCheck } from './waiter/WaiterCheck';

const AREA_AR: Record<string, string> = { Hall: 'الصالة الرئيسية', Terrace: 'التراس' };
const LONG_SEATED = 90; // minutes: a long visit is highlighted for the floor manager
const ZOOMS = [1, 1.25, 1.5, 2];
const placeName = (tb: any) => (tb.floorName ? L(tb.floorName) : AREA_AR[tb.area] ?? (tb.area || '—'));
const firstName = (s?: string | null) => (s ? personName(null, s) : '');
const LOOK = STAGE_LOOK;
const OCC: TableStage[] = ['SEATED', 'ORDERED', 'WAITING_FOOD', 'FOOD_READY', 'PREBILL', 'PAYING'];

/** Tables, floors and the open dine-in checks — what the floor map and the cashier's tables view draw from. */
export function useFloorData() {
  const tables = useQuery<any>('Table.List', { query: {} });
  const floors = useQuery<any>('Floor.List');
  const checks = useQuery<any>('Order.Find', { query: { channel: 'DINE_IN', lifecycle: 'DRAFT,CONFIRMED', sort: 'OLDEST' } });
  const items: any[] = tables.data?.items ?? [];
  const open: any[] = (checks.data?.items ?? []).filter((o: any) => o.visitId);
  const stageOf = (tb: any) => tableStage(tb, open);
  const checksOf = (tb: any) => (tb.occupancy ? open.filter((o) => o.visitId === tb.occupancy.visitId) : []);
  return { tables, floors, items, fl: (floors.data?.items ?? []) as any[], open, stageOf, checksOf, loading: (tables.loading && !tables.data) || (floors.loading && !floors.data) };
}

export default function Floor() {
  const { kind, params, nav } = useDev();
  // the waiter's tablet: the check opens in place, inside the floor workspace
  if (kind === 'FLOOR' && params.orderId) return <WaiterCheck orderId={params.orderId} onBack={() => nav('floor', {})} onSwitch={(id) => nav('floor', { orderId: id })} />;
  return <FloorScreen />;
}

function FloorScreen() {
  const { kind, nav, me } = useDev();
  const waiter = kind === 'FLOOR';
  useNow(30000);
  const data = useFloorData();
  const { items, loading } = data;
  const [view, setView] = useState<'map' | 'list'>('map');
  const [who, setWho] = useState<'all' | 'mine'>('all');
  const [selId, setSelId] = useState<string | null>(null);
  const meId = me?.user?.id ?? null;
  const mine = (tb: any) => !!tb.occupancy && tb.occupancy.serverUserId === meId;
  const guests = items.reduce((a, x) => a + (x.occupancy?.primary ? x.occupancy.guestCount : 0), 0);
  const busy = items.filter((x) => x.occupancy).length;
  const sel = selId ? items.find((x) => x.id === selId) ?? null : null;
  const openCheck = (id: string) => (waiter ? nav('floor', { orderId: id }) : nav('order', { orderId: id, back: 'floor' }));
  const onTable = (tb: any) => {
    const cs = data.checksOf(tb);
    if (waiter && tb.occupancy && cs.length === 1) return openCheck(cs[0].id);
    setSelId(tb.id);
  };
  return (
    <div data-screen="C1" className="h-full flex flex-col gap-3 min-h-0" data-profile={waiter ? 'waiter' : undefined}>
      <PageHeader className="!mb-0" title={t('الصالة')} ops={['Table.List', 'Floor.List', 'TableVisit.Open', 'TableVisit.Transfer', 'TableVisit.Close', 'Table.MarkClean']}
        meta={!loading && <><Pill tone="neutral"><Armchair className="w-3 h-3" /><span className="num">{busy}/{items.filter((x) => x.active).length}</span> {t('مشغولة')}</Pill><Pill tone="neutral"><Users className="w-3 h-3" /><span className="num">{guests}</span> {t('ضيف الآن')}</Pill></>}
        actions={<div className="flex items-center gap-2 flex-wrap">
          <FilterChips value={who} onChange={setWho} options={[{ id: 'all', label: t('الكل'), count: busy, fb: 'floor-all' }, { id: 'mine', label: t('ترابيزاتي'), count: items.filter(mine).length, fb: 'floor-mine' }]} />
          <SegmentedControl value={view} onChange={setView} options={[{ id: 'map', label: t('الخريطة'), icon: <MapIcon />, fb: 'floor-view:map' }, { id: 'list', label: t('قائمة'), icon: <LayoutGrid />, fb: 'floor-view:list' }]} />
        </div>} />
      {data.tables.error && <Banner tone="error">{errorText(data.tables.error)}</Banner>}
      <FloorBoard data={data} view={view} onList={() => setView('list')} onTable={onTable} selectedId={selId} dim={who === 'mine' ? (tb) => !mine(tb) : undefined} />
      {sel && <TableSheet tb={sel} tables={items} onClose={() => setSelId(null)} openCheck={openCheck} waiter={waiter} />}
    </div>
  );
}

/** Floor tabs + stage legend + the plan (or the list). `compact` = the cashier's tables view on the sale screen. */
export function FloorBoard({ data, view = 'map', onTable, selectedId, dim, compact, onList }: { data: ReturnType<typeof useFloorData>; view?: 'map' | 'list'; onTable: (tb: any, el: HTMLElement) => void; selectedId?: string | null; dim?: (tb: any) => boolean; compact?: boolean; onList?: () => void }) {
  const { items, fl, loading, stageOf, checksOf } = data;
  const [floorId, setFloorId] = useState<string>('');
  const [zoom, setZoom] = useState(1);
  const current = fl.find((f) => f.id === floorId) ?? fl[0];
  const onFloor = (tb: any) => !current || tb.floorId === current.id;
  const shown = view === 'map' ? items.filter((tb) => tb.layout && onFloor(tb)) : items.filter((tb) => (onFloor(tb) || !tb.floorId) && !(dim && dim(tb)));
  const counts: Partial<Record<TableStage, number>> = {};
  for (const tb of items) { const s = stageOf(tb); counts[s] = (counts[s] ?? 0) + 1; }
  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3" data-fb={compact ? 'collect-tables' : 'floor-board'}>
      <div className="flex items-center gap-2 flex-wrap shrink-0">
        {fl.length > 1 && <Tabs value={current?.id ?? ''} onChange={setFloorId} tabs={fl.map((f) => ({ id: f.id, label: <span data-fb={`floor-tab:${f.name.ar}`}>{L(f.name)} <span className="num text-xs opacity-70">{items.filter((x) => x.floorId === f.id && x.occupancy).length}/{items.filter((x) => x.floorId === f.id).length}</span></span> }))} />}
        <div className="flex-1" />
        <Legend c={counts} compact={compact} />
      </div>
      <div className="flex-1 min-h-[240px] relative">
        {loading ? <Skeleton className="absolute inset-0 rounded-2xl" />
          : !items.length ? <EmptyState icon={<Armchair />} title={t('لا توجد ترابيزات')} />
            : view === 'map' && current ? (
              <>
                <FloorCanvas fit zoom={zoom} width={current.width} height={current.height} decor={current.decor ?? []} tables={shown.map((tb) => ({ id: tb.id, name: tb.name, ...tb.layout }))}
                  renderTable={(ct, { scale }) => { const tb = items.find((x) => x.id === ct.id); return tb ? <MapTable tb={tb} stage={stageOf(tb)} checks={checksOf(tb)} px={(tb.layout?.w ?? 100) * scale} selected={tb.id === selectedId} dim={dim?.(tb)} onClick={(el) => onTable(tb, el)} /> : null; }} />
                <div className="absolute bottom-3 end-3 flex items-center gap-1 p-1 rounded-xl overlay-panel shadow-lg" data-fb="floor-zoom">
                  <button className="w-11 h-11 rounded-lg flex items-center justify-center hover:bg-[var(--surface-2)] disabled:opacity-30" disabled={zoom <= ZOOMS[0]} onClick={() => setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)])} title={t('تصغير')} aria-label={t('تصغير')} data-fb="floor-zoom-out"><ZoomOut className="w-4 h-4" /></button>
                  <button className="h-11 px-2 rounded-lg text-xs font-bold flex items-center gap-1 hover:bg-[var(--surface-2)]" onClick={() => setZoom(1)} title={t('ملء الشاشة')} data-fb="floor-zoom-fit"><Maximize2 className="w-3.5 h-3.5" /><span className="num">{Math.round(zoom * 100)}%</span></button>
                  <button className="w-11 h-11 rounded-lg flex items-center justify-center hover:bg-[var(--surface-2)] disabled:opacity-30" disabled={zoom >= ZOOMS[ZOOMS.length - 1]} onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)])} title={t('تكبير')} aria-label={t('تكبير')} data-fb="floor-zoom-in"><ZoomIn className="w-4 h-4" /></button>
                </div>
              </>
            ) : view === 'map' ? (
              <EmptyState icon={<MapIcon />} title={t('لا توجد خريطة للصالة')} action={onList && <Button onClick={onList}><LayoutGrid className="w-4 h-4" />{t('عرض القائمة')}</Button>} />
            ) : (
              <div className="absolute inset-0 overflow-y-auto pe-1">
                <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(156px, 1fr))' }}>
                  {shown.map((tb) => <TableCard key={tb.id} tb={tb} stage={stageOf(tb)} checks={checksOf(tb)} onClick={(el) => onTable(tb, el)} />)}
                </div>
              </div>
            )}
      </div>
    </div>
  );
}

function Legend({ c, compact }: { c: Partial<Record<TableStage, number>>; compact?: boolean }) {
  const list = STAGE_ORDER.filter((st) => st === 'FREE' || (c[st] ?? 0) > 0);
  return (
    <div className={cn('flex items-center gap-x-3.5 gap-y-1 flex-wrap', compact && 'gap-x-2.5')} data-fb="floor-legend">
      {list.map((st) => (
        <span key={st} className="flex items-center gap-1.5 text-xs text-soft whitespace-nowrap" data-fb={`legend:${st}`}>
          <span className="w-3.5 h-3.5 rounded-[5px] border-2" style={{ background: LOOK[st].fill, borderColor: LOOK[st].edge }} />{stageLabel(st)} <span className="num font-bold text-[var(--foreground)]">{c[st] ?? 0}</span>
        </span>
      ))}
    </div>
  );
}

/** A table on the plan. What it shows depends on its size on screen (px): number → stage, guests and time → waiter and total. */
function MapTable({ tb, stage, checks, px, onClick, selected, dim }: { tb: any; stage: TableStage; checks: any[]; px: number; onClick: (el: HTMLElement) => void; selected?: boolean; dim?: boolean }) {
  const o = tb.occupancy;
  const shape = tb.layout?.shape ?? 'SQUARE';
  const long = o && o.minutesSeated >= LONG_SEATED;
  const lvl = px < 64 ? 0 : px < 104 ? 1 : 2;
  const look = LOOK[stage];
  const numSize = Math.round(Math.max(13, Math.min(30, px * 0.24)));
  const meta = lvl === 0 ? 'text-[9px]' : 'text-[11px]';
  const unsent = checks.reduce((a, c) => a + (c.unfiredCount ?? 0), 0);
  const occ = OCC.includes(stage);
  return (
    <button data-fb={`table:${tb.name}`} data-table-state={occ ? 'OCCUPIED' : stage} data-stage={stage} onClick={(e) => onClick(e.currentTarget)} disabled={stage === 'INACTIVE'} aria-label={`${t('ترابيزة')} ${tb.name} · ${stageLabel(stage)}`}
      className={cn('relative w-full h-full flex flex-col items-center justify-center text-center border-2 transition-[transform,box-shadow,opacity] active:scale-[.96] p-0.5 overflow-visible focus-visible:outline-none', shapeClass(shape), stage === 'INACTIVE' && 'opacity-40 border-dashed', dim && 'opacity-35', selected && 'ring-4 ring-[var(--primary)] ring-offset-2 ring-offset-[var(--background)]')}
      style={{ background: look.fill, borderColor: look.edge, boxShadow: stage === 'FOOD_READY' ? '0 0 22px color-mix(in srgb, var(--success) 45%, transparent)' : undefined }}>
      {lvl > 0 && <Seats n={tb.layout?.seats ?? tb.capacity} shape={shape} />}
      <span className="font-extrabold num leading-none" style={{ fontSize: numSize }}>{tb.name}</span>
      {occ && (
        <div className={cn('leading-tight mt-0.5 w-full min-w-0', meta)}>
          {lvl > 0 && <div className="truncate font-bold px-1" style={{ color: look.accent }}>{stageLabel(stage, lvl < 2)}</div>}
          <div className="flex items-center justify-center gap-1 num"><span className="inline-flex items-center gap-0.5"><Users className="w-3 h-3" />{o.guestCount}</span><span className={cn('inline-flex items-center gap-0.5 font-bold', long && 'text-[var(--warning-text)]')}><Clock className="w-3 h-3" />{o.minutesSeated}{t('د')}</span></div>
          {lvl === 2 && o.primary && <div className="truncate text-soft px-1">{firstName(o.serverName)}</div>}
          {lvl === 2 && o.primary && <div className="num font-extrabold">{money(o.payable, false)}</div>}
          {!o.primary && <div style={{ color: 'var(--violet)' }} className="font-bold">{t('منضمة')}</div>}
        </div>
      )}
      {stage === 'DIRTY' && <div className={cn('flex items-center gap-0.5 mt-0.5 font-bold', meta)} style={{ color: look.accent }}><Brush className="w-3 h-3" />{lvl < 2 ? `${tb.turn.minutes}${t('د')}` : `${t('تنظيف')} · ${tb.turn.minutes}${t('د')}`}</div>}
      {stage === 'RESERVED' && <div className={cn('flex items-center gap-0.5 mt-0.5 num font-bold', meta)} style={{ color: look.accent }}><CalendarClock className="w-3 h-3" />{time(tb.reservation.at)}</div>}
      {stage === 'FREE' && lvl > 0 && <div className={cn('mt-0.5 flex items-center gap-0.5 num', meta)} style={{ color: look.accent }}><Users className="w-3 h-3" />{tb.capacity}</div>}
      {o?.primary && o.checks > 1 && <span className="absolute -top-2 -end-2 min-w-5 h-5 px-1 rounded-full text-[10px] font-bold num flex items-center justify-center bg-[var(--card-raised)] border border-[var(--glass-border)]" title={t('{n} شيكات', { n: o.checks })}>{o.checks}</span>}
      {unsent > 0 && <span className="absolute -top-2 -start-2 h-5 px-1.5 rounded-full text-[10px] font-bold num flex items-center gap-0.5 justify-center bg-[var(--primary)] text-[var(--primary-foreground)]" title={t('لم يُرسل بعد')} data-fb={`table-unsent:${tb.name}`}><Send className="w-2.5 h-2.5 rtl:-scale-x-100" />{unsent}</span>}
    </button>
  );
}

function TableCard({ tb, stage, checks, onClick }: { tb: any; stage: TableStage; checks: any[]; onClick: (el: HTMLElement) => void }) {
  const o = tb.occupancy;
  const look = LOOK[stage];
  const unsent = checks.reduce((a, c) => a + (c.unfiredCount ?? 0), 0);
  return (
    <button data-fb={`table:${tb.name}`} data-table-state={OCC.includes(stage) ? 'OCCUPIED' : stage} data-stage={stage} onClick={(e) => onClick(e.currentTarget)} disabled={!tb.active && !o}
      className={cn('relative rounded-2xl p-3 text-start border-2 transition-[transform,background] active:scale-[.97] min-h-[116px] flex flex-col gap-1', !tb.active && 'opacity-40 border-dashed')}
      style={{ background: look.fill, borderColor: look.edge }}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-2xl font-extrabold num leading-none">{tb.name}</span>
        <span className="text-[11px] font-bold text-end" style={{ color: look.accent }}>{stageLabel(stage)}</span>
      </div>
      <div className="text-[11px] text-dim truncate flex items-center gap-1">{placeName(tb)} · <Users className="w-3 h-3" /><span className="num">{tb.capacity}</span>{unsent > 0 && <span className="ms-auto text-[var(--primary)] font-bold inline-flex items-center gap-0.5"><Send className="w-3 h-3 rtl:-scale-x-100" /><span className="num">{unsent}</span></span>}</div>
      {o ? (
        <div className="mt-auto space-y-0.5 text-xs">
          <div className="flex items-center gap-2 num"><span className="inline-flex items-center gap-0.5"><Users className="w-3 h-3" />{o.guestCount}</span><span className={cn('inline-flex items-center gap-0.5', o.minutesSeated >= LONG_SEATED && 'text-[var(--warning-text)] font-bold')}><Clock className="w-3 h-3" />{o.minutesSeated} {t('د')}</span></div>
          <div className="flex items-center justify-between gap-1"><span className="text-soft truncate">{firstName(o.serverName)}</span>{o.primary ? <span className="num font-extrabold">{money(o.payable, false)}</span> : <span style={{ color: 'var(--violet)' }} className="font-bold">{t('منضمة')}</span>}</div>
        </div>
      ) : stage === 'DIRTY' ? (
        <div className="mt-auto text-xs font-bold flex items-center gap-1" style={{ color: look.accent }}><Brush className="w-3 h-3" />{t('منذ {n} دقيقة', { n: tb.turn.minutes })}</div>
      ) : tb.reservation ? (
        <div className="mt-auto text-xs font-bold flex items-center gap-1" style={{ color: 'var(--violet)' }}><CalendarClock className="w-3 h-3" />{tb.reservation.customer} · <span className="num">{time(tb.reservation.at)}</span></div>
      ) : null}
    </button>
  );
}

/** Side sheet for one table: the quick actions for its state. */
function TableSheet({ tb, tables, onClose, openCheck, waiter }: { tb: any; tables: any[]; onClose: () => void; openCheck: (id: string) => void; waiter?: boolean }) {
  const st: TableStage = tb.occupancy ? 'SEATED' : !tb.active ? 'INACTIVE' : tb.turn?.state === 'DIRTY' ? 'DIRTY' : tb.reservation ? 'RESERVED' : 'FREE';
  const look = LOOK[st];
  const [seatNow, setSeatNow] = useState(false);
  const title = <span className="flex items-center gap-2"><span className="w-9 h-9 rounded-xl border-2 flex items-center justify-center num font-extrabold text-base" style={{ background: look.fill, borderColor: look.edge }}>{tb.name}</span>{t('ترابيزة')} {tb.name}</span>;
  const sub = <span className="flex items-center gap-2 flex-wrap"><span className="font-bold" style={{ color: look.accent }}>{stageLabel(st)}</span>· {placeName(tb)} · <span className="inline-flex items-center gap-1"><Users className="w-3 h-3" /><span className="num">{tb.capacity}</span> {t('كراسي')}</span></span>;
  if (tb.occupancy) return <VisitSheet tableId={tb.id} visitId={tb.occupancy.visitId} onClose={onClose} tables={tables} title={title} sub={sub} openCheck={openCheck} waiter={waiter} />;
  if (st === 'DIRTY' && !seatNow) return <CleanSheet tb={tb} onClose={onClose} onSeat={() => setSeatNow(true)} title={title} sub={sub} />;
  return <OpenTable tb={tb} onClose={onClose} title={title} sub={sub} openCheck={openCheck} />;
}

function CleanSheet({ tb, onClose, onSeat, title, sub }: { tb: any; onClose: () => void; onSeat: () => void; title: React.ReactNode; sub: React.ReactNode }) {
  const { run, busy } = useCommand();
  const clean = async () => { if (await run('Table.MarkClean', { params: { tableId: tb.id }, body: { state: 'CLEAN' } }, { success: t('ترابيزة {n} نضيفة وجاهزة', { n: tb.name }) })) onClose(); };
  return (
    <Modal open onClose={onClose} title={title} description={sub} badge={<StateBadge ops={['Table.MarkClean']} />} size="sm"
      footer={<><Button variant="ghost" onClick={onSeat}>{t('اقعد ضيوف عليها على طول')}</Button><Button variant="success" size="lg" loading={busy} onClick={clean} data-fb="table-mark-clean"><Sparkles className="w-4 h-4" />{t('اتنضفت — جاهزة')}</Button></>}>
      <div className="space-y-4">
        <div className="rounded-2xl p-4 text-center border" style={{ background: LOOK.DIRTY.fill, borderColor: LOOK.DIRTY.edge }}>
          <Brush className="w-8 h-8 mx-auto" style={{ color: LOOK.DIRTY.accent }} />
          <div className="font-bold mt-2">{t('مستنية التنضيف من {n} دقيقة', { n: tb.turn.minutes })}</div>
          <div className="text-xs text-dim mt-0.5">{t('من الساعة')} <span className="num">{time(tb.turn.since)}</span></div>
        </div>
        <p className="text-sm text-dim leading-relaxed">{t('الترابيزة بتتعلم «محتاجة تنضيف» أول ما القعدة تتقفل. لما الرانر ينضفها يدوس «اتنضفت» فترجع خضرا للويترز.')}</p>
      </div>
    </Modal>
  );
}

function OpenTable({ tb, onClose, title, sub, openCheck }: { tb: any; onClose: () => void; title: React.ReactNode; sub: React.ReactNode; openCheck: (id: string) => void }) {
  const { run, busy } = useCommand();
  const [guests, setGuests] = useState(tb.reservation?.partySize ? Number(tb.reservation.partySize) : Math.min(2, tb.capacity));
  const open = async (andCheck: boolean) => {
    const v = await run<any>('TableVisit.Open', { params: { tableId: tb.id }, body: { guestCount: guests, reservationId: tb.reservation?.id } }, { success: t('ترابيزة {n} اتفتحت', { n: tb.name }) });
    if (!v) return;
    if (andCheck) {
      const o = await run<any>('Order.Create', { body: { channel: 'DINE_IN', tableId: tb.id } });
      onClose();
      if (o) openCheck(o.id);
      return;
    }
    onClose();
  };
  const chips = Array.from({ length: Math.max(6, Math.min(12, tb.capacity + 2)) }, (_, i) => i + 1);
  return (
    <Modal open onClose={onClose} title={title} description={sub} badge={<StateBadge ops={['TableVisit.Open']} />} size="sm"
      footer={<><Button variant="ghost" loading={busy} onClick={() => open(false)} data-fb="open-table">{t('افتح الترابيزة بس')}</Button><Button variant="primary" size="lg" loading={busy} onClick={() => open(true)} data-fb="open-table-check"><Plus className="w-4 h-4" />{t('افتح + شيك جديد')}</Button></>}>
      <div className="space-y-5">
        {tb.reservation && <Banner tone="info" title={t('محجوزة')}>{tb.reservation.customer} · <span className="num">{time(tb.reservation.at)}</span> · {tb.reservation.partySize} {t('أفراد')}</Banner>}
        <div>
          <div className="text-sm font-bold mb-2">{t('عدد الضيوف')}</div>
          <div className="flex items-center justify-center gap-4 rounded-2xl surface-1 border line p-3">
            <Button size="icon" className="!w-14 !h-14" onClick={() => setGuests(Math.max(1, guests - 1))} aria-label={t('أقل')}><Minus className="w-5 h-5" /></Button>
            <span className="text-5xl font-extrabold num w-20 text-center" data-fb="guest-count">{guests}</span>
            <Button size="icon" className="!w-14 !h-14" onClick={() => setGuests(guests + 1)} aria-label={t('أكتر')}><Plus className="w-5 h-5" /></Button>
          </div>
          <div className="grid grid-cols-6 gap-1.5 mt-2">
            {chips.map((n) => <button key={n} onClick={() => setGuests(n)} className={cn('h-11 rounded-xl border text-sm font-bold num', n === guests ? 'bg-[var(--primary)] text-[var(--primary-foreground)] border-transparent' : 'surface-1 border-[var(--glass-border)] hover:bg-[var(--surface-2)]', n > tb.capacity && n !== guests && 'text-dim')}>{n}</button>)}
          </div>
          {guests > tb.capacity && <div className="text-xs text-[var(--warning-text)] mt-2">{t('الضيوف أكتر من كراسي الترابيزة ({n}) — ممكن تضم ترابيزة تانية بعد الفتح.', { n: tb.capacity })}</div>}
        </div>
        <div className="flex items-center justify-between gap-2 border-t line pt-3">
          <span className="text-xs text-dim">{t('الترابيزة مش نضيفة؟')}</span>
          <Button size="sm" variant="ghost" onClick={async () => { if (await run('Table.MarkClean', { params: { tableId: tb.id }, body: { state: 'DIRTY' } }, { success: t('اتعلمت محتاجة تنضيف') })) onClose(); }} data-fb="table-mark-dirty"><Brush className="w-3.5 h-3.5" />{t('علّمها محتاجة تنضيف')}</Button>
        </div>
      </div>
    </Modal>
  );
}

function VisitSheet({ tableId, visitId, onClose, tables, title, sub, openCheck, waiter }: { tableId: string; visitId: string; onClose: () => void; tables: any[]; title: React.ReactNode; sub: React.ReactNode; openCheck: (id: string) => void; waiter?: boolean }) {
  const pay = useCollect();
  const { nav, kind, can } = useDev();
  const { run, busy } = useCommand();
  const vq = useQuery<any>('TableVisit.List', { query: { tableId, state: 'OPEN' } });
  const users = useQuery<any>(can('user:read') ? 'User.Find' : null, { query: {} });
  const [mode, setMode] = useState<null | 'transfer' | 'join' | 'waiter'>(null);
  const [target, setTarget] = useState('');
  const v = (vq.data?.items ?? []).find((x: any) => x.id === visitId) ?? vq.data?.items?.[0];
  const pick = (m: typeof mode) => { setMode(mode === m ? null : m); setTarget(''); };
  const newCheck = async () => {
    const o = await run<any>('Order.Create', { body: { channel: 'DINE_IN', tableId: v.tableId } }, { success: t('شيك جديد') });
    if (o) { onClose(); openCheck(o.id); }
  };
  const close = async () => { if (await run('TableVisit.Close', { params: { visitId: v.id }, body: { expectedVersion: v.version } }, { success: t('الترابيزة اتقفلت') })) onClose(); };
  const openChecks = (v?.checks ?? []).filter((c: any) => c.status === 'DRAFT' || c.status === 'CONFIRMED');
  const canPay = kind !== 'FLOOR' && can('payment:capture');
  const total = sumAmounts(openChecks.map((c: any) => c.payable));
  if (pay.node) return pay.node; // ux-07: the one payment popup (in place of the sheet while paying)
  return (
    <Modal open onClose={onClose} size="md" title={v ? <span className="flex items-center gap-2">{title}{v.joinedTableNames?.length ? <span className="text-soft text-base font-bold">+ {v.joinedTableNames.join(' + ')}</span> : null}</span> : title} description={sub}
      badge={<StateBadge ops={['TableVisit.List', 'Order.Create', 'TableVisit.Close', 'TableVisit.Transfer']} />}
      footer={v && <>
        <Button variant="danger" onClick={close} loading={busy} data-fb="close-table" disabled={openChecks.length > 0} title={openChecks.length ? t('الترابيزة عليها شيك مفتوح') : ''}><DoorClosed className="w-4 h-4" />{t('اقفل الترابيزة')}</Button>
        <div className="flex-1" />
        <Button variant={openChecks.length ? 'secondary' : 'primary'} size="lg" onClick={newCheck} data-fb="new-check"><Plus className="w-4 h-4" />{t('شيك جديد')}</Button>
      </>}>
      {!v ? <Skeleton lines={5} /> : (
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-2">
            <Fact icon={<Users />} label={t('الضيوف')} value={<span className="num">{v.guestCount}</span>} />
            <Fact icon={<Clock />} label={t('قاعدين من')} value={<span className={cn('num', v.minutesSeated >= LONG_SEATED && 'text-[var(--warning-text)]')}>{v.minutesSeated} {t('د')}</span>} hint={<span className="num">{time(v.openedAt)}</span>} />
            <Fact icon={<UserCog />} label={t('الويتر')} value={<span className="text-sm">{firstName(v.serverName)}</span>} />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between"><div className="text-sm font-bold">{t('الشيكات')}</div>{openChecks.length > 0 && <div className="text-xs text-dim">{t('المطلوب')} <Money v={total} /></div>}</div>
            {v.checks.length === 0 && <EmptyState compact icon={<Receipt />} title={t('مفيش شيكات لسه')} text={t('ابدأ «شيك جديد» وضيف الطلبات.')} />}
            {v.checks.map((c: any) => {
              const live = c.status === 'DRAFT' || c.status === 'CONFIRMED';
              return (
                <div key={c.id} className="rounded-2xl surface-1 border line p-3">
                  <div className="flex items-center gap-3">
                    <ClipboardList className="w-5 h-5 text-dim shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-sm flex items-center gap-2 flex-wrap">{t('شيك')} {c.checkNo}<StatusPill s={c.status} /></div>
                      <div className="text-[11px] text-dim">{c.lines} {t('صنف')}{c.unfired ? <> · <span className="text-[var(--primary)] font-bold">{t('{n} لسه ما اتبعتش', { n: c.unfired })}</span></> : ''}</div>
                    </div>
                    <Money v={c.payable} className="text-base" />
                  </div>
                  {live && (
                    <div className="flex gap-2 mt-2.5">
                      <Button size="lg" className="flex-1" onClick={() => { onClose(); openCheck(c.id); }} data-fb={`visit-open-check:${c.checkNo}`}>{t('فتح الشيك')}<ChevronLeft className="w-4 h-4 ltr:rotate-180" /></Button>
                      {canPay && <Button size="lg" variant="success" className="flex-1" onClick={() => pay.collect({ id: c.id, visitId: v.id })} data-fb="visit-pay"><Wallet className="w-4 h-4" />{t('تحصيل')}</Button>}
                    </div>
                  )}
                </div>
              );
            })}
            {!canPay && openChecks.length > 0 && <div className="text-[11px] text-dim">{t('التحصيل بيكون على جهاز الكاشير.')}</div>}
          </div>

          <div>
            <div className="text-sm font-bold mb-2">{t('حركات الترابيزة')}</div>
            <div className="grid grid-cols-3 gap-2">
              <QuickAct icon={<ArrowRightLeft />} label={t('نقل لترابيزة تانية')} on={mode === 'transfer'} onClick={() => pick('transfer')} fb="visit-transfer" />
              <QuickAct icon={<Link2 />} label={t('ضم ترابيزة')} on={mode === 'join'} onClick={() => pick('join')} proposed fb="visit-join" />
              {can('user:read') && <QuickAct icon={<UserCog />} label={t('تغيير الويتر')} on={mode === 'waiter'} onClick={() => pick('waiter')} proposed fb="visit-waiter" />}
            </div>
          </div>
          {mode && (
            <div className="rounded-2xl border border-[color-mix(in_srgb,var(--primary)_35%,transparent)] bg-[var(--primary-container)] p-3 space-y-2.5">
              <div className="text-sm font-bold">{mode === 'transfer' ? t('انقل القعدة كلها لترابيزة فاضية') : mode === 'join' ? t('ضم ترابيزة فاضية للقعدة دي (قعدة واحدة على كذا ترابيزة)') : t('مين الويتر الجديد؟')}</div>
              {mode === 'waiter' ? (
                <div className="grid grid-cols-2 gap-1.5">{(users.data?.items ?? []).filter((u: any) => u.active).map((u: any) => <Choice key={u.id} on={target === u.id} onClick={() => setTarget(u.id)}>{userLabel(u.username, u.displayName)}</Choice>)}</div>
              ) : (
                <div className="grid grid-cols-5 gap-1.5">
                  {tables.filter((x) => x.id !== v.tableId && x.active && !x.occupancy).map((x) => <Choice key={x.id} on={target === x.id} onClick={() => setTarget(x.id)} fb={`visit-target:${x.name}`}><span className="num font-extrabold text-base">{x.name}</span><span className="block text-[10px] text-dim num">{x.capacity} {t('كراسي')}</span></Choice>)}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setMode(null)}>{t('رجوع')}</Button>
                <Button variant="primary" disabled={!target || busy} loading={busy} data-fb="visit-action-ok" onClick={async () => {
                  if (mode === 'transfer') { if (await run('TableVisit.Transfer', { params: { visitId: v.id }, body: { expectedVersion: v.version, toTableId: target } }, { success: t('القعدة اتنقلت') })) onClose(); }
                  else if (mode === 'join') { if (await run('Table.Merge', { body: { visitId: v.id, tableId: target } }, { success: t('الترابيزة انضمت') })) setMode(null); }
                  else if (await run('Table.AssignWaiter', { params: { tableId: v.tableId }, body: { userId: target } }, { success: t('الويتر اتغير') })) setMode(null);
                }}>{mode === 'transfer' ? t('انقل') : mode === 'join' ? t('ضم') : t('غيّر')}</Button>
              </div>
            </div>
          )}
          {v.joinedTableIds?.length > 0 && <div className="flex gap-2 flex-wrap">{v.joinedTableIds.map((id: string, i: number) => <Button key={id} size="sm" variant="ghost" onClick={() => run('Table.Release', { params: { visitId: v.id }, body: { tableId: id } }, { success: t('الترابيزة اتفكت') })}><Unlink className="w-3.5 h-3.5" />{t('فك')} {v.joinedTableNames[i]}</Button>)}</div>}
          <p className="text-[11px] text-dim leading-relaxed">{t('الترابيزة مينفعش تتقفل وعليها شيك مفتوح. لما تتقفل بتتعلم «محتاجة تنضيف» لحد ما حد ينضفها.')}</p>
        </div>
      )}
    </Modal>
  );
}

function Fact({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return <div className="rounded-2xl surface-1 border line px-3 py-2.5 min-w-0"><div className="text-[11px] text-dim flex items-center gap-1 [&_svg]:w-3 [&_svg]:h-3">{icon}{label}</div><div className="font-extrabold text-lg leading-tight mt-0.5 truncate">{value}</div>{hint && <div className="text-[10px] text-dim">{hint}</div>}</div>;
}
function QuickAct({ icon, label, onClick, on, proposed, fb }: { icon: React.ReactNode; label: string; onClick: () => void; on?: boolean; proposed?: boolean; fb?: string }) {
  return (
    <button onClick={onClick} data-fb={fb} className={cn('relative min-h-[64px] rounded-2xl border px-2 py-2 flex flex-col items-center justify-center gap-1 text-xs font-bold text-center transition-colors [&>svg]:w-5 [&>svg]:h-5', on ? 'border-[var(--primary)] bg-[var(--primary-container)] text-[var(--primary)]' : 'surface-1 border-[var(--glass-border)] hover:bg-[var(--surface-2)]')}>
      {icon}<span className="leading-tight">{label}</span>
      {proposed && <Tech><span className="absolute top-1.5 end-1.5 w-1.5 h-1.5 rounded-full" style={{ background: 'var(--violet)' }} title={t('مقترح')} /></Tech>}
    </button>
  );
}
function Choice({ on, onClick, children, fb }: { on: boolean; onClick: () => void; children: React.ReactNode; fb?: string }) {
  return <button onClick={onClick} data-fb={fb} className={cn('min-h-[48px] rounded-xl border px-2 py-1.5 text-sm text-center', on ? 'border-[var(--primary)] bg-[var(--card-raised)] font-bold ring-2 ring-[var(--primary)]' : 'border-[var(--glass-border)] bg-[var(--card-raised)] hover:border-[var(--primary)]')}>{children}</button>;
}
