// Round 3 (P1-031): every pack of an ingredient is its own card (750 مل / 1 لتر / 5 لتر …) with each supplier's price,
// the price per stock unit, how long the pack lasts at today's consumption, and the "أوفر عبوة / أوفر مورد" suggestion.
// All numbers come from the server (InventoryItem.PackAdvice); the browser only lays them out.
import React, { useState } from 'react';
import { Sparkles, Tag, Plus, Save, Package, Clock3 } from 'lucide-react';
import { useCommand, useQuery } from '../../app/hooks';
import { Banner, Button, Field, Input, Modal, Pill, Select, Spinner, StateBadge, Money } from '../../ui';
import { t, L, tv } from '../../i18n';
import { cn, money } from '../../lib/format';
import { fmtQty, unitLabel, useList } from './common';

const FIT: Record<string, { ar: string; tone: 'success' | 'warning' | 'neutral' }> = {
  OK: { ar: 'مناسبة لاستهلاكك', tone: 'success' },
  TOO_BIG_SHELF: { ar: 'كبيرة — هتبوظ قبل ما تخلص', tone: 'warning' },
  TOO_BIG_CASH: { ar: 'كبيرة — هتقعد أكتر من شهرين', tone: 'warning' },
  NO_USE: { ar: 'مفيش استهلاك الشهر ده', tone: 'neutral' },
};

