// B3 Taxes: tax policies (rate, inclusive/exclusive, rounding), archive only when unused, approval on a tax-relevant change.
import React, { useState } from 'react';
import { Plus, Pencil, Archive, RotateCcw, History, Save } from 'lucide-react';
import { useCommand } from '../../app/hooks';
import { Banner, Button, Card, Field, Input, KV, Modal, Pill, Section, Select, StateBadge, Switch } from '../../ui';
import { t, L } from '../../i18n';
import { dateTime } from '../../lib/format';
import { LocInputs, PolicyChip, Radio, ruleText, useItems, usePolicy } from './catalog/common';

interface Draft { name: { ar: string; en: string }; jurisdiction: string; rate: string; calculationMode: 'EXCLUSIVE' | 'INCLUSIVE'; roundingMode: 'HALF_UP' | 'HALF_EVEN' | 'DOWN'; roundingScale: string; fiscalTaxType: string; fiscalSubtype: string; exemption: 'NONE' | 'EXEMPT' | 'ZERO_RATED' }
const EMPTY: Draft = { name: { ar: '', en: '' }, jurisdiction: 'EG', rate: '14', calculationMode: 'EXCLUSIVE', roundingMode: 'HALF_UP', roundingScale: '2', fiscalTaxType: '', fiscalSubtype: '', exemption: 'NONE' };
const modeLabel = (m: string) => (m === 'INCLUSIVE' ? t('شامل السعر') : t('فوق السعر'));
const exemptionLabel = (e?: string) => ({ NONE: t('عادي'), EXEMPT: t('معفي'), ZERO_RATED: t('نسبة صفر') } as Record<string, string>)[e ?? 'NONE'] ?? e ?? '';

