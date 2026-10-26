// Item dialog: sizes (server prices per size), half-and-half pizza (with toppings per half), combo choice groups
// with upgrades and a sub-choice, modifier groups (required/optional, min/max, defaults, sold out, sub-choices),
// ingredients no/less/extra, quantity (weight with decimals), note, seat. The line price is a server re-quote,
// never a local sum (docs/18).
import React, { useEffect, useMemo, useState } from 'react';
import { Minus, Plus, AlertTriangle, Pizza, Layers, Ruler, CircleSlash, Check } from 'lucide-react';
import { useDev, useQuery, errorText } from '../../app/hooks';
import { call, ApiFailure } from '../../api/client';
import { Modal, Button, Pill, StateBadge, Input, Textarea, Spinner, Banner } from '../../ui';
import { Tech } from '../../app/tech';
import { t, L } from '../../i18n';
import { cn, money } from '../../lib/format';
import { ALLERGEN_AR, defaultPicks } from './MenuGrid';
import { halfModeLabel, levelLabel, placementLabel } from '../menu/parts';

type Level = 'NO' | 'LESS' | 'EXTRA';
type Placement = 'WHOLE' | 'LEFT' | 'RIGHT';
export interface LineDraft {
  productId: string; quantity: string; modifierOptionIds: string[]; note?: string; variantId?: string | null; halfProductId?: string | null;
  comboSelections?: Record<string, { productId: string; variantId?: string | null; modifierOptionIds?: string[] }>; seat?: number | null;
  /** menu area (proposed): ingredient levels, toppings per pizza half, sub-choices of an option */
  modifierLevels?: Record<string, Level>; modifierPlacement?: Record<string, Placement>; nestedOptionIds?: Record<string, string[]>;
}

type ComboSel = { productId: string; variantId: string | null; modifierOptionIds: string[] };

