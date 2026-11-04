// Round 3 (F2-04, P1-036): one page per THING — a dish or an ingredient — with its whole life in one place:
// requested → ordered → received → in stock (warehouses, lots, expiry) → sold / used / wasted; prices per channel and
// cost history; recipe and where it is used; suppliers and pack cards; documents and movements; and the quick actions
// (receive, count, adjust, order, change price, sold out). Every number comes from the server (Item.Lifecycle).
import React, { useState } from 'react';
import {
  ScanSearch, Star, ClipboardList, ShoppingBag, PackageCheck, Warehouse as WarehouseIcon, TrendingDown, Trash2, ArrowLeft, UtensilsCrossed, Package,
  SlidersHorizontal, ClipboardCheck, Tags, CookingPot, PackageX, CircleCheck, Pencil, FileText, ShoppingCart, Gauge,
} from 'lucide-react';
import { useCommand, useDev, useQuery } from '../../app/hooks';
import { Tech } from '../../app/tech';
import { Banner, Button, Card, EmptyState, Field, Input, Modal, Money, PageHeader, Pill, Spinner, StateBadge, Table, Tabs } from '../../ui';
import { t, L, tv } from '../../i18n';
import { cn, dateTime, money } from '../../lib/format';
import { follow, useFollowList } from '../search/refs';
import { BandPill, LevelPill, MovementTable, Pct, Qty, StatePill, PO_STATE, fmtQty, unitLabel } from '../inventory/common';
import { PackCards } from '../inventory/PackCards';
import { SR_STATE } from '../inventory/Chain';
import { ItemActionsPopup } from '../inventory/ItemDetail';
import { ReceiveDialog } from '../inventory/Receipts';
import { StoreRequestEditor } from '../inventory/Purchasing';

const CH: Record<string, string> = { DINE_IN: 'صالة', TAKEAWAY: 'تيك أواي', DELIVERY: 'دليفري' };
const STOCKING: Record<string, { ar: string; tone: 'primary' | 'info' | 'neutral' | 'violet' | 'success' }> = {
  RECIPE: { ar: 'بيتعمل من وصفة (بيسحب خامات)', tone: 'primary' }, STOCK_ITEM: { ar: 'بيتباع زي ما هو (له رصيد)', tone: 'info' }, NOT_TRACKED: { ar: 'مش متتبع في المخزن', tone: 'neutral' },
  INGREDIENT: { ar: 'خامة', tone: 'success' }, PREP: { ar: 'تجهيزة مطبخ', tone: 'violet' },
};

