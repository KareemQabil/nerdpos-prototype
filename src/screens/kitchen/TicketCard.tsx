// One kitchen ticket, built to be read from a step away on a 15–22" screen: the header carries the number, the order
// type, the table / name, the round and the timer, coloured by the screen's thresholds (green · amber · red). Tapping
// the header bumps the whole ticket; tapping an item marks it ready (when the screen allows per-item bump). Voided
// items stay, struck through and flagged; recalled, re-fired and priority tickets are marked. A bump bar selects a
// ticket (outline + its number 1–9) and drives the same actions.
import React, { useState } from 'react';
import { Check, Flame, Undo2, RotateCcw, ArrowRightLeft, MoreVertical, AlertTriangle, Users, ShoppingBag, Utensils, Bike, Play, Ban, History, Clock } from 'lucide-react';
import { Pill, Popover, Kbd } from '../../ui';
import { t, L } from '../../i18n';
import { cn, qty } from '../../lib/format';
import { ALLERGEN_AR } from '../order/MenuGrid';
import { stationName } from '../../demo/humanLog';
import { personName } from '../../demo/people';
import { clock } from '../../mock/clock';

export type Tone = 'ok' | 'warn' | 'late';
export const TONE: Record<Tone, { bg: string; fg: string; ring: string }> = {
  ok: { bg: 'color-mix(in srgb, var(--success) 80%, #000)', fg: '#ffffff', ring: 'var(--success)' },
  warn: { bg: 'var(--warning)', fg: '#1f1400', ring: 'var(--warning)' },
  late: { bg: 'color-mix(in srgb, var(--error) 78%, #000)', fg: '#ffffff', ring: 'var(--error)' },
};
/** Seconds since the ticket arrived (until it was ready), from the server clock. */
export const ageSeconds = (tk: any) => Math.max(0, Math.floor(((tk.readyAt ? Date.parse(tk.readyAt) : clock.now()) - Number(tk.createdAtMs ?? Date.parse(tk.createdAt))) / 1000));
export const toneOf = (tk: any): Tone => { const m = ageSeconds(tk) / 60; return m >= Number(tk.alertMinutes ?? 20) ? 'late' : m >= Number(tk.targetMinutes ?? 15) ? 'warn' : 'ok'; };
export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export const orderType = (tk: any) => (tk.channel === 'DELIVERY' ? { label: t('دليفري'), Icon: Bike } : tk.channel === 'TAKEAWAY' ? { label: t('تيك أواي'), Icon: ShoppingBag } : { label: t('صالة'), Icon: Utensils });
/** The big identifier on the ticket: the table, else the short call number, else the order number. */
export const headline = (tk: any) => (tk.tableName ? `${t('ترابيزة')} ${tk.tableName}` : tk.orderLabel || tk.customerName || (tk.shortNo ? t('طلب {n}', { n: tk.shortNo }) : `#${tk.orderNumber}`));

