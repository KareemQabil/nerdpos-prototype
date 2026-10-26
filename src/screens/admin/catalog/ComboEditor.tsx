// Combo / meal deal editor: choice groups (e.g. sandwich, fries, drink), each with products (and size), an upgrade
// difference, a default, required or optional, and an optional sub-choice (e.g. the sauce of the fries).
// Preview: the server quote of the default meal and how its price is spread over the components (for tax and kitchen).
import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Layers, Plus, Save, Trash2, Star } from 'lucide-react';
import { useCommand, useDev, useQuery } from '../../../app/hooks';
import { Banner, Button, Card, Field, Input, Money, Pill, Select, Spinner, StateBadge, Switch, Table } from '../../../ui';
import { t, L } from '../../../i18n';
import { money } from '../../../lib/format';
import { LocInputs, useItems } from './common';

type Loc = { ar: string; en: string };
interface OptDraft { productId: string; variantId: string; upcharge: string; nestedGroupId: string }
interface SlotDraft { id: string; name: Loc; required: boolean; defaultIndex: number; options: OptDraft[] }

const toDraft = (combo: any[]): SlotDraft[] => [...(combo ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)).map((s) => ({
  id: s.id, name: s.name, required: s.required !== false,
  defaultIndex: Math.max(0, s.options.findIndex((o: any) => o.productId === s.defaultProductId)),
  options: s.options.map((o: any) => ({ productId: o.productId, variantId: o.variantId ?? '', upcharge: String(Number(o.upcharge)), nestedGroupId: o.nestedGroupId ?? '' })),
}));

