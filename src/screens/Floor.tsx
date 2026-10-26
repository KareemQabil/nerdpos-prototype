// C1 Floor: the real floor plan per section (main hall, terrace, upper floor) with live table states —
// free, occupied (guests, time seated, server, check total), needs cleaning, reserved, inactive — and a list view.
// Joined tables (direction), table turn (clean after the visit closes; TableTurnPolicy).
import React, { useMemo, useState } from 'react';
import { Users, Clock, Plus, ArrowRightLeft, Link2, Unlink, DoorClosed, Wallet, ClipboardList, UserCog, CalendarClock, Minus, Sparkles, Map as MapIcon, LayoutGrid, Brush } from 'lucide-react';
import { useDev, useQuery, useCommand } from '../app/hooks';
import { Section, StateBadge, Pill, Modal, Button, Field, Select, Banner, Money, Empty, Tabs, KV, useNow } from '../ui';
import { t, L } from '../i18n';
import { cn, money, time } from '../lib/format';
import { StatusPill } from './order/CheckPanel';
import { FloorCanvas, Seats, shapeClass } from './ops/FloorCanvas';

const AREA_AR: Record<string, string> = { Hall: 'الصالة الرئيسية', Terrace: 'التراس' };
type TState = 'FREE' | 'OCCUPIED' | 'DIRTY' | 'RESERVED' | 'INACTIVE';
const stateOf = (tb: any): TState => (tb.occupancy ? 'OCCUPIED' : !tb.active ? 'INACTIVE' : tb.turn?.state === 'DIRTY' ? 'DIRTY' : tb.reservation ? 'RESERVED' : 'FREE');
const LONG_SEATED = 90; // minutes: a long visit is highlighted for the floor manager

export default function Floor() {
  const { kind, can } = useDev();
  useNow(30000);
  const tables = useQuery<any>('Table.List', { query: {} });
  const floors = useQuery<any>('Floor.List');
  const [floorId, setFloorId] = useState<string>('');
  const [view, setView] = useState<'map' | 'list'>('map');
  const [sel, setSel] = useState<any>(null);
  const items: any[] = tables.data?.items ?? [];
  const fl: any[] = floors.data?.items ?? [];
  const current = fl.find((f) => f.id === floorId) ?? fl[0];
  const onFloor = (tb: any) => !current || tb.floorId === current.id;
  const shown = view === 'map' ? items.filter((tb) => tb.layout && onFloor(tb)) : items.filter((tb) => onFloor(tb) || !tb.floorId);
  const count = (st: TState, list = items) => list.filter((x) => stateOf(x) === st).length;
  const guests = items.reduce((a, x) => a + (x.occupancy?.primary ? x.occupancy.guestCount : 0), 0);
  const open = (tb: any) => setSel(tb);
  return (
    <div data-screen="C1" className="space-y-3">
      <Section title={t('الصالة')} badge={<StateBadge ops={['Table.List', 'Floor.List', 'TableVisit.Open', 'TableVisit.Transfer', 'TableVisit.Close', 'Table.MarkClean']} />}
        sub={`${count('OCCUPIED')} / ${items.filter((x) => x.active).length} ${t('ترابيزة مشغولة')} · ${guests} ${t('ضيف')}${kind === 'CASH' ? ' · ' + t('اختار ترابيزة عشان تحصّل شيكاتها') : ''}`}
        actions={<Tabs value={view} onChange={setView} tabs={[{ id: 'map', label: <span className="flex items-center gap-1.5"><MapIcon className="w-4 h-4" />{t('الخريطة')}</span> }, { id: 'list', label: <span className="flex items-center gap-1.5"><LayoutGrid className="w-4 h-4" />{t('قائمة')}</span> }]} />} />
      <div className="flex items-center gap-2 flex-wrap">
        {fl.length > 0 && <Tabs value={current?.id ?? ''} onChange={setFloorId} tabs={fl.map((f) => ({ id: f.id, label: <span data-fb={`floor-tab:${f.name.ar}`}>{L(f.name)} <span className="num text-xs opacity-70">{items.filter((x) => x.floorId === f.id && x.occupancy).length}/{items.filter((x) => x.floorId === f.id).length}</span></span> }))} />}
        <div className="flex-1" />
        <Legend c={{ FREE: count('FREE'), OCCUPIED: count('OCCUPIED'), DIRTY: count('DIRTY'), RESERVED: count('RESERVED') }} />
      </div>
      {tables.error && <Banner tone="error">{tables.error.code}</Banner>}
      {view === 'map' && current ? (
        <FloorCanvas width={current.width} height={current.height} decor={current.decor ?? []} tables={shown.map((tb) => ({ id: tb.id, name: tb.name, ...tb.layout }))}
          renderTable={(ct) => { const tb = items.find((x) => x.id === ct.id); return tb ? <MapTable tb={tb} onClick={() => open(tb)} /> : null; }} />
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
          {shown.map((tb) => <TableCard key={tb.id} tb={tb} onClick={() => open(tb)} />)}
        </div>
      )}
      {view === 'map' && !current && !floors.loading && <Empty text={t('مفيش خريطة للصالة لسه — المدير يرسمها من "خريطة الصالة" في الإعداد')} />}
      {!items.length && !tables.loading && <Empty text={t('مفيش ترابيزات — ضيفها من "خريطة الصالة" في الإعداد')} />}
      {view === 'map' && current && items.some((x) => x.floorId === current.id && x.layout?.auto) && can('table:upsert') && <div className="text-[11px] text-dim">{t('فيه ترابيزات لسه ما اتحطتش في مكانها على الخريطة (ظاهرة تحت). رتّبها من "خريطة الصالة".')}</div>}
      {sel && (sel.occupancy ? <VisitSheet tableId={sel.id} visitId={sel.occupancy.visitId} onClose={() => setSel(null)} tables={items} />
        : sel.turn?.state === 'DIRTY' && sel.active ? <CleanSheet tb={sel} onClose={() => setSel(null)} onOpen={() => setSel({ ...sel, turn: null })} />
          : <OpenTable tb={sel} onClose={() => setSel(null)} />)}
    </div>
  );
}

