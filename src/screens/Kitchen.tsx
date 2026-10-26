// F1 Kitchen display: tickets per station by round, bump, cancelled lines struck through, late-ticket timer,
// kitchen modifications ("تعديل") and allergens in bold (direction).
import React, { useState } from 'react';
import { ChefHat, Clock, Play, Check, Truck, Undo2, AlertTriangle } from 'lucide-react';
import { useQuery, useCommand } from '../app/hooks';
import { Section, StateBadge, Tabs, Pill, Button, Empty, useNow } from '../ui';
import { t, L } from '../i18n';
import { cn, qty, time } from '../lib/format';
import { ALLERGEN_AR } from './order/MenuGrid';

export default function Kitchen() {
  useNow(10000);
  const stations = useQuery<any>('KitchenStation.List', { query: {} });
  const [station, setStation] = useState<string>('ALL');
  const [showDone, setShowDone] = useState(false);
  const board = useQuery<any>('Kitchen.Board', { query: { stationId: station === 'ALL' ? undefined : station } });
  const tickets: any[] = board.data?.items ?? [];
  const cols: { id: string; title: string; tone: string }[] = [
    { id: 'NEW', title: t('جديد'), tone: 'border-cyan-400/50' },
    { id: 'IN_PROGRESS', title: t('بيتعمل'), tone: 'border-amber-400/50' },
    { id: 'READY', title: t('جاهز'), tone: 'border-emerald-400/50' },
  ];
  return (
    <div data-screen="F1" className="h-full flex flex-col gap-3 min-h-0">
      <Section title={t('شاشة المطبخ')} badge={<StateBadge ops={['Kitchen.Board', 'Kitchen.AdvanceTicket']} />} sub={board.data?.timing ? `${t('المستهدف')} ${board.data.timing.targetMinutes} ${t('دقيقة')} · ${t('تنبيه بعد')} ${board.data.timing.alertMinutes} (KitchenTimingPolicy)` : ''}
        actions={<><Tabs value={station} onChange={setStation} tabs={[{ id: 'ALL', label: t('كل المحطات') }, ...(stations.data?.items ?? []).filter((s: any) => s.active).map((s: any) => ({ id: s.id, label: s.name }))]} /><Button size="sm" variant="ghost" onClick={() => setShowDone(!showDone)}>{showDone ? t('إخفاء المسلّم') : t('إظهار المسلّم')}</Button></>} />
      <div className="flex-1 min-h-0 grid gap-3" style={{ gridTemplateColumns: `repeat(${showDone ? 4 : 3}, minmax(0, 1fr))` }}>
        {[...cols, ...(showDone ? [{ id: 'DONE', title: t('اتسلّم'), tone: 'border-white/20' }] : [])].map((c) => {
          const list = tickets.filter((x) => x.state === c.id);
          return (
            <div key={c.id} className={cn('rounded-2xl border-t-4 surface-1 flex flex-col min-h-0', c.tone)}>
              <div className="px-3 py-2 font-bold flex items-center justify-between">{c.title}<Pill tone="neutral">{list.length}</Pill></div>
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {list.map((tk) => <Ticket key={tk.id} tk={tk} />)}
                {!list.length && <Empty text={t('مفيش تذاكر')} />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Ticket({ tk }: { tk: any }) {
  const { run, busy } = useCommand();
  const adv = (toState: string) => run('Kitchen.AdvanceTicket', { params: { ticketId: tk.id }, body: { expectedVersion: tk.version, toState } });
  return (
    <div data-fb={`ticket:${tk.orderNumber}:r${tk.round}`} className={cn('rounded-xl glass p-3 space-y-2 border-2', tk.late ? 'border-red-500/70 animate-pulse-glow' : tk.warn ? 'border-amber-400/50' : 'border-transparent')}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-extrabold text-lg">{tk.tableName ? `${t('ترابيزة')} ${tk.tableName}` : tk.channel === 'TAKEAWAY' ? t('تيك أواي') : t('كاونتر')}</div>
          <div className="text-[11px] text-dim"><span className="num">#{tk.orderNumber}</span> · {t('الجولة')} {tk.round} · {tk.stationName} · {tk.serverName}</div>
        </div>
        <Pill tone={tk.late ? 'error' : tk.warn ? 'warning' : 'neutral'}><Clock className="w-3 h-3" /><span className="num">{tk.ageMinutes}</span>{t('د')}</Pill>
      </div>
      <div className="space-y-1.5">
        {tk.items.map((it: any) => (
          <div key={it.lineId} className={cn('text-sm', it.status === 'CANCELLED' && 'line-through opacity-50')}>
            <div className="flex gap-2"><span className="num font-extrabold text-[var(--primary)]">{qty(it.quantity)}×</span><span className="font-bold">{L(it.name)}</span>{it.seat ? <span className="text-[10px] px-1 rounded bg-white/10">{t('كرسي')} {it.seat}</span> : null}{it.status === 'CANCELLED' && <Pill tone="error">{t('ملغي')}</Pill>}</div>
            {it.modifiers?.length > 0 && <div className="ps-6 text-xs text-orange-300">{it.modifiers.map((m: any) => L(m)).join(' · ')}</div>}
            {it.children?.length > 0 && <div className="ps-6 text-xs text-sky-300">{it.children.map((c: string, i: number) => <div key={i}>↳ {c}</div>)}</div>}
            {it.note && <div className="ps-6 text-xs text-amber-300">✎ {it.note}</div>}
            {it.allergens?.length > 0 && <div className="ps-6 text-xs font-extrabold text-amber-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{it.allergens.map((a: string) => ALLERGEN_AR[a] ?? a).join('، ')}</div>}
            {it.mods?.map((m: any, i: number) => <div key={i} className="ps-6 text-xs font-bold text-sky-300 bg-sky-500/10 rounded px-1 mt-0.5">{t('تعديل')}: {m.text} · <span className="num">{time(m.at)}</span></div>)}
          </div>
        ))}
      </div>
      <div className="flex gap-1.5 pt-1">
        {tk.state === 'NEW' && <Button size="sm" variant="primary" className="flex-1" disabled={busy} onClick={() => adv('IN_PROGRESS')} data-fb="ticket-start"><Play className="w-3.5 h-3.5" />{t('ابدأ')}</Button>}
        {(tk.state === 'NEW' || tk.state === 'IN_PROGRESS') && <Button size="sm" variant="success" className="flex-1" disabled={busy} onClick={() => adv('READY')}><Check className="w-3.5 h-3.5" />{t('جاهز')}</Button>}
        {tk.state === 'READY' && <><Button size="sm" variant="ghost" disabled={busy} onClick={() => adv('IN_PROGRESS')}><Undo2 className="w-3.5 h-3.5" /></Button><Button size="sm" className="flex-1" disabled={busy} onClick={() => adv('DONE')}><Truck className="w-3.5 h-3.5" />{t('اتسلّم')}</Button></>}
      </div>
    </div>
  );
}
