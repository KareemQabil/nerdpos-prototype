// B2 Prices: per product (and size) × branch × channel, effective windows (now or scheduled), history, approval by
// policy; the whole price list of a branch at once; bulk price change (percent / fixed, rounding, by category / channel /
// branch, now or scheduled) with a preview of old/new prices and margin when the recipe cost is known.
// r3C (E13 / F2-05): every sales channel (صالة، تيك أواي، دليفري، طلبات…) has its own column and price list; the bulk
// change has exclusions (row checkboxes + an exception list of items/categories kept with the batch), pinned single-item
// overrides that the next bulk change skips unless included, and a result that shows applied vs excluded.
import React, { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Clock, History, Save, AlertTriangle, Percent, Wand2, ListChecks, TrendingUp, TrendingDown, Eye, Pin, Ban, CheckCircle2, X } from 'lucide-react';
import { useCommand, useDev, useQuery } from '../../app/hooks';
import { Banner, Button, Card, Field, Input, KV, Money, Pill, Section, Select, StateBadge, Switch, Table, Tabs } from '../../ui';
import { Tech } from '../../app/tech';
import { t, L } from '../../i18n';
import { branchLabel, personText } from '../../demo/people';
import { cn, dateTime, money } from '../../lib/format';
import { Check, PolicyChip, Radio, cairoLocal, cairoLocalToIso, channelLabel, ruleText, serverNow, useItems, usePolicy } from './catalog/common';
import { ChannelDot, orderTypeLabel, useSalesChannels, type SalesChannelView } from '../channels/common'; // r3C sales channels

const stateTone = (s: string) => (s === 'CURRENT' ? 'success' : s === 'SCHEDULED' ? 'info' : 'neutral') as 'success' | 'info' | 'neutral';
const stateLabel = (s: string) => ({ CURRENT: t('ساري'), SCHEDULED: t('مجدول'), ENDED: t('انتهى') } as Record<string, string>)[s] ?? s;
const kindLabel = (k: string) => ({ FIRST_PRICE: t('أول سعر'), CHANGE: t('تغيير'), CORRECTION: t('تصحيح سعر مجدول') } as Record<string, string>)[k] ?? k;
type Tab = 'product' | 'bulk' | 'batches';

export default function Prices() {
  const { me, auth } = useDev();
  const branches = useItems<any>('Branch.List');
  const [tab, setTab] = useState<Tab>('product');
  const [branchId, setBranchId] = useState<string>(me?.branchId ?? auth.branchId ?? '');
  useEffect(() => { if (!branchId && branches.items[0]) setBranchId(branches.items[0].id); }, [branches.items, branchId]);
  const sched = usePolicy<string>('PriceSchedulingPolicy');
  const zero = usePolicy<string>('ZeroPricePolicy');
  const approvals = usePolicy<Record<string, any>>('ApprovalRequirementPolicy');
  const needsApproval = approvals?.PRICE_CHANGE?.mode && approvals.PRICE_CHANGE.mode !== 'NEVER';
  return (
    <div>
      <Section title={t('الأسعار')} badge={<StateBadge ops={['Catalog.SetPrice', 'Product.PriceHistory', 'Catalog.PriceList', 'Catalog.BulkPriceChange']} />} sub={t('سعر لكل صنف وحجم في كل فرع وقناة، من دلوقتي أو مجدول، وتغيير جماعي بمعاينة قبل التطبيق')} />
      <Tech>
        <div className="flex flex-wrap gap-1.5 mb-3" data-fb="prices:policies">
          <PolicyChip id="PriceSchedulingPolicy" value={sched ?? '…'} />
          <PolicyChip id="ZeroPricePolicy" value={zero ?? '…'} />
          <PolicyChip id="ApprovalRequirementPolicy[PRICE_CHANGE]" value={ruleText(approvals?.PRICE_CHANGE ?? { mode: 'NEVER' })} />
        </div>
      </Tech>
      <Banner tone="info">{t('السعر الجديد بيسري على الطلبات الجديدة بس؛ السطور اللي اتسجلت في الشيكات بتفضل بسعرها.')} {needsApproval ? t('تغيير السعر محتاج موافقة مدير حسب الإعدادات.') : ''} {sched === 'IMMEDIATE_ONLY' ? t('الجدولة مقفولة في الإعدادات — التغيير من دلوقتي بس.') : ''}</Banner>
      <div className="flex flex-wrap gap-3 items-end my-4">
        <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: 'product', label: t('سعر صنف') }, { id: 'bulk', label: <span className="inline-flex items-center gap-1"><Wand2 className="w-3.5 h-3.5" />{t('تغيير جماعي')}</span> }, { id: 'batches', label: t('التغييرات الجماعية') }]} />
        <div className="flex-1" />
        <Field label={t('الفرع')} className="w-56"><Select data-fb="prices:branch" value={branchId} onChange={(e) => setBranchId(e.target.value)} options={branches.items.map((b) => ({ value: b.id, label: branchLabel(b) }))} /></Field>
      </div>
      {tab === 'product' && branchId && <ProductPrices branchId={branchId} branchName={branchLabel(branches.items.find((b) => b.id === branchId))} sched={sched} />}
      {tab === 'bulk' && <BulkChange branchId={branchId} branches={branches.items} sched={sched} onDone={() => setTab('batches')} />}
      {tab === 'batches' && <Batches />}
    </div>
  );
}

// ───────── one product
const chName = (c: SalesChannelView | undefined) => (c ? L(c.name) : '');
const sourceText = (src: string, c?: SalesChannelView) => src === 'FOLLOW' ? t('محسوب من {x}', { x: c?.followsName ? L(c.followsName) : t('قناة تانية') }) : src === 'ORDER_TYPE' ? t('مفيش سعر خاص — بسعر {x}', { x: orderTypeLabel(c?.orderType ?? '') }) : t('سعر خاص بالقناة');

