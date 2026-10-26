// B2 Prices: per product × branch × channel, effective windows (now or scheduled), history, approval by policy.
import React, { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Clock, History, Save, AlertTriangle } from 'lucide-react';
import { useCommand, useDev, useQuery } from '../../app/hooks';
import { Banner, Button, Card, Field, Input, KV, Money, Pill, Section, Select, StateBadge, Table, Tabs } from '../../ui';
import { t, L } from '../../i18n';
import { dateTime } from '../../lib/format';
import { CHANNELS, PolicyChip, Radio, cairoLocal, cairoLocalToIso, channelLabel, ruleText, serverNow, useItems, usePolicy, type ChannelId } from './catalog/common';

const stateTone = (s: string) => (s === 'CURRENT' ? 'success' : s === 'SCHEDULED' ? 'info' : 'neutral') as 'success' | 'info' | 'neutral';
const stateLabel = (s: string) => ({ CURRENT: t('ساري'), SCHEDULED: t('مجدول'), ENDED: t('انتهى') } as Record<string, string>)[s] ?? s;
const kindLabel = (k: string) => ({ FIRST_PRICE: t('أول سعر'), CHANGE: t('تغيير'), CORRECTION: t('تصحيح سعر مجدول') } as Record<string, string>)[k] ?? k;

export default function Prices() {
  const { me, auth } = useDev();
  const products = useItems<any>('Catalog.Search', { query: { active: 'true' } });
  const branches = useItems<any>('Branch.List');
  const cats = useItems<any>('Category.List');
  const [productId, setProductId] = useState('');
  const [branchId, setBranchId] = useState<string>(me?.branchId ?? auth.branchId ?? '');
  const [channel, setChannel] = useState<ChannelId>('DINE_IN');
  useEffect(() => { if (!productId && products.items[0]) setProductId(products.items[0].id); }, [products.items, productId]);
  useEffect(() => { if (!branchId && branches.items[0]) setBranchId(branches.items[0].id); }, [branches.items, branchId]);
  const product = products.items.find((p) => p.id === productId);
  const sched = usePolicy<string>('PriceSchedulingPolicy');
  const zero = usePolicy<string>('ZeroPricePolicy');
  const approvals = usePolicy<Record<string, any>>('ApprovalRequirementPolicy');
  return (
    <div>
      <Section title={t('الأسعار')} badge={<StateBadge ops={['Catalog.SetPrice', 'Product.PriceHistory']} />} sub={t('سعر لكل صنف × فرع × قناة، بفترات سريان من دلوقتي أو مجدولة، وسجل كامل')} />
      <div className="flex flex-wrap gap-1.5 mb-3" data-fb="prices:policies">
        <PolicyChip id="PriceSchedulingPolicy" value={sched ?? '…'} />
        <PolicyChip id="ZeroPricePolicy" value={zero ?? '…'} />
        <PolicyChip id="ApprovalRequirementPolicy[PRICE_CHANGE]" value={ruleText(approvals?.PRICE_CHANGE ?? { mode: 'NEVER' })} />
      </div>
      <Banner tone="info">{t('تعديلات المنيو والأسعار والضرايب بتسري على التسعيرات الجديدة بس؛ السطور المسجلة في الشيكات بتفضل بسعرها.')}</Banner>
      <div className="flex flex-wrap gap-3 items-end my-4">
        <Field label={t('الصنف')} className="w-72"><Select data-fb="prices:product" value={productId} onChange={(e) => setProductId(e.target.value)} options={products.items.map((p) => ({ value: p.id, label: `${L(p.name)} · ${p.sku}` }))} /></Field>
        <Field label={t('الفرع')} className="w-56"><Select data-fb="prices:branch" value={branchId} onChange={(e) => setBranchId(e.target.value)} options={branches.items.map((b) => ({ value: b.id, label: b.name }))} /></Field>
        <Field label={t('القناة')}><Tabs<ChannelId> value={channel} onChange={setChannel} tabs={CHANNELS.map((c) => ({ id: c, label: channelLabel(c) }))} /></Field>
      </div>
      {product && branchId && <PriceScope product={product} branchId={branchId} channel={channel} sched={sched} />}
      <PriceGrid branchId={branchId} branchName={branches.items.find((b) => b.id === branchId)?.name} products={products.items} cats={cats.items} onPick={setProductId} selected={productId} />
    </div>
  );
}

