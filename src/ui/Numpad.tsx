// The one keypad of the product: quantity, payment amounts, approval PIN and (later) drawer counting.
// Calculator layout (7 8 9 on top) everywhere so the hand learns one pad. Digits are always LTR.
// The same keys work from a physical keyboard through useNumpadKeys (digits, ".", Backspace, Delete, Enter).
import React, { useEffect, useRef } from 'react';
import { Delete } from 'lucide-react';
import { cn } from '../lib/format';
import { t } from '../i18n';

export type NumpadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '00' | '.' | 'back' | 'clear';
/** amount: decimals + "00"; integer: whole numbers (quantity); pin: digits only, masked by the caller. */
export type NumpadMode = 'amount' | 'integer' | 'pin';

/** Applies one key to a typed value (a string — never a float). */
export function applyNumpadKey(cur: string, k: NumpadKey, opts: { decimals?: number; maxDigits?: number } = {}): string {
  const decimals = opts.decimals ?? 2;
  const maxDigits = opts.maxDigits ?? 7;
  if (k === 'clear') return '';
  if (k === 'back') return cur.slice(0, -1);
  if (k === '00') return applyNumpadKey(applyNumpadKey(cur, '0', opts), '0', opts);
  if (k === '.') return decimals === 0 || cur.includes('.') ? cur : (cur || '0') + '.';
  const next = cur + k;
  const re = new RegExp(`^\\d{0,${maxDigits}}(\\.\\d{0,${decimals}})?$`);
  if (!re.test(next)) return cur;
  return next.replace(/^0+(?=\d)/, '');
}

/** True when `el` is inside the top-most open dialog (or no dialog is open and el is not inside one). */
export function inTopLayer(el: HTMLElement | null): boolean {
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'));
  if (!dialogs.length) return true;
  const top = dialogs[dialogs.length - 1];
  return !!el && top.contains(el);
}

const isTyping = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

/**
 * Physical keyboard for a numpad: digits, "." / ",", Backspace, Delete (clear) and Enter. Active only while
 * `scope` is in the top-most layer (a dialog above it takes the keys), and never while typing in a field.
 */
export function useNumpadKeys(enabled: boolean, onKey: (k: NumpadKey) => void, opts: { onEnter?: () => void; scope?: React.RefObject<HTMLElement>; decimals?: boolean } = {}) {
  const ref = useRef({ onKey, opts });
  ref.current = { onKey, opts };
  useEffect(() => {
    if (!enabled) return;
    const h = (e: KeyboardEvent) => {
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const { onKey: k, opts: o } = ref.current;
      if (o.scope && !inTopLayer(o.scope.current)) return;
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); k(e.key as NumpadKey); }
      else if ((e.key === '.' || e.key === ',' || e.key === 'Decimal') && o.decimals !== false) { e.preventDefault(); k('.'); }
      else if (e.key === 'Backspace') { e.preventDefault(); k('back'); }
      else if (e.key === 'Delete') { e.preventDefault(); k('clear'); }
      else if (e.key === 'Enter' && o.onEnter) { e.preventDefault(); o.onEnter(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [enabled]);
}

export function Numpad({ onKey, mode = 'amount', size = 'lg', className, fb, disabled }: { onKey: (k: NumpadKey) => void; mode?: NumpadMode; size?: 'md' | 'lg'; className?: string; fb?: string; disabled?: boolean }) {
  const h = size === 'lg' ? 'h-14 text-[22px]' : 'h-12 text-xl';
  const keys: { k: NumpadKey; span?: number }[] = mode === 'amount'
    ? [{ k: '7' }, { k: '8' }, { k: '9' }, { k: 'back' }, { k: '4' }, { k: '5' }, { k: '6' }, { k: 'clear' }, { k: '1' }, { k: '2' }, { k: '3' }, { k: '.' }, { k: '0', span: 2 }, { k: '00', span: 2 }]
    : [{ k: '7' }, { k: '8' }, { k: '9' }, { k: '4' }, { k: '5' }, { k: '6' }, { k: '1' }, { k: '2' }, { k: '3' }, { k: 'clear' }, { k: '0' }, { k: 'back' }];
  return (
    <div dir="ltr" className={cn('grid gap-1.5 select-none', mode === 'amount' ? 'grid-cols-4' : 'grid-cols-3', className)} data-fb={fb} role="group" aria-label={t('لوحة الأرقام')}>
      {keys.map(({ k, span }) => {
        const fn = k === 'back' || k === 'clear';
        return (
          <button key={k} type="button" disabled={disabled} onClick={() => onKey(k)} data-key={k}
            aria-label={k === 'back' ? t('حذف رقم') : k === 'clear' ? t('مسح الكل') : k}
            className={cn('rounded-xl border font-semibold num flex items-center justify-center transition-[transform,background] duration-100 active:scale-[.96] disabled:opacity-40', h,
              span === 2 && 'col-span-2',
              fn ? 'surface-2 border-[var(--glass-border)] text-soft !text-sm hover:bg-[var(--surface-3)]' : 'bg-[var(--card-raised)] border-[var(--glass-border)] hover:bg-[var(--surface-2)]')}>
            {k === 'back' ? <Delete className="w-5 h-5" /> : k === 'clear' ? t('مسح') : k}
          </button>
        );
      })}
    </div>
  );
}
