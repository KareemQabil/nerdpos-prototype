// B6 Promotions: the full promotion model (Promotion.Upsert) — a discount on the whole check, on chosen items or
// categories, or "buy X get Y"; automatic (happy hour / dayparts) or with one or more codes; channels, branches, dates,
// usage limits and whether it combines with other discounts. Item promotions price on the check (promo-engine).
import React, { useMemo, useState } from 'react';
import { Plus, Pencil, Save, Ticket, Timer, Radio as RadioIcon, Trash2, Gift, ShoppingBag, Percent, Layers } from 'lucide-react';
import { useCommand } from '../../app/hooks';
import { Banner, Button, Card, Field, Input, Modal, Money, Pill, Section, StateBadge, Switch, Table, Tabs } from '../../ui';
import { t, L } from '../../i18n';
import { Tech } from '../../app/tech';
import { dateTime, cn } from '../../lib/format';
import { branchLabel } from '../../demo/people';
import { CHANNELS, Check, LocInputs, Radio, cairoLocal, cairoLocalToIso, channelLabel, useItems, usePolicy } from './catalog/common';

const DAYS = [6, 0, 1, 2, 3, 4, 5];
const dayLabel = (d: number) => [t('الحد'), t('الاتنين'), t('التلات'), t('الأربع'), t('الخميس'), t('الجمعة'), t('السبت')][d];
type Mech = 'ORDER' | 'ITEMS' | 'BUY_X_GET_Y';
interface Daypart { days: number[]; start: string; end: string }
interface Draft {
  id: string | null; version: number | null; active: boolean;
  name: { ar: string; en: string }; description: string; kind: 'CODED' | 'AUTOMATIC'; codes: string;
  mechanic: Mech; benefitType: 'PERCENTAGE' | 'FIXED_AMOUNT'; benefitValue: string;
  productIds: string[]; categoryIds: string[]; buyQty: string; getQty: string; getPercent: string; getProductIds: string[]; getCategoryIds: string[]; sameGet: boolean;
  channels: string[]; branchIds: string[]; minSubtotal: string; maxDiscount: string;
  dayparts: Daypart[]; validFrom: string; validTo: string; maxUses: string; maxUsesPerDay: string; stacking: 'EXCLUSIVE' | 'STACKABLE'; priority: string;
}
const EMPTY: Draft = { id: null, version: null, active: true, name: { ar: '', en: '' }, description: '', kind: 'AUTOMATIC', codes: '', mechanic: 'ORDER', benefitType: 'PERCENTAGE', benefitValue: '10', productIds: [], categoryIds: [], buyQty: '1', getQty: '1', getPercent: '100', getProductIds: [], getCategoryIds: [], sameGet: true, channels: ['DINE_IN', 'TAKEAWAY'], branchIds: [], minSubtotal: '', maxDiscount: '', dayparts: [{ days: [4, 5], start: '17:00', end: '19:00' }], validFrom: '', validTo: '', maxUses: '', maxUsesPerDay: '', stacking: 'EXCLUSIVE', priority: '100' };
const MECH: Record<Mech, { label: string; icon: React.ComponentType<{ className?: string }>; help: string }> = {
  ORDER: { label: 'خصم على الشيك كله', icon: Percent, help: 'نسبة أو مبلغ من إجمالي الشيك' },
  ITEMS: { label: 'خصم على أصناف معينة', icon: ShoppingBag, help: 'مثلاً 20% على المشروبات الباردة' },
  BUY_X_GET_Y: { label: 'اشتري وخد', icon: Gift, help: 'مثلاً اشتري 2 شاورما وخد التالتة ببلاش' },
};

