// Sales channels (E13) on the client: the list, plain labels and a small picker used where orders start
// (counter / takeaway, new delivery order, online inbox). Display only — the server prices every line.
import React from 'react';
import { useQuery } from '../../app/hooks';
import { t, L } from '../../i18n';
import { cn } from '../../lib/format';

export interface SalesChannelView {
  id: string; name: { ar: string; en: string }; orderType: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY'; isDefault: boolean; active: boolean; sortOrder: number; color: string;
  priceMode: 'OWN' | 'FOLLOW'; follow: { channelId: string; percent: string; roundingStep: string } | null; note?: string | null; externalSources?: string[];
  ownPrices: number | null; orders: number; followers: { id: string; name: { ar: string; en: string } }[]; followsName: { ar: string; en: string } | null;
  version: number; history: { at: string; by: string; text: string }[]; updatedAt: string; updatedByName: string; createdByName: string;
}

export const orderTypeLabel = (c: string) => ({ DINE_IN: t('صالة'), TAKEAWAY: t('تيك أواي'), DELIVERY: t('دليفري') } as Record<string, string>)[c] ?? c;

/** Every active sales channel (or only those of one order type). */
export function useSalesChannels(orderType?: string, includeInactive = false) {
  const q = useQuery<{ items: SalesChannelView[] }>('SalesChannel.List', { query: { ...(orderType ? { orderType } : {}), ...(includeInactive ? { includeInactive: 'true' } : {}) } });
  return { ...q, items: q.data?.items ?? [] };
}

/** One plain sentence: where this channel's prices come from. */
export function priceModeText(c: Pick<SalesChannelView, 'isDefault' | 'priceMode' | 'follow' | 'followsName' | 'orderType' | 'ownPrices'>): string {
  if (c.isDefault) return t('أسعار {x} الأساسية', { x: orderTypeLabel(c.orderType) });
  if (c.priceMode === 'FOLLOW' && c.follow) {
    const pct = Number(c.follow.percent);
    return t('ماشية ورا أسعار {x} {s}{p}%', { x: c.followsName ? L(c.followsName) : '؟', s: pct >= 0 ? '+' : '−', p: String(Math.abs(pct)) });
  }
  return c.ownPrices ? t('أسعار خاصة ({n} صنف) — الباقي بسعر {x}', { n: String(c.ownPrices), x: orderTypeLabel(c.orderType) }) : t('أسعار خاصة — لحد ما تتحط، بتبيع بسعر {x}', { x: orderTypeLabel(c.orderType) });
}

export const ChannelDot = ({ color, className }: { color: string; className?: string }) => <span className={cn('inline-block w-2.5 h-2.5 rounded-full shrink-0', className)} style={{ background: color }} />;

/**
 * Picker shown only when an order type has more than one active channel (e.g. دليفري + طلبات).
 * value '' = the order type's default channel.
 */
export function SalesChannelPicker({ orderType, value, onChange, fb = 'sales-channel', compact, label }: { orderType: string; value: string; onChange: (id: string) => void; fb?: string; compact?: boolean; label?: React.ReactNode }) {
  const { items } = useSalesChannels(orderType);
  if (items.length <= 1) return null;
  const cur = value || items.find((c) => c.isDefault)?.id || items[0]?.id;
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', compact ? '' : 'rounded-xl surface-1 border line px-2.5 py-2')} data-fb={`${fb}:picker`}>
      <span className="text-xs font-bold text-soft">{label ?? t('القناة')}:</span>
      {items.map((c) => {
        const on = c.id === cur;
        return (
          <button key={c.id} type="button" data-fb={`${fb}:${c.id}`} aria-pressed={on} onClick={() => onChange(c.isDefault ? '' : c.id)}
            className={cn('inline-flex items-center gap-1.5 px-2.5 h-8 rounded-full text-xs border transition-colors', on ? 'border-transparent font-bold text-[var(--primary-foreground)] bg-[var(--primary)]' : 'surface-2 border-[var(--glass-border)] hover:surface-3')}>
            <ChannelDot color={c.color} />{L(c.name)}
          </button>
        );
      })}
    </div>
  );
}

/** Small label of an order's channel for headers (nothing for the default channel). */
export function SalesChannelTag({ id }: { id?: string | null }) {
  const { items } = useSalesChannels(undefined, true);
  const c = items.find((x) => x.id === id);
  if (!c || c.isDefault) return null;
  return <span className="self-start inline-flex items-center gap-1 px-2 h-6 rounded-full text-[11px] font-bold border line surface-1" data-fb="order:sales-channel"><ChannelDot color={c.color} />{L(c.name)}</span>;
}
