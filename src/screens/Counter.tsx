// Counter and takeaway: order, pay first (fire at confirm), receipt. Also the staff meal (D9, direction).
import React, { useEffect, useRef, useState } from 'react';
import { Plus, ShoppingBag, Utensils, Coffee, Bike, Wallet } from 'lucide-react';
import { useDev, useQuery, useCommand } from '../app/hooks';
import { OrderWorkspace, needsDialog } from './OrderScreen';
import { MenuGrid } from './order/MenuGrid';
import { ProductDialog, type LineDraft } from './order/ProductDialog';
import { PageHeader, StateBadge, Button, Banner, Money, Pill, Modal, Input, Field, EmptyState, Skeleton, Kbd } from '../ui';
import { t, L } from '../i18n';
import { cn, money, qty } from '../lib/format';
import { StatusPill } from './order/CheckPanel';
import { StaffMealDialog, StaffMealsList } from './control/StaffMeal'; // r3A: staff meal with employee, approval, allowance
import { SalesChannelPicker } from './channels/common'; // r3C sales channels

export default function Counter() {
  const { terminal, nav, params, screen, can } = useDev();
  const session = useQuery<any>(terminal?.drawer ? 'Session.Current' : null, { query: { terminalId: terminal?.id } });
  const open = useQuery<any>(session.data ? 'Order.Find' : null, { query: { sessionId: session.data?.id, lifecycle: 'DRAFT,CONFIRMED' } });
  const { run, busy } = useCommand();
  const [staffMeal, setStaffMeal] = useState(screen === 'staffmeal');
  const [meals, setMeals] = useState(false);
  const current = params.orderId;
  const [scPick, setScPick] = useState<Record<string, string>>({}); // r3C: sales channel per order type ('' = default)
  const create = async (channel: 'TAKEAWAY' | 'DINE_IN') => {
    const o = await run<any>('Order.Create', { body: { channel, ...(scPick[channel] ? { salesChannelId: scPick[channel] } : {}) } }, { success: channel === 'TAKEAWAY' ? t('طلب تيك أواي جديد') : t('طلب صالة كاونتر جديد') });
    if (o) nav('counter', { orderId: o.id });
  };
  // cashier keyboard: F2 = new takeaway
  const createRef = useRef(create);
  createRef.current = create;
  const hasSession = !!session.data;
  useEffect(() => {
    if (!hasSession) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'F2' && !document.querySelector('[role="dialog"]')) { e.preventDefault(); createRef.current('TAKEAWAY'); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [hasSession]);
  if (!terminal?.drawer) return <EmptyState icon={<ShoppingBag />} title={t('الجهاز ده من غير درج')} text={t('البيع على الكاونتر والتيك أواي بيكون من جهاز الكاشير اللي فيه درج.')} />;
  if (session.loading && !session.data) return <Skeleton className="h-64 rounded-2xl" />;
  if (!session.data) return (
    <div data-screen="C2" className="space-y-3">
      <PageHeader title={t('نقطة البيع')} ops={['Order.Create', 'Session.Open']} description={t('بيع التيك أواي والكاونتر من الدرج.')} />
      <EmptyState icon={<Wallet />} title={t('مفيش وردية مفتوحة على الجهاز ده')} text={t('افتح الوردية الأول بالفلوس اللي في الدرج، وبعدها تقدر تبيع.')} action={<Button variant="primary" size="lg" onClick={() => nav('shift')} data-fb="counter-open-shift">{t('افتح وردية')}</Button>} />
    </div>
  );
  const orders: any[] = (open.data?.items ?? []).filter((o: any) => !o.visitId);
  return (
    <div data-screen="C2" className="h-full flex flex-col gap-3 min-h-0">
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="text-[22px] font-extrabold tracking-tight me-1">{t('نقطة البيع')}</h1>
        <StateBadge ops={['Order.Create', 'Order.AddLines', 'Order.Confirm', 'Payment.Capture', 'Order.Complete']} />
        <Button variant="primary" size="lg" onClick={() => create('TAKEAWAY')} loading={busy} data-fb="new-takeaway"><ShoppingBag className="w-4 h-4" />{t('تيك أواي جديد')}<Kbd className="hidden xl:inline-flex !bg-black/10 !border-black/10 !text-current">F2</Kbd></Button>
        <Button size="lg" onClick={() => create('DINE_IN')} loading={busy} data-fb="new-counter-dinein"><Utensils className="w-4 h-4" />{t('صالة كاونتر')}</Button>
        <SalesChannelPicker orderType="TAKEAWAY" compact fb="counter-channel" label={t('قناة التيك أواي')} value={scPick.TAKEAWAY ?? ''} onChange={(id) => setScPick({ ...scPick, TAKEAWAY: id })} />
        {can('delivery:create') && <Button size="lg" onClick={() => nav('delivery-new')} data-fb="counter-delivery"><Bike className="w-4 h-4" />{t('دليفري')}</Button>}
        <Button variant="ghost" size="lg" onClick={() => setStaffMeal(true)} data-fb="staff-meal"><Coffee className="w-4 h-4" />{t('وجبة موظف')} <StateBadge state="PROPOSED" /></Button>
        <Button variant="ghost" size="lg" onClick={() => setMeals(true)} data-fb="staff-meals-list-open">{t('وجبات الموظفين')}</Button>
        <div className="flex-1" />
        <div className="flex gap-1.5 overflow-x-auto scrollbar-hide max-w-full lg:max-w-[45%]" data-fb="counter-open-orders">
          {orders.map((o) => <button key={o.id} onClick={() => nav('counter', { orderId: o.id })} className={cn('px-3 h-11 rounded-xl border text-xs whitespace-nowrap flex items-center gap-1.5', current === o.id ? 'border-[var(--primary)] bg-[var(--primary-container)] font-bold' : 'surface-1 border-[var(--glass-border)]')}><span className="num font-bold">#{o.number}</span>{o.channel === 'TAKEAWAY' ? t('تيك أواي') : o.channel === 'DELIVERY' ? t('دليفري') : t('صالة')} · <span className="num">{money(o.totals.payable, false)}</span></button>)}
        </div>
      </div>
      <div className="flex-1 min-h-0">
        {current ? <OrderWorkspace key={current} orderId={current} mode="COUNTER" /> : <EmptyState icon={<ShoppingBag />} title={t('ابدأ طلب جديد')} text={t('في التيك أواي الزبون بيدفع الأول، والأصناف بتروح المطبخ أول ما الشيك يتأكد.')} action={<Button variant="primary" size="lg" onClick={() => create('TAKEAWAY')} loading={busy}><ShoppingBag className="w-4 h-4" />{t('تيك أواي جديد')}</Button>} />}
      </div>
      {staffMeal && <StaffMealDialog onClose={() => setStaffMeal(false)} />}
      {meals && <Modal open onClose={() => setMeals(false)} wide title={t('وجبات الموظفين')} badge={<StateBadge ops={['Order.CreateStaffMeal', 'Order.CancelStaffMeal']} />}><StaffMealsList /></Modal>}
    </div>
  );
}
