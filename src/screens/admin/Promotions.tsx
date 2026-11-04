// B6 Promotions: the full promotion model (Promotion.Upsert) — a discount on the whole check, on chosen items or
// categories, or "buy X get Y"; automatic (happy hour / dayparts) or with one or more codes; channels, branches, dates,
// usage limits and whether it combines with other discounts. Item promotions price on the check (promo-engine).
import React, { useMemo, useState } from 'react';
import { Plus, Pencil, Save, Ticket, Timer, Radio as RadioIcon, Trash2, Gift, ShoppingBag, Percent, Layers, Package, History, Users } from 'lucide-react';
import { useCommand, useReasonMin } from '../../app/hooks';
import { Button, Card, DateTime, Field, Input, Modal, Money, Pill, Section, StateBadge, Switch, DataTable, cols, Tabs, Textarea } from '../../ui';
import { t, L } from '../../i18n';
import { Tech } from '../../app/tech';
import { dateTime, cn } from '../../lib/format';
import { branchLabel } from '../../demo/people';
import { CHANNELS, Check, LocInputs, Radio, cairoLocal, cairoLocalToIso, channelLabel, useItems, usePolicy } from './catalog/common';

const DAYS = [6, 0, 1, 2, 3, 4, 5];
const dayLabel = (d: number) => [t('الحد'), t('الاتنين'), t('التلات'), t('الأربع'), t('الخميس'), t('الجمعة'), t('السبت')][d];
type Mech = 'ORDER' | 'ITEMS' | 'BUY_X_GET_Y' | 'BUNDLE';
interface BundlePart { productIds: string[]; categoryIds: string[]; qty: string }
type Scope = 'ANY' | 'IDENTIFIED' | 'TIERS';
interface Daypart { days: number[]; start: string; end: string }
interface Draft {
  id: string | null; version: number | null; active: boolean;
  name: { ar: string; en: string }; description: string; kind: 'CODED' | 'AUTOMATIC'; codes: string;
  mechanic: Mech; benefitType: 'PERCENTAGE' | 'FIXED_AMOUNT'; benefitValue: string;
  productIds: string[]; categoryIds: string[]; buyQty: string; getQty: string; getPercent: string; getProductIds: string[]; getCategoryIds: string[]; sameGet: boolean;
  channels: string[]; branchIds: string[]; minSubtotal: string; maxDiscount: string;
  dayparts: Daypart[]; validFrom: string; validTo: string; maxUses: string; maxUsesPerDay: string; stacking: 'EXCLUSIVE' | 'STACKABLE'; priority: string;
  // ux-15
  bundleParts: BundlePart[]; bundlePrice: string; customerScope: Scope; tierIds: string[]; maxUsesPerCustomer: string; maxPerCheck: string; used: number; changeReason: string;
}
const EMPTY: Draft = { id: null, version: null, active: true, name: { ar: '', en: '' }, description: '', kind: 'AUTOMATIC', codes: '', mechanic: 'ORDER', benefitType: 'PERCENTAGE', benefitValue: '10', productIds: [], categoryIds: [], buyQty: '1', getQty: '1', getPercent: '100', getProductIds: [], getCategoryIds: [], sameGet: true, channels: ['DINE_IN', 'TAKEAWAY'], branchIds: [], minSubtotal: '', maxDiscount: '', dayparts: [{ days: [4, 5], start: '17:00', end: '19:00' }], validFrom: '', validTo: '', maxUses: '', maxUsesPerDay: '', stacking: 'EXCLUSIVE', priority: '100',
  bundleParts: [{ productIds: [], categoryIds: [], qty: '1' }, { productIds: [], categoryIds: [], qty: '1' }], bundlePrice: '', customerScope: 'ANY', tierIds: [], maxUsesPerCustomer: '', maxPerCheck: '', used: 0, changeReason: '' };
const MECH: Record<Mech, { label: string; icon: React.ComponentType<{ className?: string }>; help: string }> = {
  ORDER: { label: 'خصم على الشيك كله', icon: Percent, help: 'نسبة أو مبلغ من إجمالي الشيك' },
  ITEMS: { label: 'خصم على أصناف معينة', icon: ShoppingBag, help: 'مثلاً 20% على المشروبات الباردة' },
  BUY_X_GET_Y: { label: 'اشتري وخد', icon: Gift, help: 'مثلاً اشتري 2 شاورما وخد التالتة ببلاش' },
  BUNDLE: { label: 'سعر مجموعة', icon: Package, help: 'مثال: شاورما ومشروب بسعر واحد' },
};

