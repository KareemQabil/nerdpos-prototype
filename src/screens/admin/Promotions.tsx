// B6 Promotions: coded and scheduled (happy hour) order-wide discounts; no stacking by default.
import React, { useState } from 'react';
import { Plus, Pencil, Save, Ticket, Timer, Radio as RadioIcon } from 'lucide-react';
import { useCommand } from '../../app/hooks';
import { Banner, Button, Card, Field, Input, Modal, Money, Pill, Section, StateBadge, Switch, Table } from '../../ui';
import { t, L } from '../../i18n';
import { dateTime } from '../../lib/format';
import { CHANNELS, Check, LocInputs, PolicyChip, Radio, cairoLocal, cairoLocalToIso, channelLabel, useItems, usePolicy } from './catalog/common';

const DAYS = [0, 1, 2, 3, 4, 5, 6];
const dayLabel = (d: number) => [t('الحد'), t('الاتنين'), t('التلات'), t('الأربع'), t('الخميس'), t('الجمعة'), t('السبت')][d];

interface Draft {
  name: { ar: string; en: string }; kind: 'CODED' | 'AUTOMATIC'; code: string;
  benefitType: 'PERCENTAGE' | 'FIXED_AMOUNT'; benefitValue: string; channels: string[]; branchIds: string[]; minSubtotal: string;
  useSchedule: boolean; days: number[]; start: string; end: string; validFrom: string; validTo: string;
}
const EMPTY: Draft = { name: { ar: '', en: '' }, kind: 'AUTOMATIC', code: '', benefitType: 'PERCENTAGE', benefitValue: '10', channels: ['DINE_IN', 'TAKEAWAY'], branchIds: [], minSubtotal: '', useSchedule: true, days: [4, 5], start: '17:00', end: '19:00', validFrom: '', validTo: '' };

