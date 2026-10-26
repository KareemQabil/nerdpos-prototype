// Stock overview: value on hand, what is running low, what expires soon, consumption / waste / count variance,
// food cost per dish, recent movements and the full movement log. Quick actions start the common jobs.
import React, { useState } from 'react';
import { Boxes, TriangleAlert, CalendarClock, TrendingDown, Trash2, Scale, ShoppingBag, PackageCheck, ClipboardCheck, ArrowLeftRight, ChefHat } from 'lucide-react';
import { useDev, useQuery } from '../../app/hooks';
import { Banner, Button, Card, Empty, Field, Input, Money, Pill, Section, Select, Spinner, StateBadge, Table, Tabs } from '../../ui';
import { t, L, tv } from '../../i18n';
import { money, dayShort } from '../../lib/format';
import { BandPill, BranchScope, ItemPicker, KIND_TEXT, LevelPill, MovementTable, Pct, Qty, Stat, WarehouseSelect, fmtQty, useBranchScope, useItemsCatalog, useList, useWarehouses } from './common';
import { WasteDialog } from './WasteDialog';
import { ItemDrawer } from './ItemDrawer';

const OPS = ['Inventory.Dashboard', 'Inventory.LowStock', 'Inventory.Expiring', 'Movement.Find', 'Movement.Get'];

export default function InventoryDashboard() {
  const [tab, setTab] = useState<'overview' | 'log'>('overview');
  const scope = useBranchScope();
  return (
    <div>
      <Section title={t('المخزن — نظرة عامة')} badge={<StateBadge ops={OPS} />} sub={t('قيمة المخزون، النواقص، الصلاحية، الاستهلاك والهالك وتكلفة الأكل — كله من حركات المخزن الحقيقية.')}
        actions={<BranchScope scope={scope} />} />
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[{ id: 'overview', label: t('نظرة عامة') }, { id: 'log', label: t('سجل الحركات') }]} />
      {tab === 'overview' ? <Overview branchId={scope.branchId} /> : <MovementLog branchId={scope.branchId} />}
    </div>
  );
}

