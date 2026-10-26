// Half-and-half (pizza) settings of a product: allowed or not, its pairing group (only products of the same group can be
// the other half), the half price ratio used by "sum of halves", and a live price example per partner (server quotes).
import React, { useEffect, useState } from 'react';
import { Pizza, Save } from 'lucide-react';
import { useCommand, useDev, useQuery } from '../../../app/hooks';
import { Banner, Button, Card, Field, Input, Money, Pill, StateBadge, Switch, Table } from '../../../ui';
import { Tech } from '../../../app/tech';
import { t, L } from '../../../i18n';
import { useItems, usePolicy } from './common';
import { halfModeLabel } from '../../menu/parts';

export function HalfEditor({ p }: { p: any }) {
  const { run, busy } = useCommand();
  const mode = usePolicy<string>('HalfAndHalfPricingPolicy');
  const products = useItems<any>('Catalog.Search', { query: { active: 'true' } });
  const [on, setOn] = useState<boolean>(!!p.halfAndHalf);
  const [group, setGroup] = useState<string>(p.halfGroup ?? '');
  const [ratio, setRatio] = useState<string>(p.halfPriceRatio ?? '0.5');
  useEffect(() => { setOn(!!p.halfAndHalf); setGroup(p.halfGroup ?? ''); setRatio(p.halfPriceRatio ?? '0.5'); }, [p.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = [...new Set(products.items.filter((x) => x.halfGroup).map((x) => x.halfGroup as string))];
  const partners = products.items.filter((x) => x.id !== p.id && x.halfAndHalf && (x.halfGroup ?? '') === (p.halfGroup ?? ''));
  const save = () => run('Product.SetHalfAndHalf', { params: { productId: p.id }, body: { enabled: on, halfGroup: group.trim() || null, halfPriceRatio: ratio.trim() || '0.5', expectedVersion: p.version } }, { success: on ? t('نص ونص اتفعّل') : t('نص ونص اتقفل') });
  return (
    <div className="space-y-4">
      <Card title={<span className="inline-flex items-center gap-2"><Pizza className="w-4 h-4" />{t('نص ونص')}</span>} badge={<StateBadge ops={['Product.SetHalfAndHalf']} />}>
        <div className="space-y-3">
          {p.combo?.length > 0 && <Banner tone="warning">{t('الصنف ده وجبة (كومبو) — مينفعش يبقى نص ونص.')}</Banner>}
          <Switch checked={on} onChange={setOn} label={on ? t('الزبون يقدر يطلبه نص ونص مع صنف تاني') : t('مقفول — بيتباع كامل بس')} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={t('مجموعة النص ونص')} hint={t('الأصناف اللي في نفس المجموعة بس تتجمع مع بعض (مثلاً: بيتزا)')}>
              <Input data-fb="half:group" value={group} onChange={(e) => setGroup(e.target.value)} list="half-groups" dir="ltr" placeholder="PIZZA" />
              <datalist id="half-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
            </Field>
            <Field label={t('نسبة سعر النص')} hint={t('بتتستخدم لو الطريقة "مجموع النصين" — 0.5 يعني نص السعر')}><Input data-fb="half:ratio" inputMode="decimal" value={ratio} onChange={(e) => setRatio(e.target.value)} /></Field>
          </div>
          <div className="flex justify-end"><Button data-fb="half:save" variant="primary" loading={busy} disabled={!!p.combo?.length} onClick={save}><Save className="w-4 h-4" />{t('حفظ')}</Button></div>
        </div>
      </Card>
      <Card title={t('طريقة حساب السعر')} badge={<Pill tone="neutral">{t('من إعدادات المطعم')}</Pill>}>
        <div className="space-y-2 text-sm">
          <div>{t('دلوقتي')}: <b>{halfModeLabel(mode)}</b></div>
          <ul className="text-xs text-dim space-y-1 list-disc ps-5">
            <li>{t('سعر النص الأغلى: البيتزا كلها بسعر النص الأغلى في الحجم المختار.')}</li>
            <li>{t('متوسط سعر النصين: (سعر الأول + سعر التاني) ÷ 2.')}</li>
            <li>{t('مجموع سعر النصين: كل نص بنسبة من سعره (النسبة اللي فوق)، والمجموع هو السعر.')}</li>
          </ul>
          <div className="text-[11px] text-dim">{t('الطريقة بتتغير من إعدادات المطعم وبتسري على الشيكات الجديدة. الإضافات على نص واحد بنص السعر.')}</div>
          <Tech><span className="num text-[11px]">HalfAndHalfPricingPolicy = {mode}</span></Tech>
        </div>
      </Card>
      {p.halfAndHalf && (
        <Card title={t('مثال الأسعار (الحجم الافتراضي، صالة)')} badge={<StateBadge ops={['Pricing.QuoteItem']} />}>
          <Table head={[t('النص التاني'), t('سعره كامل'), t('سعر النص ونص')]} empty={t('مفيش أصناف تانية في نفس المجموعة')} rows={partners.map((x) => [L(x.name), <PartnerPrice key="a" productId={x.id} />, <HalfPrice key="b" productId={p.id} other={x.id} />])} />
        </Card>
      )}
    </div>
  );
}

function PartnerPrice({ productId }: { productId: string }) {
  const { auth } = useDev();
  const q = useQuery<any>('Pricing.QuoteItem', { params: { productId }, body: { branchId: auth.branchId, channel: 'DINE_IN', productId, quantity: '1', modifierOptionIds: [] } } as any);
  return q.data ? <Money v={q.data.unitTotal} /> : <span className="text-dim">—</span>;
}
function HalfPrice({ productId, other }: { productId: string; other: string }) {
  const { auth } = useDev();
  const q = useQuery<any>('Pricing.QuoteItem', { params: { productId }, body: { branchId: auth.branchId, channel: 'DINE_IN', productId, quantity: '1', modifierOptionIds: [], halfProductId: other } } as any);
  return q.data ? <Money v={q.data.unitTotal} tone="primary" /> : <span className="text-dim text-xs">{q.error?.details?.reasonAr ?? '—'}</span>;
}