export function PackCards({ itemId, compact, canEdit }: { itemId: string; compact?: boolean; canEdit?: boolean }) {
  const q = useQuery<any>('InventoryItem.PackAdvice', { params: { inventoryItemId: itemId } });
  const [price, setPrice] = useState<any | null>(null);
  const a = q.data;
  if (!a) return q.loading ? <Spinner /> : null;
  const u = unitLabel(a.unit);
  if (!a.cards.length) return <div className="text-sm text-dim">{t('الصنف ده مالوش عبوات شراء — بيتشرى بالـ{u}.', { u })}</div>;
  return (
    <div className="space-y-3" data-fb={`packs:${itemId}`}>
      {a.bestPackId && (
        <Banner tone="success" title={t('الأوفر ليك')}>
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1" data-fb="packs:advice">
            <Sparkles className="w-4 h-4" />
            <span>{t('أوفر عبوة')}: <b>{L(a.cards.find((c: any) => c.id === a.bestPackId)?.name)}</b> {t('من')} <b>{tv(a.bestPackSupplierName)}</b> — <Money v={a.bestUnitCost} /> {t('لكل {u}', { u })}</span>
            {a.bestSupplierName && <span className="text-soft">· {t('أوفر مورد')}: <b>{tv(a.bestSupplierName)}</b></span>}
            {Number(a.monthlySaving) > 0 && <span className="text-soft">· {t('توفير حوالي {m} في الشهر بالاستهلاك الحالي', { m: money(a.monthlySaving) })}</span>}
          </span>
          <div className="text-[11px] text-dim mt-1">{t('على أساس استهلاكك: {w} {u} في الأسبوع', { w: fmtQty(a.weeklyUse), u })}{a.shelfLifeDays ? ` · ${t('الصلاحية {d} يوم', { d: a.shelfLifeDays })}` : ''}{a.cheapestIgnored ? ` · ${t('«{n}» أرخص للوحدة بس مش مناسبة: {why}', { n: L(a.cheapestIgnored.name), why: t(FIT[a.cheapestIgnored.fit]?.ar ?? '') })}` : ''}</div>
        </Banner>
      )}
      <div className={cn('grid gap-2', compact ? 'grid-cols-1 sm:grid-cols-2 @5xl/main:grid-cols-1 @[1500px]/main:grid-cols-2' : 'grid-cols-1 @2xl/main:grid-cols-2 @5xl/main:grid-cols-4')}>
        {a.cards.map((c: any) => {
          const best = c.id === a.bestPackId;
          const fit = FIT[c.fit] ?? FIT.OK;
          return (
            <div key={c.id} data-fb={`pack:${c.id}`} className={cn('rounded-xl border p-3 space-y-2 surface-1', best ? 'border-[var(--success)] shadow-[0_0_0_1px_var(--success)]' : 'border-[var(--glass-border)]')}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-bold flex items-center gap-1.5"><Package className="w-4 h-4 text-dim shrink-0" /><span className="truncate">{L(c.name)}</span></div>
                  <div className="text-[11px] text-dim">= <span className="num">{fmtQty(c.factor)}</span> {u}{c.isPurchasePack ? ` · ${t('عبوة الشراء المعتادة')}` : ''} · {t('الأسعار بالجنيه')}</div>
                </div>
                {best && <Pill tone="success" size="sm"><Sparkles className="w-3 h-3" />{t('الأوفر')}</Pill>}
              </div>
              {c.offers.length === 0 ? <div className="text-xs text-dim">{t('مفيش سعر متسجل لسه')}</div> : (
                <div className="space-y-1">
                  {c.offers.map((o: any, i: number) => (
                    <div key={o.supplierId} className={cn('flex items-center justify-between gap-2 text-xs rounded-lg px-2 py-1', i === 0 ? 'bg-[color-mix(in_srgb,var(--success)_10%,transparent)]' : '')}>
                      <span className="truncate min-w-0" title={tv(o.supplierName)}>{tv(o.supplierName)}</span>
                      <span className="shrink-0 text-end whitespace-nowrap"><b className="num">{money(o.packPrice, false)}</b> <span className="text-dim"><span className="num">{money(o.unitCost, false)}</span>/{u}</span></span>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-between gap-2 pt-1">
                <Pill tone={fit.tone} size="sm"><Clock3 className="w-3 h-3" />{c.weeksToUse ? t('تخلص في ~{w} أسبوع', { w: c.weeksToUse }) : t(fit.ar)}</Pill>
                {canEdit && <Button size="sm" variant="ghost" data-fb={`pack-price:${c.id}`} onClick={() => setPrice(c)}><Tag className="w-3.5 h-3.5" />{t('سعر')}</Button>}
              </div>
              {c.fit !== 'OK' && c.fit !== 'NO_USE' && <div className="text-[11px] text-[var(--warning-text)]">{t(fit.ar)}</div>}
            </div>
          );
        })}
      </div>
      {price && <OfferDialog itemId={itemId} pack={price} onClose={() => setPrice(null)} />}
    </div>
  );
}

function OfferDialog({ itemId, pack, onClose }: { itemId: string; pack: any; onClose: () => void }) {
  const { run, busy } = useCommand();
  const sup = useList<any>('Supplier.List', { active: 'true' });
  const [supplierId, setSupplierId] = useState(pack.offers[0]?.supplierId ?? '');
  const [p, setP] = useState('');
  const save = async () => { const r = await run('InventoryItem.SetPackOffer', { params: { inventoryItemId: itemId, packId: pack.id }, body: { supplierId, packPrice: p } }, { success: t('السعر اتسجل على العبوة') }); if (r) onClose(); };
  return (
    <Modal open onClose={onClose} title={t('سعر مورد لعبوة {n}', { n: L(pack.name) })} badge={<StateBadge ops={['InventoryItem.SetPackOffer']} />}
      footer={<><Button onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" data-fb="pack-price:save" loading={busy} disabled={!supplierId || !(Number(p) > 0)} onClick={save}><Save className="w-4 h-4" />{t('احفظ')}</Button></>}>
      <div className="space-y-3">
        <Field label={t('المورد')}><Select data-fb="pack-price:supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} options={[{ value: '', label: t('اختار') }, ...sup.items.map((s) => ({ value: s.id, label: tv(s.name) }))]} /></Field>
        <Field label={t('سعر العبوة (جنيه)')}><Input data-fb="pack-price:value" inputMode="decimal" value={p} onChange={(e) => setP(e.target.value.replace(/[^\d.]/g, ''))} /></Field>
        <div className="text-[11px] text-dim">{t('الاستلامات وفواتير الموردين بتحدّث السعر ده لوحدها — ده لما يجيلك عرض سعر جديد.')}</div>
      </div>
    </Modal>
  );
}
export { Plus };
