// C1 Floor plan: areas and tables; free, occupied, inactive; guests, time seated, server; joined tables (direction).
import React, { useState } from 'react';
import { Users, Clock, Plus, ArrowRightLeft, Link2, Unlink, DoorClosed, Wallet, ClipboardList, UserCog, CalendarClock, Minus } from 'lucide-react';
import { useDev, useQuery, useCommand } from '../app/hooks';
import { Section, StateBadge, Pill, Modal, Button, Field, Select, Banner, Money, Empty, Tabs, KV } from '../ui';
import { t, L } from '../i18n';
import { cn, money, time } from '../lib/format';
import { StatusPill } from './order/CheckPanel';

export default function Floor() {
  const { kind } = useDev();
  const tables = useQuery<any>('Table.List', { query: {} });
  const visits = useQuery<any>('TableVisit.List', { query: { state: 'OPEN' } });
  const [area, setArea] = useState<string>('ALL');
  const [sel, setSel] = useState<any>(null);
  const items: any[] = tables.data?.items ?? [];
  const areas = [...new Set(items.map((x) => x.area || '—'))];
  const shown = items.filter((x) => area === 'ALL' || (x.area || '—') === area);
  const occupied = items.filter((x) => x.occupancy).length;
  return (
    <div data-screen="C1">
      <Section title={t('الصالة')} badge={<StateBadge ops={['Table.List', 'TableVisit.Open', 'TableVisit.Transfer', 'TableVisit.Close', 'TableVisit.List']} />} sub={`${occupied} / ${items.length} ${t('ترابيزة مشغولة')}${kind === 'CASH' ? ' · ' + t('اختار ترابيزة عشان تحصّل شيكاتها') : ''}`}
        actions={<Tabs value={area} onChange={setArea} tabs={[{ id: 'ALL', label: t('الكل') }, ...areas.map((a) => ({ id: a, label: a === 'Hall' ? t('الصالة الرئيسية') : a === 'Terrace' ? t('التراس') : a }))]} />} />
      {tables.error && <Banner tone="error">{tables.error.code}</Banner>}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
        {shown.map((tb) => <TableCard key={tb.id} tb={tb} onClick={() => setSel(tb)} />)}
      </div>
      {!items.length && !tables.loading && <Empty text={t('مفيش ترابيزات — ضيفها من "المحطات والتوجيه" في الباك أوفيس')} />}
      {sel && (sel.occupancy ? <VisitSheet tableId={sel.id} visitId={sel.occupancy.visitId} onClose={() => setSel(null)} tables={items} /> : <OpenTable tb={sel} onClose={() => setSel(null)} />)}
    </div>
  );
}

function TableCard({ tb, onClick }: { tb: any; onClick: () => void }) {
  const o = tb.occupancy;
  return (
    <button data-fb={`table:${tb.name}`} onClick={onClick} disabled={!tb.active && !o} className={cn('relative rounded-2xl p-3 text-start border transition-all active:scale-[.97] min-h-[120px] flex flex-col', !tb.active ? 'opacity-40 border-dashed border-white/20 surface-1' : o ? 'bg-gradient-to-br from-pink-500/30 to-rose-600/20 border-pink-400/50 shadow-[0_0_24px_rgba(236,72,153,0.15)]' : 'surface-1 border-emerald-400/30 hover:border-emerald-400/70')}>
      <div className="flex items-center justify-between">
        <span className="text-2xl font-extrabold num">{tb.name}</span>
        <span className="text-[10px] text-dim flex items-center gap-1"><Users className="w-3 h-3" />{tb.capacity}</span>
      </div>
      {!tb.active ? <Pill tone="neutral" className="mt-auto self-start">{t('موقوفة')}</Pill> : o ? (
        <div className="mt-auto space-y-0.5 text-xs">
          <div className="flex items-center gap-1"><Users className="w-3 h-3" />{o.guestCount} · <Clock className="w-3 h-3" /><span className="num">{o.minutesSeated}</span>{t('د')}</div>
          <div className="text-dim truncate">{o.serverName}</div>
          <div className="flex items-center justify-between"><span>{o.checks} {t('شيك')}</span><span className="num font-bold">{money(o.payable, false)}</span></div>
          {!o.primary && <Pill tone="violet">{t('منضمة')}</Pill>}
        </div>
      ) : (
        <div className="mt-auto flex items-center justify-between"><Pill tone="success">{t('فاضية')}</Pill>{tb.reservation && <Pill tone="violet"><CalendarClock className="w-3 h-3" />{time(tb.reservation.at)}</Pill>}</div>
      )}
    </button>
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
        <KV rows={[[t('المنطقة'), tb.area || '—'], [t('السعة'), tb.capacity]]} />
        {tb.reservation && <Banner tone="info">{t('محجوزة لـ')} {tb.reservation.customer} · {time(tb.reservation.at)} · {tb.reservation.partySize} {t('أفراد')}</Banner>}
        <Field label={t('عدد الضيوف')}>
          <div className="flex items-center gap-3">
            <Button size="lg" onClick={() => setGuests(Math.max(1, guests - 1))}><Minus className="w-4 h-4" /></Button>
            <span className="text-3xl font-bold num w-12 text-center">{guests}</span>
            <Button size="lg" onClick={() => setGuests(guests + 1)}><Plus className="w-4 h-4" /></Button>
          </div>
        </Field>
        <div className="text-[11px] text-dim">{t('ترابيزة واحدة = قعدة واحدة مفتوحة. فتحها مرتين بيترفض TABLE_OCCUPIED.')}</div>
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
        <div className="text-[11px] text-dim">{t('الترابيزة مينفعش تتقفل وعليها شيك مفتوح (TABLE_HAS_OPEN_CHECKS). مع VisitAutoClosePolicy ON_LAST_CHECK_COMPLETED بتفضى لوحدها لما آخر شيك يخلص.')}</div>
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
