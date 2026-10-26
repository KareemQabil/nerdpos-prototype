// C2 order entry for a table check (or any check opened by id): menu + the check.
// Fast ordering: tapping a simple item that is already on the check (not sent yet) adds one to that line.
import React, { useState } from 'react';
import { ArrowRight, Receipt } from 'lucide-react';
import { useDev, useQuery, useCommand, errorText } from '../app/hooks';
import { MenuGrid } from './order/MenuGrid';
import { ProductDialog, type LineDraft } from './order/ProductDialog';
import { CheckPanel } from './order/CheckPanel';
import { Button, Banner, StateBadge, Skeleton, EmptyState } from '../ui';
import { t } from '../i18n';

export function needsDialog(p: any) {
  return p.modifierGroupIds?.length || p.variants?.length || p.combo?.length || p.halfAndHalf;
}

/** An unsent plain line of the same product (no options, note, seat or parts) that a repeat tap can add to. */
function sameSimpleLine(order: any, l: LineDraft) {
  if ((l.modifierOptionIds?.length ?? 0) > 0 || (l as any).note || (l as any).variantId || (l as any).children || (l as any).seat || l.quantity !== '1') return null;
  return order.lines.find((x: any) => x.status === 'ACTIVE' && x.fireRound === null && x.productId === l.productId && !x.modifiers?.length && !x.variant && !x.note && !x.children?.length && !x.seat && !x.shareOf) ?? null;
}

export function OrderWorkspace({ orderId, mode, back }: { orderId: string; mode: 'FLOOR' | 'COUNTER'; back?: () => void }) {
  const { nav, params } = useDev();
  const o = useQuery<any>('Order.Get', { params: { orderId } });
  const seatsP = useQuery<any>('Settings.Effective', { query: { policyId: 'SeatsPolicy', scopeType: 'TENANT', scopeId: 'biz' } });
  const { run } = useCommand();
  const [pick, setPick] = useState<any>(null);
  const order = o.data;
  const add = async (l: LineDraft) => {
    const same = sameSimpleLine(order, l);
    const r = same
      ? await run('Order.UpdateLine', { params: { orderId, lineId: same.id }, body: { expectedVersion: order.version, expectedLineVersion: same.version, quantity: String(Math.round(Number(same.quantity)) + 1) } })
      : await run('Order.AddLines', { params: { orderId }, body: { expectedVersion: order.version, lines: [l] } });
    if (r) setPick(null);
  };
  if (o.error) return <Banner tone="error" action={back && <Button size="sm" onClick={back}>{t('رجوع')}</Button>}>{errorText(o.error)}</Banner>;
  if (!order) return (
    <div className="h-full flex gap-3 min-h-0">
      <div className="flex-1 min-w-0 space-y-3"><Skeleton className="h-10 w-full rounded-xl" /><Skeleton className="h-9 w-2/3 rounded-xl" /><div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}</div></div>
      <Skeleton className="w-[340px] h-full rounded-2xl shrink-0" />
    </div>
  );
  const editable = order.status === 'DRAFT';
  return (
    <div className="@container/ow h-full flex gap-3 min-h-0">
      <div className="flex-1 min-w-0 flex flex-col gap-2 min-h-0">
        <div className="flex items-center gap-2 min-h-9">
          {back && <Button size="sm" variant="ghost" onClick={back} data-fb="order-back"><ArrowRight className="w-4 h-4 ltr:rotate-180" />{t('رجوع')}</Button>}
          <div className="text-sm text-dim truncate">{editable ? t('دوس على الصنف يتضاف للشيك — ودوسة تانية تزوّد واحد.') : t('الشيك ده مقفول للتعديل.')}</div>
          <div className="flex-1" />
          <StateBadge ops={['Order.Get', 'Order.AddLines', 'Order.UpdateLine', 'Order.RemoveLine']} />
        </div>
        <div className="flex-1 min-h-0"><MenuGrid channel={order.channel} disabled={!editable} onPick={(p) => (needsDialog(p) ? setPick(p) : add({ productId: p.id, quantity: '1', modifierOptionIds: [] }))} /></div>
      </div>
      <div className="w-[46%] @[760px]/ow:w-[340px] @[1100px]/ow:w-[390px] shrink-0 min-h-0"><CheckPanel order={order} refetch={o.refetch} mode={mode} onCheckSwitch={(id) => nav('order', { ...params, orderId: id })} /></div>
      {pick && <ProductDialog product={pick} channel={order.channel} onClose={() => setPick(null)} onAdd={add} seatsEnabled={!!seatsP.data?.value && mode === 'FLOOR'} guestCount={order.guestCount} />}
    </div>
  );
}

export default function OrderScreen() {
  const { params, nav } = useDev();
  if (!params.orderId) return <EmptyState icon={<Receipt />} title={t('مفيش شيك مفتوح')} text={t('افتح شيك من الصالة أو من شاشة الشيكات.')} action={<><Button variant="primary" onClick={() => nav('floor')}>{t('الصالة')}</Button><Button onClick={() => nav('checks')}>{t('الشيكات')}</Button></>} />;
  return <OrderWorkspace orderId={params.orderId} mode={params.mode ?? 'FLOOR'} back={() => nav(params.back ?? 'floor')} />;
}