function Legend({ c }: { c: Record<string, number> }) {
  const it = (cls: string, label: string, n: number) => <span className="flex items-center gap-1.5 text-xs text-soft"><span className={cn('w-3 h-3 rounded', cls)} />{label} <span className="num font-bold">{n}</span></span>;
  return (
    <div className="flex items-center gap-3 flex-wrap" data-fb="floor-legend">
      {it('border-2 border-emerald-400/70 bg-emerald-500/10', t('فاضية'), c.FREE)}
      {it('bg-gradient-to-br from-pink-500/60 to-rose-600/50', t('مشغولة'), c.OCCUPIED)}
      {it('bg-[repeating-linear-gradient(45deg,rgba(245,158,11,.5)_0_3px,transparent_3px_6px)] border border-amber-400/60', t('محتاجة تنضيف'), c.DIRTY)}
      {it('border-2 border-violet-400/70 bg-violet-500/10', t('محجوزة'), c.RESERVED)}
    </div>
  );
}

function MapTable({ tb, onClick }: { tb: any; onClick: () => void }) {
  const st = stateOf(tb);
  const o = tb.occupancy;
  const shape = tb.layout?.shape ?? 'SQUARE';
  const long = o && o.minutesSeated >= LONG_SEATED;
  const small = (tb.layout?.w ?? 100) < 100;
  return (
    <button data-fb={`table:${tb.name}`} data-table-state={st} onClick={onClick} disabled={st === 'INACTIVE'}
      className={cn('relative w-full h-full flex flex-col items-center justify-center text-center border-2 transition-all active:scale-[.97] p-1', shapeClass(shape),
        st === 'OCCUPIED' ? 'bg-gradient-to-br from-pink-500/40 to-rose-600/30 border-pink-400/70 shadow-[0_0_24px_rgba(236,72,153,0.18)]' :
          st === 'DIRTY' ? 'bg-[repeating-linear-gradient(45deg,rgba(245,158,11,.22)_0_8px,rgba(245,158,11,.08)_8px_16px)] border-amber-400/70' :
            st === 'RESERVED' ? 'bg-violet-500/10 border-violet-400/70 hover:bg-violet-500/20' :
              st === 'INACTIVE' ? 'opacity-40 border-dashed border-white/25' : 'bg-emerald-500/[0.07] border-emerald-400/50 hover:bg-emerald-500/15')}>
      <Seats n={tb.layout?.seats ?? tb.capacity} shape={shape} />
      <span className={cn('font-extrabold num leading-none', small ? 'text-lg' : 'text-2xl')}>{tb.name}</span>
      {st === 'OCCUPIED' && (
        <div className="text-[10px] leading-tight mt-0.5 space-y-0.5 w-full">
          <div className="flex items-center justify-center gap-1"><Users className="w-3 h-3" />{o.guestCount}<span className={cn('flex items-center gap-0.5 num', long && 'text-amber-300 font-bold')}><Clock className="w-3 h-3" />{o.minutesSeated}{t('د')}</span></div>
          {!small && <div className="truncate text-white/70">{o.serverName?.split(' — ')[0]}</div>}
          {!small && o.primary && <div className="num font-bold">{money(o.payable, false)}</div>}
          {!o.primary && <div className="text-violet-300">{t('منضمة')}</div>}
        </div>
      )}
      {st === 'DIRTY' && <div className="text-[10px] text-amber-200 flex items-center gap-0.5 mt-0.5"><Brush className="w-3 h-3" />{small ? `${tb.turn.minutes}${t('د')}` : `${t('تنضيف')} · ${tb.turn.minutes}${t('د')}`}</div>}
      {st === 'RESERVED' && <div className="text-[10px] text-violet-200 flex items-center gap-0.5 mt-0.5"><CalendarClock className="w-3 h-3" />{time(tb.reservation.at)}</div>}
      {st === 'FREE' && !small && <div className="text-[10px] text-emerald-300/80 mt-0.5 flex items-center gap-0.5"><Users className="w-3 h-3" />{tb.capacity}</div>}
    </button>
  );
}

