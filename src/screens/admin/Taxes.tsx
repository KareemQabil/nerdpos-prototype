// B3 Taxes: tax groups (rate, included in or added to the price, rounding, exempt), archive only when unused, approval on a
// tax-relevant change; which products use which tax group (with bulk re-mapping); how prices show on the cashier
// (as priced or with tax) — always computed by the server.
import React, { useMemo, useState } from 'react';
import { Plus, Pencil, Archive, RotateCcw, History, Save, Link2, Eye, Search } from 'lucide-react';
import { useCommand, useDev, useQuery } from '../../app/hooks';
import { Banner, Button, Card, Field, Input, KV, Modal, Money, Pill, Section, Select, StateBadge, Switch, Tabs, toast } from '../../ui';
import { Tech } from '../../app/tech';
import { t, L } from '../../i18n';
import { cn, dateTime } from '../../lib/format';
import { CHANNELS, LocInputs, PolicyChip, Radio, channelLabel, ruleText, useItems, usePolicy } from './catalog/common';

interface Draft { name: { ar: string; en: string }; jurisdiction: string; rate: string; calculationMode: 'EXCLUSIVE' | 'INCLUSIVE'; roundingMode: 'HALF_UP' | 'HALF_EVEN' | 'DOWN'; roundingScale: string; fiscalTaxType: string; fiscalSubtype: string; exemption: 'NONE' | 'EXEMPT' | 'ZERO_RATED' }
const EMPTY: Draft = { name: { ar: '', en: '' }, jurisdiction: 'EG', rate: '14', calculationMode: 'EXCLUSIVE', roundingMode: 'HALF_UP', roundingScale: '2', fiscalTaxType: '', fiscalSubtype: '', exemption: 'NONE' };
const modeLabel = (m: string) => (m === 'INCLUSIVE' ? t('شاملة في السعر') : t('بتتضاف على السعر'));
const exemptionLabel = (e?: string) => ({ NONE: t('عادي'), EXEMPT: t('معفي'), ZERO_RATED: t('نسبة صفر') } as Record<string, string>)[e ?? 'NONE'] ?? e ?? '';
const roundingLabel = (m: string, s: number) => `${({ HALF_UP: t('لأقرب (النص لفوق)'), HALF_EVEN: t('لأقرب زوجي'), DOWN: t('لتحت') } as Record<string, string>)[m] ?? m} · ${t('{n} خانة', { n: s })}`;
type Tab = 'groups' | 'mapping' | 'display';

export default function Taxes() {
  const [tab, setTab] = useState<Tab>('groups');
  const approvals = usePolicy<Record<string, any>>('ApprovalRequirementPolicy');
  const taxDefault = usePolicy<any>('ProductTaxDefaultPolicy');
  return (
    <div>
      <Section title={t('الضرايب')} badge={<StateBadge ops={['TaxPolicy.Create', 'TaxPolicy.Configure', 'TaxPolicy.SetActive', 'TaxPolicy.List', 'Product.SetTaxPolicy']} />} sub={t('مجموعات الضريبة (النسبة، شاملة ولا بتتضاف، التقريب، المعفي)، والأصناف اللي على كل مجموعة، وطريقة عرض الأسعار على الكاشير. النسب بيانات صاحب المطعم والمحاسب.')} />
      <Tech>
        <div className="flex flex-wrap gap-1.5 mb-3 items-center">
          <PolicyChip id="ApprovalRequirementPolicy[SENSITIVE_POLICY_CHANGE]" value={ruleText(approvals?.SENSITIVE_POLICY_CHANGE ?? { mode: 'ALWAYS' })} />
          <PolicyChip id="ApprovalRequirementPolicy[PRODUCT_TAX_CHANGE]" value={ruleText(approvals?.PRODUCT_TAX_CHANGE ?? { mode: 'NEVER' })} />
          <PolicyChip id="ProductTaxDefaultPolicy" value={taxDefault?.taxPolicyId ?? '—'} />
        </div>
      </Tech>
      <Tabs<Tab> className="mb-4" value={tab} onChange={setTab} tabs={[{ id: 'groups', label: t('مجموعات الضريبة') }, { id: 'mapping', label: <span className="inline-flex items-center gap-1"><Link2 className="w-3.5 h-3.5" />{t('الأصناف والضريبة')}</span> }, { id: 'display', label: <span className="inline-flex items-center gap-1"><Eye className="w-3.5 h-3.5" />{t('عرض الأسعار')}</span> }]} />
      {tab === 'groups' && <Groups />}
      {tab === 'mapping' && <Mapping />}
      {tab === 'display' && <Display />}
    </div>
  );
}

