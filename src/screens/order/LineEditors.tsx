// Quick editors of one cart line, as popovers next to the line (never a side panel):
// - QtyPopover: tap the quantity → type the exact quantity on the shared Numpad (or the keyboard). Decimals only for
//   weighed items (unit precision > 0). Enter applies, Esc cancels. The caller decides what a lower quantity means
//   (unsent: a free decrease; 0 or a sent line: a void with its approval).
// - LineEditorPopover: tap the line → note, options, seat (dine-in) and remove — for an unsent line; a sent line
//   offers a kitchen note, the seat and the void (approval), never a silent change.
//   ux-04: the size of an UNSENT line can change here (Order.UpdateLine variantId, re-priced by the server, written to the
//   check history); the new price is the server's quote. A sent line shows its size read-only (void + add instead).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Trash2, Ban, Armchair, StickyNote, Lock, Check, Ruler, ChefHat, Send } from 'lucide-react';
import { useQuery, useCommand, useDev } from '../../app/hooks';
import { call } from '../../api/client';
import { Popover, Numpad, applyNumpadKey, useNumpadKeys, Button, Input, Kbd, Money } from '../../ui';
import { t, L } from '../../i18n';
import { cn, qty as fmtQty } from '../../lib/format';
import { cmpQty, validQty } from '../../lib/cash';

/** Decimal places a product's quantity may have (0 = counted items; weighed items have their unit's precision). */
export function useQtyDecimals(productId: string | null | undefined): number {
  const products = useQuery<any>(productId ? 'Catalog.Search' : null, { query: { active: true, limit: 500 } });
  const units = useQuery<any>(productId ? 'Unit.List' : null, { query: {} });
  const p = (products.data?.items ?? []).find((x: any) => x.id === productId);
  const u = (units.data?.items ?? []).find((x: any) => x.id === p?.unitId);
  return Math.min(3, Number(u?.precision ?? 0) || 0);
}

export function QtyPopover({ anchor, line, onClose, onApply, sent, lockLower, lockZero }: { anchor: HTMLElement | null; line: any; onClose: () => void; onApply: (q: string) => void; sent?: boolean; lockLower?: boolean; lockZero?: boolean }) {
  const decimals = useQtyDecimals(line?.productId);
  const [v, setV] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const cur = fmtQty(line.quantity);
  const next = v === '' ? cur : v;
  const ok = v !== '' && validQty(v, decimals) && cmpQty(v, line.quantity) !== 0 && !(sent && cmpQty(v, line.quantity) > 0);
  const lower = v !== '' && validQty(v, decimals) && cmpQty(v, line.quantity) < 0;
  const zero = v !== '' && validQty(v, decimals) && cmpQty(v, '0') === 0;
  const apply = () => { if (ok) onApply(v.replace(/\.$/, '')); };
  const key = (k: any) => setV((c) => applyNumpadKey(c, k, { decimals, maxDigits: 4 }));
  useNumpadKeys(true, key, { onEnter: apply, scope: ref, decimals: decimals > 0 });
  const needs = (zero && lockZero) || (lower && !zero && lockLower);
  return (
    <Popover anchor={anchor} open onClose={onClose} side="auto" align="start" width={280} fb="qty-edit" label={t('تعديل الكمية')}>
      <div className="p-1.5 space-y-2" ref={ref}>
        <div className="text-sm font-bold truncate px-1">{L(line.name)}</div>
        <div className="h-14 rounded-xl surface-1 border line px-3 flex items-center justify-between gap-2" data-fb="qty-edit-value">
          <span className="num text-dim text-lg">{cur}</span>
          <span className="text-dim">←</span>
          <span className={cn('num text-3xl font-bold', v === '' && 'text-dim', zero && 'text-[var(--error)]')}>{next}</span>
        </div>
        {zero && <div className="text-xs text-[var(--error)] flex items-center gap-1 px-1" data-fb="qty-edit-void">{sent ? <Ban className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}{sent ? t('إلغاء الصنف') : t('حذف الصنف')}</div>}
        {sent && lower && !zero && <div className="text-xs text-[var(--warning-text)] flex items-center gap-1 px-1"><Ban className="w-3.5 h-3.5" />{t('إلغاء جزء من الصنف')}</div>}
        <Numpad mode={decimals > 0 ? 'amount' : 'integer'} size="md" onKey={key} fb="qty-edit-numpad" />
        <Button variant={zero || (sent && lower) ? 'danger' : 'primary'} size="lg" className="w-full" disabled={!ok} onClick={apply} data-fb="qty-edit-apply">
          {needs && <Lock className="w-4 h-4" />}{zero ? (sent ? t('إلغاء الصنف') : t('حذف الصنف')) : t('تطبيق')}<Kbd className="!bg-black/10 !border-black/10 !text-current">Enter</Kbd>
        </Button>
      </div>
    </Popover>
  );
}

