// ux-10b: the blind count by denomination that the close and the shift handover share (the shared Numpad and the
// keyboard type the same keys). Counts are whole numbers per note / coin; totals are integer piasters → a Decimal string.
import React, { useEffect, useMemo, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { Money, Numpad, SegmentedControl, applyNumpadKey, useNumpadKeys, type NumpadKey } from '../../ui';
import { t } from '../../i18n';
import { cn } from '../../lib/format';
import { DENOMS, fromPiasters } from './ShiftReport';

/** Enter on a focused action button presses it; otherwise (a choice tile, a numpad key, nothing) runs `fallback`, the
 *  popup's main action — useNumpadKeys owns Enter inside these popups. */
export const enterOr = (scope: React.RefObject<HTMLElement>, fallback: () => void) => () => {
  const a = document.activeElement as HTMLElement | null;
  const action = !!a && a.tagName === 'BUTTON' && !!scope.current?.contains(a) && a.getAttribute('role') !== 'radio' && !a.hasAttribute('data-key');
  if (action) a!.click(); else fallback();
};

// ───────── blind count by denomination (shared by the close and the handover)

/** The blind count being typed: by denomination (whole numbers, integer piasters) or as one total. */
export function useBlindCount(editable: boolean, onEnter: () => void, panel: React.RefObject<HTMLElement>) {
  const [mode, setMode] = useState<'denoms' | 'total'>('denoms');
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [sel, setSel] = useState(0);
  const [typed, setTyped] = useState('');
  const totalP = useMemo(() => DENOMS.reduce((a, d) => a + d.p * Number(counts[d.p] || 0), 0), [counts]); // integer piasters
  const counted = mode === 'total' ? typed : totalP ? fromPiasters(totalP) : '';
  const setCount = (p: number, v: string) => setCounts((c) => ({ ...c, [p]: v.replace(/\D/g, '').slice(0, 4).replace(/^0+(?=\d)/, '') }));
  const key = (k: NumpadKey) => {
    if (mode === 'total') return setTyped((cur) => applyNumpadKey(cur, k));
    const d = DENOMS[sel];
    setCounts((c) => ({ ...c, [d.p]: applyNumpadKey(c[d.p] ?? '', k, { decimals: 0, maxDigits: 4 }) }));
  };
  const reset = () => { setCounts({}); setTyped(''); setSel(0); };
  useNumpadKeys(editable, key, { onEnter: enterOr(panel, () => (mode === 'denoms' ? setSel((i) => Math.min(DENOMS.length - 1, i + 1)) : onEnter())), scope: panel, decimals: mode === 'total' });
  useEffect(() => {
    if (!editable || mode !== 'denoms') return;
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => Math.min(DENOMS.length - 1, i + 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => Math.max(0, i - 1)); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [editable, mode]);
  return { mode, setMode, counts, sel, setSel, counted, setCount, key, reset };
}
export type BlindCount = ReturnType<typeof useBlindCount>;

/** Denominations on one side; the total, the Numpad (while editable) and `children` on the other. */
export function CountBoard({ bc, editable, shown, children }: { bc: BlindCount; editable: boolean; shown?: string; children?: React.ReactNode }) {
  const total = shown ?? bc.counted;
  return (
    <div className="grid lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-5">
      <div className={cn(!editable && 'opacity-50 pointer-events-none')}>
        <SegmentedControl value={bc.mode} onChange={bc.setMode} className="mb-2" options={[{ id: 'denoms', label: t('بالفئات'), fb: 'count-mode:denoms' }, { id: 'total', label: t('المبلغ الإجمالي'), fb: 'count-mode:total' }]} />
        <div className={cn('space-y-1', bc.mode === 'total' && 'opacity-40 pointer-events-none')} data-fb="denoms">
          {DENOMS.map((d, i) => {
            const n = bc.counts[d.p] ?? '';
            return (
              <div key={d.p} onClick={() => bc.setSel(i)} className={cn('flex items-center gap-2 rounded-xl border px-2 h-11 cursor-pointer', bc.sel === i && bc.mode === 'denoms' ? 'border-[var(--primary)] bg-[var(--primary-container)]' : n ? 'border-[color-mix(in_srgb,var(--primary)_30%,transparent)] surface-1' : 'surface-1 border-transparent')} data-fb={`denom:${d.label}`} data-selected={bc.sel === i || undefined}>
                <span className="w-14 flex justify-center shrink-0"><span className={cn('h-8 flex items-center justify-center font-extrabold num text-sm', d.coin ? 'min-w-8 px-1 rounded-full bg-[color-mix(in_srgb,var(--warning)_18%,transparent)] text-[var(--warning-text)]' : 'w-14 rounded-md bg-[color-mix(in_srgb,var(--success)_15%,transparent)] text-[var(--success)]')}>{d.label}</span></span>
                <span className="text-xs text-dim w-16 shrink-0">{d.coin ? t('عملة') : t('ورقة')}</span>
                <button type="button" onClick={() => bc.setCount(d.p, String(Math.max(0, Number(n || 0) - 1)))} disabled={!n} className="w-9 h-9 rounded-lg surface-2 flex items-center justify-center disabled:opacity-30" aria-label={t('أقل')} data-fb={`denom-minus:${d.label}`}><Minus className="w-4 h-4" /></button>
                <input value={n} onChange={(e) => bc.setCount(d.p, e.target.value)} onFocus={() => bc.setSel(i)} inputMode="numeric" placeholder="0" className="num w-14 h-9 text-center rounded-lg glass-input !p-0 font-bold" style={{ fontSize: 17 }} aria-label={t('عدد {d}', { d: d.label })} data-fb={`denom-input:${d.label}`} />
                <button type="button" onClick={() => bc.setCount(d.p, String(Number(n || 0) + 1))} className="w-9 h-9 rounded-lg surface-2 flex items-center justify-center" aria-label={t('أكتر')} data-fb={`denom-plus:${d.label}`}><Plus className="w-4 h-4" /></button>
                <span className="flex-1 text-end text-sm">{n && n !== '0' ? <Money v={fromPiasters(d.p * Number(n))} /> : ''}</span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="space-y-3 min-w-0">
        <div className="rounded-2xl p-3 text-center border border-[color-mix(in_srgb,var(--primary)_30%,transparent)] bg-[var(--primary-container)]" data-fb="count-total" data-value={total}>
          <div className="text-sm text-soft font-bold">{t('إجمالي اللي اتعد')}</div>
          <div style={{ fontSize: 34, lineHeight: 1.15 }}><Money v={total || '0'} className="font-extrabold text-[var(--primary)]" /></div>
        </div>
        {editable && <Numpad onKey={bc.key} mode={bc.mode === 'total' ? 'amount' : 'integer'} size="md" fb="count-numpad" />}
        {children}
      </div>
    </div>
  );
}