function Groups() {
  const { run, busy } = useCommand();
  const [showArchived, setShowArchived] = useState(true);
  const list = useItems<any>('TaxPolicy.List', { query: { includeArchived: showArchived ? 'true' : undefined } });
  const [form, setForm] = useState<{ mode: 'create' | 'edit'; tp?: any; d: Draft } | null>(null);
  const [hist, setHist] = useState<string | null>(null);
  const toDraft = (tp: any): Draft => ({ name: tp.name, jurisdiction: tp.jurisdiction, rate: tp.rate, calculationMode: tp.calculationMode, roundingMode: tp.roundingMode, roundingScale: String(tp.roundingScale), fiscalTaxType: tp.fiscalTaxType ?? '', fiscalSubtype: tp.fiscalSubtype ?? '', exemption: tp.exemption ?? 'NONE' });
  const save = async () => {
    if (!form) return;
    const d = form.d;
    const body: any = { name: d.name, jurisdiction: d.jurisdiction.trim(), rate: d.rate.trim(), calculationMode: d.calculationMode, roundingMode: d.roundingMode, roundingScale: Number(d.roundingScale), exemption: d.exemption };
    if (d.fiscalTaxType.trim()) body.fiscalTaxType = d.fiscalTaxType.trim();
    if (d.fiscalSubtype.trim()) body.fiscalSubtype = d.fiscalSubtype.trim();
    const r = form.mode === 'create'
      ? await run('TaxPolicy.Create', { body }, { success: t('مجموعة الضريبة اتعملت — مش هتغير أي سعر لحد ما صنف يتربط بيها') })
      : await run('TaxPolicy.Configure', { params: { taxPolicyId: form.tp.id }, body: { ...body, expectedVersion: form.tp.version } }, { success: t('اتعدلت — بتسري على الطلبات الجديدة بس') });
    if (r) setForm(null);
  };
  const setActive = (tp: any, active: boolean) => run('TaxPolicy.SetActive', { params: { taxPolicyId: tp.id }, body: { active, expectedVersion: tp.version } }, { success: active ? t('رجعت') : t('اتأرشفت') });
  return (
    <>
      <div className="flex flex-wrap gap-2 items-center mb-3">
        <Banner tone="info">{t('تغيير النسبة أو طريقة الحساب أو التقريب بيطلب موافقة حسب الإعدادات، وبيسري على الطلبات الجديدة بس. المجموعة اللي عليها أصناف ما تتأرشفش، ومفيش مسح.')}</Banner>
      </div>
      <div className="flex items-center gap-2 mb-3">
        <Button data-fb="taxes:new" variant="primary" onClick={() => setForm({ mode: 'create', d: { ...EMPTY } })}><Plus className="w-4 h-4" />{t('مجموعة ضريبة جديدة')}</Button>
        <div className="flex-1" />
        <Switch checked={showArchived} onChange={setShowArchived} label={t('اعرض المؤرشف')} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
        {list.items.map((tp) => (
          <Card key={tp.id} className={tp.active ? '' : 'opacity-60'} title={<span>{L(tp.name)}</span>}
            badge={<>{tp.active ? <Pill tone="success">{t('شغالة')}</Pill> : <Pill tone="neutral">{t('مؤرشفة')}</Pill>}{tp.exemption && tp.exemption !== 'NONE' && <Pill tone="info">{exemptionLabel(tp.exemption)}</Pill>}</>}
            actions={<>
              {tp.active && <Button size="sm" data-fb={`tax:edit:${tp.id}`} onClick={() => setForm({ mode: 'edit', tp, d: toDraft(tp) })}><Pencil className="w-3.5 h-3.5" />{t('تعديل')}</Button>}
              {tp.active
                ? <Button size="sm" variant="danger" data-fb={`tax:archive:${tp.id}`} loading={busy} onClick={() => setActive(tp, false)}><Archive className="w-3.5 h-3.5" />{t('أرشفة')}</Button>
                : <Button size="sm" data-fb={`tax:restore:${tp.id}`} loading={busy} onClick={() => setActive(tp, true)}><RotateCcw className="w-3.5 h-3.5" />{t('رجّعها')}</Button>}
            </>}>
            <div className="flex items-baseline gap-2 mb-3"><span className="num text-3xl font-bold text-[var(--primary)]">{tp.rate}%</span><span className="text-sm text-soft">{modeLabel(tp.calculationMode)}</span></div>
            <KV rows={[
              [t('التقريب'), <span className="text-xs">{roundingLabel(tp.roundingMode, tp.roundingScale)}</span>],
              [t('كود الإيصال الإلكتروني'), <span className="num">{tp.fiscalTaxType ?? '—'} / {tp.fiscalSubtype ?? '—'}</span>],
              [t('مستخدمة في'), <span>{t('{n} صنف', { n: tp.usedBy })}{tp.usedByDefault ? <Pill tone="primary" className="ms-1">{t('الافتراضية للأصناف الجديدة')}</Pill> : null}</span>],
            ]} />
            <Tech><div className="text-[11px] text-dim num mt-1">{tp.id} · {tp.jurisdiction} · v{tp.version}</div></Tech>
            <button className="mt-3 text-xs text-[var(--primary)] inline-flex items-center gap-1" data-fb={`tax:history:${tp.id}`} onClick={() => setHist(hist === tp.id ? null : tp.id)}><History className="w-3.5 h-3.5" />{t('السجل')} ({tp.history?.length ?? 0})</button>
            {hist === tp.id && (
              <ol className="mt-2 space-y-1.5 border-s-2 line ps-3">
                {(tp.history ?? []).map((h: any, i: number) => <li key={i} className="text-xs"><span className="text-dim">{dateTime(h.at)}</span><div className="num" dir="ltr" style={{ textAlign: 'start' }}>{h.change}</div></li>)}
              </ol>
            )}
          </Card>
        ))}
      </div>
      <Modal open={!!form} onClose={() => setForm(null)} wide title={form?.mode === 'create' ? t('مجموعة ضريبة جديدة') : t('تعديل مجموعة الضريبة')} badge={<StateBadge ops={[form?.mode === 'create' ? 'TaxPolicy.Create' : 'TaxPolicy.Configure']} />}
        footer={<><Button onClick={() => setForm(null)}>{t('إلغاء')}</Button><Button data-fb="tax-form:save" variant="primary" loading={busy} onClick={save}><Save className="w-4 h-4" />{t('حفظ')}</Button></>}>
        {form && <TaxForm d={form.d} set={(d) => setForm({ ...form, d })} editing={form.mode === 'edit'} />}
      </Modal>
    </>
  );
}

