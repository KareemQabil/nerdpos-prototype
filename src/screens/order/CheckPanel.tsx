// C2–C4: the check. Lines by round; fired lines are locked (only void with approval, move, or a kitchen
// modification); unfired lines stay editable. Totals come from the server preview.
import React, { useMemo, useState } from 'react';
import { ChefHat, Minus, Plus, Trash2, Ban, ArrowRightLeft, Send, Lock, Tag, Gift, XCircle, Printer, Wallet, Split, Merge, PenLine, Armchair, RefreshCw, History, CheckCircle2, Clock, AlertTriangle, Shuffle, Receipt } from 'lucide-react';
import { useDev, useQuery, useCommand } from '../../app/hooks';
import { Button, Pill, Modal, Field, Select, Input, Textarea, Money, StateBadge, Banner, Spinner, Empty, KV, Tabs } from '../../ui';
import { t, L } from '../../i18n';
import { cn, money, qty, time } from '../../lib/format';
import { ALLERGEN_AR } from './MenuGrid';
import { CustomerChip } from '../customers/common'; // crm area: customer on the check

export function useReasons(kind: string) {
  const r = useQuery<any>('ReasonCode.List', { query: { kind, active: true } });
  return (r.data?.items ?? []) as any[];
}

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
  const T = order.totals;
  const v = order.version;

  const fire = () => run('Order.Fire', { params: { orderId: order.id }, body: { expectedVersion: v } }, { success: t('اتبعت للمطبخ'), label: t('إرسال للمطبخ') });
  const qtyChange = (l: any, d: number) => {
    const n = Math.round(Number(l.quantity) + d);
    if (n < 1) return run('Order.RemoveLine', { params: { orderId: order.id, lineId: l.id }, query: { expectedVersion: v, expectedLineVersion: l.version }, body: { expectedVersion: v, expectedLineVersion: l.version } });
    return run('Order.UpdateLine', { params: { orderId: order.id, lineId: l.id }, body: { expectedVersion: v, expectedLineVersion: l.version, quantity: String(n) } });
  };

  return (
    <div className="flex flex-col h-full min-h-0 rounded-2xl overflow-hidden border border-[var(--glass-border)] bg-slate-900/70 backdrop-blur-2xl" data-fb="check-panel">
      {/* header */}
      <div className="px-4 py-3 border-b line space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="font-bold flex items-center gap-2 flex-wrap">{order.kind === 'STAFF_MEAL' ? t('وجبة موظف') : order.tableName ? `${t('ترابيزة')} ${order.tableName}` : order.channel === 'TAKEAWAY' ? t('تيك أواي') : order.channel === 'DELIVERY' ? t('دليفري') : t('صالة كاونتر')}{order.tableName && <span className="text-dim font-normal text-sm">· {t('شيك')} {order.checkNo}</span>}<StatusPill s={order.status} /></div>
            <div className="text-[11px] text-dim num">#{order.number} · v{order.version} · {order.serverName} · {order.sessionId ? t('على وردية درج') : t('شيك صالة من غير درج')}</div>
          </div>
          <div className="flex gap-1">
            <button title={t('السجل')} onClick={() => setShowHist(true)} className="w-8 h-8 rounded-lg surface-1 flex items-center justify-center"><History className="w-4 h-4" /></button>
          </div>
        </div>
        {order.kind !== 'STAFF_MEAL' && <CustomerChip order={order} />}
        {siblings.length > 1 && (
          <div className="flex gap-1 overflow-x-auto scrollbar-hide">{siblings.map((c: any) => <button key={c.id} onClick={() => onCheckSwitch?.(c.id)} className={cn('px-2.5 h-7 rounded-lg text-xs border whitespace-nowrap', c.id === order.id ? 'bg-[var(--primary)] text-[var(--primary-foreground)] border-transparent font-bold' : 'surface-1 border-[var(--glass-border)]')}>{t('شيك')} {c.checkNo} · <span className="num">{money(c.payable, false)}</span></button>)}</div>
        )}
      </div>

      {/* lines */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {order.lines.length === 0 && <Empty icon={<Receipt className="w-10 h-10" />} text={t('الشيك فاضي — اختار أصناف من المنيو')} />}
        {rounds.map((r) => {
          const info = roundInfo(r);
          const lines = order.lines.filter((l: any) => l.fireRound === r && l.status !== 'REMOVED');
          return (
            <div key={r} className="rounded-xl border line">
              <div className="flex items-center justify-between px-3 py-1.5 surface-1 rounded-t-xl text-xs">
                <span className="font-bold flex items-center gap-1"><ChefHat className="w-3.5 h-3.5" />{t('الجولة')} {r}{info?.via === 'CONFIRM' && <span className="text-dim font-normal"> · {t('مع التأكيد')}</span>}</span>
                <RoundStatus info={info} orderId={order.id} />
              </div>
              <div className="divide-y divide-[var(--line)]">{lines.map((l: any) => <LineRow key={l.id} l={l} locked draft={draft} onVoid={() => setDlg({ k: 'void', line: l })} onMod={() => setDlg({ k: 'kmod', line: l })} onSeat={() => setDlg({ k: 'seat', line: l })} seats={!!seatsP.data?.value && mode === 'FLOOR'} />)}</div>
            </div>
          );
        })}
        {unfired.length > 0 && (
          <div className="rounded-xl border border-dashed border-[color-mix(in_srgb,var(--primary)_40%,transparent)]">
            <div className="px-3 py-1.5 text-xs font-bold text-[var(--primary)] flex items-center justify-between">{t('لسه ما اتبعتش')} <span className="text-dim font-normal">{t('ينفع تعدل أو تشيل')}</span></div>
            <div className="divide-y divide-[var(--line)]">{unfired.map((l: any) => <LineRow key={l.id} l={l} draft={draft} onQty={(d) => qtyChange(l, d)} onRemove={() => qtyChange(l, -999)} onSeat={() => setDlg({ k: 'seat', line: l })} seats={!!seatsP.data?.value && mode === 'FLOOR'} busy={busy} />)}</div>
          </div>
        )}
        {order.lines.filter((l: any) => l.status === 'REMOVED').length > 0 && <div className="text-[11px] text-dim">{t('أصناف اتشالت قبل الإرسال')}: {order.lines.filter((l: any) => l.status === 'REMOVED').map((l: any) => L(l.name)).join('، ')}</div>}
        {order.discounts.filter((d: any) => d.active).map((d: any) => (
          <div key={d.id} className="flex items-center justify-between text-xs rounded-lg px-3 py-2 bg-red-500/10 border border-red-500/30">
            <span className="flex items-center gap-1"><Tag className="w-3.5 h-3.5" />{d.label ? L(d.label) : t('خصم')} {d.type === 'PERCENTAGE' ? `${d.value}%` : money(d.value)} · {d.reasonCode}{d.approvalGrantId ? ` · ${t('بموافقة')}` : ''}</span>
            {draft && <button className="text-[var(--error)]" onClick={() => run('Order.RemoveDiscount', { params: { orderId: order.id, discountId: d.id }, body: {} })}><XCircle className="w-4 h-4" /></button>}
          </div>
        ))}
        {order.comp && <Banner tone="success">{t('ضيافة كاملة')} · {order.comp.reasonCode}</Banner>}
      </div>

      {/* totals (server) */}
      <div className="border-t line bg-slate-950/60 p-4 space-y-1.5 text-sm" data-fb="check-totals">
        <Row k={t('المجموع')} v={T.itemsSubtotal} />
        {T.discountTotal !== '0.0000' && !T.comp && <Row k={t('الخصم')} v={'-' + T.discountTotal} tone="error" />}
        {T.serviceRate && <Row k={`${t('خدمة')} ${T.serviceRate}%`} v={T.serviceCharge} sub={t('سطر لوحده — مش جزء من صافي المبيعات')} />}
        {!T.serviceRate && order.channel === 'DINE_IN' && order.service && <div className="text-[11px] text-dim">{t('مفيش خدمة على الشيك ده')} ({order.service.origin})</div>}
        {T.charges.map((c: any) => <Row key={c.id} k={<span className="flex items-center gap-1">{L(c.label)} <StateBadge state="PROPOSED" /></span>} v={c.amount} />)}
        {T.tableTax !== '0.0000' && <Row k={<span className="flex items-center gap-1">{t('ضريبة الجدول')} <StateBadge state="PROPOSED" /></span>} v={T.tableTax} />}
        {T.taxLines.map((x: any, i: number) => <Row key={i} k={`${L(x.name)} ${x.rate}%`} v={x.amount} />)}
        <div className="border-t line pt-2 flex items-center justify-between"><span className="font-bold text-lg">{t('الإجمالي')}</span><Money v={T.payable} big tone="primary" /></div>
        <div className="text-[10px] text-dim">{t('كل الأرقام من السيرفر')} · {order.policy.pricingOrder} · {order.policy.rounding.mode}/{order.policy.rounding.scale}</div>
        {order.settlement && <div className="text-xs flex justify-between"><span className="text-dim">{t('المدفوع / المتبقي')}</span><span className="num">{money(order.settlement.paid)} / <b>{money(order.settlement.remaining)}</b></span></div>}
      </div>

      {/* actions */}
      <div className="border-t line p-3 space-y-2">
        {draft && order.kind !== 'STAFF_MEAL' && (
          <>
            {showFire ? (
              <Button data-fb="send-round" variant="primary" size="lg" className="w-full" disabled={!unfired.length || busy} onClick={fire}><Send className="w-5 h-5" />{t('ابعت للمطبخ')} {unfired.length ? `(${unfired.length})` : ''}</Button>
            ) : (
              <div className="text-[11px] text-dim text-center">{t('الإرسال للمطبخ بيحصل وقت التأكيد (FireTimingPolicy AT_CONFIRM)')}</div>
            )}
            <div className="grid grid-cols-4 gap-1.5">
              <Act icon={<Tag />} label={t('خصم')} onClick={() => setDlg({ k: 'discount' })} disabled={!active.length} perm={can('order:applydiscount')} />
              <Act icon={<Gift />} label={t('ضيافة')} onClick={() => setDlg({ k: 'comp' })} disabled={!active.length} perm={can('order:comp')} />
              {order.visitId && <Act icon={<ArrowRightLeft />} label={t('نقل أصناف')} onClick={() => setDlg({ k: 'move' })} disabled={!active.length} perm={can('order:updateline')} />}
              {order.visitId && <Act icon={<Split />} label={t('تقسيم')} onClick={() => setDlg({ k: 'split' })} disabled={!active.length} perm={can('order:updateline')} proposed />}
              {order.visitId && siblings.length > 1 && <Act icon={<Merge />} label={t('دمج')} onClick={() => setDlg({ k: 'merge' })} perm={can('order:updateline')} proposed />}
              <Act icon={<Shuffle />} label={t('تغيير القناة')} onClick={() => setDlg({ k: 'channel' })} perm={can('order:changechannel')} proposed />
              <Act icon={<Printer />} label={t('شيك مبدئي')} onClick={() => run('Print.PreBill', { params: { orderId: order.id }, body: { terminalId: auth.terminalId } }, { success: t('اتبعت شيك مبدئي للطابعة (ليس فاتورة ضريبية)') })} disabled={!active.length} proposed />
              {rounds.length === 0 ? <Act icon={<XCircle />} label={t('إلغاء الشيك')} onClick={() => setDlg({ k: 'cancel' })} perm={can('order:cancel')} danger /> : <Act icon={<Ban />} label={t('إلغاء بعد الإرسال')} onClick={() => setDlg({ k: 'voidOrder' })} perm={can('order:void')} danger />}
            </div>
          </>
        )}
        {order.status === 'CONFIRMED' && can('order:void') && <Button variant="danger" size="sm" className="w-full" onClick={() => setDlg({ k: 'voidOrder' })}><Ban className="w-4 h-4" />{t('إلغاء الشيك (موافقة مدير)')}</Button>}
        {(draft || order.status === 'CONFIRMED') && can('payment:capture') && kind !== 'FLOOR' && <Button data-fb="go-pay" variant="success" size="lg" className="w-full" disabled={!active.length} onClick={() => nav('pay', { orderId: order.id, back: mode === 'COUNTER' ? 'counter' : 'order' })}><Wallet className="w-5 h-5" />{draft ? t('تأكيد وتحصيل') : t('تحصيل')}</Button>}
        {draft && kind === 'FLOOR' && order.visitId && <div className="text-[11px] text-dim text-center">{t('التحصيل بيكون على جهاز الكاشير اللي فيه درج مفتوح (CollectionScopePolicy)')}</div>}
        {order.status === 'COMPLETED' && <Button variant="secondary" className="w-full" onClick={() => nav('receipt', { orderId: order.id })}><Receipt className="w-4 h-4" />{t('الإيصال')}</Button>}
      </div>

      {dlg?.k === 'void' && <VoidLineDialog order={order} line={dlg.line} onClose={() => setDlg(null)} />}
      {dlg?.k === 'kmod' && <KitchenModDialog order={order} line={dlg.line} onClose={() => setDlg(null)} />}
      {dlg?.k === 'seat' && <SeatDialog order={order} line={dlg.line} onClose={() => setDlg(null)} />}
      {dlg?.k === 'discount' && <DiscountDialog order={order} onClose={() => setDlg(null)} />}
      {dlg?.k === 'comp' && <ReasonDialog title={t('ضيافة (شيك مجاني)')} kind="COMP" ops={['Order.Comp']} onClose={() => setDlg(null)} onOk={(rc, note) => run('Order.Comp', { params: { orderId: order.id }, body: { expectedVersion: v, reasonCode: rc, reason: note } }, { success: t('اتعملت ضيافة') })} note={t('ComplimentaryOrderPolicy: خصم كامل والمطلوب صفر. موافقة ORDER_COMP مقترحة (مش في approval_actions.json).')} />}
      {dlg?.k === 'cancel' && <ReasonDialog title={t('إلغاء شيك ما اتبعتش')} kind="ORDER_CANCEL" ops={['Order.Cancel']} onClose={() => setDlg(null)} onOk={(rc, note) => run('Order.Cancel', { params: { orderId: order.id }, body: { expectedVersion: v, reasonCode: rc, reason: note } }, { success: t('الشيك اتلغى') })} note={t('الإلغاء للشيك اللي مفيهوش ولا صنف اتبعت للمطبخ.')} />}
      {dlg?.k === 'voidOrder' && <ReasonDialog title={t('إلغاء شيك بعد الإرسال')} kind="ORDER_VOID" ops={['Order.Void', 'Approval.Grant']} requireNote onClose={() => setDlg(null)} onOk={(rc, note) => run('Order.Void', { params: { orderId: order.id }, body: { expectedVersion: v, reasonCode: rc, reason: note } }, { success: t('الشيك اتلغى بالكامل') })} note={t('محتاج موافقة مدير دايمًا (ORDER_VOID). شيك عليه مدفوعات مينفعش يتلغي — يتعمل مرتجع.')} />}
      {dlg?.k === 'move' && <MoveDialog order={order} siblings={siblings} onClose={() => setDlg(null)} />}
      {dlg?.k === 'split' && <SplitDialog order={order} siblings={siblings} onClose={() => setDlg(null)} />}
      {dlg?.k === 'merge' && <MergeDialog order={order} siblings={siblings} onClose={() => setDlg(null)} />}
      {dlg?.k === 'channel' && <ChannelDialog order={order} onClose={() => setDlg(null)} />}
      {showHist && <HistoryDialog order={order} onClose={() => setShowHist(false)} />}
    </div>
  );
}