export default function Taxes() {
  const { run, busy } = useCommand();
  const [showArchived, setShowArchived] = useState(true);
  const list = useItems<any>('TaxPolicy.List', { query: { includeArchived: showArchived ? 'true' : undefined } });
  const approvals = usePolicy<Record<string, any>>('ApprovalRequirementPolicy');
  const taxDefault = usePolicy<any>('ProductTaxDefaultPolicy');
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
      ? await run('TaxPolicy.Create', { body }, { success: t('الضريبة اتعملت — مش هتغير أي سعر لحد ما صنف يتربط بيها') })
      : await run('TaxPolicy.Configure', { params: { taxPolicyId: form.tp.id }, body: { ...body, expectedVersion: form.tp.version } }, { success: t('الضريبة اتعدلت — بتسري على التسعيرات الجديدة بس') });
    if (r) setForm(null);
  };
  const setActive = (tp: any, active: boolean) => run('TaxPolicy.SetActive', { params: { taxPolicyId: tp.id }, body: { active, expectedVersion: tp.version } }, { success: active ? t('الضريبة رجعت') : t('الضريبة اتأرشفت') });
  return (
    <div>
      <Section title={t('الضرايب')} badge={<StateBadge ops={['TaxPolicy.Create', 'TaxPolicy.Configure', 'TaxPolicy.SetActive', 'TaxPolicy.List']} />} sub={t('سياسات الضريبة: النسبة، شاملة ولا فوق السعر، والتقريب. النسب بيانات صاحب المطعم — مفيش نسبة قانونية مكتوبة كحقيقة.')}
        actions={<Button data-fb="taxes:new" variant="primary" onClick={() => setForm({ mode: 'create', d: { ...EMPTY } })}><Plus className="w-4 h-4" />{t('ضريبة جديدة')}</Button>} />
      <div className="flex flex-wrap gap-1.5 mb-3 items-center">
        <PolicyChip id="ApprovalRequirementPolicy[SENSITIVE_POLICY_CHANGE]" value={ruleText(approvals?.SENSITIVE_POLICY_CHANGE ?? { mode: 'ALWAYS' })} />
        <PolicyChip id="ProductTaxDefaultPolicy" value={taxDefault?.taxPolicyId ?? t('مش متحدد')} />
        <div className="flex-1" />
        <Switch checked={showArchived} onChange={setShowArchived} label={t('اعرض المؤرشف')} />
      </div>
      <Banner tone="info">{t('تغيير النسبة أو طريقة الحساب أو التقريب محتاج موافقة حسب السياسة، وبيسري على التسعيرات الجديدة بس — السطور المسجلة بتفضل بضريبتها ونسخة السياسة. الضريبة اللي عليها أصناف ما تتأرشفش (TAX_POLICY_IN_USE)، ومفيش مسح.')}</Banner>
      <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3 mt-4">
        {list.items.map((tp) => (
          <Card key={tp.id} className={tp.active ? '' : 'opacity-60'} title={<span>{L(tp.name)}</span>}
            badge={<>{tp.active ? <Pill tone="success">{t('شغالة')}</Pill> : <Pill tone="neutral">{t('مؤرشفة')}</Pill>}<Pill tone="neutral">v{tp.version}</Pill></>}
            actions={<>
              {tp.active && <Button size="sm" data-fb={`tax:edit:${tp.id}`} onClick={() => setForm({ mode: 'edit', tp, d: toDraft(tp) })}><Pencil className="w-3.5 h-3.5" />{t('تعديل')}</Button>}
              {tp.active
                ? <Button size="sm" variant="danger" data-fb={`tax:archive:${tp.id}`} loading={busy} onClick={() => setActive(tp, false)}><Archive className="w-3.5 h-3.5" />{t('أرشفة')}</Button>
                : <Button size="sm" data-fb={`tax:restore:${tp.id}`} loading={busy} onClick={() => setActive(tp, true)}><RotateCcw className="w-3.5 h-3.5" />{t('رجّعها')}</Button>}
            </>}>
            <div className="flex items-baseline gap-2 mb-3"><span className="num text-3xl font-bold text-[var(--primary)]">{tp.rate}%</span><span className="text-sm text-soft">{modeLabel(tp.calculationMode)}</span></div>
            <KV rows={[
              [t('الكود الداخلي'), <span className="num text-xs">{tp.id}</span>],
              [t('الجهة'), <span className="num">{tp.jurisdiction}</span>],
              [t('التقريب'), <span className="num">{tp.roundingMode} · {tp.roundingScale}</span>],
              [t('نوع الضريبة (الإيصال الإلكتروني)'), <span className="num">{tp.fiscalTaxType ?? '—'} / {tp.fiscalSubtype ?? '—'}</span>],
              [<span className="inline-flex items-center gap-1">{t('الإعفاء')} <StateBadge state="PROPOSED" /></span>, exemptionLabel(tp.exemption)],
              [t('مستخدمة في'), <span>{t('{n} صنف', { n: tp.usedBy })}{tp.usedByDefault ? <Pill tone="primary" className="ms-1">{t('الافتراضية للأصناف الجديدة')}</Pill> : null}</span>],
            ]} />
            <button className="mt-3 text-xs text-[var(--primary)] inline-flex items-center gap-1" data-fb={`tax:history:${tp.id}`} onClick={() => setHist(hist === tp.id ? null : tp.id)}><History className="w-3.5 h-3.5" />{t('السجل')} ({tp.history?.length ?? 0})</button>
            {hist === tp.id && (
              <ol className="mt-2 space-y-1.5 border-s-2 line ps-3">
                {(tp.history ?? []).map((h: any, i: number) => (
                  <li key={i} className="text-xs"><span className="text-dim">{dateTime(h.at)} · <span className="num">{h.by}</span></span><div className="num" dir="ltr" style={{ textAlign: 'start' }}>{h.change}</div></li>
                ))}
              </ol>
            )}
          </Card>
        ))}
      </div>
      <Modal open={!!form} onClose={() => setForm(null)} wide title={form?.mode === 'create' ? t('ضريبة جديدة') : t('تعديل الضريبة')} badge={<StateBadge ops={[form?.mode === 'create' ? 'TaxPolicy.Create' : 'TaxPolicy.Configure']} />}
        footer={<><Button onClick={() => setForm(null)}>{t('إلغاء')}</Button><Button data-fb="tax-form:save" variant="primary" loading={busy} onClick={save}><Save className="w-4 h-4" />{t('حفظ')}</Button></>}>
        {form && <TaxForm d={form.d} set={(d) => setForm({ ...form, d })} editing={form.mode === 'edit'} />}
      </Modal>
    </div>
  );
}

