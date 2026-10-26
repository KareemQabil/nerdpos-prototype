// "خلص النهارده" (86) board: managers and cashiers mark items and options sold out for today; they come back by
// themselves at the start of the next business day (SoldOutResetPolicy). Every device sees it at once.
import React, { useMemo, useState } from 'react';
import { Ban, RotateCcw, Search, CircleSlash, Clock, PackageX } from 'lucide-react';
import { useCommand, useDev, useQuery } from '../../app/hooks';
import { Banner, Button, Card, Empty, Field, Input, Modal, Pill, Section, StateBadge, Switch, Tabs, Textarea } from '../../ui';
import { Tech } from '../../app/tech';
import { t, L } from '../../i18n';
import { cn, dateTime } from '../../lib/format';
import { timeText } from './parts';

const OPS = ['SoldOut.Board', 'Product.SetAvailability', 'ModifierOption.SetAvailability'];
const QUICK_REASONS = ['الخامة خلصت', 'الكمية المحضرة خلصت', 'المكنة عطلانة', 'مش في الموسم'];

export default function SoldOutScreen() {
  return (
    <div>
      <Section title={t('خلص النهارده')} badge={<StateBadge ops={OPS} />} sub={t('علّم الأصناف والإضافات اللي خلصت — بتختفي من البيع على كل الأجهزة فورًا، وبترجع لوحدها أول اليوم التجاري الجاي')} />
      <SoldOutBoard />
    </div>
  );
}

type Target = { kind: 'product'; id: string; name: any } | { kind: 'option'; id: string; groupId: string; name: any };

