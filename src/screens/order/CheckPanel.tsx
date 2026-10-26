// C2–C4: the check. Lines by round («الدفعة»); sent lines are locked (only void with approval, move, or a kitchen
// note); lines not sent yet stay editable (quick − / + and remove). Totals come from the server preview.
import React, { useState } from 'react';
import { ChefHat, Minus, Plus, Trash2, Ban, ArrowRightLeft, Send, Lock, Tag, Gift, XCircle, Printer, Wallet, Split, Merge, PenLine, Armchair, RefreshCw, History, CheckCircle2, Clock, AlertTriangle, Shuffle, Receipt, Users, StickyNote, ChevronDown, ChevronUp, MoreHorizontal } from 'lucide-react';
import { useDev, useQuery, useCommand } from '../../app/hooks';
import { Button, Pill, Modal, Field, Select, Input, Textarea, Money, StateBadge, Banner, EmptyState, Tabs, Timeline, Skeleton } from '../../ui';
import { Tech } from '../../app/tech';
import { t, L } from '../../i18n';
import { cn, money, qty, time } from '../../lib/format';
import { ALLERGEN_AR } from './MenuGrid';
import { CustomerChip } from '../customers/common'; // crm area: customer on the check
import { optionText, ruleSentence } from '../../demo/policyText';
import { personName, deviceName } from '../../demo/people';

export function useReasons(kind: string) {
  const r = useQuery<any>('ReasonCode.List', { query: { kind, active: true } });
  return (r.data?.items ?? []) as any[];
}
/** A managed reason code in words (the code itself only with technical details on). */
function ReasonText({ kind, code }: { kind: string; code?: string | null }) {
  const reasons = useReasons(kind);
  if (!code) return null;
  const r = reasons.find((x) => x.code === code);
  const plain = r ? L(r.label) : code === 'PROMOTION' ? t('عرض') : t('سبب مسجّل');
  return <>{plain}<Tech><span className="num text-[10px] opacity-70 ms-1">{code}</span></Tech></>;
}
const firstName = (s?: string | null) => (s ?? '').split(' — ')[0];