function Overview({ branchId }: { branchId?: string }) {
  const { nav } = useDev();
  const q = useQuery<any>('Inventory.Dashboard', { query: { branchId } });
  const low = useList<any>('Inventory.LowStock', { branchId });
  const exp = useList<any>('Inventory.Expiring', { branchId, days: 3 });
  const [waste, setWaste] = useState<{ itemId?: string; wh?: string } | null>(null);
  const [item, setItem] = useState<string | null>(null);
  const d = q.data;
  if (!d) return <div className="py-10 flex justify-center"><Spinner /></div>;
  if (!d.byWarehouse.length) {
    return <Empty icon={<Boxes className="w-10 h-10" />} text={t('لسه مفيش مخازن في الفرع ده. ابدأ بإضافة مخزن ومطبخ، وبعدين الخامات.')}><Button variant="primary" data-fb="inv-dash:go-warehouses" onClick={() => nav('inv-warehouses')}>{t('روح للمخازن')}</Button></Empty>;
  }
  const maxDay = Math.max(1, ...d.days.map((x: any) => Number(x.sales) + Number(x.waste)), ...d.days.map((x: any) => Number(x.receipts)));
  const maxWh = Math.max(1, ...d.byWarehouse.map((w: any) => Number(w.stockValue)));
  const dayName = (s: string) => dayShort(s);
  return (
    <div className="space-y-4">
      {d.salesWarehouseMissing.length > 0 && <Banner tone="error" action={<Button size="sm" onClick={() => nav('inv-warehouses')}>{t('حدد مخزن البيع')}</Button>}>{t('الفرع ده مالوش مخزن بيع — المبيعات مش هتسحب من المخزن لحد ما تحدده:')} {d.salesWarehouseMissing.map((b: any) => b.name).join(t('، '))}</Banner>}
      {d.negativeCount > 0 && <Banner tone="warning">{t('فيه {n} صنف رصيده بالسالب: المبيعات سحبت أكتر من المسجل. غالبًا استلام ما اتسجلش أو محتاج جرد.', { n: d.negativeCount })}</Banner>}
      <div className="flex flex-wrap gap-2">
        <Button data-fb="inv-dash:po" variant="primary" onClick={() => nav('inv-po', { fromLowStock: true })}><ShoppingBag className="w-4 h-4" />{t('اطلب النواقص')}</Button>
        <Button data-fb="inv-dash:receive" onClick={() => nav('inv-receipts', { newReceipt: true })}><PackageCheck className="w-4 h-4" />{t('استلام بضاعة')}</Button>
        <Button data-fb="inv-dash:waste" onClick={() => setWaste({})}><Trash2 className="w-4 h-4" />{t('تسجيل هالك')}</Button>
        <Button data-fb="inv-dash:count" onClick={() => nav('inv-counts', { start: true })}><ClipboardCheck className="w-4 h-4" />{t('جرد جديد')}</Button>
        <Button data-fb="inv-dash:transfer" onClick={() => nav('inv-transfers', { create: true })}><ArrowLeftRight className="w-4 h-4" />{t('تحويل للمطبخ')}</Button>
        <Button data-fb="inv-dash:production" onClick={() => nav('inv-production')}><ChefHat className="w-4 h-4" />{t('تحضير')}</Button>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6 gap-3">
        <Stat fb="inv-dash:stat-value" label={t('قيمة المخزون بالتكلفة')} value={money(d.stockValue)} icon={<Boxes className="w-4 h-4" />} sub={t('{n} مخزن', { n: d.byWarehouse.length })} onClick={() => nav('inv-items')} />
        <Stat fb="inv-dash:stat-low" label={t('قربت تخلص')} value={d.lowCount + d.outCount} tone={d.outCount ? 'error' : d.lowCount ? 'warning' : undefined} icon={<TriangleAlert className="w-4 h-4" />} sub={d.outCount ? t('منهم {n} خلصت خالص', { n: d.outCount }) : t('تحت الحد الأدنى')} onClick={() => nav('inv-items', { state: 'LOW,OUT,NEGATIVE' })} />
        <Stat fb="inv-dash:stat-expiry" label={t('صلاحيتها قربت (3 أيام)')} value={d.expiringCount + d.expiredCount} tone={d.expiredCount ? 'error' : d.expiringCount ? 'warning' : undefined} icon={<CalendarClock className="w-4 h-4" />} sub={d.expiredCount ? t('{n} دفعة منتهية — قيمتها {v}', { n: d.expiredCount, v: money(d.expiredValue) }) : t('اتصرف فيها الأول')} />
        <Stat label={t('استهلاك المبيعات (7 أيام)')} value={money(d.sales7)} icon={<TrendingDown className="w-4 h-4" />} sub={t('تكلفة الخامات اللي اتباعت')} />
        <Stat fb="inv-dash:stat-waste" label={t('الهالك (7 أيام)')} value={money(d.waste7)} tone={Number(d.waste7) > 0 ? 'warning' : undefined} icon={<Trash2 className="w-4 h-4" />} sub={Number(d.sales7) > 0 ? t('{p}% من الاستهلاك', { p: ((Number(d.waste7) / Number(d.sales7)) * 100).toFixed(1) }) : undefined} onClick={() => nav('inv-waste')} />
        <Stat label={t('فروقات الجرد (30 يوم)')} value={money(d.variance30)} tone={Number(d.variance30) < 0 ? 'error' : undefined} icon={<Scale className="w-4 h-4" />} sub={t('بالسالب = عجز')} onClick={() => nav('inv-counts')} />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2" title={t('آخر 7 أيام')} actions={<div className="flex gap-3 text-[11px]"><Legend c="var(--primary)" l={t('استهلاك مبيعات')} /><Legend c="var(--warning)" l={t('هالك')} /><Legend c="var(--success)" l={t('استلام')} /></div>}>
          <div className="flex items-end gap-3 h-48" data-fb="inv-dash:chart">
            {d.days.map((x: any) => (
              <div key={x.date} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                <div className="w-full flex items-end justify-center gap-1 h-40">
                  <div className="w-1/3 flex flex-col justify-end h-full" title={`${t('استهلاك')} ${money(x.sales)} · ${t('هالك')} ${money(x.waste)}`}>
                    <div className="rounded-t-sm bg-[var(--warning)]" style={{ height: `${(Number(x.waste) / maxDay) * 100}%` }} />
                    <div className="bg-[var(--primary)] rounded-b-sm" style={{ height: `${(Number(x.sales) / maxDay) * 100}%`, minHeight: Number(x.sales) > 0 ? 2 : 0 }} />
                  </div>
                  <div className="w-1/3 rounded-t-sm bg-[var(--success)]" style={{ height: `${(Number(x.receipts) / maxDay) * 100}%`, minHeight: Number(x.receipts) > 0 ? 2 : 0 }} title={`${t('استلام')} ${money(x.receipts)}`} />
                </div>
                <div className="text-[10px] text-dim">{dayName(x.date)}</div>
              </div>
            ))}
          </div>
        </Card>
        <Card title={t('قيمة المخزون في كل مخزن')}>
          <div className="space-y-3">
            {d.byWarehouse.map((w: any) => (
              <button key={w.id} className="w-full text-start" onClick={() => nav('inv-warehouses', { open: w.id })}>
                <div className="flex justify-between text-sm"><span className="font-bold">{tv(w.name)}{w.salesDefault && <Pill tone="primary" className="ms-1">{t('البيع')}</Pill>}</span><Money v={w.stockValue} className="text-sm" /></div>
                <div className="h-2 rounded-full surface-2 mt-1 overflow-hidden"><div className="h-full bg-[var(--primary)]" style={{ width: `${(Number(w.stockValue) / maxWh) * 100}%` }} /></div>
                <div className="text-[11px] text-dim mt-0.5">{t('{n} صنف', { n: w.itemCount })} · {tv(w.branchName)}{w.lowCount ? ` · ${t('{n} قرب يخلص', { n: w.lowCount })}` : ''}</div>
              </button>
            ))}
          </div>
        </Card>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title={<span className="flex items-center gap-2"><TriangleAlert className="w-4 h-4 text-[var(--warning)]" />{t('النواقص')}</span>} badge={<StateBadge ops={['Inventory.LowStock']} />} actions={<Button size="sm" variant="primary" data-fb="inv-dash:order-low" onClick={() => nav('inv-po', { fromLowStock: true })}>{t('اعمل أمر شراء')}</Button>}>
          <Table empty={t('مفيش نواقص — كله فوق الحد الأدنى')} head={[t('الصنف'), t('المخزن'), t('الموجود'), t('الحد'), t('نطلب'), '']} rows={low.items.slice(0, 8).map((r) => [
            <button className="font-bold hover:text-[var(--primary)]" onClick={() => setItem(r.item.id)}>{L(r.item.name)}</button>, <span className="text-xs">{tv(r.warehouse.name)}</span>, <Qty v={r.onHand} unit={r.item.unit} />, <span className="num text-xs">{fmtQty(r.min)}</span>,
            <span className="text-xs">{r.suggestedPacks ? `${fmtQty(r.suggestedPacks)} × ${L(r.pack.name)}` : <Qty v={r.suggestedQuantity} unit={r.item.unit} />}</span>, <LevelPill state={r.state} />,
          ])} />
        </Card>
        <Card title={<span className="flex items-center gap-2"><CalendarClock className="w-4 h-4 text-[var(--error)]" />{t('الصلاحية قربت أو خلصت')}</span>} badge={<StateBadge ops={['Inventory.Expiring']} />}>
          <Table empty={t('مفيش حاجة صلاحيتها قربت')} head={[t('الصنف'), t('المخزن'), t('الكمية'), t('الصلاحية'), '']} rows={exp.items.slice(0, 8).map((l) => [
            <button className="font-bold hover:text-[var(--primary)]" onClick={() => setItem(l.item.id)}>{L(l.item.name)}</button>, <span className="text-xs">{tv(l.warehouse.name)}</span>, <Qty v={l.remaining} unit={l.item.unit} />,
            l.status === 'EXPIRED' ? <Pill tone="error">{t('انتهت')}</Pill> : l.status === 'TODAY' ? <Pill tone="error">{t('النهارده')}</Pill> : <Pill tone="warning">{t('فاضل {n} يوم', { n: l.daysLeft })}</Pill>,
            <Button size="sm" variant="warning" data-fb={`inv-dash:waste-lot:${l.id}`} onClick={() => setWaste({ itemId: l.item.id, wh: l.warehouse.id })}>{t('هالك')}</Button>,
          ])} />
        </Card>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2" title={t('تكلفة الأكل لكل طبق')} actions={<span className="text-xs text-dim">{t('المتوسط')}: <Pct v={d.avgFoodCostPercent} band={Number(d.avgFoodCostPercent) > 40 ? 'HIGH' : Number(d.avgFoodCostPercent) > 30 ? 'WATCH' : 'GOOD'} /></span>}>
          <div className="text-xs text-dim mb-2">{t('تكلفة الوصفة بمتوسط تكلفة الخامات دلوقتي ÷ سعر البيع في الصالة (من غير ضريبة). أخضر لحد 30%، أصفر لحد 40%، أحمر فوق كده.')}</div>
          <Table head={[t('الطبق'), t('التكلفة'), t('السعر'), t('نسبة التكلفة'), '']} rows={d.dishes.slice(0, 10).map((x: any) => [
            <button className="font-bold hover:text-[var(--primary)]" onClick={() => nav('inv-recipes', { open: x.recipeId })}>{L(x.name)}</button>, <Money v={x.cost} className="text-xs" />, x.price ? <Money v={x.price} className="text-xs" /> : <span className="text-dim text-xs">—</span>,
            <FoodBar pct={x.foodCostPercent} band={x.band} />, <BandPill band={x.band} />,
          ])} />
          {d.dishes.length > 10 && <Button size="sm" variant="ghost" className="mt-2" onClick={() => nav('inv-recipes')}>{t('كل الوصفات ({n})', { n: d.dishes.length })}</Button>}
        </Card>
        <Card title={t('أكتر هالك (7 أيام)')}>
          {d.topWaste.length === 0 ? <div className="text-sm text-dim py-6 text-center">{t('مفيش هالك')}</div> : (
            <div className="space-y-2">{d.topWaste.map((w: any) => <div key={w.itemId} className="flex justify-between text-sm"><span>{L(w.name)}</span><Money v={w.value} tone="error" className="text-sm" /></div>)}</div>
          )}
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <MiniStat n={d.openPurchaseOrders} l={t('أوامر شراء مفتوحة')} onClick={() => nav('inv-po')} />
            <MiniStat n={d.inTransit} l={t('تحويلات في الطريق')} onClick={() => nav('inv-transfers')} />
            <MiniStat n={d.openCounts} l={t('جرد مفتوح')} onClick={() => nav('inv-counts')} />
          </div>
          {d.noRecipeSales > 0 && <div className="text-[11px] text-dim mt-3">{t('{n} سطر اتباع من غير وصفة — مسحبش من المخزن.', { n: d.noRecipeSales })}</div>}
        </Card>
      </div>
      <Card title={t('آخر الحركات')} actions={<span className="text-xs text-dim">{t('دوس على الوقت تشوف التفاصيل')}</span>}>
        <MovementTable items={d.recent} compact />
      </Card>
      {waste && <WasteDialog open onClose={() => setWaste(null)} presetItemId={waste.itemId} presetWarehouseId={waste.wh} />}
      <ItemDrawer itemId={item} onClose={() => setItem(null)} />
    </div>
  );
}