const QUICK_NOTES = ['بلا بصل', 'حار', 'مستوٍ جيدًا', 'بلا ثلج', 'على الجانب'];

/** Popover editor for one line. Unsent: note + options in one save, seat at once, remove (removal rule). Sent: kitchen note, seat, void. */
export function LineEditorPopover({ anchor, order, line, onClose, seats, onRemove, onVoid, lockRemove, onSaved }: { anchor: HTMLElement | null; order: any; line: any; onClose: () => void; seats?: boolean; onRemove?: () => void; onVoid?: () => void; lockRemove?: boolean; onSaved?: (r: any) => void }) {
  const { run, busy } = useCommand();
  const sent = line.fireRound !== null;
  const editable = order.status === 'DRAFT' && !sent && line.status === 'ACTIVE';
  const products = useQuery<any>('Catalog.Search', { query: { active: true, limit: 500 } });
  const groupsQ = useQuery<any>(editable ? 'ModifierGroup.List' : null, { query: {} });
  const product = (products.data?.items ?? []).find((p: any) => p.id === line.productId);
  const groups: any[] = useMemo(() => (product?.modifierGroupIds ?? []).map((id: string) => (groupsQ.data?.items ?? []).find((g: any) => g.id === id)).filter((g: any) => g && g.active && g.kind !== 'INGREDIENTS'), [product, groupsQ.data]);
  const startMods: string[] = (line.modifiers ?? []).map((m: any) => m.optionId);
  const { auth } = useDev();
  const sizes: any[] = useMemo(() => (product?.variants ?? []).filter((v: any) => v.active).sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)), [product]);
  const canSize = editable && sizes.length > 1 && !(line.children ?? []).length;
  const [variantId, setVariantId] = useState<string | null>(line.variant?.id ?? null);
  const sizeChanged = canSize && !!variantId && variantId !== (line.variant?.id ?? null);
  // the new price of the line in the chosen size: a server quote (never computed here)
  const [quote, setQuote] = useState<string | null>(null);
  useEffect(() => {
    if (!sizeChanged) { setQuote(null); return; }
    let alive = true;
    call<any>(auth, 'Pricing.QuoteItem', { params: { productId: line.productId }, body: { branchId: order.branchId, channel: order.channel, quantity: line.quantity, modifierOptionIds: startMods, variantId, ...(order.salesChannelId ? { salesChannelId: order.salesChannelId } : {}) } })
      .then((r) => alive && setQuote(r.data?.lineTotal ?? null)).catch(() => alive && setQuote(null));
    return () => { alive = false; };
  }, [variantId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [mods, setMods] = useState<string[]>(startMods);
  const [note, setNote] = useState<string>(sent ? '' : line.note ?? '');
  const ref = useRef<HTMLDivElement>(null);
  const modsChanged = mods.slice().sort().join() !== startMods.slice().sort().join();
  const noteChanged = !sent && (note.trim() || '') !== (line.note ?? '');
  const groupOk = groups.every((g) => { const n = mods.filter((m) => g.options.some((o: any) => o.id === m)).length; return n >= g.min && n <= g.max; });
  const canSave = sent ? !!note.trim() : (modsChanged || noteChanged || sizeChanged) && groupOk;
  const toggle = (g: any, id: string) => setMods((cur) => {
    const inG = cur.filter((m) => g.options.some((o: any) => o.id === m));
    if (g.selectionRule === 'SINGLE' || g.max === 1) return [...cur.filter((m) => !inG.includes(m)), ...(inG.includes(id) && g.min === 0 ? [] : [id])];
    if (cur.includes(id)) return cur.filter((m) => m !== id);
    if (inG.length >= g.max) return cur;
    return [...cur, id];
  });
  const save = async () => {
    if (!canSave || busy) return;
    const r = sent
      ? await run('Order.ModifyFiredLine', { params: { orderId: order.id, lineId: line.id }, body: { text: note.trim() } }, { success: t('تم إرسال الملاحظة للمطبخ') })
      : await run('Order.UpdateLine', { params: { orderId: order.id, lineId: line.id }, body: { expectedVersion: order.version, expectedLineVersion: line.version, quantity: line.quantity, ...(noteChanged ? { note: note.trim() } : {}), ...(modsChanged ? { modifiers: mods.map((optionId) => ({ optionId })) } : {}), ...(sizeChanged ? { variantId } : {}) } }, sizeChanged ? { success: t('تم تغيير المقاس') } : {});
    if (r) { onSaved?.(r); onClose(); }
  };
  const seat = async (s: number | null) => { const r = await run('Order.AssignSeat', { params: { orderId: order.id, lineId: line.id }, body: { seat: s } }); if (r) onSaved?.(r); };
  const n = Math.max(2, order.guestCount ?? 4);
  return (
    <Popover anchor={anchor} open onClose={onClose} side="auto" align="start" width={360} fb="line-editor" label={L(line.name)}>
      <div className="p-2 space-y-3" ref={ref} onKeyDown={(e) => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'TEXTAREA') { e.preventDefault(); save(); } }}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-bold leading-snug">{L(line.name)}</div>
            <div className="text-xs text-dim flex items-center gap-1.5 mt-0.5"><span className="num">× {fmtQty(line.quantity)}</span>{sent && <span className="inline-flex items-center gap-1"><ChefHat className="w-3 h-3" />{t('الدفعة')} <span className="num">{line.fireRound}</span></span>}</div>
          </div>
          <Money v={line.lineTotal} className="font-bold" />
        </div>
        {canSize ? (
          <div className="space-y-1.5" data-fb="line-editor:sizes">
            <div className="text-xs font-bold text-soft flex items-center gap-1"><Ruler className="w-3.5 h-3.5" />{t('المقاس')}</div>
            <div className="flex flex-wrap gap-1.5">{sizes.map((v: any) => {
              const on = variantId === v.id;
              return <button key={v.id} type="button" onClick={() => setVariantId(v.id)} data-fb={`line-editor:size:${v.id}`} aria-pressed={on} className={cn('min-h-[44px] px-3.5 rounded-xl border text-sm inline-flex items-center gap-1.5', on ? 'border-[var(--primary)] bg-[var(--primary-container)] font-bold' : 'border-[var(--glass-border)] surface-1 hover:bg-[var(--surface-2)]')}>{on && <Check className="w-3.5 h-3.5 text-[var(--primary)]" />}{L(v.name)}</button>;
            })}</div>
            {sizeChanged && <div className="text-xs flex items-center justify-between gap-2 rounded-lg surface-1 px-2.5 h-9" data-fb="line-editor:size-quote"><span className="text-soft">{t('السعر الجديد')}</span>{quote ? <Money v={quote} className="font-bold" /> : <span className="text-dim">…</span>}</div>}
          </div>
        ) : line.variant && <div className="text-xs flex items-center gap-1.5 text-soft" data-fb="line-editor:variant"><Ruler className="w-3.5 h-3.5 text-dim" />{t('المقاس')}: <b>{L(line.variant.name)}</b></div>}

        {editable && groups.map((g) => (
          <div key={g.id} className="space-y-1.5" data-fb={`line-editor:group:${g.id}`}>
            <div className="text-xs font-bold text-soft">{L(g.name)}</div>
            <div className="flex flex-wrap gap-1.5">{g.options.filter((o: any) => o.active).map((o: any) => {
              const on = mods.includes(o.id);
              return <button key={o.id} type="button" disabled={o.soldOut && !on} onClick={() => toggle(g, o.id)} data-fb={`line-editor:opt:${o.id}`} className={cn('min-h-[44px] px-3 rounded-xl border text-sm inline-flex items-center gap-1.5 disabled:opacity-40', on ? 'border-[var(--primary)] bg-[var(--primary-container)] font-bold' : 'border-[var(--glass-border)] surface-1 hover:bg-[var(--surface-2)]')}>{on && <Check className="w-3.5 h-3.5 text-[var(--primary)]" />}{L(o.name)}</button>;
            })}</div>
          </div>
        ))}

        {(editable || sent) && order.status === 'DRAFT' && (
          <div className="space-y-1.5">
            <div className="text-xs font-bold text-soft flex items-center gap-1"><StickyNote className="w-3.5 h-3.5" />{sent ? t('ملاحظة للمطبخ') : t('ملاحظة')}</div>
            <div className="flex flex-wrap gap-1">{QUICK_NOTES.map((q) => <button key={q} type="button" onClick={() => setNote((c) => (c ? `${c}، ${t(q)}` : t(q)))} className="h-9 px-2.5 rounded-lg border border-[var(--glass-border)] surface-1 text-xs hover:bg-[var(--surface-2)]">{t(q)}</button>)}</div>
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} data-fb="line-editor:note" className="!h-11" />
          </div>
        )}

        {seats && line.status === 'ACTIVE' && order.status === 'DRAFT' && (
          <div className="space-y-1.5">
            <div className="text-xs font-bold text-soft flex items-center gap-1"><Armchair className="w-3.5 h-3.5" />{t('المقعد')}</div>
            <div className="flex flex-wrap gap-1" data-fb="line-editor:seats">{[null, ...Array.from({ length: n }, (_, i) => i + 1)].map((s) => (
              <button key={String(s)} type="button" disabled={busy} onClick={() => seat(s)} data-fb={`line-editor:seat:${s ?? 0}`} className={cn('min-w-11 h-11 px-2 rounded-xl border text-sm font-bold', (line.seat ?? null) === s ? 'border-transparent bg-[var(--primary)] text-[var(--primary-foreground)]' : 'border-[var(--glass-border)] surface-1 hover:bg-[var(--surface-2)]')}>{s === null ? t('مشترك') : <span className="num">{s}</span>}</button>
            ))}</div>
          </div>
        )}

        <div className="flex items-center gap-2 pt-1 border-t line">
          {editable && onRemove && <Button variant="danger" size="lg" onClick={() => { onClose(); onRemove(); }} data-fb="line-editor:remove">{lockRemove && <Lock className="w-3.5 h-3.5" />}<Trash2 className="w-4 h-4" />{t('حذف الصنف')}</Button>}
          {sent && onVoid && order.status === 'DRAFT' && <Button variant="danger" size="lg" onClick={() => { onClose(); onVoid(); }} data-fb="line-editor:void"><Lock className="w-3.5 h-3.5" /><Ban className="w-4 h-4" />{t('إلغاء الصنف')}</Button>}
          <div className="flex-1" />
          {(editable || sent) && order.status === 'DRAFT' && <Button variant="primary" size="lg" disabled={!canSave} loading={busy} onClick={save} data-fb="line-editor:save">{sent ? <><Send className="w-4 h-4 rtl:-scale-x-100" />{t('إرسال')}</> : t('حفظ')}</Button>}
        </div>
      </div>
    </Popover>
  );
}