function ProductPrices({ branchId, branchName, sched }: { branchId: string; branchName?: string; sched?: string }) {
  const products = useItems<any>('Catalog.Search', { query: { active: 'true' } });
  const cats = useItems<any>('Category.List');
  const channels = useSalesChannels();
  const list = useQuery<any>('Catalog.PriceList', { query: { branchId } });
  const [productId, setProductId] = useState('');
  const [variantId, setVariantId] = useState('');
  const [channelId, setChannelId] = useState<string>('sch_dine_in');
  useEffect(() => { if (!productId && products.items[0]) setProductId(products.items[0].id); }, [products.items, productId]);
  const product = products.items.find((p) => p.id === productId);
  const variants = (product?.variants ?? []).filter((v: any) => v.active);
  useEffect(() => { setVariantId(''); }, [productId]);
  const channel = channels.items.find((c) => c.id === channelId) ?? channels.items[0];
  const effective = (list.data?.items ?? []).find((p: any) => p.productId === productId)?.prices?.[`${channel?.id}:${variantId || 'BASE'}`]?.current ?? null;
  return (
    <>
      <div className="flex flex-wrap gap-3 items-end mb-4">
        <Field label={t('الصنف')} className="w-72"><Select data-fb="prices:product" value={productId} onChange={(e) => setProductId(e.target.value)} options={products.items.map((p) => ({ value: p.id, label: `${L(p.name)} · ${p.sku}` }))} /></Field>
        {variants.length > 0 && <Field label={t('الحجم')} className="w-52"><Select data-fb="prices:variant" value={variantId} onChange={(e) => setVariantId(e.target.value)} options={[{ value: '', label: t('سعر الصنف (الأساسي)') }, ...variants.map((v: any) => ({ value: v.id, label: t('سعر خاص: {n}', { n: L(v.name) }) }))]} /></Field>}
        <Field label={t('القناة')}><Tabs<string> value={channel?.id ?? ''} onChange={setChannelId} tabs={channels.items.map((c) => ({ id: c.id, label: <span className="inline-flex items-center gap-1.5" data-fb={`prices:channel:${c.id}`}><ChannelDot color={c.color} />{L(c.name)}</span> }))} /></Field>
      </div>
      {product && channel && <PriceScope product={product} variant={variants.find((v: any) => v.id === variantId) ?? null} branchId={branchId} channel={channel} effective={effective} sched={sched} />}
      <PriceGrid branchId={branchId} branchName={branchName} cats={cats.items} data={list.data} loading={list.loading} channels={channels.items} onPick={(id, vid, ch) => { setProductId(id); if (ch) setChannelId(ch); setTimeout(() => setVariantId(vid ?? ''), 0); }} selected={productId} />
    </>
  );
}

function PriceScope({ product, variant, branchId, channel, effective, sched }: { product: any; variant: any | null; branchId: string; channel: SalesChannelView; effective: any; sched?: string }) {
  const hist = useItems<any>('Product.PriceHistory', { params: { productId: product.id }, query: { branchId, channel: channel.orderType, salesChannelId: channel.id, variantId: variant ? variant.id : 'BASE' } });
  const current = hist.items.find((r) => r.state === 'CURRENT');
  const next = [...hist.items].filter((r) => r.state === 'SCHEDULED').sort((a, b) => a.effectiveFrom - b.effectiveFrom)[0];
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_420px] gap-4 mb-6">
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Card>
            <div className="text-xs text-dim mb-1 flex items-center gap-1.5"><ChannelDot color={channel.color} />{t('السعر الساري دلوقتي')} · {chName(channel)}{variant ? ` · ${L(variant.name)}` : ''}</div>
            {current ? <><Money v={current.amount} big tone="primary" />{current.pinned && <Pill tone="violet" className="ms-2"><Pin className="w-3 h-3" />{t('متثبت')}</Pill>}</>
              : effective && !channel.isDefault ? <><Money v={effective.amount} big /><div className="text-[11px] text-dim mt-1" data-fb="prices:effective-source">{sourceText(effective.source, channel)}</div></>
              : <Pill tone={variant ? 'neutral' : 'error'}>{variant ? t('مفيش سعر خاص — بيتحسب سعر الصنف + فرق الحجم') : t('مفيش سعر — الصنف مش هيتباع هنا')}</Pill>}
            {current && <div className="text-[11px] text-dim mt-1">{t('من')} {dateTime(current.effectiveFromIso)} {current.effectiveToIso ? <>· {t('لحد')} {dateTime(current.effectiveToIso)}</> : <>· {t('مفتوح')}</>}</div>}
          </Card>
          <Card>
            <div className="text-xs text-dim mb-1 flex items-center gap-1"><CalendarClock className="w-3.5 h-3.5" />{t('السعر المجدول الجاي')}</div>
            {next ? <><Money v={next.amount} big /><div className="text-[11px] text-dim mt-1">{t('يبدأ')} {dateTime(next.effectiveFromIso)}</div></> : <span className="text-dim text-sm">{t('مفيش')}</span>}
          </Card>
        </div>
        <Card title={<span className="inline-flex items-center gap-2"><History className="w-4 h-4" />{t('سجل الأسعار')}</span>} badge={<StateBadge ops={['Product.PriceHistory']} />}>
          <Table head={[t('الحالة'), t('السعر'), t('من'), t('لحد'), t('اتعمل')]} empty={t('مفيش أسعار هنا')} rows={hist.items.map((r) => [
            <span className="inline-flex items-center gap-1"><Pill tone={stateTone(r.state)}>{stateLabel(r.state)}</Pill>{r.bulkChangeId && <Pill tone="violet">{t('جماعي')}</Pill>}{r.pinned && <Pill tone="violet"><Pin className="w-3 h-3" />{t('متثبت')}</Pill>}</span>,
            <Money v={r.amount} />,
            <span className="text-xs">{dateTime(r.effectiveFromIso)}</span>,
            <span className="text-xs">{r.effectiveToIso ? dateTime(r.effectiveToIso) : t('مفتوح')}</span>,
            <span className="text-[11px] text-dim">{dateTime(r.createdAt)}<Tech> · <span className="num">{r.createdBy} · v{r.version} · {r.id}</span></Tech></span>,
          ])} />
          <div className="text-[11px] text-dim mt-2">{t('السعر اللي بدأ ما بيتغيرش — بيتقفل وتبدأ فترة جديدة. ده السجل الكامل للأسعار اللي اتطبقت.')}</div>
        </Card>
      </div>
      <SetPriceForm product={product} variant={variant} branchId={branchId} channel={channel} current={current ?? (effective && !channel.isDefault ? { amount: effective.amount } : undefined)} sched={sched} />
    </div>
  );
}