export default function Promotions() {
  const { run, busy } = useCommand();
  const list = useItems<any>('Promotion.Find', { query: { includeInactive: 'true' } });
  const branches = useItems<any>('Branch.List');
  const stacking = usePolicy<{ mode: string; autoApply: boolean }>('DiscountStackingPolicy');
  const [form, setForm] = useState<{ pr?: any; d: Draft } | null>(null);
  const branchName = (id: string) => branches.items.find((b) => b.id === id)?.name ?? id;
  const toDraft = (pr: any): Draft => ({
    name: pr.name, kind: pr.kind, code: pr.code ?? '', benefitType: pr.benefitType, benefitValue: pr.benefitValue, channels: pr.channels, branchIds: pr.branchIds, minSubtotal: pr.minSubtotal ?? '',
    useSchedule: !!pr.schedule, days: pr.schedule?.days ?? [], start: pr.schedule?.start ?? '17:00', end: pr.schedule?.end ?? '19:00',
    validFrom: pr.validFrom ? cairoLocal(pr.validFrom) : '', validTo: pr.validTo ? cairoLocal(pr.validTo) : '',
  });
  const bodyOf = (d: Draft) => {
    const b: any = { name: d.name, benefitType: d.benefitType, benefitValue: d.benefitValue.trim(), channels: d.channels, branchIds: d.branchIds };
    b.minSubtotal = d.minSubtotal.trim() || null;
    b.schedule = d.useSchedule ? { daysOfWeek: d.days, startLocalTime: d.start, endLocalTime: d.end } : null;
    b.validFrom = d.validFrom ? cairoLocalToIso(d.validFrom) : null;
    b.validTo = d.validTo ? cairoLocalToIso(d.validTo) : null;
    return b;
  };
  const save = async () => {
    if (!form) return;
    const d = form.d;
    const r = form.pr
      ? await run('Promotion.Configure', { params: { promotionId: form.pr.id }, body: { ...bodyOf(d), active: form.pr.active, expectedVersion: form.pr.version } }, { success: t('العرض اتعدل — الخصومات المتطبقة بتفضل بنسختها') })
      : await run('Promotion.Create', { body: { ...bodyOf(d), kind: d.kind, ...(d.kind === 'CODED' ? { code: d.code.trim().toUpperCase() } : {}) } }, { success: t('العرض اتعمل') });
    if (r) setForm(null);
  };
  const toggle = (pr: any, active: boolean) => run('Promotion.Configure', { params: { promotionId: pr.id }, body: { ...bodyOf(toDraft(pr)), active, expectedVersion: pr.version } }, { success: active ? t('العرض اتفعّل') : t('العرض اتوقف') });
  return (
    <div>
      <Section title={t('العروض')} badge={<StateBadge ops={['Promotion.Create', 'Promotion.Find', 'Promotion.Configure']} />} sub={t('كود خصم أو عرض بمواعيد (هابي أور) — خصم على الشيك كله قبل الضريبة')}
        actions={<Button data-fb="promotions:new" variant="primary" onClick={() => setForm({ d: { ...EMPTY, branchIds: branches.items.map((b) => b.id).slice(0, 1) } })}><Plus className="w-4 h-4" />{t('عرض جديد')}</Button>} />
      <div className="flex flex-wrap gap-1.5 mb-3" data-fb="promotions:stacking">
        <PolicyChip id="DiscountStackingPolicy.mode" value={stacking?.mode ?? '…'} />
        <PolicyChip id="DiscountStackingPolicy.autoApply" value={stacking ? (stacking.autoApply ? t('أوتوماتيك') : t('مقفول')) : '…'} />
      </div>
      <Banner tone="info">
        {stacking?.mode === 'NO_STACKING' || !stacking ? t('مفيش تجميع: الشيك عليه خصم واحد بس — يا عرض يا خصم مدير.') : t('التجميع مسموح: عرض + خصم مدير على نفس الشيك.')}{' '}
        {stacking?.autoApply ? t('العروض الأوتوماتيك بتتطبق لوحدها.') : t('العرض الأوتوماتيك (هابي أور) بيظهر للكاشير كاقتراح وهو اللي بيطبقه — مش بيتطبق لوحده.')}
        <div className="text-xs text-dim mt-1">{t('العروض متوقفة على قرار صاحب المنتج PD-V4-11 (اختيار B: أكواد وعروض بمواعيد).')}</div>
      </Banner>
      <div className="mt-4">
        <Table head={[t('العرض'), t('النوع'), t('الخصم'), t('القنوات والفروع'), t('المواعيد'), t('حد أدنى'), t('شغال دلوقتي'), t('مفعّل'), '']} rows={list.items.map((pr) => [
          <div><div className="font-bold">{L(pr.name)}</div><span className="num text-[11px] text-dim">v{pr.version}</span></div>,
          pr.kind === 'CODED' ? <Pill tone="primary"><Ticket className="w-3 h-3" />{t('كود')} <span className="num">{pr.code}</span></Pill> : <Pill tone="info"><Timer className="w-3 h-3" />{t('أوتوماتيك')}</Pill>,
          pr.benefitType === 'PERCENTAGE' ? <span className="num font-bold">{pr.benefitValue}%</span> : <Money v={pr.benefitValue} />,
          <div className="flex flex-wrap gap-1">{pr.channels.map((c: string) => <Pill key={c} tone="neutral">{channelLabel(c)}</Pill>)}<span className="text-[11px] text-dim w-full">{pr.branchIds.length ? pr.branchIds.map(branchName).join('، ') : t('كل الفروع')}</span></div>,
          <div className="text-xs">
            {pr.schedule ? <><div>{pr.schedule.days.map(dayLabel).join('، ')}</div><div className="num">{pr.schedule.start}–{pr.schedule.end}{pr.schedule.end < pr.schedule.start ? ` (${t('بيعدي نص الليل')})` : ''}</div></> : <span className="text-dim">{t('طول الوقت')}</span>}
            {(pr.validFrom || pr.validTo) && <div className="text-dim">{pr.validFrom ? dateTime(new Date(pr.validFrom).toISOString()) : '…'} → {pr.validTo ? dateTime(new Date(pr.validTo).toISOString()) : '…'}</div>}
          </div>,
          pr.minSubtotal ? <Money v={pr.minSubtotal} /> : '—',
          pr.liveNow ? <Pill tone="success"><RadioIcon className="w-3 h-3" />{t('شغال')}</Pill> : <Pill tone="neutral">{t('لأ')}</Pill>,
          <Switch checked={pr.active} onChange={(v) => toggle(pr, v)} />,
          <Button size="sm" data-fb={`promotion:edit:${pr.id}`} onClick={() => setForm({ pr, d: toDraft(pr) })}><Pencil className="w-3.5 h-3.5" />{t('تعديل')}</Button>,
        ])} />
        <div className="text-[11px] text-dim mt-2">{t('"شغال دلوقتي" من السيرفر حسب ساعة النظام وتوقيت الفرع — حرّك الساعة من المحاكاة عشان تجرب الهابي أور.')}</div>
      </div>
      <Modal open={!!form} onClose={() => setForm(null)} wide title={form?.pr ? t('تعديل العرض') : t('عرض جديد')} badge={<StateBadge ops={[form?.pr ? 'Promotion.Configure' : 'Promotion.Create']} />}
        footer={<><Button onClick={() => setForm(null)}>{t('إلغاء')}</Button><Button data-fb="promotion-form:save" variant="primary" loading={busy} onClick={save}><Save className="w-4 h-4" />{t('حفظ')}</Button></>}>
        {form && <PromoForm d={form.d} set={(d) => setForm({ ...form, d })} editing={!!form.pr} branches={branches.items} />}
      </Modal>
    </div>
  );
}