function TableCard({ tb, onClick }: { tb: any; onClick: () => void }) {
  const o = tb.occupancy;
  const st = stateOf(tb);
  return (
    <button data-fb={`table:${tb.name}`} data-table-state={st} onClick={onClick} disabled={!tb.active && !o} className={cn('relative rounded-2xl p-3 text-start border transition-all active:scale-[.97] min-h-[120px] flex flex-col', !tb.active ? 'opacity-40 border-dashed border-white/20 surface-1' : o ? 'bg-gradient-to-br from-pink-500/30 to-rose-600/20 border-pink-400/50 shadow-[0_0_24px_rgba(236,72,153,0.15)]' : st === 'DIRTY' ? 'surface-1 border-amber-400/60 bg-[repeating-linear-gradient(45deg,rgba(245,158,11,.12)_0_8px,transparent_8px_16px)]' : 'surface-1 border-emerald-400/30 hover:border-emerald-400/70')}>
      <div className="flex items-center justify-between">
        <span className="text-2xl font-extrabold num">{tb.name}</span>
        <span className="text-[10px] text-dim flex items-center gap-1"><Users className="w-3 h-3" />{tb.capacity}</span>
      </div>
      <div className="text-[10px] text-dim truncate">{tb.floorName ? L(tb.floorName) : AREA_AR[tb.area] ?? tb.area}</div>
      {!tb.active ? <Pill tone="neutral" className="mt-auto self-start">{t('موقوفة')}</Pill> : o ? (
        <div className="mt-auto space-y-0.5 text-xs">
          <div className="flex items-center gap-1"><Users className="w-3 h-3" />{o.guestCount} · <Clock className="w-3 h-3" /><span className="num">{o.minutesSeated}</span>{t('د')}</div>
          <div className="text-dim truncate">{o.serverName}</div>
          <div className="flex items-center justify-between"><span>{o.checks} {t('شيك')}</span><span className="num font-bold">{money(o.payable, false)}</span></div>
          {!o.primary && <Pill tone="violet">{t('منضمة')}</Pill>}
        </div>
      ) : st === 'DIRTY' ? (
        <Pill tone="warning" className="mt-auto self-start"><Brush className="w-3 h-3" />{t('محتاجة تنضيف')} · {tb.turn.minutes}{t('د')}</Pill>
      ) : (
        <div className="mt-auto flex items-center justify-between"><Pill tone="success">{t('فاضية')}</Pill>{tb.reservation && <Pill tone="violet"><CalendarClock className="w-3 h-3" />{time(tb.reservation.at)}</Pill>}</div>
      )}
    </button>
  );
}