export function StatusPill({ s }: { s: string }) {
  const m: Record<string, [string, any]> = { DRAFT: ['مفتوح', 'primary'], CONFIRMED: ['متأكد — مستني الدفع', 'warning'], COMPLETED: ['اتقفل', 'success'], CANCELLED: ['ملغي', 'neutral'], VOIDED: ['ملغي بموافقة', 'error'], MERGED: ['اتدمج', 'neutral'] };
  const [ar, tone] = m[s] ?? [s, 'neutral'];
  return <Pill tone={tone}>{t(ar)}</Pill>;
}

function Row({ k, v, tone, sub }: { k: React.ReactNode; v: string; tone?: 'error'; sub?: string }) {
  return <div className="flex items-start justify-between gap-2"><span className="text-dim">{k}{sub && <span className="block text-[10px]">{sub}</span>}</span><Money v={v} tone={tone} className="text-sm" /></div>;
}

function Act({ icon, label, onClick, disabled, perm = true, danger, proposed }: { icon: React.ReactElement; label: string; onClick: () => void; disabled?: boolean; perm?: boolean; danger?: boolean; proposed?: boolean }) {
  if (!perm) return null;
  return (
    <button data-fb={`check-action:${label}`} onClick={onClick} disabled={disabled} className={cn('relative h-14 rounded-lg flex flex-col items-center justify-center gap-0.5 text-[10px] border transition-colors disabled:opacity-30', danger ? 'border-red-500/40 text-red-300 bg-red-500/10 hover:bg-red-500/20' : 'border-[var(--glass-border)] surface-1 hover:surface-2')}>
      {React.cloneElement(icon, { className: 'w-4 h-4' })}<span className="leading-tight text-center">{label}</span>
      {proposed && <span className="absolute top-0.5 end-0.5 w-1.5 h-1.5 rounded-full bg-purple-400" title={t('مقترح')} />}
    </button>
  );
}