export function CheckPanel({ order, refetch, mode, onCheckSwitch }: { order: any; refetch: () => void; mode: 'FLOOR' | 'COUNTER'; onCheckSwitch?: (id: string) => void }) {
  const { nav, can, auth, kind } = useDev();
  const { run, busy } = useCommand();
  const [dlg, setDlg] = useState<null | { k: string; line?: any }>(null);
  const [showHist, setShowHist] = useState(false);
  const fireP = useQuery<any>('Settings.Effective', { query: { policyId: 'FireTimingPolicy', scopeType: 'BRANCH', scopeId: auth.branchId } });
  const seatsP = useQuery<any>('Settings.Effective', { query: { policyId: 'SeatsPolicy', scopeType: 'TENANT', scopeId: 'biz' } });
  const visit = useQuery<any>(order.visitId ? 'TableVisit.List' : null, { query: { tableId: order.tableId, state: 'OPEN' } });
  const siblings = (visit.data?.items?.[0]?.checks ?? []).filter((c: any) => c.status === 'DRAFT' || c.status === 'CONFIRMED');
  const draft = order.status === 'DRAFT';
  const policyFire = fireP.data?.value?.[order.channel] ?? 'AT_CONFIRM';
  const showFire = draft && (order.fireModeBound === 'EXPLICIT_ROUNDS' || (order.fireModeBound === null && policyFire === 'EXPLICIT_ROUNDS'));
  const active = order.lines.filter((l: any) => l.status === 'ACTIVE');
  const unfired = active.filter((l: any) => l.fireRound === null);
  const rounds = [...new Set(order.lines.filter((l: any) => l.fireRound !== null).map((l: any) => l.fireRound))].sort((a: any, b: any) => a - b) as number[];
  const roundInfo = (r: number) => order.rounds.find((x: any) => x.round === r);
  const removed = order.lines.filter((l: any) => l.status === 'REMOVED');
  const T = order.totals;
  const v = order.version;
  const seats = !!seatsP.data?.value && mode === 'FLOOR';
  const canPay = (draft || order.status === 'CONFIRMED') && can('payment:capture') && kind !== 'FLOOR';
  const items = active.reduce((a: number, l: any) => a + Number(l.quantity), 0);

  const fire = () => run('Order.Fire', { params: { orderId: order.id }, body: { expectedVersion: v } }, { success: t('اتبعت للمطبخ'), label: t('إرسال للمطبخ') });
  const qtyChange = (l: any, d: number) => {
    const n = Math.round(Number(l.quantity) + d);
    if (n < 1) return run('Order.RemoveLine', { params: { orderId: order.id, lineId: l.id }, query: { expectedVersion: v, expectedLineVersion: l.version }, body: { expectedVersion: v, expectedLineVersion: l.version } });
    return run('Order.UpdateLine', { params: { orderId: order.id, lineId: l.id }, body: { expectedVersion: v, expectedLineVersion: l.version, quantity: String(n) } });
  };
  const [showBreak, setShowBreak] = useState(() => typeof window === 'undefined' || window.innerHeight > 860);
  const [moreOpen, setMoreOpen] = useState(false);
  type ActDef = { icon: React.ReactElement; label: string; onClick: () => void; disabled?: boolean; danger?: boolean; proposed?: boolean };
  const acts: ActDef[] = ([
    can('order:applydiscount') && { icon: <Tag />, label: t('خصم'), onClick: () => setDlg({ k: 'discount' }), disabled: !active.length },
    order.visitId && can('order:updateline') && { icon: <ArrowRightLeft />, label: t('نقل أصناف'), onClick: () => setDlg({ k: 'move' }), disabled: !active.length },
    order.visitId && can('order:updateline') && { icon: <Split />, label: t('تقسيم'), onClick: () => setDlg({ k: 'split' }), disabled: !active.length, proposed: true },
    { icon: <Printer />, label: t('شيك مبدئي'), onClick: () => run('Print.PreBill', { params: { orderId: order.id }, body: { terminalId: auth.terminalId } }, { success: t('الشيك المبدئي اتبعت للطابعة (مش فاتورة ضريبية)') }), disabled: !active.length, proposed: true },
    can('order:comp') && { icon: <Gift />, label: t('ضيافة'), onClick: () => setDlg({ k: 'comp' }), disabled: !active.length },
    order.visitId && siblings.length > 1 && can('order:updateline') && { icon: <Merge />, label: t('دمج'), onClick: () => setDlg({ k: 'merge' }), proposed: true },
    can('order:changechannel') && { icon: <Shuffle />, label: t('تغيير القناة'), onClick: () => setDlg({ k: 'channel' }), proposed: true },
    rounds.length === 0 ? can('order:cancel') && { icon: <XCircle />, label: t('إلغاء الشيك'), onClick: () => setDlg({ k: 'cancel' }), danger: true } : can('order:void') && { icon: <Ban />, label: t('إلغاء بعد الإرسال'), onClick: () => setDlg({ k: 'voidOrder' }), danger: true },
  ] as (ActDef | false | null | undefined | '')[]).filter(Boolean) as ActDef[];
  const where = order.kind === 'STAFF_MEAL' ? t('وجبة موظف') : order.tableName ? `${t('ترابيزة')} ${order.tableName}` : order.channel === 'TAKEAWAY' ? t('تيك أواي') : order.channel === 'DELIVERY' ? t('دليفري') : t('صالة كاونتر');

  return (
    <div className="flex flex-col h-full min-h-0 rounded-2xl overflow-hidden border border-[var(--glass-border)] bg-[var(--glass-bg-strong)] backdrop-blur-2xl shadow-[0_12px_40px_-16px_rgba(0,0,0,.45)]" data-fb="check-panel">
      {/* header */}
      <div className="px-4 pt-3 pb-2.5 border-b line space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-extrabold text-lg leading-tight flex items-center gap-2 flex-wrap">{where}{order.tableName && <span className="text-soft font-bold text-sm">· {t('شيك')} {order.checkNo}</span>}<StatusPill s={order.status} /></div>
            <div className="text-[11px] text-dim mt-0.5 flex items-center gap-1.5 flex-wrap">
              <span className="num">#{order.number}</span>
              {order.serverName && <span>· {firstName(order.serverName)}</span>}
              {order.guestCount ? <span className="inline-flex items-center gap-0.5">· <Users className="w-3 h-3" /><span className="num">{order.guestCount}</span></span> : null}
              <Tech><span className="num">· v{order.version} · {order.sessionId ? 'session' : 'no drawer'}</span></Tech>
            </div>
          </div>
          <button title={t('سجل الشيك')} aria-label={t('سجل الشيك')} onClick={() => setShowHist(true)} className="w-10 h-10 rounded-xl surface-1 border border-[var(--glass-border)] flex items-center justify-center hover:bg-[var(--surface-2)] shrink-0" data-fb="check-history"><History className="w-4 h-4" /></button>
        </div>
        {order.kind !== 'STAFF_MEAL' && <CustomerChip order={order} />}
        {siblings.length > 1 && (
          <div className="flex gap-1 overflow-x-auto scrollbar-hide">{siblings.map((c: any) => <button key={c.id} onClick={() => onCheckSwitch?.(c.id)} className={cn('px-3 h-9 rounded-lg text-xs border whitespace-nowrap', c.id === order.id ? 'bg-[var(--primary)] text-[var(--primary-foreground)] border-transparent font-bold' : 'surface-1 border-[var(--glass-border)]')}>{t('شيك')} {c.checkNo} · <span className="num">{money(c.payable, false)}</span></button>)}</div>
        )}
      </div>

      {/* lines */}
      <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5">
        {order.lines.length === 0 && <EmptyState compact icon={<Receipt />} title={t('الشيك فاضي')} text={t('دوس على أي صنف من المنيو يتضاف هنا.')} />}
        {rounds.map((r) => {
          const info = roundInfo(r);
          const lines = order.lines.filter((l: any) => l.fireRound === r && l.status !== 'REMOVED');
          return (
            <div key={r} className="rounded-xl border line overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-3 py-1.5 surface-1 text-xs">
                <span className="font-bold flex items-center gap-1.5"><ChefHat className="w-3.5 h-3.5 text-dim" />{t('الدفعة')} <span className="num">{r}</span>{info?.firedAt && <span className="text-dim font-normal num">· {time(info.firedAt)}</span>}{info?.via === 'CONFIRM' && <span className="text-dim font-normal">· {t('مع التأكيد')}</span>}</span>
                <RoundStatus info={info} orderId={order.id} />
              </div>
              <div className="divide-y divide-[var(--line)]">{lines.map((l: any) => <LineRow key={l.id} l={l} locked draft={draft} onVoid={() => setDlg({ k: 'void', line: l })} onMod={() => setDlg({ k: 'kmod', line: l })} onSeat={() => setDlg({ k: 'seat', line: l })} seats={seats} />)}</div>
            </div>
          );
        })}
        {unfired.length > 0 && (
          <div className="rounded-xl border-2 border-dashed border-[color-mix(in_srgb,var(--primary)_40%,transparent)] overflow-hidden" data-fb="check-unsent">
            <div className="px-3 py-1.5 text-xs font-bold text-[var(--primary)] flex items-center justify-between bg-[var(--primary-container)]"><span className="flex items-center gap-1.5"><Send className="w-3.5 h-3.5" />{t('لسه ما اتبعتش')} <span className="num">({unfired.length})</span></span><span className="text-soft font-normal">{t('تقدر تعدّل أو تشيل')}</span></div>
            <div className="divide-y divide-[var(--line)]">{unfired.map((l: any) => <LineRow key={l.id} l={l} draft={draft} onQty={(d) => qtyChange(l, d)} onRemove={() => qtyChange(l, -999)} onSeat={() => setDlg({ k: 'seat', line: l })} seats={seats} busy={busy} />)}</div>
          </div>
        )}
        {removed.length > 0 && <div className="text-[11px] text-dim px-1">{t('اتشالوا قبل الإرسال')}: {removed.map((l: any) => L(l.name)).join('، ')}</div>}
        {order.discounts.filter((d: any) => d.active).map((d: any) => (
          <div key={d.id} className="flex items-center justify-between gap-2 text-xs rounded-xl px-3 py-2 border border-[color-mix(in_srgb,var(--error)_30%,transparent)] bg-[color-mix(in_srgb,var(--error)_8%,transparent)]">
            <span className="flex items-center gap-1.5 min-w-0"><Tag className="w-3.5 h-3.5 text-[var(--error)] shrink-0" /><b>{d.label ? L(d.label) : t('خصم')} {d.type === 'PERCENTAGE' ? <span className="num">{d.value}%</span> : <span className="num">{money(d.value)}</span>}</b><span className="text-dim truncate">· <ReasonText kind="DISCOUNT" code={d.reasonCode} />{d.approvalGrantId ? ` · ${t('بموافقة مدير')}` : ''}</span></span>
            {draft && <button className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--error)] hover:bg-[color-mix(in_srgb,var(--error)_14%,transparent)] shrink-0" title={t('شيل الخصم')} aria-label={t('شيل الخصم')} onClick={() => run('Order.RemoveDiscount', { params: { orderId: order.id, discountId: d.id }, body: {} }, { success: t('الخصم اتشال') })}><XCircle className="w-4 h-4" /></button>}
          </div>
        ))}
        {order.comp && <Banner tone="success" title={t('ضيافة كاملة — الشيك مجاني')}><ReasonText kind="COMP" code={order.comp.reasonCode} /></Banner>}
      </div>

      {/* totals (server) */}
      <div className="border-t line px-4 py-2.5 space-y-1 text-sm surface-1" data-fb="check-totals">
        {showBreak && <>
          <Row k={<>{t('الأصناف')} <span className="num text-dim text-xs">({qty(String(items))})</span></>} v={T.itemsSubtotal} />
          {T.discountTotal !== '0.0000' && !T.comp && <Row k={t('الخصم')} v={'-' + T.discountTotal} tone="error" />}
          {T.serviceRate && <Row k={<>{t('خدمة')} <span className="num">{qty(T.serviceRate)}%</span></>} v={T.serviceCharge} />}
          {!T.serviceRate && order.channel === 'DINE_IN' && order.service && <div className="text-[11px] text-dim">{t('مفيش خدمة على الشيك ده')}<Tech> ({order.service.origin})</Tech></div>}
          {T.charges.map((c: any) => <Row key={c.id} k={<span className="flex items-center gap-1">{L(c.label)} <StateBadge state="PROPOSED" /></span>} v={c.amount} />)}
          {T.tableTax !== '0.0000' && <Row k={<span className="flex items-center gap-1">{t('ضريبة الجدول')} <StateBadge state="PROPOSED" /></span>} v={T.tableTax} />}
          {T.taxLines.map((x: any, i: number) => <Row key={i} k={<>{L(x.name)} <span className="num">{qty(x.rate)}%</span></>} v={x.amount} />)}
        </>}
        <div className={cn('flex items-end justify-between gap-2', showBreak && 'pt-1.5 mt-1 border-t line')}>
          <button className="font-extrabold text-base flex items-center gap-1 text-start" onClick={() => setShowBreak(!showBreak)} data-fb="check-totals-toggle" title={showBreak ? t('اخفي التفاصيل') : t('اعرض التفاصيل')}>{t('الإجمالي')}<ChevronDown className={cn('w-4 h-4 text-dim transition-transform', showBreak && 'rotate-180')} /></button>
          <Money v={T.payable} className="text-[28px] leading-none tracking-tight text-[var(--primary)]" />
        </div>
        {order.settlement && order.settlement.paid !== '0.0000' && <div className="text-xs flex justify-between"><span className="text-dim">{t('اتدفع')} <span className="num">{money(order.settlement.paid)}</span></span><span>{t('الباقي')} <b className="num">{money(order.settlement.remaining)}</b></span></div>}
        {showBreak && <div className="text-[10px] text-dim" title={optionText('PricingOrderPolicy', null, order.policy.pricingOrder).help}>{optionText('PricingOrderPolicy', null, order.policy.pricingOrder).label} · {t('التقريب لأقرب قرش')}<Tech><span className="num"> · {order.policy.pricingOrder} · {order.policy.rounding.mode}/{order.policy.rounding.scale}</span></Tech></div>}
      </div>

      {/* actions */}
      <div className="border-t line p-2.5 space-y-2">
        {draft && order.kind !== 'STAFF_MEAL' && acts.length > 0 && (
          <div className="grid grid-cols-4 gap-1.5" data-fb="check-actions">
            {(moreOpen || acts.length <= 4 ? acts : acts.slice(0, 3)).map((x) => <Act key={x.label} {...x} />)}
            {acts.length > 4 && <Act icon={moreOpen ? <ChevronUp /> : <MoreHorizontal />} label={moreOpen ? t('أقل') : t('المزيد')} onClick={() => setMoreOpen(!moreOpen)} />}
          </div>
        )}
        {order.status === 'CONFIRMED' && can('order:void') && <Button variant="danger" size="sm" className="w-full" onClick={() => setDlg({ k: 'voidOrder' })}><Ban className="w-4 h-4" />{t('إلغاء الشيك (موافقة مدير)')}</Button>}
        <div className="flex gap-2">
          {showFire && order.kind !== 'STAFF_MEAL' && <Button data-fb="send-round" variant="primary" size="xl" className="flex-1" disabled={!unfired.length || busy} onClick={fire}><Send className="w-5 h-5 rtl:-scale-x-100" />{t('ابعت للمطبخ')}{unfired.length ? <span className="num">({unfired.length})</span> : null}</Button>}
          {canPay && <Button data-fb="go-pay" variant={showFire && unfired.length ? 'success' : 'success'} size="xl" className={cn(showFire ? 'flex-1' : 'w-full')} disabled={!active.length} onClick={() => nav('pay', { orderId: order.id, back: mode === 'COUNTER' ? 'counter' : 'order' })}><Wallet className="w-5 h-5" />{draft ? t('ادفع') : t('تحصيل')}<Money v={T.payable} className="text-base opacity-90" /></Button>}
        </div>
        {draft && !showFire && order.kind !== 'STAFF_MEAL' && <div className="text-[11px] text-dim text-center">{t('الأصناف بتروح المطبخ لوحدها أول ما الشيك يتأكد.')}</div>}
        {draft && kind === 'FLOOR' && order.visitId && <div className="text-[11px] text-dim text-center">{t('التحصيل بيكون على جهاز الكاشير.')}</div>}
        {order.status === 'COMPLETED' && <Button variant="secondary" size="lg" className="w-full" onClick={() => nav('receipt', { orderId: order.id })}><Receipt className="w-4 h-4" />{t('الإيصال')}</Button>}
      </div>

      {dlg?.k === 'void' && <VoidLineDialog order={order} line={dlg.line} onClose={() => setDlg(null)} />}
      {dlg?.k === 'kmod' && <KitchenModDialog order={order} line={dlg.line} onClose={() => setDlg(null)} />}
      {dlg?.k === 'seat' && <SeatDialog order={order} line={dlg.line} onClose={() => setDlg(null)} />}
      {dlg?.k === 'discount' && <DiscountDialog order={order} onClose={() => setDlg(null)} />}
      {dlg?.k === 'comp' && <ReasonDialog title={t('ضيافة (الشيك كله مجاني)')} kind="COMP" ops={['Order.Comp']} onClose={() => setDlg(null)} onOk={(rc, note) => run('Order.Comp', { params: { orderId: order.id }, body: { expectedVersion: v, reasonCode: rc, reason: note } }, { success: t('اتعملت ضيافة') })} note={t('الشيك كله بيبقى مجاني (المطلوب صفر)، والسبب بيتسجل في تقرير الاستثناءات.')} />}
      {dlg?.k === 'cancel' && <ReasonDialog danger title={t('إلغاء شيك ما اتبعتش')} kind="ORDER_CANCEL" ops={['Order.Cancel']} onClose={() => setDlg(null)} onOk={(rc, note) => run('Order.Cancel', { params: { orderId: order.id }, body: { expectedVersion: v, reasonCode: rc, reason: note } }, { success: t('الشيك اتلغى') })} note={t('الإلغاء للشيك اللي مفيهوش ولا صنف اتبعت للمطبخ.')} />}
      {dlg?.k === 'voidOrder' && <ReasonDialog danger title={t('إلغاء شيك بعد الإرسال')} kind="ORDER_VOID" ops={['Order.Void', 'Approval.Grant']} requireNote onClose={() => setDlg(null)} onOk={(rc, note) => run('Order.Void', { params: { orderId: order.id }, body: { expectedVersion: v, reasonCode: rc, reason: note } }, { success: t('الشيك اتلغى بالكامل') })} note={t('ده محتاج موافقة مدير دايمًا. الشيك اللي عليه فلوس اتدفعت مينفعش يتلغي — اعمل له مرتجع.')} />}
      {dlg?.k === 'move' && <MoveDialog order={order} siblings={siblings} onClose={() => setDlg(null)} />}
      {dlg?.k === 'split' && <SplitDialog order={order} siblings={siblings} onClose={() => setDlg(null)} />}
      {dlg?.k === 'merge' && <MergeDialog order={order} siblings={siblings} onClose={() => setDlg(null)} />}
      {dlg?.k === 'channel' && <ChannelDialog order={order} onClose={() => setDlg(null)} />}
      {showHist && <HistoryDialog order={order} onClose={() => setShowHist(false)} />}
    </div>
  );
}

