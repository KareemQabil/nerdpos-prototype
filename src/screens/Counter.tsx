// Counter and takeaway: order, pay first (fire at confirm), receipt. Also the staff meal (D9, direction).
import React, { useState } from 'react';
import { Plus, ShoppingBag, Utensils, Coffee } from 'lucide-react';
import { useDev, useQuery, useCommand } from '../app/hooks';
import { OrderWorkspace, needsDialog } from './OrderScreen';
import { MenuGrid } from './order/MenuGrid';
import { ProductDialog, type LineDraft } from './order/ProductDialog';
import { Section, StateBadge, Button, Banner, Money, Pill, Modal, Input, Field, Empty } from '../ui';
import { t, L } from '../i18n';
import { cn, money, qty } from '../lib/format';
import { StatusPill } from './order/CheckPanel';

export default function Counter() {
  const { terminal, nav, params, screen } = useDev();
  const session = useQuery<any>(terminal?.drawer ? 'Session.Current' : null, { query: { terminalId: terminal?.id } });
  const open = useQuery<any>(session.data ? 'Order.Find' : null, { query: { sessionId: session.data?.id, lifecycle: 'DRAFT,CONFIRMED' } });
  const { run, busy } = useCommand();
  const [staffMeal, setStaffMeal] = useState(screen === 'staffmeal');
  const current = params.orderId;
  const create = async (channel: 'TAKEAWAY' | 'DINE_IN') => {
    const o = await run<any>('Order.Create', { body: { channel } }, { success: channel === 'TAKEAWAY' ? t('طلب تيك أواي جديد') : t('طلب صالة كاونتر جديد') });
    if (o) nav('counter', { orderId: o.id });
  };
  if (!terminal?.drawer) return <Banner tone="warning">{t('الجهاز ده من غير درج — البيع على الكاونتر محتاج جهاز كاشير.')}</Banner>;
  if (session.loading && !session.data) return null;
  if (!session.data) return (
    <div data-screen="C2" className="space-y-3">
      <Section title={t('نقطة البيع')} badge={<StateBadge ops={['Order.Create', 'Session.Open']} />} />
      <Banner tone="warning" action={<Button variant="primary" size="sm" onClick={() => nav('shift')}>{t('افتح وردية')}</Button>}>{t('مفيش وردية مفتوحة على الجهاز ده. البيع على الكاونتر والتيك أواي محتاج وردية درج (SESSION_NOT_OPEN).')}</Banner>
    </div>
  );
  const orders: any[] = (open.data?.items ?? []).filter((o: any) => !o.visitId);
  return (
    <div data-screen="C2" className="h-full flex flex-col gap-3 min-h-0">
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="text-xl font-bold me-2">{t('نقطة البيع')}</h1>
        <StateBadge ops={['Order.Create', 'Order.AddLines', 'Order.Confirm', 'Payment.Capture', 'Order.Complete']} />
        <Button variant="primary" onClick={() => create('TAKEAWAY')} loading={busy} data-fb="new-takeaway"><ShoppingBag className="w-4 h-4" />{t('تيك أواي جديد')}</Button>
        <Button onClick={() => create('DINE_IN')} loading={busy}><Utensils className="w-4 h-4" />{t('صالة كاونتر')}</Button>
        <Button variant="ghost" onClick={() => setStaffMeal(true)}><Coffee className="w-4 h-4" />{t('وجبة موظف')} <StateBadge state="PROPOSED" /></Button>
        <div className="flex-1" />
        <div className="flex gap-1.5 overflow-x-auto scrollbar-hide max-w-[50%]">
          {orders.map((o) => <button key={o.id} onClick={() => nav('counter', { orderId: o.id })} className={cn('px-3 h-9 rounded-lg border text-xs whitespace-nowrap flex items-center gap-1.5', current === o.id ? 'border-[var(--primary)] bg-[var(--primary-container)]' : 'surface-1 border-[var(--glass-border)]')}><span className="num font-bold">#{o.number}</span>{o.channel === 'TAKEAWAY' ? t('تيك أواي') : t('صالة')} · <span className="num">{money(o.totals.payable, false)}</span></button>)}
        </div>
      </div>
      <div className="flex-1 min-h-0">
        {current ? <OrderWorkspace key={current} orderId={current} mode="COUNTER" /> : <Empty icon={<ShoppingBag className="w-12 h-12" />} text={t('ابدأ طلب تيك أواي جديد. في التيك أواي الدفع الأول والإرسال للمطبخ وقت التأكيد (FireTimingPolicy TAKEAWAY AT_CONFIRM).')} />}
      </div>
      {staffMeal && <StaffMealDialog onClose={() => setStaffMeal(false)} />}
    </div>
  );
}

function StaffMealDialog({ onClose }: { onClose: () => void }) {
  const { run, busy } = useCommand();
  const [lines, setLines] = useState<(LineDraft & { name: string })[]>([]);
  const [pick, setPick] = useState<any>(null);
  const [staff, setStaff] = useState('');
  return (
    <Modal open onClose={onClose} xwide title={t('وجبة موظف')} badge={<StateBadge ops={['Order.CreateStaffMeal']} />} footer={<><div className="me-auto text-sm text-dim">{lines.map((l) => `${l.name} ×${l.quantity}`).join('، ')}</div><Button variant="primary" loading={busy} disabled={!lines.length || !staff} onClick={async () => { if (await run('Order.CreateStaffMeal', { body: { staffName: staff, lines: lines.map(({ name, ...l }) => l) } }, { success: t('وجبة الموظف اتسجلت واتبعتت للمطبخ') })) onClose(); }}>{t('سجّل')}</Button></>}>
      <div className="space-y-3">
        <Banner tone="info">{t('وجبة الموظف مش بيع: من غير إيصال ولا إيصال إلكتروني، وليها سطر لوحدها في التقارير. بتتبعت للمطبخ عادي.')}</Banner>
        <Field label={t('اسم الموظف')}><Input value={staff} onChange={(e) => setStaff(e.target.value)} /></Field>
        <div className="h-[48vh]"><MenuGrid channel="TAKEAWAY" onPick={(p) => (needsDialog(p) ? setPick(p) : setLines([...lines, { productId: p.id, quantity: '1', modifierOptionIds: [], name: L(p.name) }]))} /></div>
      </div>
      {pick && <ProductDialog product={pick} channel="TAKEAWAY" onClose={() => setPick(null)} onAdd={(l) => { setLines([...lines, { ...l, name: L(pick.name) }]); setPick(null); }} />}
    </Modal>
  );
}