function Legend({ c, l }: { c: string; l: string }) { return <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: c }} />{l}</span>; }
function MiniStat({ n, l, onClick }: { n: number; l: string; onClick: () => void }) {
  return <button onClick={onClick} className="rounded-xl surface-1 p-2 hover:surface-2"><div className="text-xl font-bold num">{n}</div><div className="text-[10px] text-dim">{l}</div></button>;
}
export function FoodBar({ pct, band }: { pct: string | null; band: string }) {
  const c = band === 'HIGH' ? 'var(--error)' : band === 'WATCH' ? 'var(--warning)' : 'var(--success)';
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-2 rounded-full surface-2 overflow-hidden"><div className="h-full" style={{ width: `${Math.min(100, Number(pct ?? 0))}%`, background: c }} /></div>
      <Pct v={pct} band={band} />
    </div>
  );
}

function MovementLog({ branchId }: { branchId?: string }) {
  const whs = useWarehouses();
  const items = useItemsCatalog();
  const [wh, setWh] = useState('');
  const [kind, setKind] = useState('');
  const [itemId, setItemId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [limit, setLimit] = useState(100);
  const q = useList<any>('Movement.Find', { branchId, warehouseId: wh || undefined, kind: kind || undefined, itemId: itemId || undefined, from: from ? new Date(from + 'T00:00:00+02:00').toISOString() : undefined, to: to ? new Date(to + 'T23:59:59+02:00').toISOString() : undefined, limit });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-end">
        <Field label={t('المخزن')} className="w-52"><WarehouseSelect fb="log:warehouse" value={wh} onChange={setWh} warehouses={whs.items} includeAll={t('كل المخازن')} activeOnly={false} /></Field>
        <Field label={t('نوع الحركة')} className="w-52"><Select data-fb="log:kind" value={kind} onChange={(e) => setKind(e.target.value)} options={[{ value: '', label: t('كل الأنواع') }, ...Object.entries(KIND_TEXT).map(([k, v]) => ({ value: k, label: t(v.ar) }))]} /></Field>
        <Field label={t('الصنف')} className="w-60"><div className="flex gap-1"><ItemPicker fb="log:item" className="flex-1" items={items.items} value={itemId} onChange={setItemId} placeholder={t('كل الأصناف')} />{itemId && <Button size="sm" variant="ghost" onClick={() => setItemId('')}>×</Button>}</div></Field>
        <Field label={t('من')} className="w-40"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label={t('لحد')} className="w-40"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <div className="text-xs text-dim">{t('{n} حركة', { n: q.raw?.total ?? 0 })} · {t('كل حركة ثابتة ومتسجلة: مينفعش تتمسح أو تتعدل — التصحيح بيبقى حركة جديدة.')}</div>
      {q.loading && !q.raw ? <Spinner /> : <MovementTable items={q.items} />}
      {q.raw?.nextCursor && <Button onClick={() => setLimit(limit + 100)}>{t('اعرض أكتر')}</Button>}
    </div>
  );
}
