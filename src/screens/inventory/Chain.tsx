// Round 3 (E14 / A16): the four linked purchasing documents and their variances — store request → purchase order →
// goods receipt → supplier invoice. Shows 100 → 80 → 60 → 60 per item, with what is still on hand now.
import React from 'react';
import { ClipboardList, ShoppingBag, PackageCheck, FileText } from 'lucide-react';
import { useDev, useQuery } from '../../app/hooks';
import { Pill, Spinner, StateBadge, Table } from '../../ui';
import { t, L, tv } from '../../i18n';
import { cn, dateTime, money } from '../../lib/format';
import { Qty, fmtQty, PO_STATE } from './common';

export const SR_STATE: Record<string, { ar: string; tone: 'neutral' | 'warning' | 'success' | 'error' | 'info' }> = {
  DRAFT: { ar: 'مسودة', tone: 'neutral' }, SUBMITTED: { ar: 'مستنية المشتريات', tone: 'warning' }, ORDERED: { ar: 'اتعمل منها أمر شراء', tone: 'success' }, CANCELLED: { ar: 'ملغية', tone: 'error' },
};

/** Difference to the previous stage, e.g. "−20". */
function Delta({ a, b }: { a: string | null; b: string | null }) {
  if (a === null || b === null) return null;
  const d = Number(b) - Number(a);
  if (Math.abs(d) < 1e-9) return <span className="text-[10px] text-[var(--success)] ms-1.5" title={t('زي الخطوة اللي قبلها')}>✓</span>;
  return <bdi dir="ltr" title={t('الفرق عن الخطوة اللي قبلها')} className={cn('inline-block text-[10px] num ms-1.5 px-1.5 rounded-full font-bold', d < 0 ? 'text-[var(--warning-text)] bg-[color-mix(in_srgb,var(--warning)_14%,transparent)]' : 'text-[var(--error)] bg-[color-mix(in_srgb,var(--error)_14%,transparent)]')}>{d > 0 ? '+' : '−'}{fmtQty(Math.abs(d))}</bdi>;
}

export function ChainView({ query, title }: { query: Record<string, string>; title?: React.ReactNode }) {
  const { nav } = useDev();
  const q = useQuery<any>('Procurement.Chain', { query });
  const c = q.data;
  if (!c) return q.loading ? <Spinner /> : null;
  const stage = (icon: React.ReactNode, label: string, docs: { key: string; number: string; sub: React.ReactNode; tone?: any; onClick?: () => void }[], empty: string) => (
    <div className="min-w-0 rounded-xl surface-1 border border-[var(--glass-border)] p-2.5 space-y-1.5">
      <div className="text-xs font-bold text-soft flex items-center gap-1.5">{icon}{label}</div>
      {docs.length === 0 ? <div className="text-[11px] text-dim">{empty}</div> : docs.map((d) => (
        <button key={d.key} type="button" onClick={d.onClick} disabled={!d.onClick} className="w-full text-start rounded-lg px-2 py-1 hover:surface-2 disabled:hover:bg-transparent">
          <div className="text-sm font-bold"><span className="num">{d.number}</span></div><div className="text-[11px] text-dim truncate">{d.sub}</div>
        </button>
      ))}
    </div>
  );
  return (
    <div className="space-y-3" data-fb="chain">
      {title && <div className="text-sm font-bold flex items-center gap-2">{title}<StateBadge ops={['Procurement.Chain']} /></div>}
      {/* plain breakpoints: the chain is also shown inside drawers, which sit outside the main container */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2 items-stretch">
        {stage(<ClipboardList className="w-3.5 h-3.5" />, t('١. طلبية المخزن'), c.storeRequest ? [{ key: c.storeRequest.id, number: c.storeRequest.number, sub: <>{t(SR_STATE[c.storeRequest.state]?.ar)} · {c.storeRequest.byName ? tv(c.storeRequest.byName) : ''}</>, onClick: () => nav('inv-purchasing', { tab: 'requests', open: c.storeRequest.id }) }] : [], t('من غير طلبية'))}
        {stage(<ShoppingBag className="w-3.5 h-3.5" />, t('٢. أمر الشراء'), c.purchaseOrders.map((p: any) => ({ key: p.id, number: p.number, sub: <>{tv(p.supplierName)} · {t(PO_STATE[p.state]?.ar)}</>, onClick: () => nav('inv-po', { open: p.id }) })), t('من غير أمر شراء'))}
        {stage(<PackageCheck className="w-3.5 h-3.5" />, t('٣. الاستلام'), c.receipts.map((r: any) => ({ key: r.id, number: r.number, sub: <>{dateTime(r.at)} · <span className="num">{money(r.total)}</span>{r.state === 'REVERSED' ? ` · ${t('اتلغى')}` : ''}</>, onClick: () => nav('inv-receipts', { open: r.id }) })), t('لسه ما اتستلمش'))}
        {stage(<FileText className="w-3.5 h-3.5" />, t('٤. فاتورة المورد'), c.invoices.map((x: any) => ({ key: x.id, number: x.number, sub: <>{x.kind === 'DIRECT' ? t('فاتورة مباشرة') : t('من الاستلام')} · <span className="num">{money(x.total)}</span></>, onClick: () => nav('inv-purchasing', { tab: 'invoices', open: x.id }) })), t('لسه مفيش فاتورة'))}
      </div>
      <Table dense head={[t('الصنف'), t('المخزن طلب'), t('المشتريات طلبت'), t('اتستلم فعلًا'), t('اتفوتر'), t('الرصيد دلوقتي')]} align={['start', 'end', 'end', 'end', 'end', 'end']}
        rows={c.items.map((i: any) => [
          <span className="font-bold">{L(i.item?.name)}</span>,
          i.requested !== null ? <Qty v={i.requested} unit={i.item?.unit} hint={false} /> : <span className="text-dim">—</span>,
          i.ordered !== null ? <span data-fb={`chain-ordered:${i.item?.id}`}><Qty v={i.ordered} unit={i.item?.unit} hint={false} /><Delta a={i.requested} b={i.ordered} /></span> : <span className="text-dim">—</span>,
          <span data-fb={`chain-received:${i.item?.id}`}><Qty v={i.received} unit={i.item?.unit} hint={false} /><Delta a={i.ordered ?? i.requested} b={i.received} /></span>,
          <span data-fb={`chain-invoiced:${i.item?.id}`}><Qty v={i.invoiced} unit={i.item?.unit} hint={false} /><Delta a={i.received} b={i.invoiced} /></span>,
          i.onHandNow !== null ? <Qty v={i.onHandNow} unit={i.item?.unit} hint={false} /> : '—',
        ])} />
      <div className="text-[11px] text-dim">{t('الرصيد بيزيد بالكمية اللي اتستلمت بس — مش باللي اتطلب. والفاتورة بتتعمل على اللي اتستلم.')}</div>
      {c.items.some((i: any) => i.requested !== null && i.ordered !== null && Number(i.ordered) !== Number(i.requested)) && <Pill tone="warning" size="sm">{t('فيه فرق بين طلبية المخزن وأمر الشراء')}</Pill>}
    </div>
  );
}