export default function Item360() {
  const { params, nav, me } = useDev();
  const kind: 'product' | 'item' = params?.kind === 'item' ? 'item' : 'product';
  const id: string | undefined = params?.id;
  const q = useQuery<any>(id ? 'Item.Lifecycle' : null, { params: { kind, itemId: id } });
  const userId: string | undefined = me?.user?.id;
  const followed = useFollowList(userId);
  const [drawer, setDrawer] = useState<null | 'stock' | 'levels'>(null);
  const [receive, setReceive] = useState(false);
  const [request, setRequest] = useState(false);
  const [price, setPrice] = useState(false);
  const { run, busy } = useCommand();
  if (!id) return <EmptyState icon={<ScanSearch />} title={t('افتح صنف من البحث')} text={t('اضغط Ctrl+K ودوّر على أي طبق أو خامة.')} />;
  if (q.loading && !q.data) return <Spinner />;
  if (q.error && !q.data) return <Banner tone="error">{t('مش لاقيين الصنف ده. ممكن يكون اتمسح أو الحساب ده مش مسموح له يشوفه.')}</Banner>;
  const d = q.data;
  if (!d) return null;
  const ref = { type: kind, id } as const;
  const isFollowed = followed.some((x) => x.type === ref.type && x.id === ref.id);
  const st = d.stages;
  const unit = d.item?.unit;
  const isDish = !!d.product;
  const stockItemId: string | null = d.item?.id ?? null;
  const avail = d.product?.availability?.state;
  const toggleAvail = () => run('Product.SetAvailability', { params: { productId: d.product.id }, body: avail === 'AVAILABLE' ? { state: 'SOLD_OUT', reason: t('خلص النهارده'), until: 'END_OF_BUSINESS_DAY' } : { state: 'AVAILABLE' } }, { success: avail === 'AVAILABLE' ? t('اتعلّم «خلص النهارده»') : t('رجع متاح') });
  const stage = (icon: React.ReactNode, label: string, value: React.ReactNode, sub: React.ReactNode, tone?: 'warning' | 'error' | 'success' | 'info', fb?: string, onClick?: () => void) => (
    <button type="button" data-fb={fb} onClick={onClick} disabled={!onClick} className={cn('flex-1 min-w-[132px] rounded-xl border p-3 text-start surface-1 transition-colors', onClick && 'hover:border-[var(--primary)]', tone === 'warning' ? 'border-[color-mix(in_srgb,var(--warning)_45%,transparent)]' : tone === 'error' ? 'border-[color-mix(in_srgb,var(--error)_45%,transparent)]' : 'border-[var(--glass-border)]')}>
      <div className="text-[11px] text-soft flex items-center gap-1.5">{icon}{label}</div>
      <div className={cn('text-lg font-bold num mt-0.5', tone === 'warning' ? 'text-[var(--warning-text)]' : tone === 'error' ? 'text-[var(--error)]' : tone === 'success' ? 'text-[var(--success)]' : '')}>{value}</div>
      <div className="text-[11px] text-dim truncate">{sub}</div>
    </button>
  );
  const arrow = <ArrowLeft className="w-4 h-4 text-dim shrink-0 self-center ltr:rotate-180 hidden @3xl/main:block" />;
  const scrollTo = (sid: string) => document.querySelector(`[data-section="${sid}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="space-y-4" data-fb="item360">
      <PageHeader icon={isDish ? <UtensilsCrossed /> : <Package />} badge={<StateBadge ops={['Item.Lifecycle', 'InventoryItem.PackAdvice']} />}
        title={<span className="flex items-center gap-2 flex-wrap"><span data-fb="item360:title">{L(d.name)}</span><span className="text-sm text-dim font-normal" dir="auto">{d.name.en !== d.name.ar ? d.name.en : ''}</span></span>}
        description={isDish ? t('كل حاجة عن الطبق ده في مكان واحد: السعر في كل قناة، التكلفة، الوصفة وحالة خاماتها، المبيعات والهالك.') : t('كل حاجة عن الخامة دي في مكان واحد: مطلوب ← متطلب من المورد ← اتستلم ← في المخزن ← اتباع/اتستهلك/هالك، والموردين والعبوات.')}
        meta={<span className="flex flex-wrap gap-1.5 items-center">
          <Pill tone={STOCKING[d.stocking]?.tone ?? 'neutral'}>{t(STOCKING[d.stocking]?.ar ?? d.stocking)}</Pill>
          {d.category && <Pill>{tv(L(d.category))}</Pill>}
          {isDish && avail && <Pill tone={avail === 'AVAILABLE' ? 'success' : avail === 'SOLD_OUT' ? 'warning' : 'error'} dot>{avail === 'AVAILABLE' ? t('متاح') : avail === 'SOLD_OUT' ? t('خلص النهارده') : t('موقوف')}</Pill>}
          {isDish && d.product.taxName && <Pill>{L(d.product.taxName)} · {d.product.taxRate}%</Pill>}
          {st && <LevelPill state={st.inStock.state} />}
          <Tech><span className="num text-[10px] text-dim">{d.sku} · {id}</span></Tech>
        </span>}
        actions={<>
          {userId && <Button data-fb="item360:follow" variant={isFollowed ? 'warning' : 'secondary'} onClick={() => follow.toggle(userId, ref)} aria-pressed={isFollowed}><Star className={cn('w-4 h-4', isFollowed && 'fill-current')} />{isFollowed ? t('متابَع') : t('تابع')}</Button>}
        </>} />

      {/* quick actions */}
      <Card padding="sm">
        <div className="flex flex-wrap gap-2 items-center" data-fb="item360:actions">
          <span className="text-xs text-soft me-1">{t('حركات سريعة')}:</span>
          {stockItemId && d.can.receive && <Button size="sm" variant="success" data-fb="item360:receive" onClick={() => setReceive(true)}><PackageCheck className="w-4 h-4" />{t('استلام')}</Button>}
          {stockItemId && d.can.request && <Button size="sm" data-fb="item360:request" onClick={() => setRequest(true)}><ClipboardList className="w-4 h-4" />{t('اطلب (طلبية مخزن)')}</Button>}
          {stockItemId && d.can.order && <Button size="sm" data-fb="item360:po" onClick={() => nav('inv-po', { create: true, supplierId: d.item.defaultSupplierId })}><ShoppingBag className="w-4 h-4" />{t('أمر شراء')}</Button>}
          {stockItemId && d.can.count && <Button size="sm" data-fb="item360:count" onClick={() => nav('inv-counts', { start: true })}><ClipboardCheck className="w-4 h-4" />{t('جرد')}</Button>}
          {stockItemId && d.can.adjust && <Button size="sm" data-fb="item360:adjust" onClick={() => setDrawer('stock')}><SlidersHorizontal className="w-4 h-4" />{t('تسوية / هالك')}</Button>}
          {stockItemId && d.can.inventory && <Button size="sm" variant="ghost" data-fb="item360:levels" onClick={() => setDrawer('levels')}><Gauge className="w-4 h-4" />{t('الحد الأدنى والمستهدف')}</Button>}
          {isDish && d.can.price && <Button size="sm" variant="primary" data-fb="item360:price" onClick={() => setPrice(true)}><Tags className="w-4 h-4" />{t('غيّر السعر')}</Button>}
          {isDish && d.can.availability && <Button size="sm" variant={avail === 'AVAILABLE' ? 'warning' : 'success'} loading={busy} data-fb="item360:availability" onClick={toggleAvail}>{avail === 'AVAILABLE' ? <><PackageX className="w-4 h-4" />{t('خلص النهارده')}</> : <><CircleCheck className="w-4 h-4" />{t('رجّعه متاح')}</>}</Button>}
          {isDish && d.recipe && d.can.recipe && <Button size="sm" data-fb="item360:recipe" onClick={() => nav('inv-recipes', { open: d.recipe.id })}><CookingPot className="w-4 h-4" />{t('عدّل الوصفة')}</Button>}
          {isDish && <Button size="sm" variant="ghost" data-fb="item360:menu" onClick={() => nav('menu', { openProduct: d.product.id })}><Pencil className="w-4 h-4" />{t('بيانات المنيو')}</Button>}
          {isDish && <Button size="sm" variant="ghost" data-fb="item360:pos" onClick={() => nav('counter')}><ShoppingCart className="w-4 h-4" />{t('افتح نقطة البيع')}</Button>}
          {!isDish && d.whereUsed?.length === 0 && d.stocking === 'INGREDIENT' && <span className="text-[11px] text-dim">{t('الخامة دي مش داخلة في أي وصفة لسه')}</span>}
        </div>
      </Card>

      {!isDish && !st && <Banner tone="info" title={t('تفاصيل المخزن مش ظاهرة للحساب ده')}>{t('رصيد الخامة ومستنداتها بتظهر لأمين المخزن والمدير. ادخل بحساب تاني لو محتاجها.')}</Banner>}
      {/* lifecycle strip */}
      {st && (
        <Card title={t('رحلة الصنف')} description={t('آخر 30 يوم في مخازن الفرع ده — اضغط على أي خطوة عشان تشوف تفاصيلها.')}>
          <div className="flex flex-col @3xl/main:flex-row gap-2 items-stretch" data-fb="item360:stages">
            {stage(<ClipboardList className="w-3.5 h-3.5" />, t('مطلوب من المخزن'), <Qty v={st.requested.quantity} unit={unit} hint={false} />, t('{n} طلبية مفتوحة', { n: st.requested.docs.length }), Number(st.requested.quantity) > 0 ? 'info' : undefined, 'stage:requested', () => scrollTo('docs'))}
            {arrow}
            {stage(<ShoppingBag className="w-3.5 h-3.5" />, t('متطلب من المورد'), <Qty v={st.ordered.quantity} unit={unit} hint={false} />, t('{n} أمر شراء مفتوح', { n: st.ordered.docs.length }), Number(st.ordered.quantity) > 0 ? 'info' : undefined, 'stage:ordered', () => scrollTo('docs'))}
            {arrow}
            {stage(<PackageCheck className="w-3.5 h-3.5" />, t('اتستلم'), <Qty v={st.received.quantity} unit={unit} hint={false} />, st.received.pendingInvoice.length ? t('{n} من غير فاتورة', { n: st.received.pendingInvoice.length }) : money(st.received.value), st.received.pendingInvoice.length ? 'warning' : undefined, 'stage:received', () => scrollTo('docs'))}
            {arrow}
            {stage(<WarehouseIcon className="w-3.5 h-3.5" />, t('في المخزن دلوقتي'), <Qty v={st.inStock.quantity} unit={unit} hint={false} />, money(st.inStock.value), st.inStock.state === 'LOW' ? 'warning' : st.inStock.state === 'OUT' || st.inStock.state === 'NEGATIVE' ? 'error' : 'success', 'stage:stock', () => scrollTo('stock'))}
            {arrow}
            {stage(<TrendingDown className="w-3.5 h-3.5" />, d.stocking === 'PREP' || d.stocking === 'INGREDIENT' ? t('اتستهلك') : t('اتباع'), <Qty v={String(Number(st.sold.quantity) + Number(st.usedInPrep.quantity))} unit={unit} hint={false} />, t('في المبيعات {a} · في التحضير {b}', { a: fmtQty(st.sold.quantity), b: fmtQty(st.usedInPrep.quantity) }), undefined, 'stage:used', () => scrollTo('moves'))}
            {arrow}
            {stage(<Trash2 className="w-3.5 h-3.5" />, t('هالك'), <Qty v={st.wasted.quantity} unit={unit} hint={false} />, money(st.wasted.value), Number(st.wasted.quantity) > 0 ? 'warning' : undefined, 'stage:waste', () => scrollTo('moves'))}
          </div>
          <div className="text-[11px] text-dim mt-2">{t('الاستهلاك في الأسبوع حوالي {w} {u}', { w: fmtQty(st.weeklyUse), u: unitLabel(unit) })}{Number(st.adjusted.quantity) !== 0 ? ` · ${t('تسويات وفروق جرد')} ${fmtQty(st.adjusted.quantity)}` : ''}</div>
        </Card>
      )}

      {/* dish summary */}
      {isDish && (
        <div className="grid grid-cols-2 @3xl/main:grid-cols-4 gap-2">
          <Box label={t('تكلفة الطبق')} value={d.unitCost ? <Money v={d.unitCost} /> : <span className="text-dim">—</span>} sub={d.recipe ? t('من الوصفة بأسعار الخامات النهارده') : d.item ? t('متوسط تكلفة الصنف') : t('مفيش وصفة')} />
          <Box label={t('اتباع آخر 7 أيام')} value={<span className="num">{fmtQty(d.sold7?.qty)}</span>} sub={d.sold7 && Number(d.sold7.fromHistory) > 0 ? t('منهم {n} من سجل المبيعات', { n: fmtQty(d.sold7.fromHistory) }) : <Money v={d.sold7?.revenue ?? '0'} />} />
          <Box label={t('اتباع آخر 30 يوم')} value={<span className="num">{fmtQty(d.sold30?.qty)}</span>} sub={<Money v={d.sold30?.revenue ?? '0'} />} />
          <Box label={t('هالك الطبق (30 يوم)')} value={<span className="num">{d.dishWaste.reduce((a: number, w: any) => a + Number(w.quantity), 0)}</span>} sub={<Money v={String(d.dishWaste.reduce((a: number, w: any) => a + Number(w.value), 0))} />} />
        </div>
      )}

      <div className="grid grid-cols-1 @5xl/main:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-4 items-start">
        <div className="space-y-4 min-w-0">
          {/* recipe */}
          {d.recipe && (
            <Card title={d.recipe.prep ? t('بتتعمل من إيه (وصفة التحضير)') : t('الوصفة وحالة الخامات')} description={t('النسخة {v} · التكلفة {c} لكل {u}', { v: d.recipe.activeVersion, c: money(d.recipe.perUnit), u: d.recipe.prep ? unitLabel(unit) : t('طبق') })} actions={d.can.recipe ? <Button size="sm" variant="ghost" onClick={() => nav('inv-recipes', { open: d.recipe.id })}><Pencil className="w-3.5 h-3.5" />{t('عدّل')}</Button> : undefined}>
              <Table dense head={[t('الخامة'), t('الكمية'), t('الهالك'), t('التكلفة'), t('الرصيد')]} align={['start', 'end', 'end', 'end', 'start']} rows={d.recipe.lines.map((l: any) => [
                <button className="font-bold hover:text-[var(--primary)] text-start" data-fb={`item360:ing:${l.itemId}`} onClick={() => nav('item360', { kind: 'item', id: l.itemId })}>{L(l.name)}</button>,
                <span className="num text-xs">{fmtQty(l.enteredQuantity)} {unitLabel(l.enteredUnit?.replace?.('unit_', '').toUpperCase?.() ?? l.unit)}</span>,
                Number(l.wastePercent) ? <span className="num text-xs">{l.wastePercent}%</span> : <span className="text-dim text-xs">—</span>,
                <span className="num text-xs">{money(l.cost)}</span>,
                l.state ? <LevelPill state={l.state} /> : null,
              ])} />
            </Card>
          )}
          {isDish && !d.recipe && !d.item && <Banner tone="warning" title={t('الطبق ده مش بيسحب من المخزن')}>{t('مالوش وصفة ولا رصيد — المبيعات مش هتنزّل أي خامات. اعمله وصفة من «الوصفات والتكلفة» أو اربطه بصنف مخزن.')}</Banner>}

          {/* where used */}
          {!isDish || d.item ? (d.whereUsed?.length > 0 && (
            <Card title={t('داخلة في إيه')} description={t('الأطباق والتحضيرات اللي بتستخدم الصنف ده — اضغط على أي واحد يفتح صفحته.')}>
              <div className="flex flex-wrap gap-2" data-fb="item360:where-used">
                {d.whereUsed.map((w: any) => (
                  <button key={w.recipeId} disabled={!w.target} onClick={() => w.target && nav('item360', { kind: w.target.type, id: w.target.id })} className="rounded-xl surface-1 border border-[var(--glass-border)] px-3 py-2 text-start hover:border-[var(--primary)] disabled:hover:border-[var(--glass-border)]">
                    <div className="text-sm font-bold flex items-center gap-1.5">{w.kind === 'MENU' ? <UtensilsCrossed className="w-3.5 h-3.5 text-dim" /> : w.kind === 'PREP' ? <CookingPot className="w-3.5 h-3.5 text-dim" /> : <Tags className="w-3.5 h-3.5 text-dim" />}{L(w.name)}</div>
                    <div className="text-[11px] text-dim num">{fmtQty(w.enteredQuantity)} {unitLabel(String(w.enteredUnit ?? '').replace('unit_', '').toUpperCase())}{Number(w.perBatch) !== 1 ? ` / ${fmtQty(w.perBatch)}` : ''}{w.sold7 !== null ? ` · ${t('اتباع {n} الأسبوع ده', { n: fmtQty(w.sold7) })}` : ''}</div>
                  </button>
                ))}
              </div>
            </Card>
          )) : null}
          {d.inCombos?.length > 0 && <Card title={t('موجود في الوجبات')}><div className="flex flex-wrap gap-1.5">{d.inCombos.map((c: any) => <button key={c.id} onClick={() => nav('item360', { kind: 'product', id: c.id })}><Pill tone="info">{L(c.name)}</Pill></button>)}</div></Card>}

          {/* documents */}
          {d.docs && (
            <div data-section="docs">
              <Card title={t('المستندات')} description={t('طلبيات المخزن وأوامر الشراء والاستلامات وفواتير الموردين اللي فيها الصنف ده.')}>
                <DocsTabs d={d} unit={unit} />
              </Card>
            </div>
          )}

          {/* movements */}
          {d.can.inventory && stockItemId && (
            <div data-section="moves">
              <Card title={t('آخر الحركات')} padding="sm"><MovementTable items={d.movements} showItem={false} compact empty={t('مفيش حركات لسه')} /></Card>
            </div>
          )}
        </div>

        <div className="space-y-4 min-w-0">
          {/* prices */}
          {d.prices && (
            <Card title={t('السعر في كل قناة')} actions={d.can.price ? <Button size="sm" variant="ghost" onClick={() => setPrice(true)}><Tags className="w-3.5 h-3.5" />{t('غيّر')}</Button> : undefined}>
              <Table dense head={[t('الفرع'), t('القناة'), t('السعر'), t('تكلفة الأكل')]} align={['start', 'start', 'end', 'end']} rows={d.prices.rows.map((r: any) => {
                const fc = d.foodCost.find((f: any) => f.channel === r.channel);
                const mine = d.prices.rows.filter((x: any) => x.branchId === r.branchId);
                return [<span className="text-xs">{tv(r.branchName)}</span>, t(CH[r.channel]), r.amount ? <Money v={r.amount} className="text-sm" /> : <Pill tone="warning" size="sm">{t('مالوش سعر')}</Pill>, fc && mine[0]?.branchId === d.prices.rows[0]?.branchId && r.amount ? <span className="inline-flex items-center gap-1"><Pct v={fc.percent} band={fc.band} /></span> : <span className="text-dim text-xs">—</span>];
              })} />
              {d.foodCost.some((f: any) => f.band === 'HIGH') && <div className="mt-2"><BandPill band="HIGH" /> <span className="text-[11px] text-dim">{t('التكلفة أعلى من 40% من السعر في قناة واحدة على الأقل.')}</span></div>}
              {d.prices.history.length > 0 && (
                <details className="mt-3"><summary className="text-xs text-soft cursor-pointer">{t('تاريخ الأسعار ({n})', { n: d.prices.history.length })}</summary>
                  <div className="mt-2 space-y-1">{d.prices.history.map((h: any) => <div key={h.id} className="text-[11px] flex justify-between gap-2"><span className="text-dim">{dateTime(h.from)} · {tv(h.branchName)} · {t(CH[h.channel])}</span><span className="num">{money(h.amount)}{h.to ? <span className="text-dim"> {t('(انتهى)')}</span> : null}</span></div>)}</div>
                </details>
              )}
            </Card>
          )}

          {/* stock by warehouse + lots */}
          {st && (
            <div data-section="stock">
              <Card title={t('الرصيد في كل مخزن')}>
                <Table dense head={[t('المخزن'), t('الرصيد'), t('الحد / المستهدف'), t('الحالة')]} align={['start', 'end', 'end', 'start']} rows={st.inStock.byWarehouse.map((b: any) => [
                  <span className="text-xs font-bold">{tv(b.warehouse.name)}{b.salesDefault ? ' ★' : ''}</span>, <Qty v={b.quantity} unit={unit} hint={false} />,
                  b.level ? <span className="num text-xs">{fmtQty(b.level.min)} / {fmtQty(b.level.par)}</span> : <span className="text-dim text-xs">—</span>, <LevelPill state={b.state} />,
                ])} />
                {st.inStock.lots.length > 0 && (
                  <div className="mt-3 space-y-1"><div className="text-xs font-bold text-soft">{t('الدفعات والصلاحية (الأقرب الأول)')}</div>
                    {st.inStock.lots.slice(0, 6).map((l: any) => { const days = l.expiryDate ? Math.round((Date.parse(l.expiryDate) - Date.now()) / 86_400_000) : null; return (
                      <div key={l.id} className="flex items-center justify-between gap-2 text-xs rounded-lg surface-1 px-2 py-1"><span className="truncate">{tv(l.warehouse.name)} · <span className="num">{l.lotCode}</span></span><span className="shrink-0 flex items-center gap-1.5"><Qty v={l.remaining} unit={unit} hint={false} />{l.expiryDate && <Pill size="sm" tone={days !== null && days < 0 ? 'error' : days !== null && days <= 2 ? 'warning' : 'neutral'}>{l.expiryDate}</Pill>}</span></div>
                    ); })}
                  </div>
                )}
              </Card>
            </div>
          )}

          {/* suppliers & packs */}
          {d.suppliers?.length > 0 && (
            <Card title={t('الموردين')}>
              <div className="space-y-1.5">{d.suppliers.map((s: any) => (
                <button key={s.supplierId} onClick={() => nav('inv-suppliers', { open: s.supplierId })} className="w-full flex items-center justify-between gap-2 rounded-lg surface-1 px-2.5 py-1.5 text-start hover:surface-2">
                  <span className="min-w-0"><span className="text-sm font-bold truncate block">{tv(s.name)} {s.isDefault && <Pill size="sm" tone="primary">{t('الأساسي')}</Pill>}</span><span className="text-[11px] text-dim">{s.receipts ? t('{n} استلام · آخر مرة {d}', { n: s.receipts, d: dateTime(s.lastAt) }) : t('مفيش استلامات لسه')}</span></span>
                  <span className="text-xs num shrink-0">{money(s.lastUnitCost)}/{unitLabel(unit)}</span>
                </button>
              ))}</div>
            </Card>
          )}
          {stockItemId && d.packs && d.packs.cards.length > 0 && (
            <Card title={t('العبوات — كل عبوة كارت')}><PackCards itemId={stockItemId} compact canEdit={d.can.inventory} /></Card>
          )}
          {d.item?.costHistory?.length > 0 && (
            <Card title={t('تاريخ التكلفة')}>
              <div className="space-y-1">{d.item.costHistory.map((c: any, i: number) => <div key={i} className="flex justify-between text-[11px] gap-2"><span className="text-dim">{dateTime(c.at)}</span><span className="num">{t('سعر الشراء')} {money(c.unitCost)} · {t('المتوسط')} {money(c.avgCost)}</span></div>)}</div>
            </Card>
          )}
        </div>
      </div>

      {stockItemId && drawer && <ItemActionsPopup itemId={stockItemId} kind={drawer} onClose={() => setDrawer(null)} />}
      {receive && stockItemId && <ReceiveDialog presetItemId={stockItemId} presetSupplierId={d.item.defaultSupplierId ?? undefined} onClose={() => setReceive(false)} />}
      {request && stockItemId && <StoreRequestEditor presetItemId={stockItemId} onClose={() => setRequest(false)} onSaved={(sid) => { setRequest(false); nav('inv-purchasing', { tab: 'requests', open: sid }); }} />}
      {price && isDish && <PriceDialog d={d} onClose={() => setPrice(false)} />}
    </div>
  );
}

function Box({ label, value, sub }: { label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode }) {
  return <div className="rounded-xl surface-1 border border-[var(--glass-border)] p-3 min-w-0"><div className="text-[11px] text-soft">{label}</div><div className="text-lg font-bold mt-0.5">{value}</div>{sub && <div className="text-[11px] text-dim truncate">{sub}</div>}</div>;
}

function DocsTabs({ d, unit }: { d: any; unit?: string }) {
  const { nav } = useDev();
  const [tab, setTab] = useState<'sr' | 'po' | 'gr' | 'inv'>(d.docs.purchaseOrders.length ? 'po' : 'gr');
  return (
    <div className="space-y-2">
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'sr', label: t('طلبيات المخزن'), count: d.docs.storeRequests.length }, { id: 'po', label: t('أوامر الشراء'), count: d.docs.purchaseOrders.length },
        { id: 'gr', label: t('الاستلامات'), count: d.docs.receipts.length }, { id: 'inv', label: t('فواتير الموردين'), count: d.docs.invoices.length },
      ]} />
      {tab === 'sr' && <Table dense empty={t('مفيش')} onRowClick={(i) => nav('inv-purchasing', { tab: 'requests', open: d.docs.storeRequests[i].id })} head={[t('الرقم'), t('الحالة'), t('اتطلب'), t('اتعمل أمر'), t('اتستلم')]} align={['start', 'start', 'end', 'end', 'end']} rows={d.docs.storeRequests.map((s: any) => [<span className="num font-bold">{s.number}</span>, <StatePill map={SR_STATE} state={s.state} />, <Qty v={s.requested} unit={unit} hint={false} />, <Qty v={s.ordered} unit={unit} hint={false} />, <Qty v={s.received} unit={unit} hint={false} />])} />}
      {tab === 'po' && <Table dense empty={t('مفيش')} onRowClick={(i) => nav('inv-po', { open: d.docs.purchaseOrders[i].id })} head={[t('الرقم'), t('المورد'), t('الحالة'), t('المطلوب'), t('اتستلم'), t('باقي')]} align={['start', 'start', 'start', 'end', 'end', 'end']} rows={d.docs.purchaseOrders.map((p: any) => [<span className="num font-bold">{p.number}</span>, <span className="text-xs">{tv(p.supplierName)}</span>, <StatePill map={PO_STATE} state={p.state} />, <Qty v={p.ordered} unit={unit} hint={false} />, <Qty v={p.received} unit={unit} hint={false} />, <Qty v={p.outstanding} unit={unit} hint={false} />])} />}
      {tab === 'gr' && <Table dense empty={t('مفيش')} onRowClick={(i) => nav('inv-receipts', { open: d.docs.receipts[i].id })} head={[t('الإذن'), t('المورد'), t('إمتى'), t('الكمية'), t('سعر الوحدة'), t('الفاتورة')]} align={['start', 'start', 'start', 'end', 'end', 'start']} rows={d.docs.receipts.map((r: any) => [<span className="num font-bold">{r.number}</span>, <span className="text-xs">{tv(r.supplierName)}</span>, <span className="text-xs">{dateTime(r.at)}</span>, <Qty v={r.quantity} unit={unit} hint={false} />, <span className="num text-xs">{money(r.unitCost)}</span>, r.state === 'REVERSED' ? <Pill tone="error" size="sm">{t('اتلغى')}</Pill> : r.invoiceId ? <Pill tone="success" size="sm"><FileText className="w-3 h-3" />{t('عليه فاتورة')}</Pill> : <Pill tone="warning" size="sm">{t('من غير فاتورة')}</Pill>])} />}
      {tab === 'inv' && <Table dense empty={t('مفيش')} onRowClick={(i) => nav('inv-purchasing', { tab: 'invoices', open: d.docs.invoices[i].id })} head={[t('الرقم'), t('المورد'), t('النوع'), t('الكمية'), t('الإجمالي')]} align={['start', 'start', 'start', 'end', 'end']} rows={d.docs.invoices.map((x: any) => [<span className="num font-bold">{x.number}</span>, <span className="text-xs">{tv(x.supplierName)}</span>, <Pill size="sm" tone={x.kind === 'DIRECT' ? 'violet' : 'info'}>{x.kind === 'DIRECT' ? t('مباشرة') : t('من الاستلام')}</Pill>, <Qty v={x.quantity} unit={unit} hint={false} />, <Money v={x.total} className="text-xs" />])} />}
    </div>
  );
}

/** Change the dish price per channel (Catalog.SetPrice — the manager-approval popup appears when the rule fires). */
function PriceDialog({ d, onClose }: { d: any; onClose: () => void }) {
  const { run, busy } = useCommand();
  const { auth } = useDev();
  const branchId = auth.branchId ?? d.prices.rows[0]?.branchId;
  const mine = d.prices.rows.filter((r: any) => r.branchId === branchId);
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(mine.map((r: any) => [r.channel, r.amount ? String(Number(r.amount)) : ''])));
  const save = async () => {
    for (const r of mine) {
      const nv = v[r.channel];
      if (!nv || (r.amount && Number(nv) === Number(r.amount))) continue;
      const ok = await run('Catalog.SetPrice', { params: { productId: d.product.id }, body: { amount: nv, currency: 'EGP', branchId, channel: r.channel } }, { success: t('سعر {c} اتغير', { c: t(CH[r.channel]) }) });
      if (!ok) return;
    }
    onClose();
  };
  return (
    <Modal open onClose={onClose} title={t('سعر {n}', { n: L(d.name) })} badge={<StateBadge ops={['Catalog.SetPrice']} />}
      footer={<><Button onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" data-fb="price360:save" loading={busy} onClick={save}>{t('احفظ الأسعار')}</Button></>}>
      <div className="space-y-3">
        {mine.map((r: any) => <Field key={r.channel} label={`${t(CH[r.channel])}${r.amount ? ` — ${t('دلوقتي')} ${money(r.amount)}` : ''}`}><Input data-fb={`price360:${r.channel}`} inputMode="decimal" value={v[r.channel] ?? ''} onChange={(e) => setV({ ...v, [r.channel]: e.target.value.replace(/[^\d.]/g, '') })} /></Field>)}
        <div className="text-[11px] text-dim">{t('السعر الجديد بيسري على الطلبات الجديدة بس. لو التغيير كبير، مدير لازم يوافق.')}</div>
      </div>
    </Modal>
  );
}