function RoundStatus({ info, orderId }: { info: any; orderId: string }) {
  const { run, busy } = useCommand();
  const d = info?.delivery;
  if (!d) return <Pill tone="neutral"><Clock className="w-3 h-3" />{t('في الطريق')}</Pill>;
  if (d.state === 'DELIVERED') return <Pill tone="success" title={`${d.ticketIds.length} tickets`}><CheckCircle2 className="w-3 h-3" />{t('اتبعت')} · {time(info.firedAt)}</Pill>;
  if (d.state === 'PENDING') return <Pill tone="warning"><Clock className="w-3 h-3" />{t('معلّق')}</Pill>;
  return (
    <span className="flex items-center gap-1"><Pill tone="error" title={d.lastError}><AlertTriangle className="w-3 h-3" />{t('ما وصلش المطبخ')}</Pill>
      <button disabled={busy} onClick={() => run('Kitchen.Resend', { params: { orderId }, body: {} }, { success: t('اتعاد الإرسال — من غير تكرار للتذكرة') })} className="text-[10px] px-2 py-0.5 rounded bg-[var(--primary)] text-[var(--primary-foreground)] font-bold flex items-center gap-1"><RefreshCw className="w-3 h-3" />{t('إعادة إرسال')}</button>
    </span>
  );
}

