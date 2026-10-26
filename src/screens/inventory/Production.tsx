// Production: prepare a batch in the kitchen (e.g. 5 kg tahini sauce) — preview what it takes and what it costs,
// enter what was really used and made, post it: ingredients out, the preparation in at its real cost.
import React, { useEffect, useState } from 'react';
import { ChefHat, Factory, CheckCircle2 } from 'lucide-react';
import { useCommand, useDev, useQuery } from '../../app/hooks';
import { Tech } from '../../app/tech';
import { Banner, Button, Card, Empty, Field, Input, Money, Pill, Section, Select, Spinner, StateBadge, Table } from '../../ui';
import { t, L } from '../../i18n';
import { dateTime, money } from '../../lib/format';
import { BranchScope, Qty, WarehouseSelect, fmtQty, unitLabel, useBranchScope, useList, useWarehouses } from './common';

const OPS = ['Production.Preview', 'Production.Post', 'Production.Find', 'Recipe.Find'];

export default function Production() {
  const scope = useBranchScope();
  const hist = useList<any>('Production.Find', { branchId: scope.branchId });
  return (
    <div>
      <Section title={t('التحضير')} badge={<StateBadge ops={OPS} />} sub={t('تحضير الصوصات والعجين والتتبيلات في المطبخ: الخامات بتطلع من المخزن، والتحضيرة بتدخل بتكلفتها الحقيقية.')} actions={<BranchScope scope={scope} />} />
      <div className="grid grid-cols-1 2xl:grid-cols-5 gap-4">
        <div className="2xl:col-span-3"><NewRun /></div>
        <Card className="2xl:col-span-2" title={t('آخر التحضيرات')}>
          {hist.loading && !hist.raw ? <Spinner /> : hist.items.length === 0 ? <Empty icon={<Factory className="w-8 h-8" />} text={t('مفيش تحضيرات لسه')} /> : (
            <div className="space-y-2 max-h-[640px] overflow-y-auto">
              {hist.items.map((p) => (
                <div key={p.id} className="rounded-xl surface-1 p-3">
                  <div className="flex justify-between gap-2"><span className="font-bold">{L(p.output?.name)} <Qty v={p.actualOutput} unit={p.output?.unit} /></span><span className="num text-xs text-dim">{p.number}</span></div>
                  <div className="text-xs text-dim mt-0.5">{dateTime(p.at)} · {p.userName} · {p.warehouse.name}</div>
                  <div className="text-xs mt-1">{t('التكلفة')}: <b className="num">{money(p.totalCost)}</b> · {t('الوحدة')}: <b className="num">{money(p.unitCost)}</b>{p.expiryDate && <> · {t('صلاحية')} <span className="num">{p.expiryDate}</span></>}</div>
                  <div className="text-[11px] text-dim mt-1">{p.inputs.map((i: any) => `${L(i.name)} ${fmtQty(i.actual)} ${unitLabel(i.unit)}`).join('، ')}</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function NewRun() {
  const { run, busy } = useCommand();
  const { auth } = useDev();
  const recipes = useList<any>('Recipe.Find', { kind: 'PREP' });
  const whs = useWarehouses();
  const [recipeId, setRecipeId] = useState('');
  const [wh, setWh] = useState('');
  const [out, setOut] = useState('');
  const [actualOut, setActualOut] = useState('');
  const [actual, setActual] = useState<Record<string, string>>({});
  const [expiry, setExpiry] = useState('');
  const [done, setDone] = useState<any | null>(null);
  useEffect(() => { if (!wh && whs.items.length) setWh(whs.items.find((w) => w.branchId === auth.branchId && w.kind === 'KITCHEN')?.id ?? whs.items[0].id); }, [whs.items, wh, auth.branchId]);
  const r = recipes.items.find((x) => x.id === recipeId);
  useEffect(() => { if (r) { setOut(r.activeVersion.outputQuantityPerBatch); setActual({}); setActualOut(''); setDone(null); } }, [recipeId]); // eslint-disable-line react-hooks/exhaustive-deps
  const pv = useQuery<any>(recipeId && Number(out) > 0 && wh ? 'Production.Preview' : null, { query: { recipeId, outputQuantity: out, warehouseId: wh } });
  const p = pv.data;
  const post = async () => {
    if (!p) return;
    const res = await run<any>('Production.Post', { body: { recipeVersionId: p.recipeVersionId, warehouseId: wh, actualOutput: actualOut || out, actualInputs: p.inputs.map((i: any) => ({ itemId: i.item.id, quantity: actual[i.item.id] ?? i.required })), expiryDate: expiry || undefined } }, { success: t('التحضير اتسجل') });
    if (res) { setDone(res); setActual({}); setActualOut(''); }
  };
  return (
    <Card title={<span className="flex items-center gap-2"><ChefHat className="w-4 h-4" />{t('تحضير جديد')}</span>} badge={<StateBadge ops={['Production.Preview', 'Production.Post']} />}>
      {recipes.items.length === 0 && !recipes.loading ? <Empty text={t('مفيش وصفات تحضير. اعمل وصفة تحضيرة من شاشة الوصفات الأول.')} /> : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label={t('هتحضّر إيه')}><Select data-fb="production:recipe" value={recipeId} onChange={(e) => setRecipeId(e.target.value)} options={[{ value: '', label: t('اختار') }, ...recipes.items.map((x) => ({ value: x.id, label: L(x.name) }))]} /></Field>
            <Field label={t('في مخزن')}><WarehouseSelect fb="production:warehouse" value={wh} onChange={setWh} warehouses={whs.items} /></Field>
            <Field label={t('الكمية المطلوبة')} hint={r ? t('الدفعة الواحدة {q} {u}', { q: fmtQty(r.activeVersion.outputQuantityPerBatch), u: unitLabel(r.outputUnit) }) : undefined}>
              <div className="flex gap-1 items-center"><Input data-fb="production:qty" inputMode="decimal" value={out} onChange={(e) => setOut(e.target.value.replace(/[^\d.]/g, ''))} /><span className="text-xs text-dim">{unitLabel(r?.outputUnit)}</span></div>
            </Field>
          </div>
          {r && (
            <div className="flex flex-wrap gap-1.5">{[0.5, 1, 2, 3].map((b) => <Button key={b} size="sm" variant="ghost" onClick={() => setOut(String(Number(r.activeVersion.outputQuantityPerBatch) * b))}>{b === 0.5 ? t('نص دفعة') : t('{n} دفعة', { n: b })}</Button>)}</div>
          )}
          {done && <Banner tone="success"><span className="inline-flex items-center gap-1"><CheckCircle2 className="w-4 h-4" />{t('اتسجل {n}: {q} بتكلفة {c} للوحدة', { n: done.number, q: `${fmtQty(done.actualOutput)} ${unitLabel(done.output?.unit)}`, c: money(done.unitCost) })}</span></Banner>}
          {pv.loading && !p ? <Spinner /> : p && (
            <>
              <Table head={[t('الخامة'), t('المطلوب'), t('الموجود'), t('اللي اتستخدم فعلًا'), t('التكلفة')]} rows={p.inputs.map((i: any) => [
                <span className="font-bold">{L(i.item.name)}</span>,
                <Qty v={i.required} unit={i.item.unit} />,
                <span className={i.shortage ? 'text-[var(--error)]' : ''}><Qty v={i.onHand} unit={i.item.unit} hint={false} />{i.shortage && <Pill tone="error" className="ms-1">{t('ناقص {q}', { q: fmtQty(i.shortage) })}</Pill>}</span>,
                <div className="flex items-center gap-1"><Input data-fb={`production:actual:${i.item.id}`} className="w-24" inputMode="decimal" value={actual[i.item.id] ?? i.required} onChange={(e) => setActual({ ...actual, [i.item.id]: e.target.value.replace(/[^\d.]/g, '') })} /><span className="text-xs text-dim">{unitLabel(i.item.unit)}</span></div>,
                <Money v={i.value} className="text-xs" />,
              ])} />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                <Field label={t('طلع فعلًا')} hint={t('لو طلع أقل أو أكتر من المتوقع')}><div className="flex gap-1 items-center"><Input data-fb="production:actual-out" inputMode="decimal" value={actualOut} placeholder={out} onChange={(e) => setActualOut(e.target.value.replace(/[^\d.]/g, ''))} /><span className="text-xs text-dim">{unitLabel(p.output.unit)}</span></div></Field>
                <Field label={t('تاريخ الصلاحية')} hint={p.shelfLifeDays ? t('لو فاضي: بعد {n} يوم', { n: p.shelfLifeDays }) : undefined}><Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></Field>
                <div className="rounded-xl surface-1 p-3 text-sm">
                  <div>{t('تكلفة الدفعة')}: <b className="num">{money(p.totalCost)}</b></div>
                  <div>{t('تكلفة الوحدة')}: <b className="num">{money(p.unitCost)}</b> <span className="text-dim text-xs">({t('المتوسط دلوقتي')} {money(p.currentAvgCost)})</span></div>
                </div>
              </div>
              {!p.canProduce && <Banner tone="warning">{t('فيه خامات مش كفاية في المخزن ده. حوّل من المخزن الرئيسي الأول، أو قلل الكمية.')}</Banner>}
              <div className="flex justify-end"><Button variant="primary" data-fb="production:post" loading={busy} onClick={post}><Factory className="w-4 h-4" />{t('سجّل التحضير')}</Button></div>
              <Tech><div className="text-[11px] num text-dim">{p.recipeVersionId} · batches {p.batches}</div></Tech>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