const toDraft = (pr: any): Draft => ({
  id: pr.id, version: pr.version, active: pr.active, name: pr.name, description: pr.description?.ar ?? '', kind: pr.kind, codes: (pr.codes ?? (pr.code ? [pr.code] : [])).join(t('، ')),
  mechanic: pr.mechanic ?? 'ORDER', benefitType: pr.benefitType, benefitValue: pr.benefitValue, productIds: pr.productIds ?? [], categoryIds: pr.categoryIds ?? [],
  buyQty: String(pr.buyQty ?? 1), getQty: String(pr.getQty ?? 1), getPercent: String(pr.getPercent ?? '100'), getProductIds: pr.getProductIds ?? [], getCategoryIds: pr.getCategoryIds ?? [], sameGet: !(pr.getProductIds?.length || pr.getCategoryIds?.length),
  channels: pr.channels, branchIds: pr.branchIds, minSubtotal: pr.minSubtotal ? String(Number(pr.minSubtotal)) : '', maxDiscount: pr.maxDiscount ? String(Number(pr.maxDiscount)) : '',
  dayparts: pr.dayparts ?? (pr.schedule ? [pr.schedule] : []), validFrom: pr.validFrom ? cairoLocal(pr.validFrom) : '', validTo: pr.validTo ? cairoLocal(pr.validTo) : '',
  maxUses: pr.maxUses ? String(pr.maxUses) : '', maxUsesPerDay: pr.maxUsesPerDay ? String(pr.maxUsesPerDay) : '', stacking: pr.stacking ?? 'EXCLUSIVE', priority: String(pr.priority ?? 100),
  bundleParts: pr.bundleParts?.length ? pr.bundleParts.map((x: any) => ({ productIds: x.productIds ?? [], categoryIds: x.categoryIds ?? [], qty: String(x.qty ?? 1) })) : EMPTY.bundleParts, bundlePrice: pr.bundlePrice ? String(Number(pr.bundlePrice)) : '',
  customerScope: pr.customerScope ?? 'ANY', tierIds: pr.tierIds ?? [], maxUsesPerCustomer: pr.maxUsesPerCustomer ? String(pr.maxUsesPerCustomer) : '', maxPerCheck: pr.maxPerCheck ? String(pr.maxPerCheck) : '', used: pr.usage?.total ?? 0, changeReason: '',
});
const bodyOf = (d: Draft, active = d.active) => ({
  name: { ar: d.name.ar.trim(), en: d.name.en.trim() || d.name.ar.trim() }, description: d.description ? { ar: d.description, en: d.description } : null, kind: d.kind,
  codes: d.kind === 'CODED' ? d.codes.split(/[،,\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean) : [],
  mechanic: d.mechanic, benefitType: d.benefitType, benefitValue: d.benefitValue.trim(), productIds: d.productIds, categoryIds: d.categoryIds,
  buyQty: Number(d.buyQty), getQty: Number(d.getQty), getPercent: d.getPercent.trim(), getProductIds: d.sameGet ? [] : d.getProductIds, getCategoryIds: d.sameGet ? [] : d.getCategoryIds,
  channels: d.channels, branchIds: d.branchIds, minSubtotal: d.minSubtotal.trim() || null, maxDiscount: d.maxDiscount.trim() || null, dayparts: d.kind === 'AUTOMATIC' || d.dayparts.length ? d.dayparts : [],
  validFrom: d.validFrom ? cairoLocalToIso(d.validFrom) : null, validTo: d.validTo ? cairoLocalToIso(d.validTo) : null,
  maxUses: d.maxUses ? Number(d.maxUses) : null, maxUsesPerDay: d.maxUsesPerDay ? Number(d.maxUsesPerDay) : null, stacking: d.stacking, priority: Number(d.priority || 100), active, expectedVersion: d.version ?? undefined,
  bundleParts: d.mechanic === 'BUNDLE' ? d.bundleParts.map((x) => ({ productIds: x.productIds, categoryIds: x.categoryIds, qty: Number(x.qty || 1) })) : [], bundlePrice: d.mechanic === 'BUNDLE' ? d.bundlePrice.trim() : null,
  customerScope: d.customerScope, tierIds: d.customerScope === 'TIERS' ? d.tierIds : [], maxUsesPerCustomer: d.maxUsesPerCustomer ? Number(d.maxUsesPerCustomer) : null, maxPerCheck: d.mechanic !== 'ORDER' && d.maxPerCheck ? Number(d.maxPerCheck) : null,
  changeReason: d.changeReason.trim() || undefined,
});

export default function Promotions() {
  const { run, busy } = useCommand();
  const min = useReasonMin();
  const list = useItems<any>('Promotion.Find', { query: { includeInactive: 'true' } });
  const branches = useItems<any>('Branch.List');
  const products = useItems<any>('Catalog.Search', { query: { limit: 500 } });
  const categories = useItems<any>('Category.List');
  const tiers = useItems<any>('LoyaltyTier.List');
  const stacking = usePolicy<{ mode: string; autoApply: boolean }>('DiscountStackingPolicy');
  const rules = usePolicy<{ maxPromotionsPerCheck: number; manualWithPromotion: string }>('PromotionPolicy');
  const [form, setForm] = useState<Draft | null>(null);
  const [toggling, setToggling] = useState<{ pr: any; active: boolean; reason: string } | null>(null);
  const [history, setHistory] = useState<any | null>(null);
  const [filter, setFilter] = useState<'all' | 'live' | 'off'>('all');
  const branchName = (id: string) => branchLabel(branches.items.find((b) => b.id === id)) || id;
  const needReason = !!form?.id && form.used > 0;
  const save = async () => {
    if (!form) return;
    const id = form.id ?? `promo_${Date.now().toString(36)}`;
    const r = await run('Promotion.Upsert', { params: { promotionId: id }, body: bodyOf(form) }, { success: form.id ? t('تم حفظ العرض — الشيكات السابقة تبقى بنسختها') : t('تم إنشاء العرض') });
    if (r) setForm(null);
  };
  // ux-15: switching a used promotion on / off is written with a reason (its revisions)
  const toggle = (pr: any, active: boolean) => ((pr.usage?.total ?? 0) > 0 ? setToggling({ pr, active, reason: '' }) : run('Promotion.Upsert', { params: { promotionId: pr.id }, body: bodyOf(toDraft(pr), active) }, { success: active ? t('تم تفعيل العرض') : t('تم إيقاف العرض') }));
  const confirmToggle = async () => {
    if (!toggling) return;
    const r = await run('Promotion.Upsert', { params: { promotionId: toggling.pr.id }, body: { ...bodyOf(toDraft(toggling.pr), toggling.active), changeReason: toggling.reason.trim() } }, { success: toggling.active ? t('تم تفعيل العرض') : t('تم إيقاف العرض') });
    if (r) setToggling(null);
  };
  const shown = list.items.filter((p) => filter === 'all' || (filter === 'live' ? p.liveNow : !p.active));
  const PC = cols<any>();
  const noStack = stacking?.mode === 'NO_STACKING' || !stacking;
  return (
    <div className="space-y-4">
      <Section title={t('العروض')} badge={<StateBadge ops={['Promotion.Upsert', 'Promotion.Find', 'Promotion.Create', 'Promotion.Configure']} />}
        actions={<><Tabs value={filter} onChange={setFilter} tabs={[{ id: 'all', label: t('الكل') }, { id: 'live', label: t('شغالة دلوقتي') }, { id: 'off', label: t('موقوفة') }]} /><Button data-fb="promotions:new" variant="primary" onClick={() => setForm({ ...EMPTY, branchIds: branches.items.map((b) => b.id).slice(0, 1) })}><Plus className="w-4 h-4" />{t('عرض جديد')}</Button></>} />
      <div className="flex flex-wrap gap-1.5 items-center" data-fb="promotions:rules">
        <Pill tone="neutral"><Layers className="w-3 h-3" />{noStack ? t('خصم واحد على الشيك') : t('حتى {n} عروض على الشيك', { n: rules?.maxPromotionsPerCheck ?? 2 })}</Pill>
        {!noStack && <Pill tone="neutral">{rules?.manualWithPromotion === 'ALLOW' ? t('خصم المدير مع العرض: مسموح') : t('خصم المدير مع العرض: غير مسموح')}</Pill>}
        <Pill tone="neutral"><Timer className="w-3 h-3" />{stacking?.autoApply ? t('العروض التلقائية تُطبَّق وحدها') : t('العروض التلقائية يطبّقها الكاشير')}</Pill>
        <span className="text-xs text-dim">{t('من الإعدادات: التسعير')}</span>
        <Tech><span className="num text-[10px]"> DiscountStackingPolicy {JSON.stringify(stacking)} · PromotionPolicy {JSON.stringify(rules)}</span></Tech>
      </div>
      <DataTable rows={shown} rowKey={(pr: any) => pr.id} label={t('العروض')} empty={t('مفيش عروض')} columns={[
        PC.text('name', t('العرض'), (pr) => L(pr.name), { cell: (pr) => <div className="min-w-[190px] max-w-[240px]"><div className="font-bold">{L(pr.name)}</div>{pr.description?.ar && <div className="text-[11px] text-dim truncate">{L(pr.description)}</div>}<Tech><span className="num text-[10px] text-dim">{pr.id} v{pr.version} · {t('الأولوية')} {pr.priority ?? 100}</span></Tech></div> }),
        PC.custom('gives', t('بيدّي إيه'), (pr) => <div className="text-sm max-w-[260px]">{L(pr.summary)}{pr.minSubtotal && <div className="text-[11px] text-dim">{t('لو الشيك فوق')} <Money v={pr.minSubtotal} /></div>}{pr.maxDiscount && <div className="text-[11px] text-dim">{t('أقصى خصم')} <Money v={pr.maxDiscount} /></div>}{pr.maxPerCheck && <div className="text-[11px] text-dim">{t('حتى {n} في الشيك', { n: pr.maxPerCheck })}</div>}</div>),
        PC.custom('how', t('إزاي'), (pr) => <div className="flex flex-col gap-1 items-start">{pr.kind === 'CODED' ? <Pill tone="primary"><Ticket className="w-3 h-3" />{t('كود')} <span className="num">{(pr.codes ?? []).join(t('، '))}</span></Pill> : <Pill tone="info"><Timer className="w-3 h-3" />{t('أوتوماتيك')}</Pill>}<div className="flex flex-wrap gap-1">{pr.channels.map((c: string) => <Pill key={c} tone="neutral">{channelLabel(c)}</Pill>)}</div><span className="text-[11px] text-dim">{pr.branchIds.length ? pr.branchIds.map(branchName).join(t('، ')) : t('كل الفروع')}</span>{pr.stacking === 'STACKABLE' && <Pill tone="violet"><Layers className="w-3 h-3" />{t('بيتجمع')}</Pill>}{pr.customerScope && pr.customerScope !== 'ANY' && <Pill tone="violet"><Users className="w-3 h-3" />{pr.customerScope === 'TIERS' ? (pr.tierNames ?? []).map((n: any) => L(n)).join(t('، ')) : t('عملاء مسجلون')}</Pill>}</div>),
        PC.custom('when', t('إمتى'), (pr) => (<div className="text-xs">
          {pr.dayparts?.length ? pr.dayparts.map((dp: Daypart, i: number) => <div key={i} className="whitespace-nowrap">{dp.days.length === 7 ? t('كل يوم') : dp.days.map(dayLabel).join(t('، '))} <span className="num">{dp.start}–{dp.end}</span></div>) : <span className="text-dim">{t('طول الوقت')}</span>}
          {(pr.validFrom || pr.validTo) && <div className="text-dim">{pr.validFrom ? <DateTime v={new Date(pr.validFrom).toISOString()} /> : '…'} ← {pr.validTo ? <DateTime v={new Date(pr.validTo).toISOString()} /> : '…'}</div>}
        </div>)),
        PC.number('usage', t('الاستخدام'), (pr) => pr.usage?.total ?? 0, { align: 'start', cell: (pr) => <div className="text-xs whitespace-nowrap"><div>{t('النهارده')}: <b className="num">{pr.usage?.today ?? 0}</b>{pr.maxUsesPerDay ? <span className="text-dim"> / {pr.maxUsesPerDay}</span> : null}</div><div>{t('الإجمالي')}: <b className="num">{pr.usage?.total ?? 0}</b>{pr.maxUses ? <span className="text-dim"> / {pr.maxUses}</span> : null}</div>{pr.maxUsesPerCustomer && <div className="text-dim">{t('لكل عميل: {n}', { n: pr.maxUsesPerCustomer })}</div>}{pr.exhausted && <Pill tone="warning">{t('خلص')}</Pill>}</div> }),
        PC.status('live', t('شغال دلوقتي'), (pr) => (pr.liveNow && !pr.exhausted ? { label: t('شغال'), tone: 'success' } : { label: t('لأ'), tone: 'neutral' }), { cell: (pr) => pr.liveNow && !pr.exhausted ? <Pill tone="success"><RadioIcon className="w-3 h-3" />{t('شغال')}</Pill> : <Pill tone="neutral">{t('لأ')}</Pill> }),
        PC.custom('active', t('مفعّل'), (pr) => <Switch checked={pr.active} onChange={(v) => toggle(pr, v)} />),
        PC.actions('act', (pr) => <>
          <Button size="sm" variant="ghost" data-fb={`promotion:history:${pr.id}`} onClick={() => setHistory(pr)} title={t('سجل العرض')}><History className="w-3.5 h-3.5" /></Button>
          <Button size="sm" data-fb={`promotion:edit:${pr.id}`} onClick={() => setForm(toDraft(pr))}><Pencil className="w-3.5 h-3.5" />{t('تعديل')}</Button>
        </>),
      ]} />

      <Modal open={!!form} onClose={() => setForm(null)} xwide title={form?.id ? t('تعديل العرض') : t('عرض جديد')} badge={<StateBadge ops={['Promotion.Upsert']} />}
        footer={<>{needReason && <Input data-fb="promotion-form:reason" value={form!.changeReason} onChange={(e) => setForm({ ...form!, changeReason: e.target.value })} placeholder={t('سبب التعديل ({n} أحرف على الأقل)', { n: min })} className="max-w-md" maxLength={200} />}<div className="flex-1" /><Button onClick={() => setForm(null)}>{t('إلغاء')}</Button><Button data-fb="promotion-form:save" variant="primary" loading={busy} onClick={save} disabled={!form?.name.ar.trim() || !form?.channels.length || (needReason && form!.changeReason.trim().length < min)}><Save className="w-4 h-4" />{t('حفظ')}</Button></>}>
        {form && <PromoForm d={form} set={setForm} branches={branches.items} products={products.items} categories={categories.items} tiers={tiers.items} />}
      </Modal>
      <Modal open={!!toggling} onClose={() => setToggling(null)} size="sm" title={toggling?.active ? t('تفعيل «{n}»', { n: L(toggling?.pr.name) }) : t('إيقاف «{n}»', { n: L(toggling?.pr.name) })} badge={<StateBadge ops={['Promotion.Upsert']} />}
        footer={<><Button variant="ghost" onClick={() => setToggling(null)}>{t('إلغاء')}</Button><Button variant={toggling?.active ? 'primary' : 'danger'} loading={busy} disabled={(toggling?.reason.trim().length ?? 0) < min} onClick={confirmToggle} data-fb="promotion-toggle:confirm">{toggling?.active ? t('تفعيل العرض') : t('إيقاف العرض')}</Button></>}>
        {toggling && <div className="space-y-3"><Pill tone="neutral">{t('استُخدم في {n} شيك', { n: toggling.pr.usage?.total ?? 0 })}</Pill><Field label={t('السبب')} required hint={t('{n} أحرف على الأقل', { n: min })}><Textarea value={toggling.reason} onChange={(e) => setToggling({ ...toggling, reason: e.target.value })} maxLength={200} data-fb="promotion-toggle:reason" /></Field></div>}
      </Modal>
      <Modal open={!!history} onClose={() => setHistory(null)} wide title={t('سجل «{n}»', { n: L(history?.name) })} badge={<StateBadge ops={['Promotion.Find']} />}>
        {history && <DataTable dense rows={history.revisions ?? []} rowKey={(r: any) => r.version} empty={t('لا يوجد سجل')} defaultSort={{ id: 'version', dir: 'desc' }} columns={[
          PC.number('version', t('النسخة'), (r) => r.version, { align: 'start', cell: (r) => <span className="num">v{r.version}</span> }),
          PC.status('change', t('التغيير'), (r) => ({ label: t(REV[r.change] ?? r.change), tone: r.change === 'DEACTIVATED' ? 'warning' : r.change === 'CREATED' ? 'success' : 'neutral' })),
          PC.text('summary', t('العرض'), (r) => L(r.summary), { maxChars: 40 }),
          PC.text('reason', t('السبب'), (r) => r.reason, { maxChars: 32 }),
          PC.date('at', t('بواسطة'), (r) => r.at, { cell: (r) => <span className="text-[11px] text-dim">{r.byName} · <DateTime v={r.at} /></span> }),
        ]} />}
      </Modal>
    </div>
  );
}
const REV: Record<string, string> = { CREATED: 'إنشاء', EDITED: 'تعديل', ACTIVATED: 'تفعيل', DEACTIVATED: 'إيقاف' };

function Picker({ products, categories, pIds, cIds, onChange, fb }: { products: any[]; categories: any[]; pIds: string[]; cIds: string[]; onChange: (p: string[], c: string[]) => void; fb: string }) {
  const [q, setQ] = useState('');
  const shownP = products.filter((p) => p.active && (!q || L(p.name).includes(q))).slice(0, 60);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">{categories.filter((c) => c.active).map((c) => <Check key={c.id} fb={`${fb}:cat:${c.id}`} checked={cIds.includes(c.id)} onChange={(on) => onChange(pIds, on ? [...cIds, c.id] : cIds.filter((x) => x !== c.id))}>{t('قسم')}: {L(c.name)}</Check>)}</div>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('دوّر على صنف…')} />
      <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">{shownP.map((p) => <Check key={p.id} fb={`${fb}:p:${p.sku}`} checked={pIds.includes(p.id)} onChange={(on) => onChange(on ? [...pIds, p.id] : pIds.filter((x) => x !== p.id), cIds)}>{L(p.name)}</Check>)}</div>
      {(pIds.length > 0 || cIds.length > 0) && <div className="text-[11px] text-dim">{t('اخترت')}: {[...cIds.map((id) => L(categories.find((c) => c.id === id)?.name)), ...pIds.map((id) => L(products.find((p) => p.id === id)?.name))].join(t('، '))}</div>}
    </div>
  );
}