function PriceScope({ product, branchId, channel, sched }: { product: any; branchId: string; channel: ChannelId; sched?: string }) {
  const hist = useItems<any>('Product.PriceHistory', { params: { productId: product.id }, query: { branchId, channel } });
  const current = hist.items.find((r) => r.state === 'CURRENT');
  const next = [...hist.items].filter((r) => r.state === 'SCHEDULED').sort((a, b) => a.effectiveFrom - b.effectiveFrom)[0];
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_420px] gap-4 mb-6">
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Card>
            <div className="text-xs text-dim mb-1">{t('السعر الساري دلوقتي')} · {channelLabel(channel)}</div>
            {current ? <Money v={current.amount} big tone="primary" /> : <Pill tone="error">{t('مفيش سعر — الصنف مش هيتباع هنا (PRICE_NOT_FOUND)')}</Pill>}
            {current && <div className="text-[11px] text-dim mt-1">{t('من')} {dateTime(current.effectiveFromIso)} {current.effectiveToIso ? <>· {t('لحد')} {dateTime(current.effectiveToIso)}</> : <>· {t('مفتوح')}</>}</div>}
          </Card>
          <Card>
            <div className="text-xs text-dim mb-1 flex items-center gap-1"><CalendarClock className="w-3.5 h-3.5" />{t('السعر المجدول الجاي')}</div>
            {next ? <><Money v={next.amount} big /><div className="text-[11px] text-dim mt-1">{t('يبدأ')} {dateTime(next.effectiveFromIso)}</div></> : <span className="text-dim text-sm">{t('مفيش')}</span>}
          </Card>
        </div>
        <Card title={<span className="inline-flex items-center gap-2"><History className="w-4 h-4" />{t('سجل الأسعار')}</span>} badge={<StateBadge ops={['Product.PriceHistory']} />}>
          <Table head={[t('الحالة'), t('السعر'), t('من'), t('لحد'), t('النسخة'), t('بدل'), t('اتعمل')]} empty={t('مفيش أسعار للفرع والقناة دي')} rows={hist.items.map((r) => [
            <Pill tone={stateTone(r.state)}>{stateLabel(r.state)}</Pill>,
            <Money v={r.amount} />,
            <span className="text-xs">{dateTime(r.effectiveFromIso)}</span>,
            <span className="text-xs">{r.effectiveToIso ? dateTime(r.effectiveToIso) : t('مفتوح')}</span>,
            <span className="num text-xs">v{r.version}</span>,
            <span className="num text-[11px] text-dim">{r.replacesRuleId ?? '—'}</span>,
            <span className="text-[11px] text-dim">{dateTime(r.createdAt)} · <span className="num">{r.createdBy}</span></span>,
          ])} />
          <div className="text-[11px] text-dim mt-2">{t('الفترة اللي بدأت عمر سعرها ما بيتغير — بتتقفل بس وتبدأ فترة جديدة. ده السجل الكامل للأسعار اللي اتطبقت.')}</div>
        </Card>
      </div>
      <SetPriceForm product={product} branchId={branchId} channel={channel} current={current} sched={sched} />
    </div>
  );
}

function SetPriceForm({ product, branchId, channel, current, sched }: { product: any; branchId: string; channel: ChannelId; current?: any; sched?: string }) {
  const { run, busy } = useCommand();
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<'NOW' | 'SCHEDULED'>('NOW');
  const [from, setFrom] = useState(() => cairoLocal(serverNow() + 86_400_000));
  const [hasTo, setHasTo] = useState(false);
  const [to, setTo] = useState(() => cairoLocal(serverNow() + 2 * 86_400_000));
  const [last, setLast] = useState<any | null>(null);
  useEffect(() => { setLast(null); }, [product.id, branchId, channel]);
  const submit = async () => {
    const body: any = { amount: amount.trim(), currency: 'EGP', branchId, channel };
    if (mode === 'SCHEDULED') body.effectiveFrom = cairoLocalToIso(from);
    if (hasTo) body.effectiveTo = cairoLocalToIso(to);
    const r = await run<any>('Catalog.SetPrice', { params: { productId: product.id }, body }, { success: t('السعر اتحفظ') });
    if (r) { setLast(r); setAmount(''); }
  };
  return (
    <Card title={t('سعر جديد')} badge={<StateBadge ops={['Catalog.SetPrice']} />}>
      <div className="space-y-3">
        <KV rows={[[t('الصنف'), L(product.name)], [t('القناة'), channelLabel(channel)], [t('السعر الحالي'), current ? <Money v={current.amount} /> : '—']]} />
        <Field label={t('السعر (ج.م)')} hint={t('لحد 4 خانات عشرية — العملة من الفرع (EGP)')}>
          <Input data-fb="set-price:amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        </Field>
        <Field label={t('يبدأ إمتى')}>
          <Radio<'NOW' | 'SCHEDULED'> fb="set-price:mode" value={mode} onChange={setMode} options={[{ value: 'NOW', label: <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{t('من دلوقتي')}</span> }, { value: 'SCHEDULED', label: <span className="inline-flex items-center gap-1"><CalendarClock className="w-3.5 h-3.5" />{t('مجدول')}</span> }]} />
        </Field>
        {mode === 'SCHEDULED' && (
          <Field label={t('يبدأ من (بتوقيت القاهرة)')} hint={sched === 'IMMEDIATE_ONLY' ? t('السياسة IMMEDIATE_ONLY — الجدولة هتترفض (PRICE_SCHEDULING_NOT_ALLOWED)') : t('ممنوع تاريخ فات (مفيش أثر رجعي)')}>
            <Input data-fb="set-price:from" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} dir="ltr" />
          </Field>
        )}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" data-fb="set-price:has-to" checked={hasTo} onChange={(e) => setHasTo(e.target.checked)} className="accent-[var(--primary)]" />{t('ليه نهاية')}</label>
        {hasTo && (
          <>
            <Field label={t('ينتهي في (بتوقيت القاهرة)')}><Input data-fb="set-price:to" type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} dir="ltr" /></Field>
            <Banner tone="warning"><AlertTriangle className="inline w-3.5 h-3.5" /> {t('بعد النهاية الصنف هيفضل من غير سعر في الفرع والقناة دي (PRICE_NOT_FOUND) لحد ما تحط سعر جديد. السعر المؤقت اللي يرجع لوحده مكانه العروض.')}</Banner>
          </>
        )}
        <Button data-fb="set-price:submit" variant="primary" className="w-full" loading={busy} disabled={!amount.trim()} onClick={submit}><Save className="w-4 h-4" />{t('حفظ السعر')}</Button>
        <div className="text-[11px] text-dim">{t('لو السياسة بتطلب موافقة على تغيير السعر، شاشة موافقة المدير هتظهر لوحدها.')}</div>
        {last && (
          <Banner tone="success">
            <div className="font-bold">{kindLabel(last.changeKind)} · <Money v={last.rule.amount} /></div>
            <div className="text-xs">{t('من')} {dateTime(new Date(last.rule.effectiveFrom).toISOString())}{last.rule.effectiveTo ? <> · {t('لحد')} {dateTime(new Date(last.rule.effectiveTo).toISOString())}</> : null}{last.changePercent ? <> · {t('التغيير')} <span className="num">{last.changePercent}%</span></> : null}</div>
            {last.closedRule && <div className="text-[11px] text-dim">{t('الفترة القديمة اتقفلت')}: <span className="num">{last.closedRule.id}</span></div>}
          </Banner>
        )}
      </div>
    </Card>
  );
}

