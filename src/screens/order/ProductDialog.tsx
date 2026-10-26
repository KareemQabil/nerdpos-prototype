// Item dialog: modifiers with min/max, sizes, half-and-half, combo slots with swaps and one nested choice,
// quantity (weight with decimals), note, seat. The line price is a server re-quote, never a local sum.
import React, { useEffect, useMemo, useState } from 'react';
import { Minus, Plus, AlertTriangle } from 'lucide-react';
import { useDev, useQuery, errorText } from '../../app/hooks';
import { call, ApiFailure } from '../../api/client';
import { Modal, Button, Pill, StateBadge, Input, Textarea, Spinner, Banner } from '../../ui';
import { t, L } from '../../i18n';
import { cn, money } from '../../lib/format';
import { ALLERGEN_AR } from './MenuGrid';

export interface LineDraft { productId: string; quantity: string; modifierOptionIds: string[]; note?: string; variantId?: string | null; halfProductId?: string | null; comboSelections?: Record<string, { productId: string; modifierOptionIds?: string[] }>; seat?: number | null }

export function ProductDialog({ product, channel, onClose, onAdd, seatsEnabled, guestCount }: { product: any; channel: string; onClose: () => void; onAdd: (l: LineDraft) => Promise<void> | void; seatsEnabled?: boolean; guestCount?: number }) {
  const { auth } = useDev();
  const groupsQ = useQuery<any>('ModifierGroup.List', { query: {} });
  const allProducts = useQuery<any>('Catalog.Search', { query: { active: true, limit: 500 } });
  const groups: any[] = (groupsQ.data?.items ?? []).filter((g: any) => product.modifierGroupIds.includes(g.id));
  const [sel, setSel] = useState<Record<string, string[]>>({});
  const [qty, setQty] = useState('1');
  const [note, setNote] = useState('');
  const [variant, setVariant] = useState<string | null>(product.variants?.length ? 'v_m' : null);
  const [half, setHalf] = useState<string | null>(null);
  const [combo, setCombo] = useState<Record<string, { productId: string; modifierOptionIds: string[] }>>(() => Object.fromEntries((product.combo ?? []).map((s: any) => [s.id, { productId: s.defaultProductId, modifierOptionIds: [] }])));
  const [seat, setSeat] = useState<number | null>(null);
  const [quote, setQuote] = useState<{ data?: any; error?: ApiFailure; loading: boolean }>({ loading: true });
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!groupsQ.data) return;
    const init: Record<string, string[]> = {};
    for (const g of groups) init[g.id] = g.min > 0 ? g.options.filter((o: any) => o.active).slice(0, g.min).map((o: any) => o.id) : [];
    setSel(init);
    // nested choice defaults (e.g. sauce for the side)
    const gs = groupsQ.data.items as any[];
    setCombo((c) => Object.fromEntries(Object.entries(c).map(([k, v]) => {
      const slot = product.combo?.find((s: any) => s.id === k);
      const opt = slot?.options.find((o: any) => o.productId === v.productId);
      const ng = opt?.nestedGroupId ? gs.find((g) => g.id === opt.nestedGroupId) : null;
      return [k, { ...v, modifierOptionIds: ng ? ng.options.slice(0, ng.min).map((o: any) => o.id) : [] }];
    })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupsQ.data]);

  const modIds = Object.values(sel).flat();
  const draft: LineDraft = { productId: product.id, quantity: qty, modifierOptionIds: modIds, note: note || undefined, variantId: variant, halfProductId: half, comboSelections: product.combo ? combo : undefined, seat };
  const key = JSON.stringify({ ...draft, note: undefined, seat: undefined });
  useEffect(() => {
    if (!groupsQ.data) return;
    let alive = true;
    setQuote((q) => ({ ...q, loading: true }));
    const h = setTimeout(() => {
      call(auth, 'Pricing.QuoteItem', { params: { productId: product.id }, body: { branchId: auth.branchId, channel, productId: product.id, quantity: qty || '1', modifierOptionIds: modIds, variantId: variant, halfProductId: half, comboSelections: product.combo ? combo : undefined } })
        .then((r) => alive && setQuote({ data: r.data, loading: false }))
        .catch((e) => alive && setQuote({ error: e, loading: false }));
    }, 220);
    return () => { alive = false; clearTimeout(h); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, groupsQ.data]);

  const toggle = (g: any, optId: string) => setSel((s) => {
    const cur = s[g.id] ?? [];
    if (g.selectionRule === 'SINGLE' || g.max === 1) return { ...s, [g.id]: [optId] };
    if (cur.includes(optId)) return { ...s, [g.id]: cur.filter((x) => x !== optId) };
    if (cur.length >= g.max) return s;
    return { ...s, [g.id]: [...cur, optId] };
  });
  const halves = (allProducts.data?.items ?? []).filter((p: any) => p.halfAndHalf && p.id !== product.id);
  const gs: any[] = groupsQ.data?.items ?? [];
  const step = (d: number) => { const n = Math.max(1, Math.round((Number(qty) || 0) + d)); setQty(String(n)); };
  const canAdd = !!quote.data && !quote.loading && !adding;

  return (
    <Modal open onClose={onClose} wide title={<span>{L(product.name)} <span className="text-dim text-sm font-normal" dir="ltr">{product.name.en}</span></span>} badge={product.direction ? <StateBadge state="PROPOSED" /> : undefined}
      footer={<>
        <div className="me-auto flex items-center gap-2 text-sm">
          <span className="text-dim">{t('سعر السطر من السيرفر')}:</span>
          {quote.loading ? <Spinner className="w-4 h-4" /> : quote.data ? <span className="num font-bold text-lg text-[var(--primary)]">{money(quote.data.lineTotal)}</span> : <span className="text-[var(--error)] text-xs">{quote.error ? errorText(quote.error) : '—'}</span>}
        </div>
        <Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button>
        <Button variant="primary" size="lg" disabled={!canAdd} loading={adding} onClick={async () => { setAdding(true); await onAdd(draft); setAdding(false); }} data-fb="dialog-add">{t('ضيف للشيك')}</Button>
      </>}>
      <div className="space-y-4" data-screen="C2">
        {product.allergens?.length ? <Banner tone="warning"><span className="font-bold">{t('مسببات حساسية')}:</span> {product.allergens.map((a: string) => ALLERGEN_AR[a] ?? a).join('، ')} <StateBadge state="PROPOSED" className="ms-1" /></Banner> : null}
        {quote.error && quote.error.code !== 'MODIFIER_SELECTION_INVALID' && <Banner tone="error">{errorText(quote.error)} <span className="num text-xs">({quote.error.code})</span></Banner>}

        {product.variants?.length > 0 && (
          <Block title={t('الحجم')} badge={<StateBadge state="PROPOSED" />} hint={t('الحجم بيغير سعر الصنف وسعر الإضافات')}>
            <div className="flex gap-2 flex-wrap">{product.variants.map((v: any) => <Opt key={v.id} on={variant === v.id} onClick={() => setVariant(v.id)} label={L(v.name)} delta={v.priceDelta} sub={`×${v.modifierMultiplier} ${t('للإضافات')}`} />)}</div>
          </Block>
        )}
        {product.halfAndHalf && (
          <Block title={t('نص ونص')} badge={<StateBadge state="PROPOSED" />} hint={t('السعر حسب HalfAndHalfPricingPolicy (الأغلى أو المتوسط)')}>
            <div className="flex gap-2 flex-wrap"><Opt on={!half} onClick={() => setHalf(null)} label={t('بيتزا كاملة')} />{halves.map((h: any) => <Opt key={h.id} on={half === h.id} onClick={() => setHalf(h.id)} label={`${t('نص')} ${L(h.name)}`} />)}</div>
          </Block>
        )}
        {product.combo?.map((slot: any) => {
          const cur = combo[slot.id];
          const opt = slot.options.find((o: any) => o.productId === cur?.productId);
          const ng = opt?.nestedGroupId ? gs.find((g) => g.id === opt.nestedGroupId) : null;
          return (
            <Block key={slot.id} title={L(slot.name)} badge={<StateBadge state="PROPOSED" />} hint={t('بدّل الصنف — الفرق من السيرفر')}>
              <div className="flex gap-2 flex-wrap">{slot.options.map((o: any) => { const p = (allProducts.data?.items ?? []).find((x: any) => x.id === o.productId); return <Opt key={o.productId} on={cur?.productId === o.productId} onClick={() => setCombo((c) => ({ ...c, [slot.id]: { productId: o.productId, modifierOptionIds: o.nestedGroupId ? (gs.find((g) => g.id === o.nestedGroupId)?.options.slice(0, 1).map((x: any) => x.id) ?? []) : [] } }))} label={L(p?.name) || o.productId} delta={o.upcharge} />; })}</div>
              {ng && (
                <div className="mt-2 ps-3 border-s-2 line">
                  <div className="text-xs text-dim mb-1">{L(ng.name)} ({t('اختيار جوه الاختيار — مستوى واحد')})</div>
                  <div className="flex gap-2 flex-wrap">{ng.options.map((o: any) => <Opt key={o.id} on={cur.modifierOptionIds.includes(o.id)} onClick={() => setCombo((c) => ({ ...c, [slot.id]: { ...cur, modifierOptionIds: [o.id] } }))} label={L(o.name)} delta={o.priceDelta} />)}</div>
                </div>
              )}
            </Block>
          );
        })}
        {groups.map((g) => (
          <Block key={g.id} title={L(g.name)} hint={`${g.selectionRule === 'SINGLE' ? t('اختيار واحد') : t('اختيارات متعددة')} · ${t('أقل')} ${g.min} · ${t('أقصى')} ${g.max}`} warn={(sel[g.id]?.length ?? 0) < g.min}>
            <div className="flex gap-2 flex-wrap">{g.options.map((o: any) => <Opt key={o.id} disabled={!o.active} on={(sel[g.id] ?? []).includes(o.id)} onClick={() => toggle(g, o.id)} label={L(o.name)} sub={o.name.en !== L(o.name) ? o.name.en : undefined} delta={o.priceDelta} />)}</div>
          </Block>
        ))}
        <div className="grid sm:grid-cols-3 gap-3">
          <Block title={t('الكمية')} hint={t('ينفع كسور للأصناف الموزونة لو دقة الوحدة بتسمح')}>
            <div className="flex items-center gap-2">
              <button onClick={() => step(-1)} className="w-10 h-10 rounded-lg surface-2 flex items-center justify-center"><Minus className="w-4 h-4" /></button>
              <Input value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9.]/g, ''))} className="text-center !w-20" inputMode="decimal" />
              <button onClick={() => step(1)} className="w-10 h-10 rounded-lg surface-2 flex items-center justify-center"><Plus className="w-4 h-4" /></button>
            </div>
          </Block>
          {seatsEnabled && (
            <Block title={t('الكرسي')} badge={<StateBadge state="PROPOSED" />}>
              <div className="flex gap-1 flex-wrap"><Opt on={seat === null} onClick={() => setSeat(null)} label="—" />{Array.from({ length: Math.max(2, guestCount ?? 4) }, (_, i) => i + 1).map((s) => <Opt key={s} on={seat === s} onClick={() => setSeat(s)} label={String(s)} />)}</div>
            </Block>
          )}
          <Block title={t('ملاحظة للمطبخ')}><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('مثلًا: من غير بصل')} className="min-h-[44px]" /></Block>
        </div>
        {quote.data && (
          <div className="text-xs text-dim num" dir="ltr">quote: unit {quote.data.unitPrice} · mods {quote.data.modifiers.map((m: any) => m.priceDelta).join(' + ') || '0'} · unitTotal {quote.data.unitTotal} × {quote.data.quantity} = {quote.data.lineTotal} (server, rule {quote.data.priceRuleId}, VAT {quote.data.tax.rate}% {quote.data.tax.mode})</div>
        )}
      </div>
    </Modal>
  );
}

function Block({ title, hint, children, badge, warn }: { title: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode; badge?: React.ReactNode; warn?: boolean }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2"><span className={cn('text-sm font-bold', warn && 'text-[var(--warning)]')}>{title}</span>{badge}{warn && <AlertTriangle className="w-3.5 h-3.5 text-[var(--warning)]" />}</div>
      {hint && <div className="text-[11px] text-dim">{hint}</div>}
      {children}
    </div>
  );
}
function Opt({ on, onClick, label, delta, sub, disabled }: { on: boolean; onClick: () => void; label: string; delta?: string; sub?: string; disabled?: boolean }) {
  return (
    <button disabled={disabled} onClick={onClick} className={cn('px-3 py-2 rounded-xl border text-sm flex flex-col items-start min-w-[80px] transition-colors disabled:opacity-40', on ? 'border-[var(--primary)] bg-[var(--primary-container)]' : 'border-[var(--glass-border)] surface-1 hover:surface-2')}>
      <span className="font-bold">{label}</span>
      {sub && <span className="text-[10px] text-dim" dir="ltr">{sub}</span>}
      {delta !== undefined && <span className="text-[11px] num text-dim">{Number(delta) >= 0 ? '+' : ''}{money(delta, false)}</span>}
    </button>
  );
}