export function TicketCard({ tk, index, selected, onSelect, onBump, onBumpItem, onStart, onMenu, startPolicy, itemBump, dispatch, showStation, busy, fresh, keys }: {
  tk: any; index: number; selected: boolean; onSelect: () => void; onBump: () => void; onBumpItem: (it: any) => void; onStart: () => void;
  onMenu: (action: 'priority' | 'move' | 'history') => void; startPolicy: 'HIDDEN' | 'OPTIONAL' | 'REQUIRED'; itemBump: boolean; dispatch: boolean; showStation: boolean; busy: boolean; fresh?: boolean; keys: { bump?: string };
}) {
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const tone = TONE[toneOf(tk)];
  const late = toneOf(tk) === 'late';
  const prio = tk.priority === 'RUSH';
  const type = orderType(tk);
  const voided = tk.items.filter((i: any) => i.status === 'CANCELLED').length;
  const needStart = startPolicy === 'REQUIRED' && tk.state === 'NEW';
  return (
    <article data-fb={`ticket:${tk.orderNumber}:r${tk.round}`} data-ticket-state={tk.state} data-priority={tk.priority} data-selected={selected || undefined} data-tone={toneOf(tk)} onPointerDown={onSelect}
      className={cn('relative rounded-2xl overflow-hidden border-2 bg-[var(--card-raised)] flex flex-col shadow-[0_10px_28px_-16px_rgba(0,0,0,.55)]', selected && 'kds-selected', fresh && 'kds-arrive', late && 'animate-pulse-glow')} style={{ borderColor: prio ? 'var(--error)' : tone.ring }}>
      {/* header: tap = the whole ticket is ready (or handed to dispatch) */}
      <button type="button" onClick={() => !busy && !needStart && onBump()} disabled={busy} data-fb="ticket-head" title={needStart ? t('اضغط «بدء» أولًا') : t('جاهز')}
        className="w-full text-start px-3 pt-2 pb-2.5 flex items-start gap-2 disabled:cursor-wait" style={{ background: tone.bg, color: tone.fg }}>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 flex-wrap leading-tight">
            {tk.shortNo && !tk.tableName && <span className="num text-[26px] font-black leading-none" data-fb="ticket-short-no">{tk.shortNo}</span>}
            <span className="text-[19px] font-extrabold truncate">{tk.tableName || !tk.shortNo ? headline(tk) : tk.orderLabel || tk.customerName || ''}</span>
          </span>
          <span className="mt-1 flex items-center gap-1.5 flex-wrap text-[12px] font-bold opacity-90">
            <span className="inline-flex items-center gap-1 px-1.5 h-5 rounded-md bg-black/20" data-fb="ticket-type"><type.Icon className="w-3.5 h-3.5" />{type.label}</span>
            <span>{t('الدفعة')} <span className="num">{tk.round}</span></span>
            {tk.guestCount ? <span className="inline-flex items-center gap-0.5"><Users className="w-3.5 h-3.5" /><span className="num">{tk.guestCount}</span></span> : null}
            {showStation && <span>· {stationName(tk.stationName)}</span>}
            {tk.serverName && <span className="truncate">· {personName(null, tk.serverName)}</span>}
          </span>
        </span>
        <span className="text-end shrink-0 leading-none" data-fb="ticket-timer">
          <span className="num block text-[28px] font-black tracking-tight">{mmss(ageSeconds(tk))}</span>
          <span className="num block text-[11px] font-bold opacity-80 mt-1">#{tk.orderNumber}</span>
        </span>
      </button>

      {(prio || tk.recalledAt || tk.refireOf || tk.transferredFromName || voided > 0) && (
        <div className="flex flex-wrap gap-1 px-2.5 pt-2" data-fb="ticket-flags">
          {prio && <span className="inline-flex items-center gap-1 h-7 px-2 rounded-lg bg-[var(--error)] text-white text-xs font-extrabold" data-fb="ticket-flag:priority"><Flame className="w-3.5 h-3.5" />{t('أولوية')}</span>}
          {tk.refireOf && <span className="inline-flex items-center gap-1 h-7 px-2 rounded-lg bg-[var(--violet)] text-white text-xs font-extrabold" data-fb="ticket-flag:refire"><RotateCcw className="w-3.5 h-3.5" />{t('إعادة التحضير')}{tk.refireReasonText ? `: ${L(tk.refireReasonText)}` : ''}</span>}
          {tk.recalledAt && <span className="inline-flex items-center gap-1 h-7 px-2 rounded-lg bg-[var(--warning)] text-[#1f1400] text-xs font-extrabold" data-fb="ticket-flag:recalled"><Undo2 className="w-3.5 h-3.5" />{t('مُستعادة')}</span>}
          {tk.transferredFromName && <Pill tone="info"><ArrowRightLeft className="w-3 h-3" />{t('منقولة من {s}', { s: stationName(tk.transferredFromName) })}</Pill>}
          {voided > 0 && <span className="inline-flex items-center gap-1 h-7 px-2 rounded-lg border-2 border-[var(--error)] text-[var(--error)] text-xs font-extrabold" data-fb="ticket-flag:void"><Ban className="w-3.5 h-3.5" />{t('أصناف ملغاة: {n}', { n: voided })}</span>}
        </div>
      )}

      <div className="flex-1 px-1.5 py-1.5 space-y-0.5">
        {tk.items.map((it: any) => {
          const cancelled = it.status === 'CANCELLED';
          const Row: any = itemBump && !cancelled ? 'button' : 'div';
          return (
            <Row key={it.lineId} {...(Row === 'button' ? { type: 'button', disabled: busy, onClick: () => onBumpItem(it), title: it.bumped ? t('إلغاء التجهيز') : t('جاهز') } : {})} data-fb={`ticket-item-bump:${it.name.ar}`} data-bumped={it.bumped || undefined} data-void={cancelled || undefined}
              className={cn('w-full text-start rounded-xl px-2 py-1.5 block', Row === 'button' && 'hover:bg-[var(--surface-2)] active:scale-[.99] transition', cancelled && 'bg-[color-mix(in_srgb,var(--error)_8%,transparent)]')}>
              <span className="flex gap-2 items-start">
                {itemBump && <span className={cn('w-7 h-7 mt-0.5 rounded-lg border-2 flex items-center justify-center shrink-0', it.bumped ? 'bg-[var(--success)] border-[var(--success)] text-white' : cancelled ? 'border-[var(--error)] text-[var(--error)]' : 'border-[var(--glass-border)]')}>{it.bumped ? <Check className="w-5 h-5" /> : cancelled ? <Ban className="w-4 h-4" /> : null}</span>}
                <span className={cn('num font-black text-[22px] leading-7 shrink-0', cancelled ? 'text-[var(--error)]' : 'text-[var(--primary)]')}>{qty(it.quantity)}×</span>
                <span className={cn('font-bold text-[20px] leading-7 flex-1 min-w-0', cancelled && 'line-through decoration-[3px] decoration-[var(--error)] text-[var(--error)]', it.bumped && 'opacity-45')}>
                  {L(it.name)}
                  {it.name2 && <span className="block text-xs font-semibold text-soft leading-4" data-fb="ticket-name2"><bdi>{it.name2}</bdi></span>}
                </span>
                {it.seat ? <span className="text-xs h-6 px-1.5 mt-0.5 rounded-md surface-3 font-bold inline-flex items-center shrink-0">{t('مقعد')} <span className="num ms-1">{it.seat}</span></span> : null}
                {cancelled && <span className="text-[11px] h-6 px-1.5 mt-0.5 rounded-md bg-[var(--error)] text-white font-extrabold inline-flex items-center shrink-0" data-fb="ticket-item-void">{t('ملغى')}</span>}
              </span>
              {!cancelled && it.modifiers?.length > 0 && <span className="block ps-16 text-[15px] font-bold text-[var(--warning-text)]">{it.modifiers.map((m: any) => L(m)).join(' · ')}</span>}
              {!cancelled && it.children?.length > 0 && <span className="block ps-16 text-[15px] text-[var(--info)]">{it.children.map((c: string, i: number) => <span key={i} className="block">↳ {c}</span>)}</span>}
              {!cancelled && it.note && <span className="block ps-16 text-[15px] font-bold text-[var(--warning-text)]">✎ {it.note}</span>}
              {!cancelled && it.allergens?.length > 0 && <span className="ps-16 text-[15px] font-extrabold text-[var(--error)] flex items-center gap-1"><AlertTriangle className="w-4 h-4" />{it.allergens.map((a: string) => t(ALLERGEN_AR[a] ?? a)).join(t('، '))}</span>}
              {it.mods?.map((m: any, i: number) => <span key={i} className="block ms-16 mt-0.5 text-[14px] font-bold text-[var(--info)] bg-[color-mix(in_srgb,var(--info)_12%,transparent)] rounded-md px-1.5">{t('تعديل')}: {m.text}</span>)}
            </Row>
          );
        })}
      </div>

      {tk.siblings?.length > 0 && <div className="flex flex-wrap gap-1 px-2.5 pb-1 text-[12px]" data-fb="ticket-siblings">{tk.siblings.map((s: any) => { const ok = s.state === 'READY' || s.state === 'DONE'; return <span key={s.id} className={cn('px-1.5 h-6 inline-flex items-center gap-1 rounded-md border font-bold', ok ? 'border-[color-mix(in_srgb,var(--success)_45%,transparent)] text-[var(--success)]' : 'border-[var(--glass-border)] text-dim')}>{ok ? <Check className="w-3 h-3" /> : <Clock className="w-3 h-3" />}{stationName(s.stationName)}</span>; })}</div>}

      <div className="flex gap-1.5 p-2 pt-1 items-center">
        {index < 9 && <Kbd className={cn('!h-8 !min-w-8 !text-sm shrink-0', selected && '!border-[var(--primary)] !text-[var(--primary)]')}>{index + 1}</Kbd>}
        {tk.state === 'NEW' && startPolicy !== 'HIDDEN' && <button type="button" disabled={busy} onClick={onStart} data-fb="ticket-start" className="h-14 px-4 rounded-xl btn-secondary font-bold inline-flex items-center gap-1.5 disabled:opacity-50"><Play className="w-5 h-5" />{t('بدء')}</button>}
        {tk.state === 'IN_PROGRESS' && startPolicy !== 'HIDDEN' && <span className="h-14 px-2 text-xs font-bold text-[var(--warning-text)] inline-flex items-center gap-1"><Clock className="w-4 h-4" />{t('قيد التحضير')}</span>}
        <button type="button" disabled={busy || needStart} onClick={onBump} data-fb="ticket-ready" title={needStart ? t('اضغط «بدء» أولًا') : dispatch ? undefined : t('يُرسل إلى شاشة التسليم')}
          className="flex-1 h-14 rounded-xl bg-[var(--success)] text-white text-lg font-extrabold inline-flex items-center justify-center gap-2 active:scale-[.98] transition disabled:opacity-45 shadow-[0_6px_18px_-8px_var(--success)]">
          <Check className="w-6 h-6" />{t('جاهز')}{keys.bump && selected && <Kbd className="!bg-black/15 !border-black/10 !text-current">{keys.bump}</Kbd>}
        </button>
        <button type="button" onClick={(e) => setMenu(menu ? null : e.currentTarget)} data-fb={`ticket-menu:${tk.orderNumber}:r${tk.round}`} aria-label={t('خيارات')} className="w-14 h-14 rounded-xl btn-secondary flex items-center justify-center"><MoreVertical className="w-5 h-5" /></button>
        <Popover anchor={menu} open={!!menu} onClose={() => setMenu(null)} side="auto" align="end" width={240} fb="ticket-menu">
          <div className="grid gap-0.5">
            <MenuItem fb="ticket-rush" onClick={() => { setMenu(null); onMenu('priority'); }} icon={<Flame className={cn('w-4 h-4', !prio && 'text-[var(--error)]')} />}>{prio ? t('إلغاء الأولوية') : t('أولوية')}</MenuItem>
            <MenuItem fb="ticket-move" onClick={() => { setMenu(null); onMenu('move'); }} icon={<ArrowRightLeft className="w-4 h-4" />}>{t('نقل إلى محطة')}</MenuItem>
            <MenuItem fb="ticket-history" onClick={() => { setMenu(null); onMenu('history'); }} icon={<History className="w-4 h-4" />}>{t('سجل التذكرة')}</MenuItem>
          </div>
        </Popover>
      </div>
    </article>
  );
}

const MenuItem = ({ children, onClick, icon, fb }: { children: React.ReactNode; onClick: () => void; icon: React.ReactNode; fb: string }) => (
  <button type="button" role="menuitem" onClick={onClick} data-fb={fb} className="h-12 px-3 rounded-xl flex items-center gap-2.5 text-sm font-bold hover:bg-[var(--surface-2)] text-start">{icon}{children}</button>
);