function PromoForm({ d, set, editing, branches }: { d: Draft; set: (d: Draft) => void; editing: boolean; branches: any[] }) {
  const toggleIn = <T,>(arr: T[], v: T, on: boolean) => (on ? [...arr, v] : arr.filter((x) => x !== v));
  return (
    <div className="space-y-4">
      <LocInputs value={d.name} onChange={(name) => set({ ...d, name })} fb="promotion-form" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={t('نوع العرض')} hint={editing ? t('النوع والكود ثابتين بعد الإنشاء') : undefined}>
          <Radio<'CODED' | 'AUTOMATIC'> fb="promotion-form:kind" value={d.kind} onChange={(v) => !editing && set({ ...d, kind: v, useSchedule: v === 'AUTOMATIC' ? true : d.useSchedule })} options={[{ value: 'AUTOMATIC', label: t('أوتوماتيك / هابي أور') }, { value: 'CODED', label: t('كود خصم') }]} />
        </Field>
        {d.kind === 'CODED' && <Field label={t('الكود')} hint={t('فريد — الكاشير مش بيشوف الأكواد')}><Input data-fb="promotion-form:code" value={d.code} onChange={(e) => set({ ...d, code: e.target.value })} disabled={editing} dir="ltr" placeholder="WELCOME50" /></Field>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label={t('نوع الخصم')}>
          <Radio<'PERCENTAGE' | 'FIXED_AMOUNT'> fb="promotion-form:benefit" value={d.benefitType} onChange={(v) => set({ ...d, benefitType: v })} options={[{ value: 'PERCENTAGE', label: t('نسبة %') }, { value: 'FIXED_AMOUNT', label: t('مبلغ ثابت') }]} />
        </Field>
        <Field label={d.benefitType === 'PERCENTAGE' ? t('النسبة %') : t('المبلغ (ج.م)')} hint={d.benefitType === 'PERCENTAGE' ? t('أكبر من 0 ولحد 100') : t('أكبر من 0')}><Input data-fb="promotion-form:value" inputMode="decimal" value={d.benefitValue} onChange={(e) => set({ ...d, benefitValue: e.target.value })} /></Field>
        <Field label={t('حد أدنى للشيك (اختياري)')} hint={t('على المجموع قبل الخصم — السيرفر بيحسبه')}><Input data-fb="promotion-form:min" inputMode="decimal" value={d.minSubtotal} onChange={(e) => set({ ...d, minSubtotal: e.target.value })} /></Field>
      </div>
      <Field label={t('القنوات')}>
        <div className="flex flex-wrap gap-1.5">{CHANNELS.map((c) => <Check key={c} fb={`promotion-form:channel:${c}`} checked={d.channels.includes(c)} onChange={(on) => set({ ...d, channels: toggleIn(d.channels, c, on) })}>{channelLabel(c)}</Check>)}</div>
      </Field>
      <Field label={t('الفروع')} hint={t('من غير اختيار = كل الفروع')}>
        <div className="flex flex-wrap gap-1.5">{branches.map((b) => <Check key={b.id} fb={`promotion-form:branch:${b.id}`} checked={d.branchIds.includes(b.id)} onChange={(on) => set({ ...d, branchIds: toggleIn(d.branchIds, b.id, on) })}>{b.name}</Check>)}</div>
      </Field>
      <Card title={<span className="inline-flex items-center gap-2"><Timer className="w-4 h-4" />{t('مواعيد أسبوعية (هابي أور)')}</span>} actions={<Switch checked={d.useSchedule} onChange={(v) => set({ ...d, useSchedule: v })} />}>
        {d.useSchedule ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">{DAYS.map((x) => <Check key={x} fb={`promotion-form:day:${x}`} checked={d.days.includes(x)} onChange={(on) => set({ ...d, days: toggleIn(d.days, x, on).sort() })}>{dayLabel(x)}</Check>)}</div>
            <div className="grid grid-cols-2 gap-3 max-w-sm">
              <Field label={t('من')}><Input data-fb="promotion-form:start" type="time" value={d.start} onChange={(e) => set({ ...d, start: e.target.value })} dir="ltr" /></Field>
              <Field label={t('لحد')}><Input data-fb="promotion-form:end" type="time" value={d.end} onChange={(e) => set({ ...d, end: e.target.value })} dir="ltr" /></Field>
            </div>
            <div className="text-[11px] text-dim">{t('بتوقيت الفرع. لو النهاية قبل البداية العرض بيعدي نص الليل.')}</div>
          </div>
        ) : <div className="text-sm text-dim">{t('العرض شغال طول الوقت جوه فترة الصلاحية')}</div>}
      </Card>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={t('صالح من (اختياري)')}><Input type="datetime-local" value={d.validFrom} onChange={(e) => set({ ...d, validFrom: e.target.value })} dir="ltr" /></Field>
        <Field label={t('صالح لحد (اختياري)')}><Input type="datetime-local" value={d.validTo} onChange={(e) => set({ ...d, validTo: e.target.value })} dir="ltr" /></Field>
      </div>
      <div className="text-[11px] text-dim">{t('مش في CORE: عروض على أصناف معينة (اشتري واحد وخد التاني)، حد استخدام لكل ضيف، ونقاط الولاء.')}</div>
    </div>
  );
}