export function SoldOutBoard({ compact }: { compact?: boolean }) {
  const { can } = useDev();
  const { run, busy } = useCommand();
  const board = useQuery<any>('SoldOut.Board');
  const products = useQuery<any>('Catalog.Search', { query: { active: true, limit: 500 } });
  const groups = useQuery<any>('ModifierGroup.List', { query: { active: true } });
  const cats = useQuery<any>('Category.List', { query: { active: true } });
  const [tab, setTab] = useState<'products' | 'options'>('products');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [reason, setReason] = useState('');
  const [untilReset, setUntilReset] = useState(false);
  const allowed = can('product:setavailability');
  const b = board.data;
  const items: any[] = products.data?.items ?? [];
  const shown = items.filter((p) => (!cat || p.categoryId === cat) && (!q || (p.name.ar + p.name.en + p.sku).toLowerCase().includes(q.toLowerCase())));
  const options = useMemo(() => (groups.data?.items ?? []).flatMap((g: any) => g.options.filter((o: any) => o.active).map((o: any) => ({ ...o, group: g }))).filter((o: any) => !q || (o.name.ar + o.name.en + o.group.name.ar).toLowerCase().includes(q.toLowerCase())), [groups.data, q]);

  const markOut = async () => {
    if (!target) return;
    const why = reason.trim() || t('خلص النهارده');
    const ok = target.kind === 'product'
      ? await run('Product.SetAvailability', { params: { productId: target.id }, body: { state: 'SOLD_OUT', reason: why, until: untilReset ? undefined : 'END_OF_BUSINESS_DAY' } }, { success: t('{n} اتعلّم خلص — اختفى من البيع', { n: L(target.name) }) })
      : await run('ModifierOption.SetAvailability', { params: { groupId: target.groupId, optionId: target.id }, body: { state: 'SOLD_OUT', reason: why, until: untilReset ? 'UNTIL_RESET' : undefined } }, { success: t('{n} اتعلّم خلص', { n: L(target.name) }) });
    if (ok) { setTarget(null); setReason(''); setUntilReset(false); }
  };
  const back = (kind: 'product' | 'option', id: string, groupId?: string, name?: any) => kind === 'product'
    ? run('Product.SetAvailability', { params: { productId: id }, body: { state: 'AVAILABLE' } }, { success: t('{n} رجع للبيع', { n: L(name) }) })
    : run('ModifierOption.SetAvailability', { params: { groupId, optionId: id }, body: { state: 'AVAILABLE' } }, { success: t('{n} رجع للبيع', { n: L(name) }) });

  const outProducts: any[] = b?.products ?? [];
  const outOptions: any[] = b?.options ?? [];
  return (
    <div className="space-y-3" data-fb="soldout-board">
      <Banner tone="info">
        <span className="inline-flex items-center gap-1.5"><Clock className="w-4 h-4" />
          {b?.autoReset ? t('اللي يتعلّم "خلص النهارده" بيرجع لوحده أول اليوم التجاري الجاي (الساعة {h}).', { h: timeText(b?.resetsAt) || '04:00' }) : t('الرجوع يدوي: اللي يتعلّم خلص بيفضل لحد ما حد يرجّعه.')}
        </span>
        {!allowed && <div className="text-xs mt-1">{t('إنت شايف اللوحة بس — التعليم محتاج صلاحية توفر الأصناف.')}</div>}
      </Banner>

      <Card title={<span className="inline-flex items-center gap-2"><PackageX className="w-4 h-4 text-[var(--error)]" />{t('خلصان دلوقتي')}</span>} badge={<Pill tone={outProducts.length + outOptions.length ? 'error' : 'success'}>{outProducts.length + outOptions.length}</Pill>}>
        {outProducts.length + outOptions.length === 0 ? <div className="text-sm text-dim">{t('كل حاجة متاحة')}</div> : (
          <div className="flex flex-wrap gap-2">
            {outProducts.map((x) => (
              <div key={x.productId} className="flex items-center gap-2 rounded-xl border border-[color-mix(in_srgb,var(--error)_35%,transparent)] bg-[color-mix(in_srgb,var(--error)_8%,transparent)] ps-3 pe-1 py-1" data-fb={`soldout:out:${x.productId}`}>
                <div className="leading-tight">
                  <div className="text-sm font-bold">{L(x.name)} {x.state === 'BLOCKED' && <Pill tone="error">{t('متوقف')}</Pill>}</div>
                  <div className="text-[11px] text-dim">{x.reason ?? '—'} · {x.today ? t('النهارده بس') : x.state === 'BLOCKED' ? t('لحد ما يتشغل') : t('لحد ما حد يرجّعه')} · {x.updatedByName}</div>
                </div>
                {allowed && x.state === 'SOLD_OUT' && <Button size="sm" variant="ghost" data-fb={`soldout:back:${x.productId}`} disabled={busy} onClick={() => back('product', x.productId, undefined, x.name)}><RotateCcw className="w-3.5 h-3.5" />{t('رجّعه')}</Button>}
              </div>
            ))}
            {outOptions.map((x) => (
              <div key={x.optionId} className="flex items-center gap-2 rounded-xl border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-[color-mix(in_srgb,var(--warning)_8%,transparent)] ps-3 pe-1 py-1" data-fb={`soldout:out:${x.optionId}`}>
                <div className="leading-tight">
                  <div className="text-sm font-bold">{L(x.name)} <span className="text-[11px] text-dim font-normal">({t('إضافة')} · {L(x.groupName)})</span></div>
                  <div className="text-[11px] text-dim">{x.reason ?? '—'} · {x.today ? t('النهارده بس') : t('لحد ما حد يرجّعه')} · {x.updatedByName}</div>
                </div>
                {allowed && <Button size="sm" variant="ghost" data-fb={`soldout:back:${x.optionId}`} disabled={busy} onClick={() => back('option', x.optionId, x.groupId, x.name)}><RotateCcw className="w-3.5 h-3.5" />{t('رجّعها')}</Button>}
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="flex flex-wrap gap-2 items-center">
        <Tabs<'products' | 'options'> value={tab} onChange={setTab} tabs={[{ id: 'products', label: t('الأصناف') }, { id: 'options', label: t('الإضافات') }]} />
        <div className="relative flex-1 min-w-[200px]"><Search className="w-4 h-4 absolute top-3 start-3 text-dim" /><Input data-fb="soldout:search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('دوّر بالاسم…')} style={{ paddingInlineStart: 36 }} /></div>
      </div>
      {tab === 'products' && (
        <>
          <div className="flex gap-1.5 flex-wrap">
            <button className={cn('px-3 h-8 rounded-lg text-xs border', !cat ? 'border-[var(--primary)] text-[var(--primary)] bg-[var(--primary-container)] font-bold' : 'border-[var(--glass-border)] text-soft')} onClick={() => setCat(null)}>{t('الكل')}</button>
            {(cats.data?.items ?? []).map((c: any) => <button key={c.id} className={cn('px-3 h-8 rounded-lg text-xs border', cat === c.id ? 'border-[var(--primary)] text-[var(--primary)] bg-[var(--primary-container)] font-bold' : 'border-[var(--glass-border)] text-soft')} onClick={() => setCat(c.id)}>{L(c.name)}</button>)}
          </div>
          {shown.length === 0 ? <Empty icon={<Search className="w-8 h-8" />} text={t('مفيش أصناف بالاسم ده')} /> : (
            <div className={cn('grid gap-2', compact ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5')}>
              {shown.map((p) => {
                const st = p.availability?.state;
                const out = st === 'SOLD_OUT' || st === 'BLOCKED';
                const notHere = st === 'NOT_ON_BRANCH_MENU';
                return (
                  <button key={p.id} data-fb={`soldout:product:${p.sku}`} disabled={!allowed || notHere || busy}
                    onClick={() => (out ? st === 'SOLD_OUT' && back('product', p.id, undefined, p.name) : (setTarget({ kind: 'product', id: p.id, name: p.name }), setReason('')))}
                    className={cn('text-start rounded-xl border p-2.5 transition-colors flex gap-2 items-center disabled:cursor-default', out ? 'border-[color-mix(in_srgb,var(--error)_45%,transparent)] bg-[color-mix(in_srgb,var(--error)_10%,transparent)]' : 'border-[var(--glass-border)] surface-1 hover:surface-2', notHere && 'opacity-40')}>
                    {p.imageUrl ? <img src={p.imageUrl} alt="" className={cn('w-10 h-10 rounded-lg object-cover shrink-0', out && 'grayscale')} /> : <span className="w-10 h-10 rounded-lg shrink-0" style={{ background: (p.colorCode ?? '#64748b') + '44' }} />}
                    <span className="min-w-0 flex-1">
                      <span className={cn('block text-sm font-bold truncate', out && 'line-through opacity-70')}>{L(p.name)}</span>
                      <span className="block text-[11px]">{out ? <span className="text-[var(--error)] font-bold">{st === 'BLOCKED' ? t('متوقف') : t('خلص')}{p.availability?.soldOutFor ? ' · ' + t('النهارده') : ''}</span> : notHere ? <span className="text-dim">{t('مش على منيو الفرع')}</span> : <span className="text-[var(--success)]">{t('متاح')}</span>}</span>
                    </span>
                    {allowed && !notHere && (out ? (st === 'SOLD_OUT' ? <RotateCcw className="w-4 h-4 text-dim shrink-0" /> : null) : <Ban className="w-4 h-4 text-dim shrink-0" />)}
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
      {tab === 'options' && (
        <div className={cn('grid gap-2', compact ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5')}>
          {options.map((o: any) => (
            <button key={o.id} data-fb={`soldout:option:${o.id}`} disabled={!allowed || busy}
              onClick={() => (o.soldOut ? back('option', o.id, o.group.id, o.name) : (setTarget({ kind: 'option', id: o.id, groupId: o.group.id, name: o.name }), setReason('')))}
              className={cn('text-start rounded-xl border p-2.5 transition-colors disabled:cursor-default', o.soldOut ? 'border-[color-mix(in_srgb,var(--warning)_45%,transparent)] bg-[color-mix(in_srgb,var(--warning)_10%,transparent)]' : 'border-[var(--glass-border)] surface-1 hover:surface-2')}>
              <span className={cn('block text-sm font-bold', o.soldOut && 'line-through opacity-70')}>{L(o.name)}</span>
              <span className="block text-[11px] text-dim">{L(o.group.name)} · {o.soldOut ? <span className="text-[var(--warning)] font-bold">{t('خلصت')}</span> : t('متاحة')}</span>
            </button>
          ))}
        </div>
      )}

      <Modal open={!!target} onClose={() => setTarget(null)} title={<span className="inline-flex items-center gap-2"><CircleSlash className="w-5 h-5 text-[var(--error)]" />{t('خلص: {n}', { n: L(target?.name) })}</span>} badge={<StateBadge ops={[target?.kind === 'option' ? 'ModifierOption.SetAvailability' : 'Product.SetAvailability']} />}
        footer={<><Button onClick={() => setTarget(null)}>{t('رجوع')}</Button><Button variant="danger" data-fb="soldout:confirm" loading={busy} onClick={markOut}><Ban className="w-4 h-4" />{untilReset ? t('علّمه خلص') : t('خلص النهارده')}</Button></>}>
        <div className="space-y-3">
          <div className="text-sm">{target?.kind === 'option' ? t('الإضافة دي هتبان "خلصت" في شاشة البيع ومش هتتختار.') : t('الصنف هيختفي من شاشة البيع على كل الأجهزة، ومش هيتضاف لأي شيك.')}</div>
          <Field label={t('السبب')}>
            <div className="flex flex-wrap gap-1.5 mb-2">{QUICK_REASONS.map((r) => <button key={r} type="button" onClick={() => setReason(t(r))} className={cn('px-2.5 h-8 rounded-lg text-xs border', reason === t(r) ? 'border-[var(--primary)] text-[var(--primary)] bg-[var(--primary-container)]' : 'border-[var(--glass-border)] text-soft')}>{t(r)}</button>)}</div>
            <Textarea data-fb="soldout:reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('اختياري — مثلاً: الفراخ خلصت')} className="min-h-[44px]" />
          </Field>
          <Switch checked={untilReset} onChange={setUntilReset} label={t('يفضل خلصان لحد ما حد يرجّعه (مش النهارده بس)')} />
          <Tech><div className="text-[11px] text-dim num" dir="ltr">{target?.kind === 'option' ? 'ModifierOption.SetAvailability' : 'Product.SetAvailability'} until={untilReset ? 'UNTIL_RESET' : 'END_OF_BUSINESS_DAY'} · business date {b?.businessDate}</div></Tech>
        </div>
      </Modal>
      <Tech><div className="text-[11px] text-dim">{t('اليوم التجاري')}: <span className="num">{b?.businessDate}</span> · {dateTime(b?.resetsAt)}</div></Tech>
    </div>
  );
}