function TaxForm({ d, set, editing }: { d: Draft; set: (d: Draft) => void; editing: boolean }) {
  return (
    <div className="space-y-3">
      <LocInputs value={d.name} onChange={(name) => set({ ...d, name })} fb="tax-form" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label={t('النسبة %')} hint={t('من 0 لـ 100، رقم عشري')}><Input data-fb="tax-form:rate" inputMode="decimal" value={d.rate} onChange={(e) => set({ ...d, rate: e.target.value })} /></Field>
        <Field label={t('الجهة (Jurisdiction)')}><Input data-fb="tax-form:jurisdiction" value={d.jurisdiction} onChange={(e) => set({ ...d, jurisdiction: e.target.value })} dir="ltr" /></Field>
        <Field label={t('طريقة الحساب')}>
          <Radio<'EXCLUSIVE' | 'INCLUSIVE'> fb="tax-form:mode" value={d.calculationMode} onChange={(v) => set({ ...d, calculationMode: v })} options={[{ value: 'EXCLUSIVE', label: t('فوق السعر') }, { value: 'INCLUSIVE', label: t('شامل السعر') }]} />
        </Field>
        <Field label={t('طريقة التقريب')}><Select data-fb="tax-form:rounding" value={d.roundingMode} onChange={(e) => set({ ...d, roundingMode: e.target.value as Draft['roundingMode'] })} options={[{ value: 'HALF_UP', label: 'HALF_UP' }, { value: 'HALF_EVEN', label: 'HALF_EVEN' }, { value: 'DOWN', label: 'DOWN' }]} /></Field>
        <Field label={t('خانات التقريب')} hint="0..4"><Input data-fb="tax-form:scale" type="number" min={0} max={4} value={d.roundingScale} onChange={(e) => set({ ...d, roundingScale: e.target.value })} /></Field>
        <div />
        <Field label={t('نوع الضريبة (fiscalTaxType)')} hint={t('كود منظومة الإيصال الإلكتروني — من المحاسب')}><Input data-fb="tax-form:fiscal-type" value={d.fiscalTaxType} onChange={(e) => set({ ...d, fiscalTaxType: e.target.value })} dir="ltr" placeholder="T1" /></Field>
        <Field label={t('النوع الفرعي (fiscalSubtype)')}><Input data-fb="tax-form:fiscal-subtype" value={d.fiscalSubtype} onChange={(e) => set({ ...d, fiscalSubtype: e.target.value })} dir="ltr" placeholder="V009" /></Field>
        <Field label={<span className="inline-flex items-center gap-1">{t('الإعفاء')} <StateBadge state="PROPOSED" /></span>} hint={t('النهاردة: نسبة 0 + النوع الفرعي بيفرق بين المعفي والصفر')}>
          <Select data-fb="tax-form:exemption" value={d.exemption} onChange={(e) => set({ ...d, exemption: e.target.value as Draft['exemption'] })} options={[{ value: 'NONE', label: t('عادي') }, { value: 'EXEMPT', label: t('معفي') }, { value: 'ZERO_RATED', label: t('نسبة صفر') }]} />
        </Field>
      </div>
      {d.calculationMode === 'INCLUSIVE' && <Banner tone="warning">{t('الأسعار شاملة الضريبة: الخدمة على منيو شامل الضريبة مش متاحة في التسعير (CAPABILITY_NOT_AVAILABLE).')}</Banner>}
      {editing && <Banner tone="info">{t('تغيير الاسم بس مش محتاج موافقة. أي تغيير في النسبة أو الحساب أو التقريب أو الجهة أو أكواد الإيصال الإلكتروني بيطلب موافقة SENSITIVE_POLICY_CHANGE حسب السياسة.')}</Banner>}
    </div>
  );
}