function TaxForm({ d, set, editing }: { d: Draft; set: (d: Draft) => void; editing: boolean }) {
  return (
    <div className="space-y-3">
      <LocInputs value={d.name} onChange={(name) => set({ ...d, name })} fb="tax-form" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label={t('النسبة %')} hint={t('من 0 لـ 100')}><Input data-fb="tax-form:rate" inputMode="decimal" value={d.rate} onChange={(e) => set({ ...d, rate: e.target.value })} /></Field>
        <Field label={t('طريقة الحساب')}>
          <Radio<'EXCLUSIVE' | 'INCLUSIVE'> fb="tax-form:mode" value={d.calculationMode} onChange={(v) => set({ ...d, calculationMode: v })} options={[{ value: 'EXCLUSIVE', label: t('بتتضاف على السعر') }, { value: 'INCLUSIVE', label: t('شاملة في السعر') }]} />
        </Field>
        <Field label={t('الإعفاء')}>
          <Select data-fb="tax-form:exemption" value={d.exemption} onChange={(e) => set({ ...d, exemption: e.target.value as Draft['exemption'] })} options={[{ value: 'NONE', label: t('عادي') }, { value: 'EXEMPT', label: t('معفي') }, { value: 'ZERO_RATED', label: t('نسبة صفر') }]} />
        </Field>
        <Field label={t('التقريب')}><Select data-fb="tax-form:rounding" value={d.roundingMode} onChange={(e) => set({ ...d, roundingMode: e.target.value as Draft['roundingMode'] })} options={[{ value: 'HALF_UP', label: t('لأقرب (النص لفوق)') }, { value: 'HALF_EVEN', label: t('لأقرب زوجي') }, { value: 'DOWN', label: t('لتحت') }]} /></Field>
        <Field label={t('خانات التقريب')} hint="0..4"><Input data-fb="tax-form:scale" type="number" min={0} max={4} value={d.roundingScale} onChange={(e) => set({ ...d, roundingScale: e.target.value })} /></Field>
        <Field label={t('الجهة')}><Input data-fb="tax-form:jurisdiction" value={d.jurisdiction} onChange={(e) => set({ ...d, jurisdiction: e.target.value })} dir="ltr" /></Field>
        <Field label={t('نوع الضريبة في الإيصال الإلكتروني')} hint={t('من المحاسب')}><Input data-fb="tax-form:fiscal-type" value={d.fiscalTaxType} onChange={(e) => set({ ...d, fiscalTaxType: e.target.value })} dir="ltr" placeholder="T1" /></Field>
        <Field label={t('النوع الفرعي')}><Input data-fb="tax-form:fiscal-subtype" value={d.fiscalSubtype} onChange={(e) => set({ ...d, fiscalSubtype: e.target.value })} dir="ltr" placeholder="V009" /></Field>
      </div>
      {d.calculationMode === 'INCLUSIVE' && <Banner tone="info">{t('الأسعار شاملة الضريبة: الشيك بيطلّع الضريبة من جوه السعر ومش بيزودها. الإيصال بيكتب "شاملة في الأسعار".')}</Banner>}
      {editing && <Banner tone="info">{t('تغيير الاسم بس مش محتاج موافقة. أي تغيير في النسبة أو الحساب أو التقريب أو الأكواد بيطلب موافقة حسب الإعدادات.')}</Banner>}
    </div>
  );
}