function SetPriceForm({ product, variant, branchId, channel, current, sched }: { product: any; variant: any | null; branchId: string; channel: SalesChannelView; current?: any; sched?: string }) {
  const { run, busy } = useCommand();
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<'NOW' | 'SCHEDULED'>('NOW');
  const [from, setFrom] = useState(() => cairoLocal(serverNow() + 86_400_000));
  const [hasTo, setHasTo] = useState(false);
  const [to, setTo] = useState(() => cairoLocal(serverNow() + 2 * 86_400_000));
  const [pinned, setPinned] = useState(false);
  const [last, setLast] = useState<any | null>(null);
  useEffect(() => { setLast(null); }, [product.id, branchId, channel.id, variant?.id]);
  const submit = async () => {
    const body: any = { amount: amount.trim(), currency: 'EGP', branchId, channel: channel.orderType };
    if (!channel.isDefault) body.salesChannelId = channel.id;
    if (pinned) body.pinned = true;
    if (variant) body.variantId = variant.id;
    if (mode === 'SCHEDULED') body.effectiveFrom = cairoLocalToIso(from);
    if (hasTo) body.effectiveTo = cairoLocalToIso(to);
    const r = await run<any>('Catalog.SetPrice', { params: { productId: product.id }, body }, { success: t('السعر اتحفظ') });
    if (r) { setLast(r); setAmount(''); }
  };
  return (
    <Card title={t('سعر جديد')} badge={<StateBadge ops={['Catalog.SetPrice']} />}>
      <div className="space-y-3">
        <KV rows={[[t('الصنف'), `${L(product.name)}${variant ? ' · ' + L(variant.name) : ''}`], [t('القناة'), <span className="inline-flex items-center gap-1.5"><ChannelDot color={channel.color} />{chName(channel)}{!channel.isDefault && <span className="text-dim text-xs">({orderTypeLabel(channel.orderType)})</span>}</span>], [t('السعر الحالي'), current ? <Money v={current.amount} /> : '—']]} />
        <Field label={t('السعر (ج.م)')}><Input data-fb="set-price:amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></Field>
        <Field label={t('يبدأ إمتى')}>
          <Radio<'NOW' | 'SCHEDULED'> fb="set-price:mode" value={mode} onChange={setMode} options={[{ value: 'NOW', label: <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{t('من دلوقتي')}</span> }, { value: 'SCHEDULED', label: <span className="inline-flex items-center gap-1"><CalendarClock className="w-3.5 h-3.5" />{t('مجدول')}</span> }]} />
        </Field>
        {mode === 'SCHEDULED' && (
          <Field label={t('يبدأ من (بتوقيت القاهرة)')} hint={sched === 'IMMEDIATE_ONLY' ? t('الجدولة مقفولة في الإعدادات') : t('ممنوع تاريخ فات')}>
            <Input data-fb="set-price:from" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} dir="ltr" />
          </Field>
        )}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" data-fb="set-price:has-to" checked={hasTo} onChange={(e) => setHasTo(e.target.checked)} className="accent-[var(--primary)]" />{t('ليه نهاية')}</label>
        {hasTo && (
          <>
            <Field label={t('ينتهي في (بتوقيت القاهرة)')}><Input data-fb="set-price:to" type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} dir="ltr" /></Field>
            <Banner tone="warning"><AlertTriangle className="inline w-3.5 h-3.5" /> {t('بعد النهاية الصنف هيفضل من غير سعر هنا لحد ما تحط سعر جديد. السعر المؤقت اللي يرجع لوحده مكانه العروض.')}</Banner>
          </>
        )}
        <label className="flex items-start gap-2 text-sm rounded-xl surface-1 border line p-2.5">
          <input type="checkbox" data-fb="set-price:pinned" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="accent-[var(--primary)] mt-1" />
          <span><span className="font-bold inline-flex items-center gap-1"><Pin className="w-3.5 h-3.5" />{t('ثبّت السعر ده')}</span><span className="block text-xs text-dim">{t('التغيير الجماعي الجاي مش هيلمسه إلا لو اخترته بنفسك في المعاينة.')}</span></span>
        </label>
        <Button data-fb="set-price:submit" variant="primary" className="w-full" loading={busy} disabled={!amount.trim()} onClick={submit}><Save className="w-4 h-4" />{t('حفظ السعر')}</Button>
        {last && (
          <Banner tone="success">
            <div className="font-bold">{kindLabel(last.changeKind)} · <Money v={last.rule.amount} />{last.rule.pinned ? <> · {t('متثبت')}</> : null}</div>
            <div className="text-xs">{t('من')} {dateTime(new Date(last.rule.effectiveFrom).toISOString())}{last.rule.effectiveTo ? <> · {t('لحد')} {dateTime(new Date(last.rule.effectiveTo).toISOString())}</> : null}{last.changePercent ? <> · {t('التغيير')} <span className="num">{last.changePercent}%</span></> : null}</div>
          </Banner>
        )}
      </div>
    </Card>
  );
}