export function StatusPill({ s }: { s: string }) {
  const m: Record<string, [string, any]> = { DRAFT: ['مفتوح', 'primary'], CONFIRMED: ['اتأكد — مستني الدفع', 'warning'], COMPLETED: ['اتقفل', 'success'], CANCELLED: ['ملغي', 'neutral'], VOIDED: ['ملغي بموافقة', 'error'], MERGED: ['اتدمج', 'neutral'] };
  const [ar, tone] = m[s] ?? ['—', 'neutral'];
  return <Pill tone={tone} dot>{t(ar)}<Tech><span className="num opacity-70">{s}</span></Tech></Pill>;
}

function Row({ k, v, tone }: { k: React.ReactNode; v: string; tone?: 'error' }) {
  return <div className="flex items-center justify-between gap-2"><span className="text-soft">{k}</span><Money v={v} tone={tone} className="text-sm" /></div>;
}

function Act({ icon, label, onClick, disabled, danger, proposed }: { icon: React.ReactElement; label: string; onClick: () => void; disabled?: boolean; danger?: boolean; proposed?: boolean }) {
  return (
    <button data-fb={`check-action:${label}`} onClick={onClick} disabled={disabled} className={cn('relative min-h-[48px] rounded-xl flex flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-bold border transition-colors disabled:opacity-30', danger ? 'border-[color-mix(in_srgb,var(--error)_35%,transparent)] text-[var(--error)] bg-[color-mix(in_srgb,var(--error)_8%,transparent)] hover:bg-[color-mix(in_srgb,var(--error)_16%,transparent)]' : 'border-[var(--glass-border)] surface-1 text-soft hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]')}>
      {React.cloneElement(icon as React.ReactElement<any>, { className: 'w-4 h-4' })}<span className="leading-tight text-center">{label}</span>
      {proposed && <span className="absolute top-1 end-1 w-1.5 h-1.5 rounded-full" style={{ background: 'var(--violet)' }} title={t('مقترح')} />}
    </button>
  );
}