// ───────── which products use which tax group (bulk re-mapping)
function Mapping() {
  const { run, busy } = useCommand();
  const taxes = useItems<any>('TaxPolicy.List');
  const products = useItems<any>('Catalog.Search', { query: { active: 'true' } });
  const cats = useItems<any>('Category.List');
  const [sel, setSel] = useState<string[]>([]);
  const [target, setTarget] = useState('');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [progress, setProgress] = useState<string | null>(null);
  const shown = products.items.filter((p) => (!cat || p.categoryId === cat) && (!q || (p.name.ar + p.name.en + p.sku).toLowerCase().includes(q.toLowerCase())));
  const byTax = useMemo(() => { const m = new Map<string, number>(); for (const p of products.items) m.set(p.taxPolicyId, (m.get(p.taxPolicyId) ?? 0) + 1); return m; }, [products.items]);
  const apply = async () => {
    const todo = products.items.filter((p) => sel.includes(p.id) && p.taxPolicyId !== target);
    let n = 0;
    for (const p of todo) {
      setProgress(t('بيتغير {a} من {b}…', { a: n + 1, b: todo.length }));
      const r = await run('Product.SetTaxPolicy', { params: { productId: p.id }, body: { taxPolicyId: target, expectedVersion: p.version } });
      if (!r) break;
      n++;
    }
    setProgress(null);
    if (n) { setSel([]); }
    if (n === todo.length && n) toast('success', t('{n} صنف اتنقلوا للمجموعة الجديدة', { n }));
  };
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-4">
      <Card title={t('الأصناف ومجموعة الضريبة')} badge={<StateBadge ops={['Catalog.Search', 'Product.SetTaxPolicy']} />}>
        <div className="flex flex-wrap gap-2 items-end mb-3">
          <div className="relative flex-1 min-w-[200px]"><Search className="w-4 h-4 absolute top-3 start-3 text-dim" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('دوّر…')} style={{ paddingInlineStart: 36 }} /></div>
          <Select value={cat} onChange={(e) => setCat(e.target.value)} options={[{ value: '', label: t('كل الأقسام') }, ...cats.items.map((c) => ({ value: c.id, label: L(c.name) }))]} />
          <Button size="sm" variant="ghost" onClick={() => setSel(sel.length ? [] : shown.map((p) => p.id))}>{sel.length ? t('شيل التحديد') : t('حدد الكل')}</Button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 max-h-[520px] overflow-y-auto">
          {shown.map((p) => {
            const on = sel.includes(p.id);
            const tp = taxes.items.find((x) => x.id === p.taxPolicyId);
            return (
              <label key={p.id} data-fb={`tax-map:product:${p.sku}`} className={cn('flex items-center gap-2 rounded-lg border px-2 py-1.5 cursor-pointer', on ? 'border-[var(--primary)] bg-[var(--primary-container)]' : 'border-[var(--glass-border)] surface-1')}>
                <input type="checkbox" className="accent-[var(--primary)]" checked={on} onChange={(e) => setSel(e.target.checked ? [...sel, p.id] : sel.filter((x) => x !== p.id))} />
                <span className="flex-1 min-w-0"><span className="block text-sm truncate">{L(p.name)}</span><span className="block text-[11px] text-dim truncate">{tp ? `${L(tp.name)} · ${tp.rate}%` : t('مفيش ضريبة')}</span></span>
              </label>
            );
          })}
        </div>
      </Card>
      <div className="space-y-3">
        <Card title={t('نقل لمجموعة تانية')}>
          <div className="space-y-3">
            <div className="text-sm">{t('محدد: {n} صنف', { n: sel.length })}</div>
            <Field label={t('المجموعة الجديدة')}><Select data-fb="tax-map:target" value={target} onChange={(e) => setTarget(e.target.value)} options={[{ value: '', label: t('— اختار —') }, ...taxes.items.filter((x) => x.active).map((x) => ({ value: x.id, label: `${L(x.name)} · ${x.rate}%` }))]} /></Field>
            <Button data-fb="tax-map:apply" variant="primary" className="w-full" loading={busy} disabled={!sel.length || !target} onClick={apply}><Save className="w-4 h-4" />{t('انقل')}</Button>
            {progress && <div className="text-xs text-dim">{progress}</div>}
            <div className="text-[11px] text-dim">{t('كل صنف بيتغير لوحده (ولو الإعدادات بتطلب موافقة على تغيير ضريبة صنف، هتظهر الموافقة). الشيكات القديمة بتفضل بضريبتها.')}</div>
          </div>
        </Card>
        <Card title={t('عدد الأصناف في كل مجموعة')}>
          <div className="space-y-1.5">{taxes.items.filter((x) => x.active).map((x) => <div key={x.id} className="flex justify-between text-sm"><span>{L(x.name)} <span className="text-dim text-xs">{x.rate}%</span></span><span className="num">{byTax.get(x.id) ?? 0}</span></div>)}</div>
        </Card>
      </div>
    </div>
  );
}