function PromoForm({ d, set, branches, products, categories, tiers }: { d: Draft; set: (d: Draft) => void; branches: any[]; products: any[]; categories: any[]; tiers: any[] }) {
  const toggleIn = <T,>(arr: T[], v: T, on: boolean) => (on ? [...arr, v] : arr.filter((x) => x !== v));
  const editing = !!d.id;
  const preview = useMemo(() => {
    const scope = [...d.categoryIds.map((id) => L(categories.find((c) => c.id === id)?.name)), ...d.productIds.map((id) => L(products.find((p) => p.id === id)?.name))].join(t('، '));
    const ben = d.benefitType === 'PERCENTAGE' ? `${d.benefitValue || '?'}%` : `${d.benefitValue || '?'} ${t('جنيه')}`;
    if (d.mechanic === 'ORDER') return t('خصم {b} على الشيك كله', { b: ben });
    if (d.mechanic === 'BUNDLE') return t('{p} بسعر {v} ج.م', { p: d.bundleParts.map((x) => `${x.qty || '?'} × ${[...x.categoryIds.map((id) => L(categories.find((c) => c.id === id)?.name)), ...x.productIds.map((id) => L(products.find((p) => p.id === id)?.name))].join(t('، ')) || '…'}`).join(' + '), v: d.bundlePrice || '?' });
    if (d.mechanic === 'ITEMS') return t('خصم {b} على {s}', { b: ben, s: scope || '…' });
    const get = d.sameGet ? scope : [...d.getCategoryIds.map((id) => L(categories.find((c) => c.id === id)?.name)), ...d.getProductIds.map((id) => L(products.find((p) => p.id === id)?.name))].join(t('، '));
    return t('اشتري {x} من {s} وخد {y} من {g} {o}', { x: d.buyQty, s: scope || '…', y: d.getQty, g: get || '…', o: Number(d.getPercent) >= 100 ? t('ببلاش') : t('بخصم {p}%', { p: d.getPercent }) });
  }, [d, products, categories]);
  return (
    <div className="grid lg:grid-cols-2 gap-5">
      <div className="space-y-4">
        <LocInputs value={d.name} onChange={(name) => set({ ...d, name })} fb="promotion-form" />
        <Field label={t('وصف قصير يظهر للكاشير (اختياري)')}><Input value={d.description} onChange={(e) => set({ ...d, description: e.target.value })} /></Field>
        <Field label={t('نوع العرض')}>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">{(Object.keys(MECH) as Mech[]).map((m) => { const M = MECH[m]; return (
            <button key={m} type="button" onClick={() => set({ ...d, mechanic: m })} data-fb={`promotion-form:mechanic:${m}`} className={cn('rounded-xl border p-2.5 text-start', d.mechanic === m ? 'border-[var(--primary)] bg-[var(--primary-container)]' : 'border-[var(--glass-border)] surface-1')}>
              <M.icon className="w-4 h-4 mb-1 text-[var(--primary)]" /><div className="text-sm font-bold">{t(M.label)}</div><div className="text-[10px] text-dim">{t(M.help)}</div>
            </button>); })}</div>
        </Field>
        {d.mechanic !== 'BUY_X_GET_Y' && d.mechanic !== 'BUNDLE' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('الخصم')}><Radio<'PERCENTAGE' | 'FIXED_AMOUNT'> fb="promotion-form:benefit" value={d.benefitType} onChange={(v) => set({ ...d, benefitType: v })} options={[{ value: 'PERCENTAGE', label: t('نسبة %') }, { value: 'FIXED_AMOUNT', label: d.mechanic === 'ITEMS' ? t('جنيه على كل صنف') : t('مبلغ ثابت') }]} /></Field>
            <Field label={d.benefitType === 'PERCENTAGE' ? t('النسبة %') : t('المبلغ (جنيه)')}><Input data-fb="promotion-form:value" inputMode="decimal" value={d.benefitValue} onChange={(e) => set({ ...d, benefitValue: e.target.value })} /></Field>
          </div>
        )}
        {d.mechanic === 'BUNDLE' && (
          <Card title={t('أجزاء المجموعة')} actions={<Button size="sm" variant="ghost" disabled={d.bundleParts.length >= 6} onClick={() => set({ ...d, bundleParts: [...d.bundleParts, { productIds: [], categoryIds: [], qty: '1' }] })} data-fb="promotion-form:bundle-add"><Plus className="w-3.5 h-3.5" />{t('جزء')}</Button>}>
            <div className="space-y-3">
              {d.bundleParts.map((part, i) => (
                <div key={i} className="rounded-lg surface-1 p-2 space-y-2" data-fb={`promotion-form:bundle-part:${i}`}>
                  <div className="flex items-end gap-2">
                    <span className="text-sm font-bold">{t('الجزء {n}', { n: i + 1 })}</span>
                    <div className="flex-1" />
                    <Field label={t('العدد')} className="w-24"><Input type="number" min={1} max={10} value={part.qty} onChange={(e) => set({ ...d, bundleParts: d.bundleParts.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)) })} data-fb={`promotion-form:bundle-qty:${i}`} /></Field>
                    <Button size="sm" variant="ghost" disabled={d.bundleParts.length <= 2} onClick={() => set({ ...d, bundleParts: d.bundleParts.filter((_, j) => j !== i) })}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </div>
                  <Picker products={products} categories={categories} pIds={part.productIds} cIds={part.categoryIds} onChange={(pp, cc) => set({ ...d, bundleParts: d.bundleParts.map((x, j) => (j === i ? { ...x, productIds: pp, categoryIds: cc } : x)) })} fb={`promotion-form:bundle:${i}`} />
                </div>
              ))}
              <Field label={t('سعر المجموعة (ج.م)')}><Input data-fb="promotion-form:bundle-price" inputMode="decimal" value={d.bundlePrice} onChange={(e) => set({ ...d, bundlePrice: e.target.value })} /></Field>
            </div>
          </Card>
        )}
        {d.mechanic !== 'ORDER' && d.mechanic !== 'BUNDLE' && (
          <Card title={d.mechanic === 'ITEMS' ? t('على أنهي أصناف؟') : t('الزبون يشتري إيه؟')}>
            <Picker products={products} categories={categories} pIds={d.productIds} cIds={d.categoryIds} onChange={(p, c) => set({ ...d, productIds: p, categoryIds: c })} fb="promotion-form:scope" />
          </Card>
        )}
        {d.mechanic === 'BUY_X_GET_Y' && (
          <Card title={t('وياخد إيه؟')}>
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <Field label={t('يشتري كام')}><Input type="number" min={1} value={d.buyQty} onChange={(e) => set({ ...d, buyQty: e.target.value })} data-fb="promotion-form:buy" /></Field>
                <Field label={t('ياخد كام')}><Input type="number" min={1} value={d.getQty} onChange={(e) => set({ ...d, getQty: e.target.value })} data-fb="promotion-form:get" /></Field>
                <Field label={t('بخصم %')} hint={t('100 = ببلاش')}><Input inputMode="decimal" value={d.getPercent} onChange={(e) => set({ ...d, getPercent: e.target.value })} /></Field>
              </div>
              <Switch checked={d.sameGet} onChange={(v) => set({ ...d, sameGet: v })} label={t('ياخد من نفس الأصناف (الأرخص هو اللي عليه الخصم)')} />
              {!d.sameGet && <Picker products={products} categories={categories} pIds={d.getProductIds} cIds={d.getCategoryIds} onChange={(p, c) => set({ ...d, getProductIds: p, getCategoryIds: c })} fb="promotion-form:get" />}
            </div>
          </Card>
        )}
        <div className="rounded-xl border border-[color-mix(in_srgb,var(--primary)_40%,transparent)] bg-[var(--primary-container)] px-3 py-2 text-sm" data-fb="promotion-form:preview"><b>{t('العرض هيبقى')}: </b>{preview}</div>
      </div>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('بيشتغل إزاي')} hint={editing ? t('ده مش بيتغير بعد ما العرض يتعمل') : undefined}>
            <Radio<'CODED' | 'AUTOMATIC'> fb="promotion-form:kind" value={d.kind} onChange={(v) => !editing && set({ ...d, kind: v })} options={[{ value: 'AUTOMATIC', label: t('أوتوماتيك') }, { value: 'CODED', label: t('بكود') }]} />
          </Field>
          {d.kind === 'CODED' && <Field label={t('الأكواد')} hint={t('كود أو أكتر، بينهم فاصلة')}><Input data-fb="promotion-form:code" value={d.codes} onChange={(e) => set({ ...d, codes: e.target.value })} dir="ltr" placeholder="RAMADAN25, VIP10" /></Field>}
        </div>
        <Field label={t('على أنهي طلبات')}><div className="flex flex-wrap gap-1.5">{CHANNELS.map((c) => <Check key={c} fb={`promotion-form:channel:${c}`} checked={d.channels.includes(c)} onChange={(on) => set({ ...d, channels: toggleIn(d.channels, c as string, on) })}>{channelLabel(c)}</Check>)}</div></Field>
        <Field label={t('الفروع')} hint={t('من غير اختيار = كل الفروع')}><div className="flex flex-wrap gap-1.5">{branches.map((b) => <Check key={b.id} fb={`promotion-form:branch:${b.id}`} checked={d.branchIds.includes(b.id)} onChange={(on) => set({ ...d, branchIds: toggleIn(d.branchIds, b.id, on) })}>{branchLabel(b)}</Check>)}</div></Field>
        <Card title={<span className="inline-flex items-center gap-2"><Timer className="w-4 h-4" />{t('المواعيد')}</span>} actions={<Button size="sm" variant="ghost" onClick={() => set({ ...d, dayparts: [...d.dayparts, { days: [0, 1, 2, 3, 4, 5, 6], start: '13:00', end: '16:00' }] })} data-fb="promotion-form:add-daypart"><Plus className="w-3.5 h-3.5" />{t('فترة')}</Button>}>
          {d.dayparts.length === 0 ? <div className="text-sm text-dim">{t('شغال طول اليوم جوه فترة الصلاحية')}</div> : (
            <div className="space-y-3">{d.dayparts.map((dp, i) => (
              <div key={i} className="rounded-lg surface-1 p-2 space-y-2">
                <div className="flex flex-wrap gap-1">{DAYS.map((x) => <Check key={x} checked={dp.days.includes(x)} onChange={(on) => set({ ...d, dayparts: d.dayparts.map((y, j) => (j === i ? { ...y, days: toggleIn(y.days, x, on).sort() } : y)) })}>{dayLabel(x)}</Check>)}</div>
                <div className="flex items-center gap-2"><span className="text-xs">{t('من')}</span><Input type="time" value={dp.start} onChange={(e) => set({ ...d, dayparts: d.dayparts.map((y, j) => (j === i ? { ...y, start: e.target.value } : y)) })} dir="ltr" className="w-32" /><span className="text-xs">{t('لحد')}</span><Input type="time" value={dp.end} onChange={(e) => set({ ...d, dayparts: d.dayparts.map((y, j) => (j === i ? { ...y, end: e.target.value } : y)) })} dir="ltr" className="w-32" /><Button size="sm" variant="ghost" onClick={() => set({ ...d, dayparts: d.dayparts.filter((_, j) => j !== i) })}><Trash2 className="w-3.5 h-3.5" /></Button></div>
              </div>
            ))}<div className="text-[11px] text-dim">{t('بتوقيت الفرع. لو النهاية قبل البداية الفترة بتعدي نص الليل.')}</div></div>
          )}
        </Card>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('صالح من (اختياري)')}><Input type="datetime-local" value={d.validFrom} onChange={(e) => set({ ...d, validFrom: e.target.value })} dir="ltr" /></Field>
          <Field label={t('صالح لحد (اختياري)')}><Input type="datetime-local" value={d.validTo} onChange={(e) => set({ ...d, validTo: e.target.value })} dir="ltr" /></Field>
          <Field label={t('لو الشيك فوق (جنيه)')} hint={t('اختياري')}><Input data-fb="promotion-form:min" inputMode="decimal" value={d.minSubtotal} onChange={(e) => set({ ...d, minSubtotal: e.target.value })} /></Field>
          <Field label={t('أقصى خصم (جنيه)')} hint={t('اختياري')}><Input inputMode="decimal" value={d.maxDiscount} onChange={(e) => set({ ...d, maxDiscount: e.target.value })} /></Field>
          <Field label={t('أقصى عدد شيكات في اليوم')} hint={t('اختياري')}><Input type="number" min={1} value={d.maxUsesPerDay} onChange={(e) => set({ ...d, maxUsesPerDay: e.target.value })} data-fb="promotion-form:per-day" /></Field>
          <Field label={t('أقصى عدد شيكات خالص')} hint={t('اختياري')}><Input type="number" min={1} value={d.maxUses} onChange={(e) => set({ ...d, maxUses: e.target.value })} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('مع خصومات تانية؟')}><Radio<'EXCLUSIVE' | 'STACKABLE'> fb="promotion-form:stacking" value={d.stacking} onChange={(v) => set({ ...d, stacking: v })} options={[{ value: 'EXCLUSIVE', label: t('لوحده بس') }, { value: 'STACKABLE', label: t('ينفع يتجمع') }]} /></Field>
          <Field label={t('الأولوية')} hint={t('الأقل يُطبَّق أولًا')}><Input type="number" min={1} max={999} value={d.priority} onChange={(e) => set({ ...d, priority: e.target.value })} data-fb="promotion-form:priority" /></Field>
          {d.mechanic !== 'ORDER' && <Field label={t('حد في الشيك الواحد')} hint={d.mechanic === 'ITEMS' ? t('عدد الأصناف') : d.mechanic === 'BUNDLE' ? t('عدد المجموعات') : t('عدد المرات')}><Input type="number" min={1} value={d.maxPerCheck} onChange={(e) => set({ ...d, maxPerCheck: e.target.value })} data-fb="promotion-form:per-check" /></Field>}
        </div>
        <Card title={<span className="inline-flex items-center gap-2"><Users className="w-4 h-4" />{t('لمن')}</span>}>
          <div className="space-y-3">
            <Radio<Scope> fb="promotion-form:customer" value={d.customerScope} onChange={(v) => set({ ...d, customerScope: v })} options={[{ value: 'ANY', label: t('لكل الطلبات') }, { value: 'IDENTIFIED', label: t('عملاء مسجلون') }, { value: 'TIERS', label: t('مستويات الولاء') }]} />
            {d.customerScope === 'TIERS' && <div className="flex flex-wrap gap-1.5">{tiers.filter((x) => x.active).map((x) => <Check key={x.id} fb={`promotion-form:tier:${x.id}`} checked={d.tierIds.includes(x.id)} onChange={(on) => set({ ...d, tierIds: toggleIn(d.tierIds, x.id, on) })}>{L(x.name)}</Check>)}</div>}
            <Field label={t('مرات لكل عميل')} hint={t('اختياري — يحتاج عميلًا على الشيك')}><Input type="number" min={1} value={d.maxUsesPerCustomer} onChange={(e) => set({ ...d, maxUsesPerCustomer: e.target.value })} data-fb="promotion-form:per-customer" /></Field>
          </div>
        </Card>
      </div>
    </div>
  );
}
