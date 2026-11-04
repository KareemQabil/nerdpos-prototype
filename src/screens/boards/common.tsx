// Shared bits of the four boards (ux-05): aging thresholds, the move resolver used by drops that need a short popup,
// and small card atoms. Boards are a presentation over the existing server reads and commands — no new truth.
import React, { useCallback, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import { useDev } from '../../app/hooks';
import { policy } from '../../mock/policies';
import { cn } from '../../lib/format';
import { t } from '../../i18n';
import type { Aging } from '../../ui/board';

export interface BoardRules { orderWarnMinutes: number; orderLateMinutes: number; approvalWarnMinutes: number; approvalLateMinutes: number; reviewLateHours: number; purchaseWarnDays: number; purchaseGraceDays: number }
const DEFAULT_RULES: BoardRules = { orderWarnMinutes: 10, orderLateMinutes: 20, approvalWarnMinutes: 2, approvalLateMinutes: 5, reviewLateHours: 24, purchaseWarnDays: 1, purchaseGraceDays: 0 };

/** Board thresholds of the branch (BoardAgingPolicy); the strictest operable defaults when nothing is set. */
export function useBoardRules(): BoardRules {
  const { auth, terminal } = useDev();
  const branchId = auth.branchId ?? terminal?.branchId ?? null;
  const v = policy<Partial<BoardRules> | null>('BoardAgingPolicy', { branchId }) ?? {};
  const num = (k: keyof BoardRules) => (Number.isFinite(Number(v[k])) && v[k] !== null && v[k] !== undefined ? Number(v[k]) : DEFAULT_RULES[k]);
  return { orderWarnMinutes: num('orderWarnMinutes'), orderLateMinutes: num('orderLateMinutes'), approvalWarnMinutes: num('approvalWarnMinutes'), approvalLateMinutes: num('approvalLateMinutes'), reviewLateHours: num('reviewLateHours'), purchaseWarnDays: num('purchaseWarnDays'), purchaseGraceDays: num('purchaseGraceDays') };
}

/**
 * A drop that needs a short form (rider, reason, receipt…) opens a popup and waits: the board keeps the card in the
 * target column while the popup is open; confirming runs the command, closing it reverts the card.
 */
export function usePendingMove<P>() {
  const [open, setOpen] = useState<P | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const ask = useCallback((p: P) => new Promise<boolean>((resolve) => { resolver.current?.(false); resolver.current = resolve; setOpen(p); }), []);
  const done = useCallback((ok: boolean) => { resolver.current?.(ok); resolver.current = null; setOpen(null); }, []);
  return { open, ask, done };
}

/** Age / timer chip of a card. */
export function AgeChip({ a, className }: { a: Aging; className?: string }) {
  if (!a.timer) return null;
  return (
    <span className={cn('inline-flex items-center gap-1 text-[11px] font-bold num whitespace-nowrap', a.late ? 'text-[var(--error)]' : a.heat >= 2 ? 'text-[var(--warning-text)]' : 'text-dim', className)} title={a.title} data-fb="board-age">
      <Clock className="w-3 h-3" /><span dir="auto">{a.timer}</span>{a.late && <span>· {t('متأخر')}</span>}
    </span>
  );
}

export const mins = (n: number) => t('{n} د', { n });