// ───────── compact grid: all products × channel for one branch
function PriceGrid({ branchId, branchName, products, cats, onPick, selected }: { branchId: string; branchName?: string; products: any[]; cats: any[]; onPick: (id: string) => void; selected: string }) {
  const grouped = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const p of products) { const a = m.get(p.categoryId) ?? []; a.push(p); m.set(p.categoryId, a); }
    return [...m.entries()].sort((a, b) => (cats.find((c) => c.id === a[0])?.sortOrder ?? 0) - (cats.find((c) => c.id === b[0])?.sortOrder ?? 0));
  }, [products, cats]);
  if (!branchId) return null;
  return (
    <Card title={t('جدول الأسعار — {b}', { b: branchName ?? branchId })} badge={<StateBadge ops={['Product.PriceHistory']} />}>
      <div className="overflow-x-auto rounded-xl border line" data-fb="prices:grid">
        <table className="w-full text-sm">
          <thead className="surface-1"><tr>
            <th className="text-start text-xs text-soft px-3 py-2">{t('الصنف')}</th>
            {CHANNELS.map((c) => <th key={c} className="text-start text-xs text-soft px-3 py-2">{channelLabel(c)}</th>)}
          </tr></thead>
          <tbody>
            {grouped.map(([catId, items]) => (
              <React.Fragment key={catId}>
                <tr className="border-t line"><td colSpan={1 + CHANNELS.length} className="px-3 py-1.5 text-xs font-bold text-[var(--primary)] surface-1">{L(cats.find((c) => c.id === catId)?.name) || catId}</td></tr>
                {items.map((p) => <GridRow key={p.id} p={p} branchId={branchId} onPick={onPick} selected={selected === p.id} />)}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-[11px] text-dim mt-2">{t('الأرقام من سجل الأسعار على السيرفر (الفترة السارية). دوس على صنف عشان تعدل سعره.')}</div>
    </Card>
  );
}

function GridRow({ p, branchId, onPick, selected }: { p: any; branchId: string; onPick: (id: string) => void; selected: boolean }) {
  const hist = useQuery<any>('Product.PriceHistory', { params: { productId: p.id }, query: { branchId } });
  const rows: any[] = hist.data?.items ?? [];
  return (
    <tr onClick={() => onPick(p.id)} className={'border-t line cursor-pointer hover:surface-1 ' + (selected ? 'bg-[var(--primary-container)]' : '')} data-fb={`prices:grid:${p.id}`}>
      <td className="px-3 py-1.5">{L(p.name)} <span className="num text-[11px] text-dim">{p.sku}</span></td>
      {CHANNELS.map((c) => {
        const cur = rows.find((r) => r.channel === c && r.state === 'CURRENT');
        const sch = rows.some((r) => r.channel === c && r.state === 'SCHEDULED');
        return (
          <td key={c} className="px-3 py-1.5">
            {cur ? <Money v={cur.amount} /> : <span className="text-dim">—</span>}
            {sch && <CalendarClock className="inline w-3.5 h-3.5 ms-1 text-[var(--info)]" aria-label={t('فيه سعر مجدول')} />}
          </td>
        );
      })}
    </tr>
  );
}