function LineRow({ l, locked, draft, onQty, onRemove, onVoid, onMod, onSeat, seats, busy }: { l: any; locked?: boolean; draft: boolean; onQty?: (d: number) => void; onRemove?: () => void; onVoid?: () => void; onMod?: () => void; onSeat?: () => void; seats?: boolean; busy?: boolean }) {
  const voided = l.status === 'VOIDED';
  return (
    <div className={cn('px-3 py-2 text-sm', voided && 'opacity-60')} data-fb={`line:${l.sku}`}>
      <div className="flex items-start gap-2">
        <span className="shrink-0 min-w-7 h-7 px-1 rounded-lg bg-cyan-500/20 text-cyan-300 font-bold text-sm flex items-center justify-center num">{qty(l.quantity)}</span>
        <div className="flex-1 min-w-0">
          <div className={cn('font-bold leading-tight', voided && 'line-through')}>{L(l.name)} {l.seat ? <span className="text-[10px] px-1 rounded bg-white/10 font-normal">{t('كرسي')} {l.seat}</span> : null}{l.shareOf ? <span className="text-[10px] text-dim font-normal"> · {t('حصة')} {l.shareOf.index}/{l.shareOf.parts}</span> : null}</div>
          {(l.variant || l.modifiers.length > 0 || l.children?.length) && (
            <div className="flex flex-wrap gap-1 mt-1">
              {l.variant && <span className="px-1.5 rounded bg-purple-500/15 text-purple-300 text-[10px]">{L(l.variant.name)}</span>}
              {l.modifiers.map((m: any) => <span key={m.optionId} className="px-1.5 rounded bg-orange-500/10 text-orange-300 text-[10px]">{L(m.name)}{m.priceDelta !== '0.0000' && <span className="num"> +{money(m.priceDelta, false)}</span>}</span>)}
              {l.children?.map((c: any, i: number) => <span key={i} className="px-1.5 rounded bg-sky-500/10 text-sky-300 text-[10px]">{L(c.name)}{c.detail ? ` (${L(c.detail)})` : ''}{c.upcharge !== '0.0000' && <span className="num"> +{money(c.upcharge, false)}</span>}</span>)}
            </div>
          )}
          {l.note && <div className="text-[11px] text-amber-300 mt-0.5">✎ {l.note}</div>}
          {l.allergens?.length ? <div className="text-[10px] text-amber-400">⚠ {l.allergens.map((a: string) => ALLERGEN_AR[a] ?? a).join('، ')}</div> : null}
          {l.kitchenMods?.map((m: any) => <div key={m.id} className="text-[11px] text-sky-300">{t('تعديل')}: {m.text}</div>)}
          {voided && <div className="text-[11px] text-[var(--error)]">{t('ملغي')} · {l.voided.reasonCode} · {l.voided.disposition === 'WASTE' ? t('هالك') : l.voided.disposition === 'NOT_PREPARED' ? t('ما اتعملش') : l.voided.disposition}</div>}
          {l.movedFrom && <div className="text-[10px] text-dim">{t('اتنقل من شيك تاني')}</div>}
        </div>
        <div className="text-end shrink-0"><div className={cn('num font-bold text-cyan-300', voided && 'line-through')}>{money(l.lineTotal)}</div><div className="num text-[10px] text-dim">{money(l.unitTotal, false)} × {qty(l.quantity)}</div></div>
      </div>
      {draft && !voided && (
        <div className="flex items-center gap-1 mt-1.5 ms-9">
          {locked ? (
            <>
              <span className="text-[10px] text-dim flex items-center gap-1 me-auto"><Lock className="w-3 h-3" />{t('اتبعت — التعديل والحذف مقفولين')}</span>
              {seats && <MiniBtn onClick={onSeat!} title={t('كرسي')}><Armchair className="w-3.5 h-3.5" /></MiniBtn>}
              <MiniBtn onClick={onMod!} title={t('تعديل للمطبخ')}><PenLine className="w-3.5 h-3.5" /></MiniBtn>
              <button data-fb="void-line" onClick={onVoid} className="h-7 px-2 rounded-md text-[11px] bg-red-500/10 text-red-300 border border-red-500/40 flex items-center gap-1"><Ban className="w-3 h-3" />{t('إلغاء')}</button>
            </>
          ) : (
            <>
              <div className="flex items-center gap-0.5 bg-white/[0.04] rounded-lg p-0.5 me-auto">
                <MiniBtn onClick={() => onQty!(-1)} disabled={busy} title="-"><Minus className="w-3.5 h-3.5" /></MiniBtn>
                <span className="w-7 text-center num font-bold">{qty(l.quantity)}</span>
                <MiniBtn onClick={() => onQty!(1)} disabled={busy} title="+"><Plus className="w-3.5 h-3.5" /></MiniBtn>
              </div>
              {seats && <MiniBtn onClick={onSeat!} title={t('كرسي')}><Armchair className="w-3.5 h-3.5" /></MiniBtn>}
              <MiniBtn onClick={onRemove!} title={t('شيل')}><Trash2 className="w-3.5 h-3.5 text-red-300" /></MiniBtn>
            </>
          )}
        </div>
      )}
    </div>
  );
}
const MiniBtn = ({ onClick, children, title, disabled }: { onClick: () => void; children: React.ReactNode; title: string; disabled?: boolean }) => <button title={title} disabled={disabled} onClick={onClick} className="w-7 h-7 rounded-md flex items-center justify-center text-white/70 hover:bg-white/10 disabled:opacity-30">{children}</button>;