function RoundStatus({ info, orderId }: { info: any; orderId: string }) {
  const { run, busy } = useCommand();
  const d = info?.delivery;
  if (!d) return <Pill tone="neutral" size="sm"><Clock className="w-3 h-3" />{t('في الطريق للمطبخ')}</Pill>;
  if (d.state === 'DELIVERED') return <Pill tone="success" size="sm" title={t('وصلت {n} تذكرة للمطبخ', { n: d.ticketIds.length })}><CheckCircle2 className="w-3 h-3" />{t('وصل المطبخ')}</Pill>;
  if (d.state === 'PENDING') return <Pill tone="warning" size="sm"><Clock className="w-3 h-3" />{t('مستني')}</Pill>;
  return (
    <span className="flex items-center gap-1"><Pill tone="error" size="sm"><AlertTriangle className="w-3 h-3" />{t('ما وصلش المطبخ')}</Pill>
      <button disabled={busy} onClick={() => run('Kitchen.Resend', { params: { orderId }, body: {} }, { success: t('اتبعت تاني — من غير ما الطلب يتكرر') })} className="text-[11px] h-7 px-2 rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] font-bold flex items-center gap-1"><RefreshCw className="w-3 h-3" />{t('ابعت تاني')}</button>
    </span>
  );
}

function LineRow({ l, locked, draft, onQty, onRemove, onVoid, onMod, onSeat, seats, busy }: { l: any; locked?: boolean; draft: boolean; onQty?: (d: number) => void; onRemove?: () => void; onVoid?: () => void; onMod?: () => void; onSeat?: () => void; seats?: boolean; busy?: boolean }) {
  const voided = l.status === 'VOIDED';
  const editable = draft && !voided && !locked;
  return (
    <div className={cn('px-2.5 py-2 text-sm', voided && 'opacity-60')} data-fb={`line:${l.sku}`}>
      <div className="flex items-start gap-2">
        {editable ? (
          <div className="flex items-center shrink-0 rounded-xl surface-2 p-0.5">
            <MiniBtn onClick={() => onQty!(1)} disabled={busy} title={t('أكتر')} fb="line-plus"><Plus className="w-4 h-4" /></MiniBtn>
            <span className="num font-extrabold text-[var(--primary)] min-w-6 text-center">{qty(l.quantity)}</span>
            <MiniBtn onClick={() => onQty!(-1)} disabled={busy} title={Number(l.quantity) <= 1 ? t('شيل الصنف') : t('أقل')} fb="line-minus" danger={Number(l.quantity) <= 1}>{Number(l.quantity) <= 1 ? <Trash2 className="w-4 h-4" /> : <Minus className="w-4 h-4" />}</MiniBtn>
          </div>
        ) : <span className="shrink-0 min-w-9 h-9 px-1 rounded-lg bg-[var(--primary-container)] text-[var(--primary)] font-extrabold text-sm flex items-center justify-center num">{qty(l.quantity)}</span>}
        <div className="flex-1 min-w-0 pt-1.5">
          <div className={cn('font-bold leading-snug', voided && 'line-through')}>{L(l.name)} {l.seat ? <span className="text-[10px] px-1.5 py-0.5 rounded-md surface-3 font-bold align-middle">{t('كرسي')} <span className="num">{l.seat}</span></span> : null}{l.shareOf ? <span className="text-[10px] text-dim font-normal"> · {t('حصة')} <span className="num">{l.shareOf.index}/{l.shareOf.parts}</span></span> : null}</div>
          {(l.variant || l.modifiers.length > 0 || l.children?.length) && (
            <div className="flex flex-wrap gap-1 mt-1">
              {l.variant && <Chip tone="violet">{L(l.variant.name)}</Chip>}
              {l.modifiers.map((m: any) => <Chip key={m.optionId} tone="warning">{L(m.name)}{m.priceDelta !== '0.0000' && <span className="num"> +{money(m.priceDelta, false)}</span>}</Chip>)}
              {l.children?.map((c: any, i: number) => <Chip key={i} tone="info">{L(c.name)}{c.detail ? ` (${L(c.detail)})` : ''}{c.upcharge !== '0.0000' && <span className="num"> +{money(c.upcharge, false)}</span>}</Chip>)}
            </div>
          )}
          {l.note && <div className="text-[11px] text-[var(--warning-text)] mt-0.5 flex items-center gap-1"><StickyNote className="w-3 h-3" />{l.note}</div>}
          {l.allergens?.length ? <div className="text-[11px] text-[var(--warning-text)] font-bold flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{l.allergens.map((a: string) => t(ALLERGEN_AR[a] ?? a)).join('، ')}</div> : null}
          {l.kitchenMods?.map((m: any) => <div key={m.id} className="text-[11px] text-[var(--info)]">{t('ملاحظة للمطبخ')}: {m.text}</div>)}
          {voided && <div className="text-[11px] text-[var(--error)]">{t('اتلغى')} · <ReasonText kind="LINE_VOID" code={l.voided.reasonCode} /> · {l.voided.disposition === 'WASTE' ? t('اتعمل واترمى (هالك)') : l.voided.disposition === 'NOT_PREPARED' ? t('ما اتعملش') : '—'}</div>}
          {l.movedFrom && <div className="text-[10px] text-dim">{t('اتنقل من شيك تاني')}</div>}
          {draft && !voided && locked && (
            <div className="flex items-center gap-1 mt-1">
              <span className="text-[10px] text-dim flex items-center gap-1 me-auto"><Lock className="w-3 h-3" />{t('اتبعت')}</span>
              {seats && <MiniBtn onClick={onSeat!} title={t('الكرسي')}><Armchair className="w-4 h-4" /></MiniBtn>}
              <MiniBtn onClick={onMod!} title={t('ملاحظة للمطبخ بعد الإرسال')}><PenLine className="w-4 h-4" /></MiniBtn>
              <button data-fb="void-line" onClick={onVoid} className="h-8 px-2.5 rounded-lg text-xs font-bold text-[var(--error)] border border-[color-mix(in_srgb,var(--error)_35%,transparent)] bg-[color-mix(in_srgb,var(--error)_8%,transparent)] flex items-center gap-1"><Ban className="w-3.5 h-3.5" />{t('إلغاء')}</button>
            </div>
          )}
        </div>
        <div className="text-end shrink-0 pt-1 flex flex-col items-end gap-1">
          <div className={cn('num font-extrabold', voided && 'line-through')}>{money(l.lineTotal)}</div>
          {qty(l.quantity) !== '1' && <div className="num text-[10px] text-dim">{money(l.unitTotal, false)} × {qty(l.quantity)}</div>}
          {editable && (
            <div className="flex items-center">
              {seats && <MiniBtn onClick={onSeat!} title={t('الكرسي')}><Armchair className="w-4 h-4" /></MiniBtn>}
              {Number(l.quantity) > 1 && <MiniBtn onClick={onRemove!} title={t('شيل الصنف')} danger fb="line-remove"><Trash2 className="w-4 h-4" /></MiniBtn>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
const CHIP: Record<string, string> = { violet: 'var(--violet)', warning: 'var(--warning-text)', info: 'var(--info)' };
const Chip = ({ tone, children }: { tone: 'violet' | 'warning' | 'info'; children: React.ReactNode }) => <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold" style={{ color: CHIP[tone], background: `color-mix(in srgb, ${CHIP[tone]} 13%, transparent)` }}>{children}</span>;
const MiniBtn = ({ onClick, children, title, disabled, danger, fb }: { onClick: () => void; children: React.ReactNode; title: string; disabled?: boolean; danger?: boolean; fb?: string }) => <button title={title} aria-label={title} disabled={disabled} onClick={onClick} data-fb={fb} className={cn('w-9 h-8 rounded-lg flex items-center justify-center hover:bg-[var(--surface-3)] disabled:opacity-30', danger ? 'text-[var(--error)]' : 'text-soft')}>{children}</button>;

export function ReasonDialog({ title, kind, onOk, onClose, ops, note, requireNote, danger }: { title: string; kind: string; onOk: (code: string, note?: string) => Promise<any>; onClose: () => void; ops: string[]; note?: string; requireNote?: boolean; danger?: boolean }) {
  const reasons = useReasons(kind);
  const [code, setCode] = useState('');
  const [txt, setTxt] = useState('');
  const [busy, setBusy] = useState(false);
  const rc = reasons.find((r) => r.code === code);
  const needNote = requireNote || rc?.requiresNote;
  return (
    <Modal open onClose={onClose} title={title} badge={<StateBadge ops={ops} />} footer={<><Button variant="ghost" onClick={onClose}>{t('رجوع')}</Button><Button variant={danger ? 'danger' : 'primary'} loading={busy} disabled={!code || (needNote && !txt.trim())} onClick={async () => { setBusy(true); const r = await onOk(code, txt || undefined); setBusy(false); if (r) onClose(); }} data-fb="reason-ok">{t('تنفيذ')}</Button></>}>
      <div className="space-y-4">
        {note && <Banner tone={danger ? 'warning' : 'info'}>{note}</Banner>}
        <Field label={t('السبب')} hint={<Tech>ReasonCodePolicy · {kind}</Tech>}>
          <div className="grid grid-cols-2 gap-1.5">{reasons.map((r) => <button key={r.id} onClick={() => setCode(r.code)} data-fb={`reason:${r.code}`} className={cn('min-h-[48px] px-3 py-2 rounded-xl border text-sm text-start', code === r.code ? 'border-[var(--primary)] bg-[var(--primary-container)] font-bold' : 'border-[var(--glass-border)] surface-1 hover:bg-[var(--surface-2)]')}><div>{L(r.label)}</div>{r.requiresNote && <div className="text-[10px] text-dim font-normal">{t('لازم تكتب ملاحظة')}</div>}<Tech><div className="text-[10px] num text-dim">{r.code}</div></Tech></button>)}</div>
          {reasons.length === 0 && <span className="text-xs text-dim">{t('مفيش أسباب متسجلة للنوع ده — المدير يضيفها من الإعدادات.')}</span>}
        </Field>
        <Field label={needNote ? t('ملاحظة (مطلوبة)') : t('ملاحظة (اختياري)')}><Textarea value={txt} onChange={(e) => setTxt(e.target.value)} maxLength={200} /></Field>
      </div>
    </Modal>
  );
}

function VoidLineDialog({ order, line, onClose }: { order: any; line: any; onClose: () => void }) {
  const { run } = useCommand();
  return <ReasonDialog danger title={`${t('إلغاء صنف اتبعت')}: ${L(line.name)}`} kind="LINE_VOID" ops={['Order.VoidLine', 'Approval.Grant']} onClose={onClose} note={t('الصنف اتبعت للمطبخ فمينفعش يتشال. الإلغاء ممكن يحتاج موافقة مدير، وبيظهر مشطوب على شاشة المطبخ.')}
    onOk={(rc, note) => run('Order.VoidLine', { params: { orderId: order.id, lineId: line.id }, body: { expectedVersion: order.version, reasonCode: rc, reason: note } }, { success: t('الصنف اتلغى') })} />;
}

function KitchenModDialog({ order, line, onClose }: { order: any; line: any; onClose: () => void }) {
  const { run } = useCommand();
  const [txt, setTxt] = useState('');
  const quick = ['مستوية كويس', 'من غير بصل', 'حار زيادة', 'بسرعة لو سمحت'];
  return (
    <Modal open onClose={onClose} title={`${t('ملاحظة للمطبخ')}: ${L(line.name)}`} badge={<StateBadge state="PROPOSED" />} footer={<><Button variant="ghost" onClick={onClose}>{t('رجوع')}</Button><Button variant="primary" disabled={!txt.trim()} onClick={async () => { if (await run('Order.ModifyFiredLine', { params: { orderId: order.id, lineId: line.id }, body: { text: txt } }, { success: t('الملاحظة وصلت للمطبخ') })) onClose(); }}>{t('ابعت الملاحظة')}</Button></>}>
      <div className="space-y-3">
        <p className="text-sm text-dim">{t('الملاحظة بتظهر على نفس الطلب في المطبخ تحت الصنف، من غير ما السعر يتغير.')}</p>
        <div className="flex flex-wrap gap-1.5">{quick.map((q) => <button key={q} onClick={() => setTxt(t(q))} className="h-9 px-3 rounded-lg border border-[var(--glass-border)] surface-1 text-xs hover:bg-[var(--surface-2)]">{t(q)}</button>)}</div>
        <Input value={txt} onChange={(e) => setTxt(e.target.value)} placeholder={t('مثلًا: خليها مستوية كويس')} />
      </div>
    </Modal>
  );
}

function SeatDialog({ order, line, onClose }: { order: any; line: any; onClose: () => void }) {
  const { run } = useCommand();
  const n = Math.max(2, order.guestCount ?? 4);
  return (
    <Modal open onClose={onClose} size="sm" title={`${t('الكرسي')}: ${L(line.name)}`} badge={<StateBadge state="PROPOSED" />}>
      <div className="grid grid-cols-4 gap-2">{[null, ...Array.from({ length: n }, (_, i) => i + 1)].map((s) => <Button key={String(s)} size="lg" variant={line.seat === s ? 'primary' : 'secondary'} onClick={async () => { if (await run('Order.AssignSeat', { params: { orderId: order.id, lineId: line.id }, body: { seat: s } })) onClose(); }}>{s === null ? t('مشترك') : <span className="num">{s}</span>}</Button>)}</div>
    </Modal>
  );
}

function DiscountDialog({ order, onClose }: { order: any; onClose: () => void }) {
  const { run } = useCommand();
  const reasons = useReasons('DISCOUNT');
  const promos = useQuery<any>('Promotion.Find', { query: {} });
  const thr = useQuery<any>('Settings.Effective', { query: { policyId: 'ApprovalRequirementPolicy', scopeType: 'TENANT', scopeId: 'biz' } });
  const [type, setType] = useState<'PERCENTAGE' | 'FIXED_AMOUNT' | 'PROMO'>('PERCENTAGE');
  const [value, setValue] = useState('10');
  const [code, setCode] = useState('');
  const [rc, setRc] = useState('');
  const [note, setNote] = useState('');
  const rule = thr.data?.value?.ORDER_DISCOUNT;
  const live = (promos.data?.items ?? []).filter((p: any) => p.kind === 'AUTOMATIC' && p.liveNow);
  const submit = () => run('Order.ApplyDiscount', { params: { orderId: order.id }, body: { expectedVersion: order.version, discount: type === 'PROMO' ? { promotionCode: code } : { type, value }, reasonCode: type === 'PROMO' ? 'PROMOTION' : rc, reason: note || undefined } }, { success: t('الخصم اتطبق') }).then((r) => { if (r) onClose(); });
  return (
    <Modal open onClose={onClose} title={t('خصم على الشيك')} badge={<StateBadge ops={['Order.ApplyDiscount', 'Promotion.ValidateCode']} />} footer={<><Button variant="ghost" onClick={onClose}>{t('رجوع')}</Button><Button variant="primary" onClick={submit} disabled={type === 'PROMO' ? !code : !rc || !value} data-fb="discount-apply">{t('طبّق الخصم')}</Button></>}>
      <div className="space-y-4">
        <Tabs value={type} onChange={setType} tabs={[{ id: 'PERCENTAGE', label: t('نسبة %') }, { id: 'FIXED_AMOUNT', label: t('مبلغ') }, { id: 'PROMO', label: t('كود عرض') }]} />
        {type !== 'PROMO' ? (
          <>
            <Field label={type === 'PERCENTAGE' ? t('النسبة') : t('المبلغ بالجنيه')}>
              <div className="flex gap-1.5 flex-wrap mb-1.5">{(type === 'PERCENTAGE' ? ['5', '10', '15', '20', '50'] : ['10', '25', '50', '100']).map((x) => <button key={x} onClick={() => setValue(x)} className={cn('h-10 px-3.5 rounded-xl border text-sm font-bold num', value === x ? 'bg-[var(--primary)] text-[var(--primary-foreground)] border-transparent' : 'surface-1 border-[var(--glass-border)]')}>{x}{type === 'PERCENTAGE' ? '%' : ''}</button>)}</div>
              <Input value={value} onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" />
            </Field>
            <Field label={t('السبب')}><Select value={rc} onChange={(e) => setRc(e.target.value)} options={[{ value: '', label: t('اختار السبب') }, ...reasons.map((r) => ({ value: r.code, label: L(r.label) }))]} /></Field>
            <Field label={t('ملاحظة (اختياري)')}><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            {rule && <div className="text-xs text-dim">{t('موافقة المدير')}: {ruleSentence('ORDER_DISCOUNT', rule)}.</div>}
          </>
        ) : (
          <Field label={t('الكود')} hint={t('مثلًا WELCOME50')}><Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className="num" /></Field>
        )}
        <div className="text-[11px] text-dim leading-relaxed">{t('الخصم بيتوزع على الأصناف والخدمة بالتناسب. خصمين على نفس الشيك مش مسموح.')}</div>
        {live.length > 0 && <Banner tone="success">{t('عرض شغال دلوقتي')}: {live.map((p: any) => L(p.name)).join('، ')} — {t('مش بيتطبق لوحده، اختاره من «كود عرض».')}</Banner>}
      </div>
    </Modal>
  );
}

function MoveDialog({ order, siblings, onClose }: { order: any; siblings: any[]; onClose: () => void }) {
  const { run } = useCommand();
  const [ids, setIds] = useState<string[]>([]);
  const [target, setTarget] = useState<string>(siblings.find((c) => c.id !== order.id && c.status === 'DRAFT')?.id ?? 'NEW');
  const active = order.lines.filter((l: any) => l.status === 'ACTIVE');
  const submit = async () => {
    let tid = target;
    let tver: number;
    if (target === 'NEW') {
      const c = await run<any>('Order.Create', { body: { channel: 'DINE_IN', tableId: order.tableId } });
      if (!c) return;
      tid = c.id; tver = c.version;
    } else tver = siblings.find((c) => c.id === target)!.version;
    const r = await run('Order.MoveLines', { params: { orderId: order.id }, body: { expectedVersion: order.version, targetExpectedVersion: tver, targetOrderId: tid, lineIds: ids } }, { success: t('الأصناف اتنقلت') });
    if (r) onClose();
  };
  return (
    <Modal open onClose={onClose} title={t('نقل أصناف لشيك تاني على نفس الترابيزة')} badge={<StateBadge ops={['Order.Create', 'Order.MoveLines']} />} footer={<><Button variant="ghost" onClick={onClose}>{t('رجوع')}</Button><Button variant="primary" disabled={!ids.length} onClick={submit}>{t('انقل')} <span className="num">({ids.length})</span></Button></>}>
      <div className="space-y-3">
        <div className="space-y-1">{active.map((l: any) => <label key={l.id} className={cn('flex items-center gap-2.5 px-3 min-h-[48px] rounded-xl border cursor-pointer', ids.includes(l.id) ? 'border-[var(--primary)] bg-[var(--primary-container)]' : 'surface-1 border-transparent')}><input type="checkbox" className="w-4 h-4" checked={ids.includes(l.id)} onChange={(e) => setIds(e.target.checked ? [...ids, l.id] : ids.filter((x) => x !== l.id))} /><span className="flex-1">{L(l.name)} <span className="num text-dim">×{qty(l.quantity)}</span> {l.fireRound ? <Pill tone="neutral" size="sm">{t('الدفعة')} {l.fireRound}</Pill> : null}</span><span className="num">{money(l.lineTotal)}</span></label>)}</div>
        <Field label={t('على')}><Select value={target} onChange={(e) => setTarget(e.target.value)} options={[...siblings.filter((c) => c.id !== order.id && c.status === 'DRAFT').map((c) => ({ value: c.id, label: `${t('شيك')} ${c.checkNo}` })), { value: 'NEW', label: t('شيك جديد على نفس الترابيزة') }]} /></Field>
        <div className="text-[11px] text-dim">{t('الأصناف اللي اتبعتت بتتنقل زي ما هي (مش بتتبعت للمطبخ تاني)، والشيكين بيتحدثوا مع بعض.')}</div>
      </div>
    </Modal>
  );
}

function SplitDialog({ order, onClose }: { order: any; siblings: any[]; onClose: () => void }) {
  const { run } = useCommand();
  const [mode, setMode] = useState<'EQUAL' | 'BY_SEAT' | 'SHARE_ITEM'>('EQUAL');
  const [parts, setParts] = useState('2');
  const [lineId, setLineId] = useState('');
  const active = order.lines.filter((l: any) => l.status === 'ACTIVE');
  return (
    <Modal open onClose={onClose} title={t('تقسيم الشيك')} badge={<StateBadge ops={['Order.Split']} />} footer={<><Button variant="ghost" onClick={onClose}>{t('رجوع')}</Button><Button variant="primary" disabled={mode === 'SHARE_ITEM' && !lineId} onClick={async () => { if (await run('Order.Split', { params: { orderId: order.id }, body: { expectedVersion: order.version, mode, parts: Number(parts), lineId } }, { success: t('الشيك اتقسم') })) onClose(); }}>{t('قسّم')}</Button></>}>
      <div className="space-y-4">
        <Tabs value={mode} onChange={setMode} tabs={[{ id: 'EQUAL', label: t('بالتساوي') }, { id: 'BY_SEAT', label: t('بالكرسي') }, { id: 'SHARE_ITEM', label: t('صنف مشترك') }]} />
        {mode !== 'BY_SEAT' && <Field label={t('على كام واحد؟')}><div className="flex gap-1.5">{['2', '3', '4', '5', '6'].map((x) => <button key={x} onClick={() => setParts(x)} className={cn('w-12 h-12 rounded-xl border text-lg font-extrabold num', parts === x ? 'bg-[var(--primary)] text-[var(--primary-foreground)] border-transparent' : 'surface-1 border-[var(--glass-border)]')}>{x}</button>)}</div></Field>}
        {mode === 'SHARE_ITEM' && <Field label={t('الصنف')}><Select value={lineId} onChange={(e) => setLineId(e.target.value)} options={[{ value: '', label: t('اختار') }, ...active.map((l: any) => ({ value: l.id, label: `${L(l.name)} ×${qty(l.quantity)} — ${money(l.lineTotal)}` }))]} /></Field>}
        {mode === 'BY_SEAT' && <div className="text-sm text-dim">{t('لازم كل صنف يكون متعيّن لكرسي (زرار الكرسي على كل سطر).')}</div>}
        <Banner tone="info">{t('القروش بتتوزع بحيث مجموع الشيكات يساوي الأصل بالظبط. خصم النسبة بيتطبق على كل شيك، وخصم المبلغ بيتوزع، والخدمة بتتحسب لكل شيك.')}</Banner>
        <div className="text-[11px] text-dim">{t('التقسيم ده اتجاه مقترح لسه مستني قرار. التقسيم بالأصناف موجود فعلًا من «نقل أصناف».')}<Tech> (Order.Split PD_HELD)</Tech></div>
      </div>
    </Modal>
  );
}

function MergeDialog({ order, siblings, onClose }: { order: any; siblings: any[]; onClose: () => void }) {
  const { run } = useCommand();
  const others = siblings.filter((c) => c.id !== order.id && c.status === 'DRAFT');
  const [src, setSrc] = useState(others[0]?.id ?? '');
  return (
    <Modal open onClose={onClose} title={t('دمج شيكين')} badge={<StateBadge ops={['Order.Merge']} />} footer={<><Button variant="ghost" onClick={onClose}>{t('رجوع')}</Button><Button variant="primary" disabled={!src} onClick={async () => { if (await run('Order.Merge', { params: { orderId: order.id }, body: { expectedVersion: order.version, sourceOrderId: src } }, { success: t('الشيكين اتدمجوا') })) onClose(); }}>{t('ادمج هنا')}</Button></>}>
      <Field label={t('الشيك اللي هيتدمج في الشيك ده')}><Select value={src} onChange={(e) => setSrc(e.target.value)} options={others.map((c) => ({ value: c.id, label: `${t('شيك')} ${c.checkNo} — ${money(c.payable)}` }))} /></Field>
    </Modal>
  );
}

function ChannelDialog({ order, onClose }: { order: any; onClose: () => void }) {
  const { run } = useCommand();
  const tables = useQuery<any>('Table.List', { query: {} });
  const [tableId, setTableId] = useState('');
  const toDine = order.channel === 'TAKEAWAY';
  return (
    <Modal open onClose={onClose} title={toDine ? t('حوّل الطلب لصالة') : t('حوّل الطلب لتيك أواي')} badge={<StateBadge ops={['Order.ChangeChannel']} />} footer={<><Button variant="ghost" onClick={onClose}>{t('رجوع')}</Button><Button variant="primary" disabled={toDine && !tableId} onClick={async () => { if (await run('Order.ChangeChannel', { params: { orderId: order.id }, body: { expectedVersion: order.version, channel: toDine ? 'DINE_IN' : 'TAKEAWAY', tableId: tableId || undefined } }, { success: t('نوع الطلب اتغير') })) onClose(); }}>{toDine ? t('حوّل لصالة') : t('حوّل لتيك أواي')}</Button></>}>
      <div className="space-y-3">
        <p className="text-sm text-dim">{t('الأصناف وأسعارها واللي اتبعت للمطبخ بيفضلوا زي ما هم. الخدمة بتتحسب حسب النوع الجديد.')}</p>
        {toDine ? <Field label={t('الترابيزة (لازم تكون مفتوحة)')}><Select value={tableId} onChange={(e) => setTableId(e.target.value)} options={[{ value: '', label: t('اختار') }, ...(tables.data?.items ?? []).filter((x: any) => x.occupancy).map((x: any) => ({ value: x.id, label: `${t('ترابيزة')} ${x.name}` }))]} /></Field> : <div className="text-xs text-dim">{t('التيك أواي محتاج وردية درج مفتوحة على الجهاز ده.')}</div>}
      </div>
    </Modal>
  );
}

export function HistoryDialog({ order, onClose }: { order: any; onClose: () => void }) {
  const tl = useQuery<any>('Order.Timeline', { params: { orderId: order.id } });
  const items = (tl.data?.items ?? []).map((h: any, i: number) => ({
    id: i,
    title: typeof h.text === 'string' ? h.text : L(h.text),
    time: time(h.at),
    text: [h.byName ? personName(null, h.byName) : h.by ? personName(h.by) : '', h.terminal ? deviceName(h.terminal) : ''].filter(Boolean).join(' · '),
    meta: <Tech><span className="num text-[10px] text-dim">{h.by ?? ''} {h.terminal ?? ''}</span></Tech>,
  }));
  return (
    <Modal open onClose={onClose} wide title={`${t('سجل الشيك')} #${order.number}`} badge={<StateBadge ops={['Order.Timeline']} />} description={t('مفيش حاجة مالية بتتعدل أو تتمسح: أي تصحيح بيتسجل كحركة جديدة مربوطة بالأصل.')}>
      {tl.loading && !tl.data ? <Skeleton lines={6} /> : <Timeline items={items} />}
    </Modal>
  );
}