// ───────── whole price list of a branch (one read) — one column per sales channel
function PriceGrid({ branchId, branchName, cats, data, loading, channels, onPick, selected }: { branchId: string; branchName?: string; cats: any[]; data: any; loading: boolean; channels: SalesChannelView[]; onPick: (id: string, variantId?: string, channelId?: string) => void; selected: string }) {
  const items: any[] = data?.items ?? [];
  const cols: SalesChannelView[] = channels.length ? channels : [];
  const grouped = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const p of items) { const a = m.get(p.categoryId) ?? []; a.push(p); m.set(p.categoryId, a); }
    return [...m.entries()].sort((a, b) => (cats.find((c) => c.id === a[0])?.sortOrder ?? 0) - (cats.find((c) => c.id === b[0])?.sortOrder ?? 0));
  }, [items, cats]);
  const anyCost = items.some((p) => p.cost);
  const cell = (pr: any, c: SalesChannelView) => {
    if (pr?.current) {
      const src = pr.current.source;
      const own = src === 'OWN';
      return (
        <span className="inline-flex items-center gap-1" title={own ? undefined : sourceText(src, c)}>
          <span className={cn(!own && 'text-dim', src === 'FOLLOW' && 'text-[var(--info)]', own && !c.isDefault && 'font-bold')}><Money v={pr.current.amount} /></span>
          {pr.current.pinned && <Pin className="w-3 h-3 text-[var(--violet)]" />}
          {pr.next && <span title={t('مجدول: {a} من {d}', { a: money(pr.next.amount, false), d: dateTime(pr.next.from) })} className="inline-flex items-center gap-0.5 text-[11px] text-[var(--info)]"><CalendarClock className="w-3.5 h-3.5" /><span className="num">{money(pr.next.amount, false)}</span></span>}
        </span>
      );
    }
    return pr?.next ? <span className="text-[11px] text-[var(--info)]">{t('من')} {dateTime(pr.next.from)}: <span className="num">{money(pr.next.amount, false)}</span></span> : <span className="text-dim">—</span>;
  };
  return (
    <Card title={t('قايمة الأسعار — {b}', { b: branchName ?? '' })} badge={<StateBadge ops={['Catalog.PriceList']} />}>
      <div className="overflow-x-auto rounded-xl border line" data-fb="prices:grid">
        <table className="w-full text-sm">
          <thead className="surface-1"><tr>
            <th className="text-start text-xs text-soft px-3 py-2">{t('الصنف')}</th>
            {cols.map((c) => <th key={c.id} className="text-start text-xs text-soft px-3 py-2 whitespace-nowrap"><span className="inline-flex items-center gap-1.5"><ChannelDot color={c.color} />{chName(c)}</span>{!c.isDefault && <div className="text-[10px] font-normal text-dim">{orderTypeLabel(c.orderType)}{c.priceMode === 'FOLLOW' && c.follow ? ` · ${Number(c.follow.percent) >= 0 ? '+' : ''}${c.follow.percent}%` : ''}</div>}</th>)}
            {anyCost && <th className="text-start text-xs text-soft px-3 py-2">{t('التكلفة')}</th>}
          </tr></thead>
          <tbody>
            {loading && !data && <tr><td colSpan={1 + cols.length} className="px-3 py-6 text-center text-dim">{t('بيحمّل…')}</td></tr>}
            {grouped.map(([catId, ps]) => (
              <React.Fragment key={catId}>
                <tr className="border-t line"><td colSpan={1 + cols.length + (anyCost ? 1 : 0)} className="px-3 py-1.5 text-xs font-bold text-[var(--primary)] surface-1">{L(cats.find((c) => c.id === catId)?.name) || catId}</td></tr>
                {ps.map((p) => (
                  <React.Fragment key={p.productId}>
                    <tr onClick={() => onPick(p.productId)} className={'border-t line cursor-pointer hover:surface-1 ' + (selected === p.productId ? 'bg-[var(--primary-container)]' : '')} data-fb={`prices:grid:${p.productId}`}>
                      <td className="px-3 py-1.5">{L(p.name)} <span className="num text-[11px] text-dim">{p.sku}</span></td>
                      {cols.map((c) => <td key={c.id} className="px-3 py-1.5" data-fb={`prices:cell:${p.productId}:${c.id}`} onClick={(e) => { e.stopPropagation(); onPick(p.productId, undefined, c.id); }}>{cell(p.prices[`${c.id}:BASE`], c)}</td>)}
                      {anyCost && <td className="px-3 py-1.5">{p.cost ? <Money v={p.cost} /> : '—'}</td>}
                    </tr>
                    {p.variants.map((v: any) => (
                      <tr key={v.id} onClick={() => onPick(p.productId, v.id)} className="border-t line cursor-pointer hover:surface-1 text-xs">
                        <td className="px-3 py-1 ps-8 text-soft">↳ {L(v.name)} {v.sku && <span className="num text-dim">{v.sku}</span>}</td>
                        {cols.map((c) => {
                          const own = p.prices[`${c.id}:${v.id}`];
                          const base = p.prices[`${c.id}:BASE`]?.current?.amount;
                          return <td key={c.id} className="px-3 py-1">{own ? cell(own, c) : base ? <span className="num text-dim">{(Number(base) + Number(v.priceDelta)).toFixed(2)}</span> : <span className="text-dim">—</span>}</td>;
                        })}
                        {anyCost && <td />}
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-[11px] text-dim mt-2">{t('الرمادي = مفيش سعر خاص بالقناة (بيتباع بسعر نوع الطلب، أو الصنف + فرق الحجم). الأزرق الفاتح = محسوب من قناة تانية بنسبة. الدبوس = سعر متثبت. الأيقونة الزرقا = فيه سعر مجدول. دوس على أي خانة عشان تعدلها.')}</div>
    </Card>
  );
}

// ───────── bulk change (F2-05 / P1-027 / A15)
const SKIP_TEXT: Record<string, string> = { UNCHANGED: 'من غير تغيير بعد التقريب', ZERO_NOT_ALLOWED: 'السعر هيبقى صفر — ممنوع', SCHEDULE_CONFLICT: 'فيه سعر مجدول بعد التاريخ ده', INVALID: 'مينفعش', PINNED: 'سعر متثبت — اختاره لو عايز تغيّره', EXCLUDED: 'مستثنى' };
const EXCLUDED_TEXT: Record<string, string> = { ITEM: 'صنف في الاستثناءات', CATEGORY: 'قسم في الاستثناءات', ROW: 'شلته من المعاينة' };

function BulkChange({ branchId, branches, sched, onDone }: { branchId: string; branches: any[]; sched?: string; onDone: () => void }) {
  const { run, busy } = useCommand();
  const cats = useItems<any>('Category.List');
  const products = useItems<any>('Catalog.Search', { query: { active: 'true' } });
  const channelList = useSalesChannels();
  const lastBatch = useItems<any>('Catalog.PriceChangeBatches', { query: { limit: '1' } }).items[0];
  const [catIds, setCatIds] = useState<string[]>([]);
  const [channelIds, setChannelIds] = useState<string[]>(['sch_dine_in', 'sch_takeaway']);
  const [branchIds, setBranchIds] = useState<string[]>(branchId ? [branchId] : []);
  const [includeVariants, setIncludeVariants] = useState(true);
  const [mode, setMode] = useState<'PERCENT' | 'FIXED'>('PERCENT');
  const [dir, setDir] = useState<'UP' | 'DOWN'>('UP');
  const [value, setValue] = useState('10');
  const [step, setStep] = useState('1');
  const [roundDir, setRoundDir] = useState<'NEAREST' | 'UP' | 'DOWN'>('NEAREST');
  const [when, setWhen] = useState<'NOW' | 'SCHEDULED'>('NOW');
  const [from, setFrom] = useState(() => cairoLocal(serverNow() + 86_400_000).slice(0, 11) + '04:00');
  // exceptions (kept with the batch)
  const [exProducts, setExProducts] = useState<string[]>([]);
  const [exCats, setExCats] = useState<string[]>([]);
  const [exRows, setExRows] = useState<string[]>([]);
  const [incPinned, setIncPinned] = useState<string[]>([]);
  const [pick, setPick] = useState('');
  const [preview, setPreview] = useState<any | null>(null);
  const [previewKey, setPreviewKey] = useState('');
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const body = (dryRun: boolean) => ({
    dryRun, filter: { categoryIds: catIds, salesChannelIds: channelIds, branchIds, includeVariants },
    change: { mode, value: (dir === 'DOWN' ? '-' : '') + (value.trim().replace(/^-/, '') || '0') }, rounding: { step, direction: roundDir },
    effectiveFrom: when === 'SCHEDULED' ? cairoLocalToIso(from) ?? undefined : undefined,
    exclusions: { productIds: exProducts, categoryIds: exCats, rowKeys: exRows }, includePinned: incPinned,
  });
  const key = JSON.stringify(body(true));
  const doPreview = async () => { const r = await run<any>('Catalog.BulkPriceChange', { body: body(true) }); if (r) { setPreview(r); setPreviewKey(key); setResult(null); } };
  // after the first preview, changing an exception refreshes the preview by itself (rows stay visible, marked)
  const exKey = JSON.stringify([exProducts, exCats, exRows, incPinned]);
  useEffect(() => { if (preview) void doPreview(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [exKey]);
  const apply = async () => {
    const r = await run<any>('Catalog.BulkPriceChange', { body: body(false) }, { success: t('{n} سعر اتغير', { n: r0(preview?.summary?.changed) }) });
    if (r) { setResult({ ...r, previewRows: preview?.rows ?? [] }); setPreview(null); }
  };
  const stale = preview && previewKey !== key;
  const allRows: any[] = preview?.rows ?? [];
  const rows: any[] = allRows.filter((r: any) => !onlyChanged || !r.skipped);
  const anyCost = allRows.some((r: any) => r.cost);
  const toggleRow = (r: any, on: boolean) => {
    if (r.pinned && !r.excluded) { setIncPinned(on ? [...incPinned, r.key] : incPinned.filter((k) => k !== r.key)); return; }
    if (r.excluded === 'ITEM' || r.excluded === 'CATEGORY') return; // un-exclude from the exception list instead
    setExRows(on ? exRows.filter((k) => k !== r.key) : [...exRows, r.key]);
  };
  const pname = (id: string) => L(products.items.find((p) => p.id === id)?.name) || id;
  const cname = (id: string) => L(cats.items.find((c) => c.id === id)?.name) || id;
  const useLast = () => { const x = lastBatch?.exclusions; if (!x) return; setExProducts(x.productIds ?? []); setExCats(x.categoryIds ?? []); };
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-4">
      <div className="space-y-4">
        <Card title={<span className="inline-flex items-center gap-2"><Percent className="w-4 h-4" />{t('التغيير')}</span>} badge={<StateBadge ops={['Catalog.BulkPriceChange']} />}>
          <div className="space-y-3">
            <Field label={t('القنوات')} hint={t('التغيير هيمشي على القنوات المختارة بس — الباقي زي ما هو')}><div className="flex flex-wrap gap-1.5">{channelList.items.map((c) => <Check key={c.id} fb={`bulk:channel:${c.id}`} checked={channelIds.includes(c.id)} onChange={(on) => setChannelIds(on ? [...channelIds, c.id] : channelIds.filter((x) => x !== c.id))}><ChannelDot color={c.color} />{L(c.name)}</Check>)}</div></Field>
            <Field label={t('الأقسام')} hint={t('ولا واحد = كل الأقسام')}><div className="flex flex-wrap gap-1.5">{cats.items.map((c) => <Check key={c.id} fb={`bulk:cat:${c.id}`} checked={catIds.includes(c.id)} onChange={(on) => setCatIds(on ? [...catIds, c.id] : catIds.filter((x) => x !== c.id))}>{L(c.name)}</Check>)}</div></Field>
            <Field label={t('الفروع')}><div className="flex flex-wrap gap-1.5">{branches.map((b) => <Check key={b.id} checked={branchIds.includes(b.id)} onChange={(on) => setBranchIds(on ? [...branchIds, b.id] : branchIds.filter((x) => x !== b.id))}>{branchLabel(b)}</Check>)}</div></Field>
            <Switch checked={includeVariants} onChange={setIncludeVariants} label={t('يشمل الأسعار الخاصة بالأحجام')} />
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('النوع')}><Radio<'PERCENT' | 'FIXED'> fb="bulk:mode" value={mode} onChange={setMode} options={[{ value: 'PERCENT', label: t('نسبة %') }, { value: 'FIXED', label: t('مبلغ') }]} /></Field>
              <Field label={t('الاتجاه')}><Radio<'UP' | 'DOWN'> fb="bulk:dir" value={dir} onChange={setDir} options={[{ value: 'UP', label: <span className="inline-flex items-center gap-1"><TrendingUp className="w-3.5 h-3.5" />{t('زيادة')}</span> }, { value: 'DOWN', label: <span className="inline-flex items-center gap-1"><TrendingDown className="w-3.5 h-3.5" />{t('تخفيض')}</span> }]} /></Field>
            </div>
            <Field label={mode === 'PERCENT' ? t('النسبة %') : t('المبلغ (ج.م)')}><Input data-fb="bulk:value" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} /></Field>
            <Field label={t('التقريب')}>
              <Radio fb="bulk:step" value={step} onChange={setStep} options={[{ value: '0', label: t('بالقرش') }, { value: '0.25', label: '0.25' }, { value: '0.50', label: '0.50' }, { value: '1', label: '1.00' }, { value: '5', label: '5.00' }]} />
            </Field>
            {step !== '0' && <Radio<'NEAREST' | 'UP' | 'DOWN'> fb="bulk:round-dir" value={roundDir} onChange={setRoundDir} options={[{ value: 'NEAREST', label: t('لأقرب') }, { value: 'UP', label: t('لفوق') }, { value: 'DOWN', label: t('لتحت') }]} />}
            <Field label={t('يبدأ إمتى')}>
              <Radio<'NOW' | 'SCHEDULED'> fb="bulk:when" value={when} onChange={setWhen} options={[{ value: 'NOW', label: t('من دلوقتي') }, { value: 'SCHEDULED', label: t('مجدول') }]} />
            </Field>
            {when === 'SCHEDULED' && <Field label={t('يبدأ من (بتوقيت القاهرة)')} hint={sched === 'IMMEDIATE_ONLY' ? t('الجدولة مقفولة في الإعدادات') : t('مثلاً أول اليوم التجاري الجاي (4 الصبح)')}><Input data-fb="bulk:from" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} dir="ltr" /></Field>}
          </div>
        </Card>
        <Card title={<span className="inline-flex items-center gap-2"><Ban className="w-4 h-4" />{t('الاستثناءات')}</span>} description={t('أصناف أو أقسام مش هيتغير سعرها في التغيير ده. بتتحفظ مع التغيير وتفضل ظاهرة في السجل.')}
          actions={lastBatch?.exclusions && (lastBatch.exclusions.productIds?.length || lastBatch.exclusions.categoryIds?.length) ? <Button size="sm" variant="ghost" data-fb="bulk:ex-last" onClick={useLast}>{t('نفس استثناءات آخر مرة')}</Button> : undefined}>
          <div className="space-y-3">
            <div className="flex gap-2">
              <Select data-fb="bulk:ex-pick" value={pick} onChange={(e) => setPick(e.target.value)} options={[{ value: '', label: t('اختار صنف تستثنيه…') }, ...products.items.filter((p) => !exProducts.includes(p.id)).map((p) => ({ value: p.id, label: L(p.name) }))]} />
              <Button size="sm" data-fb="bulk:ex-add" disabled={!pick} onClick={() => { setExProducts([...exProducts, pick]); setPick(''); }}>{t('استثني')}</Button>
            </div>
            <div className="flex flex-wrap gap-1.5">{cats.items.map((c) => <Check key={c.id} fb={`bulk:ex-cat:${c.id}`} checked={exCats.includes(c.id)} onChange={(on) => setExCats(on ? [...exCats, c.id] : exCats.filter((x) => x !== c.id))}>{t('قسم')}: {L(c.name)}</Check>)}</div>
            {(exProducts.length > 0 || exRows.length > 0) && (
              <div className="flex flex-wrap gap-1.5" data-fb="bulk:ex-list">
                {exProducts.map((id) => <span key={id} className="inline-flex items-center gap-1 px-2 h-7 rounded-full text-xs border border-[var(--warning)] text-[var(--warning-text)]">{pname(id)}<button type="button" data-fb={`bulk:ex-remove:${id}`} onClick={() => setExProducts(exProducts.filter((x) => x !== id))}><X className="w-3 h-3" /></button></span>)}
                {exRows.length > 0 && <span className="inline-flex items-center gap-1 px-2 h-7 rounded-full text-xs border line">{t('{n} سطر اتشال من المعاينة', { n: String(exRows.length) })}<button type="button" onClick={() => setExRows([])}><X className="w-3 h-3" /></button></span>}
              </div>
            )}
          </div>
        </Card>
        <Button data-fb="bulk:preview" className="w-full" variant="primary" loading={busy} disabled={!channelIds.length || !branchIds.length} onClick={doPreview}><Eye className="w-4 h-4" />{t('عاين قبل التطبيق')}</Button>
      </div>
      <div className="space-y-4">
        {result && <BulkResult result={result} onHistory={onDone} pname={pname} cname={cname} />}
        <Card title={<span className="inline-flex items-center gap-2"><ListChecks className="w-4 h-4" />{t('المعاينة')}</span>}
          actions={preview && <Switch checked={onlyChanged} onChange={setOnlyChanged} label={t('اللي هيتغير بس')} />}>
          {!preview ? <div className="text-sm text-dim py-8 text-center">{t('اختار التغيير ودوس "عاين" — هتشوف كل سعر قديم وجديد قبل ما تطبق، وتقدر تشيل أي سطر.')}</div> : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2" data-fb="bulk:summary">
                <Pill tone="primary">{t('هيتغير')} <span className="num" data-fb="bulk:changed">{preview.summary.changed}</span></Pill>
                {preview.summary.excluded > 0 && <Pill tone="warning"><Ban className="w-3 h-3" />{t('مستثنى')} <span className="num" data-fb="bulk:excluded">{preview.summary.excluded}</span></Pill>}
                {preview.summary.pinnedSkipped > 0 && <Pill tone="violet"><Pin className="w-3 h-3" />{t('متثبت ومش هيتغير')} <span className="num">{preview.summary.pinnedSkipped}</span></Pill>}
                {preview.summary.skipped - preview.summary.excluded - preview.summary.pinnedSkipped > 0 && <Pill tone="neutral">{t('مش هيتغير لسبب تاني')} <span className="num">{preview.summary.skipped - preview.summary.excluded - preview.summary.pinnedSkipped}</span></Pill>}
                <Pill tone="neutral">{t('أكبر تغيير')} <span className="num">{preview.summary.maxChangePercent}%</span></Pill>
                <Pill tone={preview.summary.scheduled ? 'info' : 'success'}>{preview.summary.scheduled ? t('مجدول من {d}', { d: dateTime(preview.summary.effectiveFrom) }) : t('من دلوقتي')}</Pill>
              </div>
              {(preview.summary.followNotes ?? []).length > 0 && <Banner tone="info">{t('قنوات ماشية بنسبة من قناة تانية بتتغير لوحدها مع القناة اللي ماشية وراها؛ هنا بيظهر بس الأسعار الخاصة بيها.')}</Banner>}
              {stale && <Banner tone="warning">{t('غيّرت الاختيارات بعد المعاينة — عاين تاني قبل التطبيق.')}</Banner>}
              <div className="overflow-x-auto max-h-[460px] overflow-y-auto rounded-xl border line" data-fb="bulk:preview-table">
                <table className="w-full text-sm">
                  <thead className="surface-1 sticky top-0"><tr>{['', t('الصنف'), t('القناة'), t('القديم'), t('الجديد'), t('الفرق'), ...(anyCost ? [t('الهامش')] : []), ''].map((h, i) => <th key={i} className="text-start text-xs text-soft px-3 py-2">{h}</th>)}</tr></thead>
                  <tbody>
                    {rows.map((r: any) => {
                      const on = !r.skipped || (r.skipped === 'UNCHANGED' || r.skipped === 'ZERO_NOT_ALLOWED' || r.skipped === 'SCHEDULE_CONFLICT' || r.skipped === 'INVALID');
                      const lockedEx = r.excluded === 'ITEM' || r.excluded === 'CATEGORY';
                      return (
                        <tr key={r.key} className={cn('border-t line', r.skipped && 'opacity-60', r.excluded && 'bg-[color-mix(in_srgb,var(--warning)_7%,transparent)]')} data-fb={`bulk:row:${r.productId}:${r.salesChannelId}`}>
                          <td className="px-2 py-1.5"><input type="checkbox" className="accent-[var(--primary)]" data-fb={`bulk:row-check:${r.key}`} checked={on && !r.excluded && r.skipped !== 'PINNED'} disabled={lockedEx} title={lockedEx ? t('شيله من قايمة الاستثناءات الأول') : undefined} onChange={(e) => toggleRow(r, e.target.checked)} /></td>
                          <td className="px-3 py-1.5">{L(r.name)}{r.variantName ? <span className="text-dim"> · {L(r.variantName)}</span> : null}{branchIds.length > 1 && <div className="text-[10px] text-dim">{branchLabel(branches.find((b) => b.id === r.branchId))}</div>}</td>
                          <td className="px-3 py-1.5 text-xs whitespace-nowrap">{L(r.salesChannelName) || channelLabel(r.channel)}</td>
                          <td className="px-3 py-1.5 num">{money(r.oldAmount, false)}{!r.ownBefore && !['sch_dine_in', 'sch_takeaway', 'sch_delivery'].includes(r.salesChannelId) ? <div className="text-[10px] text-dim">{t('بسعر نوع الطلب')}</div> : null}</td>
                          <td className={cn('px-3 py-1.5 num', r.skipped ? 'line-through text-dim' : 'font-bold')}>{money(r.newAmount, false)}</td>
                          <td className={cn('px-3 py-1.5 num text-xs', Number(r.newAmount) > Number(r.oldAmount) ? 'text-[var(--success)]' : Number(r.newAmount) < Number(r.oldAmount) ? 'text-[var(--error)]' : 'text-dim')}>{r.changePercent ? `${Number(r.changePercent) > 0 ? '+' : ''}${r.changePercent}%` : '—'}</td>
                          {anyCost && <td className="px-3 py-1.5 num text-xs">{r.marginOld ? `${r.marginOld}% → ${r.marginNew}%` : '—'}</td>}
                          <td className="px-3 py-1.5 text-[11px] text-dim">{r.excluded ? <span className="text-[var(--warning-text)]">{t(EXCLUDED_TEXT[r.excluded] ?? 'مستثنى')}</span> : r.skipped ? t(SKIP_TEXT[r.skipped] ?? r.skipped) : r.pinned ? <span className="text-[var(--violet)]">{t('متثبت — هيتغير لأنك اخترته')}</span> : ''}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {!anyCost && <div className="text-[11px] text-dim">{t('الهامش بيظهر لما يبقى للصنف وصفة بتكلفة معروفة (من المخزون والوصفات).')}</div>}
              <div className="flex items-center gap-2 justify-end">
                <span className="text-[11px] text-dim">{t('شيل علامة أي سطر عشان تستثنيه. لو السياسة بتطلب موافقة، المدير بيوافق مرة واحدة على التغيير كله.')}</span>
                <Button data-fb="bulk:apply" variant="primary" loading={busy} disabled={!!stale || !preview.summary.changed} onClick={apply}><Save className="w-4 h-4" />{t('طبّق {n} سعر', { n: preview.summary.changed })}</Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
const r0 = (v: any) => String(v ?? '');

/** After apply: what changed vs what was kept out, and a check that the result equals the preview. */
function BulkResult({ result, onHistory, pname, cname }: { result: any; onHistory: () => void; pname: (id: string) => string; cname: (id: string) => string }) {
  const rows: any[] = result.rows ?? [];
  const applied = rows.filter((r) => !r.skipped);
  const excluded = rows.filter((r) => r.skipped === 'EXCLUDED');
  const pinned = rows.filter((r) => r.skipped === 'PINNED');
  const pv: any[] = result.previewRows ?? [];
  const sig = (a: any[]) => a.filter((r) => !r.skipped).map((r) => `${r.key}=${r.newAmount}`).sort().join(',');
  const same = pv.length > 0 && sig(pv) === sig(rows);
  const ex = result.exclusions ?? result.batch?.exclusions;
  const ref = React.useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [result]);
  return (
    <div ref={ref}>
    <Card tone="success" title={<span className="inline-flex items-center gap-2"><CheckCircle2 className="w-4 h-4" />{t('اتطبق التغيير')}</span>} data-fb="bulk:result"
      actions={<Button size="sm" variant="ghost" data-fb="bulk:to-history" onClick={onHistory}>{t('سجل التغييرات الجماعية')}</Button>}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Pill tone="success">{t('اتغير')} <span className="num" data-fb="bulk:result-applied">{applied.length}</span></Pill>
          <Pill tone="warning">{t('مستثنى')} <span className="num" data-fb="bulk:result-excluded">{excluded.length}</span></Pill>
          {pinned.length > 0 && <Pill tone="violet">{t('متثبت ومتغيرش')} <span className="num">{pinned.length}</span></Pill>}
          {same ? <Pill tone="success" dot><span data-fb="bulk:result-matches">{t('النتيجة زي المعاينة بالظبط')}</span></Pill> : pv.length > 0 ? <Pill tone="error">{t('النتيجة مختلفة عن المعاينة — راجع')}</Pill> : null}
        </div>
        {ex && (ex.productIds?.length || ex.categoryIds?.length) ? <div className="text-xs"><span className="font-bold">{t('الاستثناءات اللي اتحفظت')}: </span>{[...(ex.productIds ?? []).map(pname), ...(ex.categoryIds ?? []).map((c: string) => `${t('قسم')} ${cname(c)}`)].join('، ')}</div> : null}
        {excluded.length > 0 && <div className="text-xs text-dim">{excluded.slice(0, 8).map((r) => `${L(r.name)} · ${L(r.salesChannelName)} ${money(r.oldAmount, false)}`).join('، ')}{excluded.length > 8 ? '…' : ''}</div>}
        <div className="text-[11px] text-dim">{t('التغيير اتسجل في سجل النشاط باسمك. تقدر تحط سعر خاص لصنف واحد بعد كده من «سعر صنف» وتثبته.')}</div>
      </div>
    </Card>
    </div>
  );
}

// ───────── history of bulk changes
function Batches() {
  const list = useItems<any>('Catalog.PriceChangeBatches');
  const products = useItems<any>('Catalog.Search', { query: { active: 'true' } });
  const cats = useItems<any>('Category.List');
  const channels = useSalesChannels(undefined, true);
  const [open, setOpen] = useState<string | null>(null);
  const pname = (id: string) => L(products.items.find((p) => p.id === id)?.name) || id;
  const vname = (id: string, vid: string) => L(products.items.find((p) => p.id === id)?.variants?.find((v: any) => v.id === vid)?.name) || vid;
  const scName = (r: any) => { const c = channels.items.find((x) => x.id === r.salesChannelId); return c ? L(c.name) : channelLabel(r.channel); };
  const changeText = (b: any) => `${Number(b.change.value) > 0 ? t('زيادة') : t('تخفيض')} ${b.change.mode === 'PERCENT' ? `${Math.abs(Number(b.change.value))}%` : `${Math.abs(Number(b.change.value)).toFixed(2)} ${t('ج.م')}`}`;
  const chText = (b: any) => (b.filter.salesChannelIds ?? []).map((id: string) => L(channels.items.find((c) => c.id === id)?.name) || id).join('، ') || (b.filter.channels ?? []).map(channelLabel).join('، ');
  const exCount = (b: any) => (b.exclusions?.productIds?.length ?? 0) + (b.exclusions?.categoryIds?.length ?? 0) + (b.exclusions?.rowKeys?.length ?? 0);
  return (
    <Card title={t('التغييرات الجماعية')} badge={<StateBadge ops={['Catalog.PriceChangeBatches']} />}>
      <Table head={[t('اتعمل'), t('بواسطة'), t('التغيير'), t('القنوات'), t('اتغير'), t('مستثنى'), t('الحالة'), '']} empty={t('لسه مفيش تغييرات جماعية')} rows={list.items.map((b) => [
        <span className="text-xs">{dateTime(b.createdAt)}</span>,
        personText(b.createdByName),
        changeText(b),
        <span className="text-xs">{chText(b)}</span>,
        <span className="num">{b.rows.filter((r: any) => !r.skipped).length}</span>,
        exCount(b) ? <Pill tone="warning" size="sm">{b.rows.filter((r: any) => r.skipped === 'EXCLUDED').length}</Pill> : <span className="text-dim">—</span>,
        b.status === 'SCHEDULED' ? <Pill tone="info">{t('مجدول من {d}', { d: dateTime(b.effectiveFromIso) })}</Pill> : <Pill tone="success">{t('اتطبق')}</Pill>,
        <Button size="sm" variant="ghost" data-fb={`batch:open:${b.id}`} onClick={() => setOpen(open === b.id ? null : b.id)}>{open === b.id ? t('اخفي') : t('التفاصيل')}</Button>,
      ])} />
      {open && (() => {
        const b = list.items.find((x) => x.id === open);
        if (!b) return null;
        const ex = b.exclusions;
        return (
          <div className="mt-3 rounded-xl border line p-3 space-y-2" data-fb="batch:details">
            <div className="text-sm font-bold">{changeText(b)} · {chText(b)} · {dateTime(b.createdAt)}</div>
            {ex && exCount(b) > 0 && <div className="text-xs"><span className="font-bold">{t('الاستثناءات')}: </span>{[...(ex.productIds ?? []).map(pname), ...(ex.categoryIds ?? []).map((c: string) => `${t('قسم')} ${L(cats.items.find((x) => x.id === c)?.name) || c}`), ...(ex.rowKeys?.length ? [t('{n} سطر اتشال يدوي', { n: String(ex.rowKeys.length) })] : [])].join('، ')}</div>}
            <Table head={[t('الصنف'), t('القناة'), t('القديم'), t('الجديد'), '']} rows={b.rows.filter((r: any) => !r.skipped || r.skipped === 'EXCLUDED' || r.skipped === 'PINNED').map((r: any) => [
              `${pname(r.productId)}${r.variantId ? ' · ' + vname(r.productId, r.variantId) : ''}`, scName(r), <Money v={r.oldAmount} />, r.skipped ? <span className="text-dim line-through"><Money v={r.newAmount} /></span> : <Money v={r.newAmount} tone="primary" />,
              r.skipped === 'EXCLUDED' ? <Pill tone="warning" size="sm">{t('مستثنى')}</Pill> : r.skipped === 'PINNED' ? <Pill tone="violet" size="sm">{t('متثبت')}</Pill> : <Pill tone="success" size="sm">{t('اتغير')}</Pill>,
            ])} />
          </div>
        );
      })()}
    </Card>
  );
}