export function ReasonDialog({ title, kind, onOk, onClose, ops, note, requireNote }: { title: string; kind: string; onOk: (code: string, note?: string) => Promise<any>; onClose: () => void; ops: string[]; note?: string; requireNote?: boolean }) {
  const reasons = useReasons(kind);
  const [code, setCode] = useState('');
  const [txt, setTxt] = useState('');
  const [busy, setBusy] = useState(false);
  const rc = reasons.find((r) => r.code === code);
  const needNote = requireNote || rc?.requiresNote;
  return (
    <Modal open onClose={onClose} title={title} badge={<StateBadge ops={ops} />} footer={<><Button variant="ghost" onClick={onClose}>{t('رجوع')}</Button><Button variant="primary" loading={busy} disabled={!code || (needNote && !txt.trim())} onClick={async () => { setBusy(true); const r = await onOk(code, txt || undefined); setBusy(false); if (r) onClose(); }}>{t('تنفيذ')}</Button></>}>
      <div className="space-y-3">
        {note && <Banner tone="info">{note}</Banner>}
        <Field label={t('السبب')} hint={`ReasonCodePolicy · ${kind}`}>
          <div className="grid grid-cols-2 gap-1.5">{reasons.map((r) => <button key={r.id} onClick={() => setCode(r.code)} className={cn('px-3 py-2 rounded-xl border text-sm text-start', code === r.code ? 'border-[var(--primary)] bg-[var(--primary-container)]' : 'border-[var(--glass-border)] surface-1')}><div className="font-bold">{L(r.label)}</div><div className="text-[10px] num text-dim">{r.code}{r.requiresNote ? ' · ' + t('لازم ملاحظة') : ''}</div></button>)}</div>
          {reasons.length === 0 && <span className="text-xs text-dim">{t('مفيش أسباب معتمدة للنوع ده — ضيفها من الإعدادات')}</span>}
        </Field>
        <Field label={needNote ? t('ملاحظة (مطلوبة)') : t('ملاحظة (اختياري)')}><Textarea value={txt} onChange={(e) => setTxt(e.target.value)} maxLength={200} /></Field>
      </div>
    </Modal>
  );
}