const toDraft = (pr: any): Draft => ({
  id: pr.id, version: pr.version, active: pr.active, name: pr.name, description: pr.description?.ar ?? '', kind: pr.kind, codes: (pr.codes ?? (pr.code ? [pr.code] : [])).join(t('، ')),
  mechanic: pr.mechanic ?? 'ORDER', benefitType: pr.benefitType, benefitValue: pr.benefitValue, productIds: pr.productIds ?? [], categoryIds: pr.categoryIds ?? [],
  buyQty: String(pr.buyQty ?? 1), getQty: String(pr.getQty ?? 1), getPercent: String(pr.getPercent ?? '100'), getProductIds: pr.getProductIds ?? [], getCategoryIds: pr.getCategoryIds ?? [], sameGet: !(pr.getProductIds?.length || pr.getCategoryIds?.length),
  channels: pr.channels, branchIds: pr.branchIds, minSubtotal: pr.minSubtotal ? String(Number(pr.minSubtotal)) : '', maxDiscount: pr.maxDiscount ? String(Number(pr.maxDiscount)) : '',
  dayparts: pr.dayparts ?? (pr.schedule ? [pr.schedule] : []), validFrom: pr.validFrom ? cairoLocal(pr.validFrom) : '', validTo: pr.validTo ? cairoLocal(pr.validTo) : '',
  maxUses: pr.maxUses ? String(pr.maxUses) : '', maxUsesPerDay: pr.maxUsesPerDay ? String(pr.maxUsesPerDay) : '', stacking: pr.stacking ?? 'EXCLUSIVE', priority: String(pr.priority ?? 100),
});
const bodyOf = (d: Draft, active = d.active) => ({
  name: { ar: d.name.ar.trim(), en: d.name.en.trim() || d.name.ar.trim() }, description: d.description ? { ar: d.description, en: d.description } : null, kind: d.kind,
  codes: d.kind === 'CODED' ? d.codes.split(/[،,\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean) : [],
  mechanic: d.mechanic, benefitType: d.benefitType, benefitValue: d.benefitValue.trim(), productIds: d.productIds, categoryIds: d.categoryIds,
  buyQty: Number(d.buyQty), getQty: Number(d.getQty), getPercent: d.getPercent.trim(), getProductIds: d.sameGet ? [] : d.getProductIds, getCategoryIds: d.sameGet ? [] : d.getCategoryIds,
  channels: d.channels, branchIds: d.branchIds, minSubtotal: d.minSubtotal.trim() || null, maxDiscount: d.maxDiscount.trim() || null, dayparts: d.kind === 'AUTOMATIC' || d.dayparts.length ? d.dayparts : [],
  validFrom: d.validFrom ? cairoLocalToIso(d.validFrom) : null, validTo: d.validTo ? cairoLocalToIso(d.validTo) : null,
  maxUses: d.maxUses ? Number(d.maxUses) : null, maxUsesPerDay: d.maxUsesPerDay ? Number(d.maxUsesPerDay) : null, stacking: d.stacking, priority: Number(d.priority || 100), active, expectedVersion: d.version ?? undefined,
});

export default function Promotions() {
  const { run, busy } = useCommand();
  const list = useItems<any>('Promotion.Find', { query: { includeInactive: 'true' } });
  const branches = useItems<any>('Branch.List');
  const products = useItems<any>('Catalog.Search', { query: { limit: 500 } });
  const categories = useItems<any>('Category.List');
  const stacking = usePolicy<{ mode: string; autoApply: boolean }>('DiscountStackingPolicy');
  const [form, setForm] = useState<Draft | null>(null);
  const [filter, setFilter] = useState<'all' | 'live' | 'off'>('all');
  const branchName = (id: string) => branchLabel(branches.items.find((b) => b.id === id)) || id;
  const save = async () => {
    if (!form) return;
    const id = form.id ?? `promo_${Date.now().toString(36)}`;
    const r = await run('Promotion.Upsert', { params: { promotionId: id }, body: bodyOf(form) }, { success: form.id ? t('العرض اتعدل — الشيكات اللي عليها العرض بتفضل بالنسخة القديمة') : t('العرض اتعمل') });
    if (r) setForm(null);
  };
  const toggle = (pr: any, active: boolean) => run('Promotion.Upsert', { params: { promotionId: pr.id }, body: bodyOf(toDraft(pr), active) }, { success: active ? t('العرض اتفعّل') : t('العرض اتوقف') });
  const shown = list.items.filter((p) => filter === 'all' || (filter === 'live' ? p.liveNow : !p.active));
  return (
    <div className="space-y-4">
      <Section title={t('العروض')} badge={<StateBadge ops={['Promotion.Upsert', 'Promotion.Find', 'Promotion.Create', 'Promotion.Configure']} />}
        sub={t('هابي أور، خصم على أصناف معينة، اشتري وخد، وأكواد خصم — بمواعيد وحدود استخدام. السيستم هو اللي بيحسب الخصم على الشيك.')}
        actions={<><Tabs value={filter} onChange={setFilter} tabs={[{ id: 'all', label: t('الكل') }, { id: 'live', label: t('شغالة دلوقتي') }, { id: 'off', label: t('موقوفة') }]} /><Button data-fb="promotions:new" variant="primary" onClick={() => setForm({ ...EMPTY, branchIds: branches.items.map((b) => b.id).slice(0, 1) })}><Plus className="w-4 h-4" />{t('عرض جديد')}</Button></>} />
      <Banner tone="info">
        {stacking?.mode === 'NO_STACKING' || !stacking ? t('الشيك عليه خصم واحد بس: يا عرض يا خصم مدير.') : t('ينفع أكتر من خصم على نفس الشيك — بس العرض اللي متعلم "لوحده" مش بيتجمع مع حاجة.')}{' '}
        {stacking?.autoApply ? t('العروض الأوتوماتيك بتتطبق لوحدها أول ما الشيك يستاهلها.') : t('العروض الأوتوماتيك بتظهر للكاشير كاقتراح وهو اللي بيطبقها.')}
        <span className="text-xs text-dim"> {t('(بيتغير من الإعدادات: الخصومات)')}</span>
        <Tech><span className="num text-[10px]"> DiscountStackingPolicy {JSON.stringify(stacking)}</span></Tech>
      </Banner>
      <Table head={[t('العرض'), t('بيدّي إيه'), t('إزاي'), t('إمتى'), t('الاستخدام'), t('شغال دلوقتي'), t('مفعّل'), '']} rows={shown.map((pr) => [
        <div className="max-w-[220px]"><div className="font-bold">{L(pr.name)}</div>{pr.description?.ar && <div className="text-[11px] text-dim truncate">{L(pr.description)}</div>}<Tech><span className="num text-[10px] text-dim">{pr.id} v{pr.version}</span></Tech></div>,
        <div className="text-sm max-w-[260px]">{L(pr.summary)}{pr.minSubtotal && <div className="text-[11px] text-dim">{t('لو الشيك فوق')} <Money v={pr.minSubtotal} /></div>}{pr.maxDiscount && <div className="text-[11px] text-dim">{t('أقصى خصم')} <Money v={pr.maxDiscount} /></div>}</div>,
        <div className="flex flex-col gap-1 items-start">{pr.kind === 'CODED' ? <Pill tone="primary"><Ticket className="w-3 h-3" />{t('كود')} <span className="num">{(pr.codes ?? []).join(t('، '))}</span></Pill> : <Pill tone="info"><Timer className="w-3 h-3" />{t('أوتوماتيك')}</Pill>}<div className="flex flex-wrap gap-1">{pr.channels.map((c: string) => <Pill key={c} tone="neutral">{channelLabel(c)}</Pill>)}</div><span className="text-[11px] text-dim">{pr.branchIds.length ? pr.branchIds.map(branchName).join(t('، ')) : t('كل الفروع')}</span>{pr.stacking === 'STACKABLE' && <Pill tone="violet"><Layers className="w-3 h-3" />{t('بيتجمع')}</Pill>}</div>,
        <div className="text-xs">
          {pr.dayparts?.length ? pr.dayparts.map((dp: Daypart, i: number) => <div key={i}>{dp.days.length === 7 ? t('كل يوم') : dp.days.map(dayLabel).join(t('، '))} <span className="num">{dp.start}–{dp.end}</span></div>) : <span className="text-dim">{t('طول الوقت')}</span>}
          {(pr.validFrom || pr.validTo) && <div className="text-dim">{pr.validFrom ? dateTime(new Date(pr.validFrom).toISOString()) : '…'} ← {pr.validTo ? dateTime(new Date(pr.validTo).toISOString()) : '…'}</div>}
        </div>,
        <div className="text-xs"><div>{t('النهارده')}: <b className="num">{pr.usage?.today ?? 0}</b>{pr.maxUsesPerDay ? <span className="text-dim"> / {pr.maxUsesPerDay}</span> : null}</div><div>{t('الإجمالي')}: <b className="num">{pr.usage?.total ?? 0}</b>{pr.maxUses ? <span className="text-dim"> / {pr.maxUses}</span> : null}</div>{pr.exhausted && <Pill tone="warning">{t('خلص')}</Pill>}</div>,
        pr.liveNow && !pr.exhausted ? <Pill tone="success"><RadioIcon className="w-3 h-3" />{t('شغال')}</Pill> : <Pill tone="neutral">{t('لأ')}</Pill>,
        <Switch checked={pr.active} onChange={(v) => toggle(pr, v)} />,
        <Button size="sm" data-fb={`promotion:edit:${pr.id}`} onClick={() => setForm(toDraft(pr))}><Pencil className="w-3.5 h-3.5" />{t('تعديل')}</Button>,
      ])} empty={t('مفيش عروض')} />
      <div className="text-[11px] text-dim">{t('"شغال دلوقتي" حسب ساعة السيستم وتوقيت الفرع — حرّك الساعة من فوق عشان تجرب الهابي أور.')}</div>
      <Modal open={!!form} onClose={() => setForm(null)} xwide title={form?.id ? t('تعديل العرض') : t('عرض جديد')} badge={<StateBadge ops={['Promotion.Upsert']} />}
        footer={<><Button onClick={() => setForm(null)}>{t('إلغاء')}</Button><Button data-fb="promotion-form:save" variant="primary" loading={busy} onClick={save} disabled={!form?.name.ar.trim() || !form?.channels.length}><Save className="w-4 h-4" />{t('حفظ')}</Button></>}>
        {form && <PromoForm d={form} set={setForm} branches={branches.items} products={products.items} categories={categories.items} />}
      </Modal>
    </div>
  );
}

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

function PromoForm({ d, set, branches, products, categories }: { d: Draft; set: (d: Draft) => void; branches: any[]; products: any[]; categories: any[] }) {
  const toggleIn = <T,>(arr: T[], v: T, on: boolean) => (on ? [...arr, v] : arr.filter((x) => x !== v));
  const editing = !!d.id;
  const preview = useMemo(() => {
    const scope = [...d.categoryIds.map((id) => L(categories.find((c) => c.id === id)?.name)), ...d.productIds.map((id) => L(products.find((p) => p.id === id)?.name))].join(t('، '));
    const ben = d.benefitType === 'PERCENTAGE' ? `${d.benefitValue || '?'}%` : `${d.benefitValue || '?'} ${t('جنيه')}`;
    if (d.mechanic === 'ORDER') return t('خصم {b} على الشيك كله', { b: ben });
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
          <div className="grid grid-cols-3 gap-2">{(Object.keys(MECH) as Mech[]).map((m) => { const M = MECH[m]; return (
            <button key={m} type="button" onClick={() => set({ ...d, mechanic: m })} data-fb={`promotion-form:mechanic:${m}`} className={cn('rounded-xl border p-2.5 text-start', d.mechanic === m ? 'border-[var(--primary)] bg-[var(--primary-container)]' : 'border-[var(--glass-border)] surface-1')}>
              <M.icon className="w-4 h-4 mb-1 text-[var(--primary)]" /><div className="text-sm font-bold">{t(M.label)}</div><div className="text-[10px] text-dim">{t(M.help)}</div>
            </button>); })}</div>
        </Field>
        {d.mechanic !== 'BUY_X_GET_Y' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('الخصم')}><Radio<'PERCENTAGE' | 'FIXED_AMOUNT'> fb="promotion-form:benefit" value={d.benefitType} onChange={(v) => set({ ...d, benefitType: v })} options={[{ value: 'PERCENTAGE', label: t('نسبة %') }, { value: 'FIXED_AMOUNT', label: d.mechanic === 'ITEMS' ? t('جنيه على كل صنف') : t('مبلغ ثابت') }]} /></Field>
            <Field label={d.benefitType === 'PERCENTAGE' ? t('النسبة %') : t('المبلغ (جنيه)')}><Input data-fb="promotion-form:value" inputMode="decimal" value={d.benefitValue} onChange={(e) => set({ ...d, benefitValue: e.target.value })} /></Field>
          </div>
        )}
        {d.mechanic !== 'ORDER' && (
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
        <Field label={t('مع خصومات تانية؟')}><Radio<'EXCLUSIVE' | 'STACKABLE'> fb="promotion-form:stacking" value={d.stacking} onChange={(v) => set({ ...d, stacking: v })} options={[{ value: 'EXCLUSIVE', label: t('لوحده بس') }, { value: 'STACKABLE', label: t('ينفع يتجمع') }]} /></Field>
      </div>
    </div>
  );
}
