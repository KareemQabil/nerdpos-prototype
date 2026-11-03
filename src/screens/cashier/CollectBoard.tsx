// Collecting dine-in checks on the sale screen: the open table checks as large cards (table, check, amount, state,
// time open). One tap puts the check in the cart; the action bar's primary then reads «الدفع» / «استكمال الدفع».
import React, { useState } from 'react';
import { Armchair, Users, Clock } from 'lucide-react';
import { Money, EmptyState, Skeleton, SearchInput, Pill, useNow } from '../../ui';
import { t } from '../../i18n';
import { cn } from '../../lib/format';
import { clock } from '../../mock/clock';

export function collectState(o: any): { label: string; tone: 'primary' | 'warning' | 'success' | 'info' } {
  if (o.settlement && o.settlement.paid !== '0.0000') return { label: t('مدفوع جزئيًا'), tone: 'success' };
  if (o.status === 'CONFIRMED') return { label: t('بانتظار الدفع'), tone: 'warning' };
  if (o.unfiredCount > 0) return { label: t('لم يُرسل بعد'), tone: 'info' };
  return { label: t('مفتوح'), tone: 'primary' };
}

const minutes = (iso?: string | null) => (iso ? Math.max(0, Math.floor((clock.now() - new Date(iso).getTime()) / 60000)) : null);

export function CollectBoard({ checks, loading, current, onPick, toolbarStart }: { checks: any[]; loading: boolean; current: string | null; onPick: (o: any) => void; toolbarStart?: React.ReactNode }) {
  useNow(30000);
  const [q, setQ] = useState('');
  const list = checks.filter((o) => !q || `${o.tableName ?? ''} ${o.number} ${o.checkNo ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="flex flex-col gap-3 min-h-0 h-full" data-fb="collect-board">
      <div className="flex items-center gap-2 shrink-0">
        {toolbarStart}
        <SearchInput value={q} onChange={setQ} placeholder={t('ابحث برقم الترابيزة أو الشيك')} className="!max-w-none [&_input]:!h-12" data-fb="collect-search" />
      </div>
      {loading && !checks.length ? (
        <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}</div>
      ) : list.length === 0 ? (
        <EmptyState icon={<Armchair />} title={q ? t('لا توجد نتائج') : t('لا توجد شيكات مفتوحة')} />
      ) : (
        <div className="grid gap-2.5 overflow-y-auto pe-1 pb-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gridAutoRows: 'max-content', alignContent: 'start' }}>
          {list.map((o) => {
            const s = collectState(o);
            const on = o.id === current;
            const m = minutes(o.createdAt ?? o.openedAt);
            return (
              <button key={o.id} onClick={() => onPick(o)} data-fb={`collect:${o.tableName ?? o.number}:${o.checkNo ?? 1}`} aria-pressed={on}
                className={cn('text-start rounded-2xl border p-3.5 flex flex-col gap-2 min-h-[128px] transition-[border-color,background,transform] active:scale-[.98]', on ? 'border-[var(--primary)] bg-[var(--primary-container)] shadow-[0_0_0_1px_var(--primary)]' : 'border-[var(--glass-border)] bg-[var(--card-raised)] hover:border-[color-mix(in_srgb,var(--primary)_45%,var(--glass-border))]')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xl font-bold font-display leading-tight truncate">{o.tableName ? `${t('ترابيزة')} ${o.tableName}` : `#${o.number}`}</div>
                    <div className="text-xs text-dim mt-0.5">{t('شيك')} <span className="num">{o.checkNo ?? 1}</span> · <span className="num">#{o.number}</span></div>
                  </div>
                  <Pill tone={s.tone} size="sm" dot>{s.label}</Pill>
                </div>
                <div className="mt-auto flex items-end justify-between gap-2">
                  <span className="text-xs text-dim flex items-center gap-2">
                    {o.guestCount ? <span className="inline-flex items-center gap-1"><Users className="w-3.5 h-3.5" /><span className="num">{o.guestCount}</span></span> : null}
                    {m !== null && <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" /><span className="num">{m}</span>{t('د')}</span>}
                  </span>
                  <Money v={o.settlement?.remaining ?? o.totals?.payable} className="text-xl" />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