function VoidLineDialog({ order, line, onClose }: { order: any; line: any; onClose: () => void }) {
  const { run } = useCommand();
  return <ReasonDialog title={`${t('إلغاء صنف اتبعت')}: ${L(line.name)}`} kind="LINE_VOID" ops={['Order.VoidLine', 'Approval.Grant']} onClose={onClose} note={t('الصنف اتبعت للمطبخ، فمينفعش يتشال. الإلغاء محتاج موافقة مدير حسب السياسة (LINE_VOID)، وبيظهر مشطوب على شاشة المطبخ.')}
    onOk={(rc, note) => run('Order.VoidLine', { params: { orderId: order.id, lineId: line.id }, body: { expectedVersion: order.version, reasonCode: rc, reason: note } }, { success: t('الصنف اتلغى') })} />;
}

function KitchenModDialog({ order, line, onClose }: { order: any; line: any; onClose: () => void }) {
  const { run } = useCommand();
  const [txt, setTxt] = useState('');
  return (
    <Modal open onClose={onClose} title={`${t('تعديل للمطبخ')}: ${L(line.name)}`} badge={<StateBadge state="PROPOSED" />} footer={<Button variant="primary" disabled={!txt.trim()} onClick={async () => { if (await run('Order.ModifyFiredLine', { params: { orderId: order.id, lineId: line.id }, body: { text: txt } }, { success: t('التعديل وصل التذكرة') })) onClose(); }}>{t('ابعت التعديل')}</Button>}>
      <div className="space-y-2"><Banner tone="info">{t('تغيير بعد الإرسال (الاستواء، زيادة…) بيظهر على نفس التذكرة كـ "تعديل" مربوط بالسطر الأصلي، من غير تغيير السعر.')}</Banner><Input value={txt} onChange={(e) => setTxt(e.target.value)} placeholder={t('مثلًا: خليها مستوية كويس')} /></div>
    </Modal>
  );
}

function SeatDialog({ order, line, onClose }: { order: any; line: any; onClose: () => void }) {
  const { run } = useCommand();
  const n = Math.max(2, order.guestCount ?? 4);
  return (
    <Modal open onClose={onClose} title={`${t('الكرسي')}: ${L(line.name)}`} badge={<StateBadge state="PROPOSED" />}>
      <div className="flex gap-2 flex-wrap">{[null, ...Array.from({ length: n }, (_, i) => i + 1)].map((s) => <Button key={String(s)} variant={line.seat === s ? 'primary' : 'secondary'} onClick={async () => { if (await run('Order.AssignSeat', { params: { orderId: order.id, lineId: line.id }, body: { seat: s } })) onClose(); }}>{s ?? '—'}</Button>)}</div>
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
    <Modal open onClose={onClose} title={t('خصم على الشيك')} badge={<StateBadge ops={['Order.ApplyDiscount', 'Promotion.ValidateCode']} />} footer={<><Button variant="ghost" onClick={onClose}>{t('رجوع')}</Button><Button variant="primary" onClick={submit} disabled={type === 'PROMO' ? !code : !rc || !value}>{t('طبّق')}</Button></>}>
      <div className="space-y-3">
        <Tabs value={type} onChange={setType} tabs={[{ id: 'PERCENTAGE', label: t('نسبة %') }, { id: 'FIXED_AMOUNT', label: t('مبلغ') }, { id: 'PROMO', label: t('كود عرض') }]} />
        {type !== 'PROMO' ? (
          <>
            <Field label={type === 'PERCENTAGE' ? t('النسبة') : t('المبلغ')}><Input value={value} onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" /></Field>
            <Field label={t('السبب')}><Select value={rc} onChange={(e) => setRc(e.target.value)} options={[{ value: '', label: t('اختار') }, ...reasons.map((r) => ({ value: r.code, label: `${L(r.label)} (${r.code})` }))]} /></Field>
            <Field label={t('ملاحظة')}><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            {rule && <div className="text-[11px] text-dim">{t('قاعدة الموافقة الحالية')}: <span className="num">{rule.mode}{rule.field ? ` ${rule.field} > ${rule.threshold}` : ''}</span> — {t('فوقها هتظهر شاشة موافقة المدير.')}</div>}
          </>
        ) : (
          <Field label={t('الكود')} hint="WELCOME50"><Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} /></Field>
        )}
        <div className="text-[11px] text-dim">{t('الخصم بيقلل الأصناف والخدمة بالتناسب. PricingOrderPolicy بيحدد قبل الضريبة ولا بعدها. التجميع ممنوع افتراضيًا (DiscountStackingPolicy).')}</div>
        {live.length > 0 && <Banner tone="success">{t('عرض شغال دلوقتي')}: {live.map((p: any) => L(p.name)).join('، ')} — {t('مش بيتطبق لوحده (autoApply مقفول)')}</Banner>}
      </div>
    </Modal>
  );
}

