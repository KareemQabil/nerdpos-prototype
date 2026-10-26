// C2 order entry for a table check (or any check opened by id): menu + the check.
import React, { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { useDev, useQuery, useCommand } from '../app/hooks';
import { MenuGrid } from './order/MenuGrid';
import { ProductDialog, type LineDraft } from './order/ProductDialog';
import { CheckPanel } from './order/CheckPanel';
import { Button, Spinner, Banner, StateBadge } from '../ui';
import { t } from '../i18n';

export function needsDialog(p: any) {
  return p.modifierGroupIds?.length || p.variants?.length || p.combo?.length || p.halfAndHalf;
}

export function OrderWorkspace({ orderId, mode, back }: { orderId: string; mode: 'FLOOR' | 'COUNTER'; back?: () => void }) {
  const { nav, params } = useDev();
  const o = useQuery<any>('Order.Get', { params: { orderId } });
  const seatsP = useQuery<any>('Settings.Effective', { query: { policyId: 'SeatsPolicy', scopeType: 'TENANT', scopeId: 'biz' } });
  const { run } = useCommand();
  const [pick, setPick] = useState<any>(null);
  const order = o.data;
  const add = async (l: LineDraft) => {
    const r = await run('Order.AddLines', { params: { orderId }, body: { expectedVersion: order.version, lines: [l] } });
    if (r) setPick(null);
  };
  if (o.error) return <Banner tone="error">{o.error.code}</Banner>;
  if (!order) return <Spinner />;
  const editable = order.status === 'DRAFT';
  return (
    <div className="h-full flex gap-3 min-h-0">
      <div className="flex-1 min-w-0 flex flex-col gap-2 min-h-0">
        <div className="flex items-center gap-2">
          {back && <Button size="sm" variant="ghost" onClick={back}><ArrowRight className="w-4 h-4 ltr:rotate-180" />{t('رجوع')}</Button>}
          <div className="text-sm text-dim">{editable ? t('اضغط على صنف عشان تضيفه') : t('الشيك مش مفتوح للتعديل')}</div>
          <div className="flex-1" />
          <StateBadge ops={['Order.Get', 'Order.AddLines', 'Order.UpdateLine', 'Order.RemoveLine']} />
        </div>
        <div className="flex-1 min-h-0"><MenuGrid channel={order.channel} disabled={!editable} onPick={(p) => (needsDialog(p) ? setPick(p) : add({ productId: p.id, quantity: '1', modifierOptionIds: [] }))} /></div>
      </div>
      <div className="w-[390px] shrink-0 min-h-0"><CheckPanel order={order} refetch={o.refetch} mode={mode} onCheckSwitch={(id) => nav('order', { ...params, orderId: id })} /></div>
      {pick && <ProductDialog product={pick} channel={order.channel} onClose={() => setPick(null)} onAdd={add} seatsEnabled={!!seatsP.data?.value && mode === 'FLOOR'} guestCount={order.guestCount} />}
    </div>
  );
}

export default function OrderScreen() {
  const { params, nav } = useDev();
  if (!params.orderId) return <Banner tone="info">{t('افتح شيك من الصالة أو من الشيكات')}</Banner>;
  return <OrderWorkspace orderId={params.orderId} mode={params.mode ?? 'FLOOR'} back={() => nav(params.back ?? 'floor')} />;
}
