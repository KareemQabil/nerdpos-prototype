// Shared helpers for the catalog admin screens (B1 menu, B2 prices, B3 taxes, B5 import, B6 promotions).
// Display only: the browser never computes a price, a tax or a total.
import React, { useEffect, useState } from 'react';
import { useQuery } from '../../../app/hooks';
import { Input, Pill, StateBadge } from '../../../ui';
import { t } from '../../../i18n';
import { clock, zonedParts } from '../../../mock/clock';
import { cn } from '../../../lib/format';

export const CHANNELS = ['DINE_IN', 'TAKEAWAY', 'DELIVERY'] as const;
export type ChannelId = (typeof CHANNELS)[number];
export function channelLabel(c: string) {
  return ({ DINE_IN: t('صالة'), TAKEAWAY: t('تيك أواي'), DELIVERY: t('دليفري') } as Record<string, string>)[c] ?? c;
}

/** List query: the mock pages every list as {items, nextCursor, total}. */
export function useItems<T = any>(opId: string | null, opts: { params?: Record<string, any>; query?: Record<string, any> } = {}, enabled = true) {
  const q = useQuery<{ items: T[]; total: number }>(opId, opts, enabled);
  return { ...q, items: (q.data?.items ?? []) as T[] };
}

/** Effective value of one tenant policy (Settings.Effective). The screen never keeps a local copy. */
export function usePolicy<T = any>(policyId: string, scopeType: 'TENANT' | 'BRANCH' = 'TENANT', scopeId = 'biz'): T | undefined {
  const q = useQuery<{ value: T }>('Settings.Effective', { query: { policyId, scopeType, scopeId } });
  return q.data?.value;
}

export function ruleText(rule: any): string {
  if (!rule) return '—';
  switch (rule.mode) {
    case 'ALWAYS': return t('دايمًا');
    case 'NEVER': return t('أبدًا');
    case 'ABOVE_THRESHOLD': return t('لو {f} أكبر من {v}', { f: rule.field, v: rule.threshold });
    case 'WHEN_TRUE': return t('لو {f} صح', { f: rule.field });
    default: return String(rule.mode ?? '—');
  }
}

export function useDebounced<T>(v: T, ms = 300): T {
  const [d, setD] = useState(v);
  useEffect(() => { const h = setTimeout(() => setD(v), ms); return () => clearTimeout(h); }, [v, ms]);
  return d;
}

/** Cairo wall-clock "YYYY-MM-DDTHH:mm" (datetime-local) → ISO instant. Business time is Africa/Cairo, never the device zone. */
export function cairoLocalToIso(v: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v);
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let ms = guess;
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(ms, 'Africa/Cairo');
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    ms = ms - (asUtc - guess);
  }
  return new Date(ms).toISOString();
}
/** ms instant → Cairo "YYYY-MM-DDTHH:mm" for a datetime-local input. */
export function cairoLocal(ms: number): string {
  const p = zonedParts(ms, 'Africa/Cairo');
  const z = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${z(p.month)}-${z(p.day)}T${z(p.hour)}:${z(p.minute)}`;
}
/** Mock server clock (the demo can move it). */
export const serverNow = () => clock.now();

export function LocInputs({ value, onChange, fb, labelAr, labelEn }: { value: { ar: string; en: string }; onChange: (v: { ar: string; en: string }) => void; fb: string; labelAr?: string; labelEn?: string }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <label className="flex flex-col gap-1.5 min-w-0">
        <span className="text-xs font-bold text-soft">{labelAr ?? t('الاسم بالعربي')}</span>
        <Input data-fb={`${fb}:name-ar`} value={value.ar} onChange={(e) => onChange({ ...value, ar: e.target.value })} dir="rtl" />
      </label>
      <label className="flex flex-col gap-1.5 min-w-0">
        <span className="text-xs font-bold text-soft">{labelEn ?? t('الاسم بالإنجليزي')}</span>
        <Input data-fb={`${fb}:name-en`} value={value.en} onChange={(e) => onChange({ ...value, en: e.target.value })} dir="ltr" />
      </label>
    </div>
  );
}

export function Check({ checked, onChange, children, fb, disabled }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode; fb?: string; disabled?: boolean }) {
  return (
    <label data-fb={fb} className={cn('inline-flex items-center gap-2 px-2.5 h-8 rounded-lg border text-sm cursor-pointer select-none', checked ? 'border-[var(--primary)] bg-[var(--primary-container)] text-[var(--primary)]' : 'border-[var(--glass-border)] surface-1 text-soft', disabled && 'opacity-40 pointer-events-none')}>
      <input type="checkbox" className="accent-[var(--primary)]" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      {children}
    </label>
  );
}

export function Radio<T extends string>({ value, onChange, options, fb }: { value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode }[]; fb: string }) {
  return (
    <div className="flex flex-wrap gap-1.5" data-fb={fb}>
      {options.map((o) => (
        <button type="button" key={o.value} data-fb={`${fb}:${o.value}`} onClick={() => onChange(o.value)} className={cn('px-3 h-9 rounded-lg text-sm border transition-colors', value === o.value ? 'border-[var(--primary)] bg-[var(--primary-container)] text-[var(--primary)] font-bold' : 'border-[var(--glass-border)] surface-1 text-soft hover:surface-2')}>{o.label}</button>
      ))}
    </div>
  );
}

/** A small "policy says…" chip so experts see which setting drives the screen. */
export function PolicyChip({ id, value, proposed }: { id: string; value: React.ReactNode; proposed?: boolean }) {
  return (
    <Pill tone="neutral" title={id} className="gap-1.5">
      <span className="num text-dim font-normal" style={{ direction: 'ltr' }}>{id}</span>
      <span>{value}</span>
      {proposed && <StateBadge state="PROPOSED" />}
    </Pill>
  );
}

export function Swatch({ color, className }: { color?: string | null; className?: string }) {
  return <span className={cn('inline-block w-4 h-4 rounded-md border border-white/20 shrink-0', className)} style={{ background: color || 'transparent' }} />;
}

export function availabilityTone(state: string): 'success' | 'warning' | 'error' | 'neutral' {
  return state === 'AVAILABLE' ? 'success' : state === 'SOLD_OUT' ? 'warning' : state === 'BLOCKED' ? 'error' : 'neutral';
}
export function availabilityLabel(state: string) {
  return ({ AVAILABLE: t('متاح'), SOLD_OUT: t('خلص'), BLOCKED: t('متوقف'), NOT_ON_BRANCH_MENU: t('مش على منيو الفرع') } as Record<string, string>)[state] ?? state;
}

export const ALLERGENS = ['GLUTEN', 'DAIRY', 'NUTS', 'EGGS', 'SEAFOOD', 'SOY', 'SESAME'] as const;
export function allergenLabel(a: string) {
  return ({ GLUTEN: t('جلوتين'), DAIRY: t('ألبان'), NUTS: t('مكسرات'), EGGS: t('بيض'), SEAFOOD: t('مأكولات بحرية'), SOY: t('صويا'), SESAME: t('سمسم') } as Record<string, string>)[a] ?? a;
}