function MoveDialog({ order, siblings, onClose }: { order: any; siblings: any[]; onClose: () => void }) {
  const { run } = useCommand();
  const { auth } = useDev();
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
    const r = await run('Order.MoveLines', { params: { orderId: order.id }, body: { expectedVersion: order.version, targetExpectedVersion: tver, targetOrderId: tid, lineIds: ids } }, { success: t('الأصناف اتنقلت — الجولات محفوظة') });
    if (r) onClose();
  };
  return (
    <Modal open onClose={onClose} title={t('نقل أصناف لشيك تاني على نفس الترابيزة')} badge={<StateBadge ops={['Order.Create', 'Order.MoveLines']} />} footer={<><Button variant="ghost" onClick={onClose}>{t('رجوع')}</Button><Button variant="primary" disabled={!ids.length} onClick={submit}>{t('انقل')} ({ids.length})</Button></>}>
      <div className="space-y-3">
        <div className="space-y-1">{active.map((l: any) => <label key={l.id} className="flex items-center gap-2 px-3 py-2 rounded-xl surface-1 cursor-pointer"><input type="checkbox" checked={ids.includes(l.id)} onChange={(e) => setIds(e.target.checked ? [...ids, l.id] : ids.filter((x) => x !== l.id))} /><span className="flex-1">{L(l.name)} ×{qty(l.quantity)} {l.fireRound ? <Pill tone="neutral">{t('الجولة')} {l.fireRound}</Pill> : null}</span><span className="num">{money(l.lineTotal)}</span></label>)}</div>
        <Field label={t('على')}><Select value={target} onChange={(e) => setTarget(e.target.value)} options={[...siblings.filter((c) => c.id !== order.id && c.status === 'DRAFT').map((c) => ({ value: c.id, label: `${t('شيك')} ${c.checkNo}` })), { value: 'NEW', label: t('شيك جديد على نفس الترابيزة') }]} /></Field>
        <div className="text-[11px] text-dim">{t('الأصناف اللي اتبعتت بتتنقل بجولاتها؛ الشيكين بيتحدثوا مع بعض (CAS).')}</div>
      </div>
    </Modal>
  );
}

function SplitDialog({ order, siblings, onClose }: { order: any; siblings: any[]; onClose: () => void }) {
  const { run } = useCommand();
  const [mode, setMode] = useState<'EQUAL' | 'BY_SEAT' | 'SHARE_ITEM'>('EQUAL');
  const [parts, setParts] = useState('2');
  const [lineId, setLineId] = useState('');
  const active = order.lines.filter((l: any) => l.status === 'ACTIVE');
  return (
    <Modal open onClose={onClose} title={t('تقسيم الشيك')} badge={<StateBadge ops={['Order.Split']} />} footer={<><Button variant="ghost" onClick={onClose}>{t('رجوع')}</Button><Button variant="primary" disabled={mode === 'SHARE_ITEM' && !lineId} onClick={async () => { if (await run('Order.Split', { params: { orderId: order.id }, body: { expectedVersion: order.version, mode, parts: Number(parts), lineId } }, { success: t('الشيك اتقسم') })) onClose(); }}>{t('قسّم')}</Button></>}>
      <div className="space-y-3">
        <Tabs value={mode} onChange={setMode} tabs={[{ id: 'EQUAL', label: t('بالتساوي على N') }, { id: 'BY_SEAT', label: t('بالكرسي') }, { id: 'SHARE_ITEM', label: t('صنف مشترك') }]} />
        {mode !== 'BY_SEAT' && <Field label={t('عدد الحصص')}><Input value={parts} onChange={(e) => setParts(e.target.value.replace(/\D/g, ''))} inputMode="numeric" /></Field>}
        {mode === 'SHARE_ITEM' && <Field label={t('الصنف')}><Select value={lineId} onChange={(e) => setLineId(e.target.value)} options={[{ value: '', label: t('اختار') }, ...active.map((l: any) => ({ value: l.id, label: `${L(l.name)} ×${qty(l.quantity)} — ${money(l.lineTotal)}` }))]} /></Field>}
        {mode === 'BY_SEAT' && <div className="text-xs text-dim">{t('لازم الأصناف تكون متعينة لكراسي (زرار الكرسي على كل سطر).')}</div>}
        <Banner tone="info">{t('قاعدة واحدة ثابتة: القروش بتتوزع بأكبر باقي والفرق الأخير على آخر حصة (SplitAllocationPolicy). خصم النسبة بيتنسخ لكل حصة، وخصم المبلغ بيتوزع بنفس القاعدة، والخدمة بتتحسب لكل شيك.')}</Banner>
        <div className="text-[11px] text-dim">{t('Order.Split موقوفة لقرار (PD_HELD) في العقد — ده اتجاه مقترح. التقسيم بالأصناف موجود فعلًا عن طريق "نقل أصناف".')}</div>
      </div>
    </Modal>
  );
}