export function ProductDialog({ product, channel, onClose, onAdd, seatsEnabled, guestCount }: { product: any; channel: string; onClose: () => void; onAdd: (l: LineDraft) => Promise<void> | void; seatsEnabled?: boolean; guestCount?: number }) {
  const { auth } = useDev();
  const groupsQ = useQuery<any>('ModifierGroup.List', { query: {} });
  const allProducts = useQuery<any>('Catalog.Search', { query: { active: true, limit: 500, channel } });
  const gs: any[] = groupsQ.data?.items ?? [];
  const byId = useMemo(() => new Map(gs.map((g) => [g.id, g])), [gs]);
  const groups: any[] = (product.modifierGroupIds ?? []).map((id: string) => byId.get(id)).filter((g: any) => g && g.active);
  const prodById = useMemo(() => new Map<string, any>((allProducts.data?.items ?? []).map((p: any) => [p.id, p])), [allProducts.data]);
  const variants: any[] = (product.variants ?? []).filter((v: any) => v.active).sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const defVariant = variants.find((v) => v.isDefault)?.id ?? variants.find((v) => v.id === 'v_m')?.id ?? variants[0]?.id ?? null;

  const [sel, setSel] = useState<Record<string, string[]>>({});
  const [nested, setNested] = useState<Record<string, string[]>>({});
  const [levels, setLevels] = useState<Record<string, Level>>({});
  const [placement, setPlacement] = useState<Record<string, Placement>>({});
  const [qty, setQty] = useState('1');
  const [note, setNote] = useState('');
  const [variant, setVariant] = useState<string | null>(defVariant);
  const [half, setHalf] = useState<string | null>(null);
  const [halfOn, setHalfOn] = useState(false);
  const slots: any[] = [...(product.combo ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const [combo, setCombo] = useState<Record<string, ComboSel>>({});
  const [seat, setSeat] = useState<number | null>(null);
  const [quote, setQuote] = useState<{ data?: any; error?: ApiFailure; loading: boolean }>({ loading: true });
  const [adding, setAdding] = useState(false);
  const [ready, setReady] = useState(false);

  // defaults once the groups are loaded: default options of required groups, their sub-choices, combo defaults
  useEffect(() => {
    if (!groupsQ.data || ready) return;
    const init: Record<string, string[]> = {};
    const nest: Record<string, string[]> = {};
    for (const g of groups) {
      if (g.kind === 'INGREDIENTS') continue;
      const picks = g.min > 0 ? defaultPicks(g, g.min) : g.options.filter((o: any) => o.active && !o.soldOut && o.isDefault).slice(0, g.max).map((o: any) => o.id);
      init[g.id] = picks;
      for (const oid of picks) { const ng = nestedGroupOf(g, oid); if (ng) nest[oid] = defaultPicks(ng, Math.max(ng.min, 0) || 0); }
    }
    setSel(init); setNested(nest);
    setCombo(Object.fromEntries(slots.map((s) => {
      const opt = s.options.find((o: any) => o.productId === s.defaultProductId) ?? s.options[0];
      return [s.id, comboDefault(opt)];
    })));
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupsQ.data]);

  function nestedGroupOf(g: any, optionId: string) { const o = g.options.find((x: any) => x.id === optionId); return o?.nestedGroupId ? byId.get(o.nestedGroupId) ?? null : null; }
  function comboDefault(opt: any): ComboSel {
    const ng = opt?.nestedGroupId ? byId.get(opt.nestedGroupId) : null;
    return { productId: opt?.productId, variantId: opt?.variantId ?? null, modifierOptionIds: ng ? defaultPicks(ng, Math.max(ng.min, ng.options.some((o: any) => o.isDefault) ? 1 : 0)) : [] };
  }

  const modIds = Object.values(sel).flat();
  const nestedSent = Object.fromEntries(Object.entries(nested).filter(([oid]) => modIds.includes(oid)));
  const placeSent = half ? Object.fromEntries(Object.entries(placement).filter(([oid, p]) => modIds.includes(oid) && p !== 'WHOLE')) : {};
  const draft: LineDraft = {
    productId: product.id, quantity: qty, modifierOptionIds: modIds, note: note || undefined, variantId: variant, halfProductId: half,
    comboSelections: slots.length ? combo : undefined, seat,
    modifierLevels: Object.keys(levels).length ? levels : undefined, modifierPlacement: Object.keys(placeSent).length ? placeSent : undefined, nestedOptionIds: Object.keys(nestedSent).length ? nestedSent : undefined,
  };
  const key = JSON.stringify({ ...draft, note: undefined, seat: undefined });
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    setQuote((q) => ({ ...q, loading: true }));
    const h = setTimeout(() => {
      const { note: _n, seat: _s, ...body } = draft;
      call(auth, 'Pricing.QuoteItem', { params: { productId: product.id }, body: { ...body, branchId: auth.branchId, channel, quantity: qty || '1' } })
        .then((r) => alive && setQuote({ data: r.data, loading: false }))
        .catch((e) => alive && setQuote({ error: e, loading: false }));
    }, 200);
    return () => { alive = false; clearTimeout(h); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready]);

  const toggle = (g: any, optId: string) => {
    setSel((s) => {
      const cur = s[g.id] ?? [];
      let next: string[];
      if (g.selectionRule === 'SINGLE' || g.max === 1) next = cur.includes(optId) && g.min === 0 ? [] : [optId];
      else if (cur.includes(optId)) next = cur.filter((x) => x !== optId);
      else if (cur.length >= g.max) return s;
      else next = [...cur, optId];
      return { ...s, [g.id]: next };
    });
    const ng = nestedGroupOf(g, optId);
    if (ng && !nested[optId]) setNested((n) => ({ ...n, [optId]: defaultPicks(ng, ng.min) }));
  };
  const setLevel = (optId: string, lv: Level | null) => setLevels((l) => { const n = { ...l }; if (lv) n[optId] = lv; else delete n[optId]; return n; });
  const halves = (allProducts.data?.items ?? []).filter((p: any) => p.halfAndHalf && p.id !== product.id && (p.halfGroup ?? null) === (product.halfGroup ?? null) && (!p.menuNow || p.menuNow.onMenu));
  const step = (d: number) => { const n = Math.max(1, Math.round((Number(qty) || 0) + d)); setQty(String(n)); };
  const canAdd = !!quote.data && !quote.loading && !adding;
  const q = quote.data;
  const curVariant = variants.find((v) => v.id === variant);
  const mult = curVariant ? Number(curVariant.modifierMultiplier || 1) : 1;
  const reasonAr = quote.error?.details?.reasonAr as string | undefined;
  const missing = groups.filter((g) => g.kind !== 'INGREDIENTS' && (sel[g.id]?.length ?? 0) < g.min);

  return (
    <Modal open onClose={onClose} wide title={<span>{L(product.name)} <span className="text-dim text-sm font-normal" dir="ltr">{product.name.en}</span></span>}
      badge={product.direction ? <StateBadge state="PROPOSED" /> : (product.combo?.length || product.halfAndHalf || variants.length) ? <StateBadge ops={['Pricing.QuoteItem', 'Product.SetCombo', 'Variant.Upsert']} /> : undefined}
      footer={<>
        <div className="me-auto flex items-center gap-2 text-sm min-w-0">
          <span className="text-dim shrink-0">{t('سعر السطر')}:</span>
          {quote.loading ? <Spinner className="w-4 h-4" /> : q ? (
            <span className="flex items-baseline gap-1.5"><span className="num font-bold text-lg text-[var(--primary)]">{money(q.display?.lineTotal ?? q.lineTotal)}</span><span className="text-[11px] text-dim">{L(q.display?.label)}</span></span>
          ) : <span className="text-[var(--error)] text-xs truncate">{reasonAr ?? (quote.error ? errorText(quote.error) : '—')}</span>}
        </div>
        <Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button>
        <Button variant="primary" size="lg" disabled={!canAdd} loading={adding} onClick={async () => { setAdding(true); await onAdd(draft); setAdding(false); }} data-fb="dialog-add">{t('ضيف للشيك')}</Button>
      </>}>
      <div className="space-y-4" data-screen="C2">
        {(product.imageUrl || product.description || product.calories != null) && (
          <div className="flex gap-3 items-start">
            {product.imageUrl && <img src={product.imageUrl} alt="" className="w-28 h-20 rounded-xl object-cover shrink-0 border line" />}
            <div className="min-w-0 space-y-1">
              {product.description && <div className="text-sm text-soft">{L(product.description)}</div>}
              <div className="flex gap-2 flex-wrap items-center text-[11px] text-dim">
                {(curVariant?.calories ?? product.calories) != null && <span className="num">{curVariant?.calories ?? product.calories} {t('سعر حراري')}</span>}
                {curVariant?.sku && <Tech><span className="num" dir="ltr">{curVariant.sku}{curVariant.barcode ? ` · ${curVariant.barcode}` : ''}</span></Tech>}
              </div>
            </div>
          </div>
        )}
        {product.allergens?.length ? <Banner tone="warning"><span className="font-bold">{t('مسببات حساسية')}:</span> {product.allergens.map((a: string) => t(ALLERGEN_AR[a] ?? a)).join('، ')}</Banner> : null}
        {quote.error && !['MODIFIER_SELECTION_INVALID'].includes(quote.error.code) && <Banner tone="error">{reasonAr ?? errorText(quote.error)} <Tech><span className="num text-xs">({quote.error.code})</span></Tech></Banner>}

        {variants.length > 0 && (
          <Block icon={<Ruler className="w-4 h-4" />} title={t('الحجم')} hint={mult !== 1 && groups.some((g) => g.scalesWithSize !== false && g.kind !== 'INGREDIENTS') ? t('سعر الإضافات بيتضرب في {m} للحجم ده', { m: String(mult) }) : t('اختار الحجم')}>
            <div className="flex gap-2 flex-wrap" data-fb="dialog:sizes">{variants.map((v: any) => {
              const vp = q?.variantPrices?.find((x: any) => x.variantId === v.id);
              return <Opt key={v.id} fb={`dialog:size:${v.id}`} on={variant === v.id} onClick={() => setVariant(v.id)} label={L(v.name)} price={vp ? money(vp.unitPrice, false) : undefined} sub={v.calories != null ? `${v.calories} ${t('سعر حراري')}` : undefined} />;
            })}</div>
          </Block>
        )}
        {product.halfAndHalf && (
          <Block icon={<Pizza className="w-4 h-4" />} title={t('نص ونص')} hint={t('السعر: {m}', { m: halfModeLabel(q?.halfAndHalf?.mode) })}>
            <div className="flex gap-2 flex-wrap">
              <Opt fb="dialog:half:whole" on={!halfOn} onClick={() => { setHalfOn(false); setHalf(null); }} label={t('بيتزا كاملة')} />
              <Opt fb="dialog:half:on" on={halfOn} onClick={() => { setHalfOn(true); if (!half && halves[0]) setHalf(halves[0].id); }} label={t('نص ونص')} disabled={!halves.length} />
            </div>
            {halfOn && (
              <div className="mt-2 ps-3 border-s-2 line space-y-2">
                <div className="text-xs text-dim">{t('النص الأول')}: <b className="text-soft">{L(product.name)}</b> — {t('اختار النص التاني')}:</div>
                <div className="flex gap-2 flex-wrap">{halves.map((h: any) => {
                  const out = h.availability?.state && h.availability.state !== 'AVAILABLE';
                  return <Opt key={h.id} fb={`dialog:half:${h.sku}`} on={half === h.id} disabled={out} onClick={() => setHalf(h.id)} label={L(h.name)} sub={out ? t('خلص') : undefined} />;
                })}</div>
                {q?.halfAndHalf && (
                  <div className="text-xs rounded-lg surface-1 px-3 py-2 flex flex-wrap gap-x-4 gap-y-1">
                    {q.halfAndHalf.halves.map((x: any, i: number) => <span key={x.productId}>{i === 0 ? t('النص الأول') : t('النص التاني')}: {L(x.name)} <span className="num text-dim">({t('الكاملة')} {money(x.price, false)})</span></span>)}
                    <span className="font-bold">{halfModeLabel(q.halfAndHalf.mode)} = <span className="num">{money(q.unitPrice, false)}</span></span>
                  </div>
                )}
              </div>
            )}
          </Block>
        )}
        {slots.map((slot: any) => {
          const cur = combo[slot.id];
          const opt = slot.options.find((o: any) => o.productId === cur?.productId && (o.variantId ?? null) === (cur?.variantId ?? null));
          const ng = opt?.nestedGroupId ? byId.get(opt.nestedGroupId) : null;
          const child = q?.children?.find((c: any) => c.slotId === slot.id);
          return (
            <Block key={slot.id} icon={<Layers className="w-4 h-4" />} title={L(slot.name)} badge={<Pill tone="neutral">{slot.required === false ? t('اختياري') : t('في الوجبة')}</Pill>} hint={child ? t('من الوجبة: {n}', { n: L(child.name) }) : undefined}>
              <div className="flex gap-2 flex-wrap" data-fb={`dialog:slot:${slot.id}`}>{slot.options.map((o: any, i: number) => {
                const p = prodById.get(o.productId);
                const v = o.variantId ? p?.variants?.find((x: any) => x.id === o.variantId) : null;
                const out = p?.availability?.state && p.availability.state !== 'AVAILABLE';
                const on = cur?.productId === o.productId && (cur?.variantId ?? null) === (o.variantId ?? null);
                return <Opt key={i} fb={`dialog:combo:${slot.id}:${p?.sku ?? o.productId}${o.variantId ? ':' + o.variantId : ''}`} on={on} disabled={out} onClick={() => setCombo((c) => ({ ...c, [slot.id]: comboDefault(o) }))} label={`${L(p?.name) || o.productId}${v ? ' ' + L(v.name) : ''}`} delta={o.upcharge} zeroText={t('من غير زيادة')} sub={out ? t('خلص') : undefined} />;
              })}</div>
              {ng && (
                <div className="mt-2 ps-3 border-s-2 line">
                  <div className="text-xs text-dim mb-1">{L(ng.name)} {ng.min > 0 ? <Pill tone="warning">{t('إجباري')}</Pill> : null}</div>
                  <div className="flex gap-2 flex-wrap">{ng.options.filter((o: any) => o.active).map((o: any) => <Opt key={o.id} fb={`dialog:combo-sub:${o.id}`} disabled={o.soldOut} on={cur.modifierOptionIds.includes(o.id)} onClick={() => setCombo((c) => ({ ...c, [slot.id]: { ...cur, modifierOptionIds: ng.max === 1 ? [o.id] : cur.modifierOptionIds.includes(o.id) ? cur.modifierOptionIds.filter((x) => x !== o.id) : [...cur.modifierOptionIds, o.id].slice(0, ng.max) } }))} label={L(o.name)} delta={o.priceDelta} sub={o.soldOut ? t('خلص') : undefined} />)}</div>
                </div>
              )}
            </Block>
          );
        })}
        {groups.map((g) => g.kind === 'INGREDIENTS' ? (
          <Block key={g.id} title={L(g.name)} hint={t('كل المكونات "عادي" — غيّر اللي الزبون عايزه')}>
            <div className="space-y-1.5" data-fb={`dialog:ingredients:${g.id}`}>
              {g.options.filter((o: any) => o.active).map((o: any) => {
                const lv = levels[o.id] ?? null;
                const extra = o.extraPriceDelta ?? o.priceDelta;
                return (
                  <div key={o.id} className="flex items-center gap-2">
                    <span className={cn('text-sm flex-1 min-w-0 truncate', lv === 'NO' && 'line-through text-dim')}>{L(o.name)}</span>
                    <div className="inline-flex rounded-lg border line overflow-hidden text-xs">
                      {(['NO', 'LESS', null, 'EXTRA'] as (Level | null)[]).map((x) => (
                        <button key={String(x)} data-fb={`dialog:level:${o.id}:${x ?? 'NORMAL'}`} disabled={x === 'EXTRA' && o.soldOut} onClick={() => setLevel(o.id, x)}
                          className={cn('px-2.5 h-8 border-s line first:border-s-0 disabled:opacity-40', lv === x ? 'bg-[var(--primary-container)] text-[var(--primary)] font-bold' : 'surface-1 text-soft')}>
                          {levelLabel(x ?? 'NORMAL')}{x === 'EXTRA' && Number(extra) > 0 ? <span className="num ms-1">+{money(extra, false)}</span> : null}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </Block>
        ) : (
          <Block key={g.id} title={L(g.name)} badge={<Pill tone={g.min > 0 ? 'warning' : 'neutral'}>{g.min > 0 ? t('إجباري') : t('اختياري')}</Pill>} hint={g.selectionRule === 'SINGLE' || g.max === 1 ? t('اختار واحد') : g.min > 0 ? t('اختار من {a} لـ {b}', { a: g.min, b: g.max }) : t('لحد {b}', { b: g.max })} warn={(sel[g.id]?.length ?? 0) < g.min}>
            <div className="flex gap-2 flex-wrap" data-fb={`dialog:group:${g.id}`}>{g.options.filter((o: any) => o.active).map((o: any) => <Opt key={o.id} fb={`dialog:opt:${o.id}`} disabled={o.soldOut} on={(sel[g.id] ?? []).includes(o.id)} onClick={() => toggle(g, o.id)} label={L(o.name)} delta={o.priceDelta} sub={o.soldOut ? t('خلص النهارده') : o.allergens?.length ? o.allergens.map((a: string) => t(ALLERGEN_AR[a] ?? a)).join('، ') : undefined} soldOut={o.soldOut} />)}</div>
            {(sel[g.id] ?? []).map((oid) => {
              const o = g.options.find((x: any) => x.id === oid);
              const ng = nestedGroupOf(g, oid);
              const showPlace = !!half && g.allowHalfPlacement;
              if (!ng && !showPlace) return null;
              return (
                <div key={oid} className="mt-2 ps-3 border-s-2 line space-y-1.5">
                  {showPlace && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-dim min-w-[80px]">{L(o?.name)}:</span>
                      <div className="inline-flex rounded-lg border line overflow-hidden">
                        {(['WHOLE', 'LEFT', 'RIGHT'] as Placement[]).map((pl) => <button key={pl} data-fb={`dialog:place:${oid}:${pl}`} onClick={() => setPlacement((p) => ({ ...p, [oid]: pl }))} className={cn('px-2.5 h-7 border-s line first:border-s-0', (placement[oid] ?? 'WHOLE') === pl ? 'bg-[var(--primary-container)] text-[var(--primary)] font-bold' : 'surface-1 text-soft')}>{placementLabel(pl)}</button>)}
                      </div>
                      {(placement[oid] ?? 'WHOLE') !== 'WHOLE' && <span className="text-dim">{t('نص السعر')}</span>}
                    </div>
                  )}
                  {ng && (
                    <div>
                      <div className="text-xs text-dim mb-1">{L(o?.name)} — {L(ng.name)} {ng.min > 0 && <Pill tone="warning">{t('إجباري')}</Pill>}</div>
                      <div className="flex gap-2 flex-wrap">{ng.options.filter((x: any) => x.active).map((x: any) => {
                        const cur = nested[oid] ?? [];
                        return <Opt key={x.id} fb={`dialog:sub:${x.id}`} disabled={x.soldOut} on={cur.includes(x.id)} onClick={() => setNested((n) => ({ ...n, [oid]: ng.max === 1 ? [x.id] : cur.includes(x.id) ? cur.filter((y) => y !== x.id) : [...cur, x.id].slice(0, ng.max) }))} label={L(x.name)} delta={x.priceDelta} sub={x.soldOut ? t('خلص') : undefined} />;
                      })}</div>
                    </div>
                  )}
                </div>
              );
            })}
          </Block>
        ))}
        {missing.length > 0 && <div className="text-xs text-[var(--warning)] inline-flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />{t('لسه لازم تختار: {g}', { g: missing.map((g) => L(g.name)).join('، ') })}</div>}
        <div className="grid sm:grid-cols-3 gap-3">
          <Block title={t('الكمية')} hint={t('ينفع كسور للأصناف الموزونة')}>
            <div className="flex items-center gap-2">
              <button onClick={() => step(-1)} className="w-10 h-10 rounded-lg surface-2 flex items-center justify-center"><Minus className="w-4 h-4" /></button>
              <Input data-fb="dialog:qty" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9.]/g, ''))} className="text-center !w-20" inputMode="decimal" />
              <button onClick={() => step(1)} className="w-10 h-10 rounded-lg surface-2 flex items-center justify-center"><Plus className="w-4 h-4" /></button>
            </div>
          </Block>
          {seatsEnabled && (
            <Block title={t('الكرسي')} badge={<StateBadge state="PROPOSED" />}>
              <div className="flex gap-1 flex-wrap"><Opt on={seat === null} onClick={() => setSeat(null)} label="—" />{Array.from({ length: Math.max(2, guestCount ?? 4) }, (_, i) => i + 1).map((s) => <Opt key={s} on={seat === s} onClick={() => setSeat(s)} label={String(s)} />)}</div>
            </Block>
          )}
          <Block title={t('ملاحظة للمطبخ')}><Textarea data-fb="dialog:note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('مثلًا: من غير بصل')} className="min-h-[44px]" /></Block>
        </div>
        {q && (q.modifiers?.length > 0 || q.children?.length > 0) && (
          <div className="rounded-xl surface-1 px-3 py-2 text-xs space-y-0.5" data-fb="dialog:summary">
            <div className="text-dim mb-1">{t('هيتسجل في الشيك كده')}:</div>
            {q.children?.map((c: any, i: number) => <div key={i} className="flex justify-between gap-2"><span>↳ {L(c.name)}{c.detail ? ` (${L(c.detail)})` : ''}</span>{Number(c.upcharge) > 0 && <span className="num">+{money(c.upcharge, false)}</span>}</div>)}
            {q.modifiers?.map((m: any, i: number) => <div key={i} className="flex justify-between gap-2"><span>+ {L(m.name)}</span>{Number(m.priceDelta) !== 0 && <span className="num">{Number(m.priceDelta) > 0 ? '+' : ''}{money(m.priceDelta, false)}</span>}</div>)}
          </div>
        )}
        <Tech>{q && <div className="text-xs text-dim num" dir="ltr">quote: unit {q.unitPrice} · mods {q.modifiers.map((m: any) => m.priceDelta).join(' + ') || '0'} · unitTotal {q.unitTotal} × {q.quantity} = {q.lineTotal} (rule {q.priceRuleId}, VAT {q.tax.rate}% {q.tax.mode}{q.taxSplit ? ' · split ' + q.taxSplit.map((p: any) => `${p.taxPolicyId}:${p.weight}`).join(' / ') : ''})</div>}</Tech>
      </div>
    </Modal>
  );
}

function Block({ title, hint, children, badge, warn, icon }: { title: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode; badge?: React.ReactNode; warn?: boolean; icon?: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">{icon && <span className="text-dim">{icon}</span>}<span className={cn('text-sm font-bold', warn && 'text-[var(--warning)]')}>{title}</span>{badge}{warn && <AlertTriangle className="w-3.5 h-3.5 text-[var(--warning)]" />}</div>
      {hint && <div className="text-[11px] text-dim">{hint}</div>}
      {children}
    </div>
  );
}
function Opt({ on, onClick, label, delta, sub, disabled, price, fb, zeroText, soldOut }: { on: boolean; onClick: () => void; label: string; delta?: string; sub?: string; disabled?: boolean; price?: string; fb?: string; zeroText?: string; soldOut?: boolean }) {
  return (
    <button data-fb={fb} disabled={disabled} onClick={onClick} className={cn('relative px-3 py-2 rounded-xl border text-sm flex flex-col items-start min-w-[80px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed', on ? 'border-[var(--primary)] bg-[var(--primary-container)]' : 'border-[var(--glass-border)] surface-1 hover:surface-2')}>
      <span className="font-bold inline-flex items-center gap-1">{on && <Check className="w-3.5 h-3.5 text-[var(--primary)]" />}{soldOut && <CircleSlash className="w-3.5 h-3.5 text-[var(--error)]" />}{label}</span>
      {price !== undefined && <span className="text-[12px] num text-[var(--primary)] font-bold">{price}</span>}
      {delta !== undefined && <span className="text-[11px] num text-dim">{Number(delta) === 0 && zeroText ? zeroText : `${Number(delta) >= 0 ? '+' : ''}${money(delta, false)}`}</span>}
      {sub && <span className={cn('text-[10px]', soldOut ? 'text-[var(--error)] font-bold' : 'text-dim')}>{sub}</span>}
    </button>
  );
}