// ───────── price display on the cashier (MenuPriceDisplayPolicy)
function Display() {
  const { run, busy } = useCommand();
  const { auth } = useDev();
  const value = usePolicy<Record<string, string>>('MenuPriceDisplayPolicy') ?? { DINE_IN: 'AS_PRICED', TAKEAWAY: 'AS_PRICED', DELIVERY: 'AS_PRICED' };
  const products = useItems<any>('Catalog.Search', { query: { active: 'true' } });
  const [pid, setPid] = useState('p_kofta');
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const v = draft ?? value;
  const save = async () => { const r = await run('Settings.UpdatePolicy', { params: { policyId: 'MenuPriceDisplayPolicy' }, body: { scopeType: 'TENANT', scopeId: 'biz', state: 'SET', value: v } }, { success: t('طريقة عرض الأسعار اتحفظت') }); if (r) setDraft(null); };
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <Card title={t('الأسعار على شاشة البيع')} badge={<StateBadge ops={['Settings.UpdatePolicy', 'Pricing.QuoteItem']} />}>
        <div className="space-y-3">
          {CHANNELS.map((c) => (
            <div key={c} className="flex items-center gap-3 flex-wrap">
              <span className="w-20 text-sm font-bold">{channelLabel(c)}</span>
              <Radio fb={`display:${c}`} value={v[c] ?? 'AS_PRICED'} onChange={(x) => setDraft({ ...v, [c]: x })} options={[{ value: 'AS_PRICED', label: t('السعر زي ما هو (الضريبة في الشيك)') }, { value: 'WITH_TAX', label: t('شامل الضريبة') }]} />
            </div>
          ))}
          <div className="flex justify-end"><Button data-fb="display:save" variant="primary" loading={busy} disabled={!draft} onClick={save}><Save className="w-4 h-4" />{t('حفظ')}</Button></div>
          <Banner tone="info">{t('ده عرض بس: الرقم بيتحسب على السيرفر (المتصفح ما بيحسبش). الشيك والإيصال بيفضلوا يحسبوا الضريبة بنفس الطريقة. الأصناف اللي ضريبتها شاملة أصلًا أو معفية بتظهر زي ما هي.')}</Banner>
          <Tech><span className="num text-[11px]">MenuPriceDisplayPolicy = {JSON.stringify(value)}</span></Tech>
        </div>
      </Card>
      <Card title={t('مثال')}>
        <Field label={t('الصنف')}><Select value={pid} onChange={(e) => setPid(e.target.value)} options={products.items.map((p) => ({ value: p.id, label: L(p.name) }))} /></Field>
        <div className="grid grid-cols-3 gap-2 mt-3">{CHANNELS.map((c) => <Example key={c + pid} productId={pid} channel={c} branchId={auth.branchId} />)}</div>
      </Card>
    </div>
  );
}