export function ComboEditor({ p }: { p: any }) {
  const { run, busy } = useCommand();
  const { auth } = useDev();
  const products = useItems<any>('Catalog.Search', { query: { active: 'true' } });
  const groups = useItems<any>('ModifierGroup.List');
  const [slots, setSlots] = useState<SlotDraft[]>(() => toDraft(p.combo));
  useEffect(() => setSlots(toDraft(p.combo)), [p.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const choosable = products.items.filter((x) => x.id !== p.id && !x.combo?.length);
  const prodOf = (id: string) => products.items.find((x) => x.id === id);
  const preview = useQuery<any>(p.combo?.length ? 'Pricing.QuoteItem' : null, { params: { productId: p.id }, body: { branchId: auth.branchId, channel: 'DINE_IN', productId: p.id, quantity: '1', modifierOptionIds: [] } } as any);
  const dirty = useMemo(() => JSON.stringify(slots) !== JSON.stringify(toDraft(p.combo)), [slots, p.combo]);

  const upd = (i: number, patch: Partial<SlotDraft>) => setSlots((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const updOpt = (i: number, k: number, patch: Partial<OptDraft>) => setSlots((s) => s.map((x, j) => (j === i ? { ...x, options: x.options.map((o, m) => (m === k ? { ...o, ...patch } : o)) } : x)));
  const moveSlot = (i: number, d: number) => setSlots((s) => { const n = [...s]; const j = i + d; if (j < 0 || j >= n.length) return s; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const addSlot = () => setSlots((s) => [...s, { id: `slot_${Date.now().toString(36)}`, name: { ar: '', en: '' }, required: true, defaultIndex: 0, options: [{ productId: choosable[0]?.id ?? '', variantId: '', upcharge: '0', nestedGroupId: '' }] }]);
  const save = () => run('Product.SetCombo', { params: { productId: p.id }, body: { expectedVersion: p.version, slots: slots.map((s) => ({ id: s.id, name: s.name, required: s.required, defaultProductId: s.options[s.defaultIndex]?.productId, options: s.options.filter((o) => o.productId).map((o) => ({ productId: o.productId, upcharge: o.upcharge.trim() || '0', variantId: o.variantId || undefined, nestedGroupId: o.nestedGroupId || undefined })) })) } }, { success: slots.length ? t('الوجبة اتحفظت') : t('الصنف رجع صنف عادي (مش وجبة)') });

  return (
    <div className="space-y-4">
      <Banner tone="info">{t('الوجبة صنف ليه سعر واحد، ومكوّنة من اختيارات (ساندوتش، بطاطس، مشروب…). كل اختيار فيه أصناف، واحد منهم الافتراضي، والباقي ممكن بفرق ترقية. سعر الوجبة بيتوزع على المكونات بنسبة أسعارهم عشان كل مكوّن ياخد ضريبته، وكل مكوّن بيروح محطة المطبخ بتاعته.')}</Banner>
      {p.halfAndHalf && <Banner tone="warning">{t('الصنف ده مفعّل عليه نص ونص — الوجبة ماينفعش تبقى نص ونص. اقفل نص ونص الأول.')}</Banner>}
      {slots.length === 0 && <Card><div className="text-center py-6 space-y-2"><Layers className="w-10 h-10 mx-auto text-dim" /><div className="text-sm text-dim">{t('الصنف ده مش وجبة. ضيف أول اختيار عشان يبقى وجبة.')}</div></div></Card>}
      {slots.map((s, i) => (
        <Card key={s.id} title={<span className="inline-flex items-center gap-2"><span className="num text-dim">{i + 1}</span>{L(s.name) || t('اختيار جديد')}</span>}
          badge={<Pill tone={s.required ? 'warning' : 'neutral'}>{s.required ? t('أساسي في الوجبة') : t('اختياري')}</Pill>}
          actions={<>
            <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => moveSlot(i, -1)}><ArrowUp className="w-3.5 h-3.5" /></Button>
            <Button size="sm" variant="ghost" disabled={i === slots.length - 1} onClick={() => moveSlot(i, 1)}><ArrowDown className="w-3.5 h-3.5" /></Button>
            <Button size="sm" variant="danger" data-fb={`combo:slot-remove:${i}`} onClick={() => setSlots(slots.filter((_, j) => j !== i))}><Trash2 className="w-3.5 h-3.5" /></Button>
          </>}>
          <div className="space-y-3">
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_200px] gap-3 items-end">
              <LocInputs value={s.name} onChange={(name) => upd(i, { name })} fb={`combo:slot:${i}`} labelAr={t('اسم الاختيار (مثلاً: المشروب)')} labelEn={t('بالإنجليزي (Drink)')} />
              <Switch checked={s.required} onChange={(v) => upd(i, { required: v })} label={s.required ? t('أساسي — لازم يتختار') : t('اختياري — ممكن "من غير"')} />
            </div>
            <div className="space-y-2">
              {s.options.map((o, k) => {
                const op = prodOf(o.productId);
                const vs = (op?.variants ?? []).filter((v: any) => v.active);
                return (
                  <div key={k} className="grid grid-cols-1 md:grid-cols-[auto_1.6fr_1fr_120px_1.2fr_auto] gap-2 items-end surface-1 rounded-xl p-2">
                    <button title={t('الافتراضي')} data-fb={`combo:default:${i}:${k}`} onClick={() => upd(i, { defaultIndex: k })} className={'h-10 w-10 rounded-lg border flex items-center justify-center ' + (s.defaultIndex === k ? 'border-[var(--primary)] text-[var(--primary)] bg-[var(--primary-container)]' : 'border-[var(--glass-border)] text-dim')}><Star className="w-4 h-4" /></button>
                    <Field label={t('الصنف')}><Select data-fb={`combo:product:${i}:${k}`} value={o.productId} onChange={(e) => updOpt(i, k, { productId: e.target.value, variantId: '' })} options={[{ value: '', label: t('— اختار —') }, ...choosable.map((x) => ({ value: x.id, label: `${L(x.name)} · ${x.sku}` }))]} /></Field>
                    <Field label={t('الحجم')}><Select data-fb={`combo:variant:${i}:${k}`} value={o.variantId} disabled={!vs.length} onChange={(e) => updOpt(i, k, { variantId: e.target.value })} options={[{ value: '', label: vs.length ? t('الافتراضي') : t('مفيش أحجام') }, ...vs.map((v: any) => ({ value: v.id, label: L(v.name) }))]} /></Field>
                    <Field label={t('فرق الترقية')}><Input data-fb={`combo:upcharge:${i}:${k}`} inputMode="decimal" value={o.upcharge} onChange={(e) => updOpt(i, k, { upcharge: e.target.value })} /></Field>
                    <Field label={t('اختيار جوه الاختيار')}><Select data-fb={`combo:nested:${i}:${k}`} value={o.nestedGroupId} onChange={(e) => updOpt(i, k, { nestedGroupId: e.target.value })} options={[{ value: '', label: t('مفيش') }, ...groups.items.filter((g) => g.kind !== 'INGREDIENTS').map((g) => ({ value: g.id, label: L(g.name) }))]} /></Field>
                    <Button size="sm" variant="ghost" disabled={s.options.length <= 1} onClick={() => upd(i, { options: s.options.filter((_, m) => m !== k), defaultIndex: s.defaultIndex >= k && s.defaultIndex > 0 ? s.defaultIndex - 1 : s.defaultIndex })}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </div>
                );
              })}
              <Button size="sm" data-fb={`combo:add-option:${i}`} onClick={() => upd(i, { options: [...s.options, { productId: '', variantId: '', upcharge: '0', nestedGroupId: '' }] })}><Plus className="w-3.5 h-3.5" />{t('ضيف صنف للاختيار ده')}</Button>
            </div>
          </div>
        </Card>
      ))}
      <div className="flex gap-2 justify-between flex-wrap">
        <Button data-fb="combo:add-slot" onClick={addSlot}><Plus className="w-4 h-4" />{t('ضيف اختيار للوجبة')}</Button>
        <Button data-fb="combo:save" variant="primary" loading={busy} disabled={!dirty || p.halfAndHalf} onClick={save}><Save className="w-4 h-4" />{t('حفظ الوجبة')}</Button>
      </div>
      {p.combo?.length > 0 && (
        <Card title={t('الوجبة الافتراضية على الكاشير')} badge={<StateBadge ops={['Pricing.QuoteItem']} />}>
          {preview.loading ? <Spinner /> : preview.data ? (
            <div className="space-y-2">
              <div className="flex items-baseline gap-2"><span className="text-sm text-dim">{t('سعر الوجبة (صالة)')}:</span><Money v={preview.data.unitTotal} big tone="primary" /></div>
              <Table head={[t('المكوّن'), t('نصيبه من السعر'), t('الضريبة'), t('فرق')]} rows={(preview.data.children ?? []).map((c: any, i: number) => [
                <span>{L(c.name)}{c.detail ? <span className="text-dim text-xs"> ({L(c.detail)})</span> : null}</span>,
                <span className="num">{money(c.allocated, false)}</span>,
                <span className="text-xs">{c.taxPolicyId === preview.data.tax.taxPolicyId ? t('زي الوجبة') : t('ضريبة مختلفة')}</span>,
                Number(c.upcharge) ? <span className="num">+{money(c.upcharge, false)}</span> : '—',
              ])} />
              <div className="text-[11px] text-dim">{t('النصيب محسوب على السيرفر بأسعار المكونات لوحدها (أكبر باقي). ده اللي بيتحسب عليه ضريبة كل مكوّن.')}</div>
            </div>
          ) : <Banner tone="warning">{t('الوجبة لسه مش بتتباع هنا — اتأكد إن ليها سعر وإنها متاحة في الفرع.')}</Banner>}
        </Card>
      )}
    </div>
  );
}