function CleanSheet({ tb, onClose, onOpen }: { tb: any; onClose: () => void; onOpen: () => void }) {
  const { run, busy } = useCommand();
  const clean = async () => { if (await run('Table.MarkClean', { params: { tableId: tb.id }, body: { state: 'CLEAN' } }, { success: t('ترابيزة {n} نضيفة وجاهزة', { n: tb.name }) })) onClose(); };
  return (
    <Modal open onClose={onClose} title={<span className="flex items-center gap-2"><Brush className="w-5 h-5 text-[var(--warning)]" />{t('ترابيزة')} {tb.name} — {t('محتاجة تنضيف')}</span>} badge={<StateBadge ops={['Table.MarkClean']} />}
      footer={<><Button variant="ghost" onClick={onOpen}>{t('اقعد ضيوف عليها على طول')}</Button><Button variant="success" loading={busy} onClick={clean} data-fb="table-mark-clean"><Sparkles className="w-4 h-4" />{t('اتنضفت — جاهزة')}</Button></>}>
      <div className="space-y-3">
        <KV rows={[[t('من'), `${time(tb.turn.since)} (${tb.turn.minutes} ${t('دقيقة')})`], [t('السعة'), tb.capacity], [t('المكان'), tb.floorName ? L(tb.floorName) : AREA_AR[tb.area] ?? tb.area]]} />
        <Banner tone="info">{t('الترابيزة بتتعلم "محتاجة تنضيف" أول ما القعدة تتقفل. لما الرانر ينضفها يدوس "اتنضفت" فترجع خضرا للويترز.')}</Banner>
      </div>
    </Modal>
  );
}

function OpenTable({ tb, onClose }: { tb: any; onClose: () => void }) {
  const { run, busy } = useCommand();
  const { nav } = useDev();
  const [guests, setGuests] = useState(Math.min(2, tb.capacity));
  const open = async (andCheck: boolean) => {
    const v = await run<any>('TableVisit.Open', { params: { tableId: tb.id }, body: { guestCount: guests, reservationId: tb.reservation?.id } }, { success: t('الترابيزة اتفتحت') });
    if (!v) return;
    if (andCheck) {
      const o = await run<any>('Order.Create', { body: { channel: 'DINE_IN', tableId: tb.id } });
      if (o) nav('order', { orderId: o.id, back: 'floor' });
    }
    onClose();
  };
  return (
    <Modal open onClose={onClose} title={`${t('ترابيزة')} ${tb.name}`} badge={<StateBadge ops={['TableVisit.Open']} />} footer={<><Button variant="ghost" onClick={onClose}>{t('رجوع')}</Button><Button loading={busy} onClick={() => open(false)} data-fb="open-table">{t('افتح الترابيزة')}</Button><Button variant="primary" loading={busy} onClick={() => open(true)}>{t('افتح + شيك جديد')}</Button></>}>
      <div className="space-y-4">
        <KV rows={[[t('المكان'), tb.floorName ? L(tb.floorName) : AREA_AR[tb.area] ?? (tb.area || '—')], [t('السعة'), tb.capacity]]} />
        {tb.reservation && <Banner tone="info">{t('محجوزة لـ')} {tb.reservation.customer} · {time(tb.reservation.at)} · {tb.reservation.partySize} {t('أفراد')}</Banner>}
        <Field label={t('عدد الضيوف')}>
          <div className="flex items-center gap-3">
            <Button size="lg" onClick={() => setGuests(Math.max(1, guests - 1))}><Minus className="w-4 h-4" /></Button>
            <span className="text-3xl font-bold num w-12 text-center">{guests}</span>
            <Button size="lg" onClick={() => setGuests(guests + 1)}><Plus className="w-4 h-4" /></Button>
          </div>
        </Field>
        <div className="flex items-center justify-between gap-2"><div className="text-[11px] text-dim">{t('ترابيزة واحدة = قعدة واحدة مفتوحة.')}</div><Button size="sm" variant="ghost" onClick={async () => { if (await run('Table.MarkClean', { params: { tableId: tb.id }, body: { state: 'DIRTY' } }, { success: t('اتعلمت محتاجة تنضيف') })) onClose(); }} data-fb="table-mark-dirty"><Brush className="w-3.5 h-3.5" />{t('محتاجة تنضيف')}</Button></div>
      </div>
    </Modal>
  );
}