function MergeDialog({ order, siblings, onClose }: { order: any; siblings: any[]; onClose: () => void }) {
  const { run } = useCommand();
  const others = siblings.filter((c) => c.id !== order.id && c.status === 'DRAFT');
  const [src, setSrc] = useState(others[0]?.id ?? '');
  return (
    <Modal open onClose={onClose} title={t('دمج شيكين')} badge={<StateBadge ops={['Order.Merge']} />} footer={<Button variant="primary" disabled={!src} onClick={async () => { if (await run('Order.Merge', { params: { orderId: order.id }, body: { expectedVersion: order.version, sourceOrderId: src } }, { success: t('الشيكين اتدمجوا') })) onClose(); }}>{t('ادمج هنا')}</Button>}>
      <Field label={t('ادمج الشيك ده في الشيك الحالي')}><Select value={src} onChange={(e) => setSrc(e.target.value)} options={others.map((c) => ({ value: c.id, label: `${t('شيك')} ${c.checkNo} — ${money(c.payable)}` }))} /></Field>
    </Modal>
  );
}

function ChannelDialog({ order, onClose }: { order: any; onClose: () => void }) {
  const { run } = useCommand();
  const tables = useQuery<any>('Table.List', { query: {} });
  const [tableId, setTableId] = useState('');
  const toDine = order.channel === 'TAKEAWAY';
  return (
    <Modal open onClose={onClose} title={t('تغيير القناة')} badge={<StateBadge ops={['Order.ChangeChannel']} />} footer={<Button variant="primary" disabled={toDine && !tableId} onClick={async () => { if (await run('Order.ChangeChannel', { params: { orderId: order.id }, body: { expectedVersion: order.version, channel: toDine ? 'DINE_IN' : 'TAKEAWAY', tableId: tableId || undefined } }, { success: t('القناة اتغيرت') })) onClose(); }}>{toDine ? t('حوّل لصالة') : t('حوّل لتيك أواي')}</Button>}>
      <div className="space-y-3">
        <Banner tone="info">{t('الأصناف وأسعارها المسجلة والجولات اللي اتبعتت بتفضل زي ما هي. الخدمة بتتحسب حسب القناة الجديدة (سؤال للخبير).')}</Banner>
        {toDine ? <Field label={t('الترابيزة (لازم تكون مفتوحة)')}><Select value={tableId} onChange={(e) => setTableId(e.target.value)} options={[{ value: '', label: t('اختار') }, ...(tables.data?.items ?? []).filter((x: any) => x.occupancy).map((x: any) => ({ value: x.id, label: `${t('ترابيزة')} ${x.name}` }))]} /></Field> : <div className="text-xs text-dim">{t('التيك أواي محتاج وردية درج مفتوحة على الجهاز ده.')}</div>}
      </div>
    </Modal>
  );
}

export function HistoryDialog({ order, onClose }: { order: any; onClose: () => void }) {
  const tl = useQuery<any>('Order.Timeline', { params: { orderId: order.id } });
  return (
    <Modal open onClose={onClose} wide title={`${t('سجل الشيك')} #${order.number}`} badge={<StateBadge ops={['Order.Timeline']} />}>
      <div className="space-y-1.5">
        <Banner tone="info">{t('مفيش حاجة مالية بتتعدل أو تتمسح: أي تصحيح بيبقى سجل جديد مربوط بالأصل (إلغاء، مرتجع، تصحيح دفع).')}</Banner>
        {(tl.data?.items ?? []).map((h: any, i: number) => (
          <div key={i} className="flex gap-3 text-sm border-s-2 line ps-3 py-1">
            <span className="num text-dim text-xs w-12 shrink-0">{time(h.at)}</span>
            <span className="flex-1">{typeof h.text === 'string' ? h.text : L(h.text)}</span>
            <span className="text-[11px] text-dim">{h.byName ?? h.by}{h.terminal ? ` · ${h.terminal}` : ''}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