function Example({ productId, channel, branchId }: { productId: string; channel: string; branchId: string | null }) {
  const groups = useItems<any>('ModifierGroup.List');
  const product = useQuery<any>('Product.Get', { params: { productId } });
  const mods = (product.data?.modifierGroupIds ?? []).map((id: string) => groups.items.find((g) => g.id === id)).filter((g: any) => g && g.min > 0 && g.kind !== 'INGREDIENTS').map((g: any) => (g.options.find((o: any) => o.isDefault && o.active) ?? g.options.find((o: any) => o.active))?.id).filter(Boolean);
  const q = useQuery<any>(product.data && groups.data ? 'Pricing.QuoteItem' : null, { params: { productId }, body: { branchId, channel, productId, quantity: '1', modifierOptionIds: mods } } as any);
  return (
    <div className="rounded-xl surface-1 p-3 text-center">
      <div className="text-xs text-dim mb-1">{channelLabel(channel)}</div>
      {q.data ? <><Money v={q.data.display?.unitTotal ?? q.data.unitTotal} big tone="primary" /><div className="text-[11px] text-dim">{L(q.data.display?.label)}</div></> : <div className="text-xs text-dim">{q.error?.details?.reasonAr ?? (q.error ? t('مش بيتباع هنا') : '…')}</div>}
    </div>
  );
}