function VisitSheet({ tableId, visitId, onClose, tables }: { tableId: string; visitId: string; onClose: () => void; tables: any[] }) {
  const { nav, kind, can, auth } = useDev();
  const { run, busy } = useCommand();
  const vq = useQuery<any>('TableVisit.List', { query: { tableId, state: 'OPEN' } });
  const users = useQuery<any>(can('user:read') ? 'User.Find' : null, { query: {} });
  const [mode, setMode] = useState<null | 'transfer' | 'join' | 'waiter'>(null);
  const [target, setTarget] = useState('');
  const v = (vq.data?.items ?? []).find((x: any) => x.id === visitId) ?? vq.data?.items?.[0];
  if (!v) return null;
  const free = tables.filter((x) => !x.occupancy && x.active);
  const newCheck = async () => {
    const o = await run<any>('Order.Create', { body: { channel: 'DINE_IN', tableId: v.tableId } }, { success: t('شيك جديد') });
    if (o) nav('order', { orderId: o.id, back: 'floor' });
  };
  const close = async () => { if (await run('TableVisit.Close', { params: { visitId: v.id }, body: { expectedVersion: v.version } }, { success: t('الترابيزة اتقفلت') })) onClose(); };
  return (
    <Modal open onClose={onClose} wide title={`${t('ترابيزة')} ${v.tableName}${v.joinedTableNames?.length ? ' + ' + v.joinedTableNames.join(' + ') : ''}`} badge={<StateBadge ops={['TableVisit.List', 'Order.Create', 'TableVisit.Close', 'TableVisit.Transfer']} />}
      footer={<>
        <Button variant="danger" onClick={close} loading={busy} data-fb="close-table"><DoorClosed className="w-4 h-4" />{t('اقفل الترابيزة')}</Button>
        <div className="flex-1" />
        <Button onClick={() => setMode(mode === 'transfer' ? null : 'transfer')}><ArrowRightLeft className="w-4 h-4" />{t('نقل لترابيزة تانية')}</Button>
        <Button onClick={() => setMode(mode === 'join' ? null : 'join')}><Link2 className="w-4 h-4" />{t('ضم ترابيزة')} <StateBadge state="PROPOSED" /></Button>
        {can('user:read') && <Button onClick={() => setMode(mode === 'waiter' ? null : 'waiter')}><UserCog className="w-4 h-4" />{t('تغيير الويتر')} <StateBadge state="PROPOSED" /></Button>}
        <Button variant="primary" onClick={newCheck} data-fb="new-check"><Plus className="w-4 h-4" />{t('شيك جديد')}</Button>
      </>}>
      <div className="space-y-4">
        <KV rows={[[t('الضيوف'), v.guestCount], [t('الويتر'), v.serverName], [t('من'), `${time(v.openedAt)} (${v.minutesSeated} ${t('دقيقة')})`]]} />
        {mode === 'transfer' && <Inline label={t('انقل القعدة لـ')} options={tables.filter((x) => x.id !== v.tableId).map((x) => ({ value: x.id, label: `${x.name}${x.occupancy ? ' (' + t('مشغولة') + ')' : !x.active ? ' (' + t('موقوفة') + ')' : ''}` }))} value={target} setValue={setTarget} onOk={async () => { if (await run('TableVisit.Transfer', { params: { visitId: v.id }, body: { expectedVersion: v.version, toTableId: target } }, { success: t('القعدة اتنقلت') })) onClose(); }} />}
        {mode === 'join' && <Inline label={t('ضم ترابيزة فاضية للقعدة دي (قعدة واحدة على كذا ترابيزة)')} options={free.map((x) => ({ value: x.id, label: x.name }))} value={target} setValue={setTarget} onOk={async () => { if (await run('Table.Merge', { body: { visitId: v.id, tableId: target } }, { success: t('الترابيزة انضمت') })) setMode(null); }} />}
        {mode === 'waiter' && <Inline label={t('الويتر الجديد')} options={(users.data?.items ?? []).filter((u: any) => u.active).map((u: any) => ({ value: u.id, label: u.displayName }))} value={target} setValue={setTarget} onOk={async () => { if (await run('Table.AssignWaiter', { params: { tableId: v.tableId }, body: { userId: target } }, { success: t('الويتر اتغير') })) setMode(null); }} />}
        {v.joinedTableIds?.length > 0 && <div className="flex gap-2 flex-wrap">{v.joinedTableIds.map((id: string, i: number) => <Button key={id} size="sm" variant="ghost" onClick={() => run('Table.Release', { params: { visitId: v.id }, body: { tableId: id } }, { success: t('الترابيزة اتفكت') })}><Unlink className="w-3.5 h-3.5" />{t('فك')} {v.joinedTableNames[i]}</Button>)}</div>}
        <div className="space-y-2">
          <div className="text-sm font-bold">{t('الشيكات')}</div>
          {v.checks.length === 0 && <div className="text-sm text-dim">{t('مفيش شيكات لسه')}</div>}
          {v.checks.map((c: any) => (
            <div key={c.id} className="flex items-center gap-3 px-3 py-2 rounded-xl surface-1 border line">
              <ClipboardList className="w-4 h-4 text-dim" />
              <div className="flex-1 min-w-0"><div className="font-bold text-sm">{t('شيك')} {c.checkNo} <span className="num text-dim font-normal">#{c.number}</span></div><div className="text-[11px] text-dim">{c.lines} {t('صنف')}{c.unfired ? ` · ${c.unfired} ${t('لسه ما اتبعتش')}` : ''}</div></div>
              <StatusPill s={c.status} />
              <Money v={c.payable} />
              {(c.status === 'DRAFT' || c.status === 'CONFIRMED') && <Button size="sm" onClick={() => nav('order', { orderId: c.id, back: 'floor' })}>{t('افتح')}</Button>}
              {(c.status === 'DRAFT' || c.status === 'CONFIRMED') && kind !== 'FLOOR' && can('payment:capture') && <Button size="sm" variant="success" onClick={() => nav('pay', { orderId: c.id, back: 'floor' })}><Wallet className="w-4 h-4" />{t('تحصيل')}</Button>}
            </div>
          ))}
        </div>
        <div className="text-[11px] text-dim">{t('الترابيزة مينفعش تتقفل وعليها شيك مفتوح. لما تتقفل بتتعلم "محتاجة تنضيف" لحد ما حد ينضفها.')}</div>
      </div>
    </Modal>
  );
}

function Inline({ label, options, value, setValue, onOk }: { label: string; options: { value: string; label: string }[]; value: string; setValue: (v: string) => void; onOk: () => void }) {
  return (
    <div className="flex items-end gap-2 rounded-xl surface-1 p-3">
      <Field label={label} className="flex-1"><Select value={value} onChange={(e) => setValue(e.target.value)} options={[{ value: '', label: t('اختار') }, ...options]} /></Field>
      <Button variant="primary" disabled={!value} onClick={onOk}>{t('تنفيذ')}</Button>
    </div>
  );
}
