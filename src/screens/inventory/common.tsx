// Shared pieces of the inventory & purchasing screens: plain wording for kinds/reasons/states, quantity display,
// warehouse/item pickers, the movement table and the movement details popup. Display only: the browser never
// computes stock or cost — every number comes from the mock server.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Search, X, Link2 } from 'lucide-react';
import { useDev, useQuery } from '../../app/hooks';
import { Tech } from '../../app/tech';
import { Input, KV, Modal, Money, Pill, Select, Spinner, StateBadge, Table } from '../../ui';
import { t, L } from '../../i18n';
import { cn, dateTime, money } from '../../lib/format';

// ───────── words
export const UNIT_AR: Record<string, string> = { KG: 'كجم', G: 'جم', L: 'لتر', ML: 'مل', PCS: 'قطعة', DEMO_EA: 'قطعة', EA: 'قطعة' };
export const unitLabel = (code?: string | null) => (code ? t(UNIT_AR[code] ?? code) : '');
/** Catalog unit id → short label (unit_kg → كجم). */
export const unitIdLabel = (id?: string | null) => (id ? t(UNIT_AR[(id.replace(/^unit_/, '') || '').toUpperCase()] ?? id.replace(/^unit_/, '')) : '');

export const KIND_TEXT: Record<string, { ar: string; tone: 'success' | 'error' | 'warning' | 'info' | 'neutral' | 'primary' | 'violet' }> = {
  OPENING: { ar: 'رصيد أول المدة', tone: 'neutral' },
  RECEIPT: { ar: 'استلام من مورد', tone: 'success' },
  RECEIPT_REVERSAL: { ar: 'إلغاء استلام', tone: 'error' },
  SALE: { ar: 'استهلاك مبيعات', tone: 'primary' },
  SALE_REVERSAL: { ar: 'رجوع استهلاك (إلغاء)', tone: 'info' },
  VOID_WASTE: { ar: 'هالك (اتلغى بعد ما اتعمل)', tone: 'warning' },
  WASTE: { ar: 'هالك', tone: 'warning' },
  ADJUSTMENT: { ar: 'تسوية', tone: 'violet' },
  COUNT_VARIANCE: { ar: 'فرق جرد', tone: 'violet' },
  TRANSFER_OUT: { ar: 'تحويل خارج', tone: 'info' },
  TRANSFER_IN: { ar: 'تحويل داخل', tone: 'info' },
  PRODUCTION_IN: { ar: 'تحضير — الناتج', tone: 'success' },
  PRODUCTION_OUT: { ar: 'تحضير — الخامات', tone: 'neutral' },
  SUPPLIER_RETURN: { ar: 'مرتجع للمورد', tone: 'error' },
  CUSTOMER_RETURN: { ar: 'مرتجع من زبون', tone: 'success' },
};
export const kindText = (k: string) => t(KIND_TEXT[k]?.ar ?? k);
export function KindPill({ kind }: { kind: string }) {
  return <Pill tone={KIND_TEXT[kind]?.tone ?? 'neutral'}>{kindText(kind)}</Pill>;
}

export const WASTE_REASONS = ['BURNT', 'EXPIRED', 'DROPPED', 'SPOILED', 'PREP_ERROR', 'OVER_PRODUCTION', 'OTHER'] as const;
export const WASTE_REASON_TEXT: Record<string, string> = { BURNT: 'اتحرق', EXPIRED: 'انتهت صلاحيته', DROPPED: 'وقع / اتكسر', SPOILED: 'باظ / بايظ', PREP_ERROR: 'غلطة في التحضير', OVER_PRODUCTION: 'اتعمل زيادة عن الحاجة', OTHER: 'سبب تاني' };
export const ADJUST_REASONS = ['FOUND', 'LOST', 'DAMAGED', 'CORRECTION', 'OPENING', 'STAFF_USE', 'TASTING', 'OTHER'] as const;
export const ADJUST_REASON_TEXT: Record<string, string> = { FOUND: 'لقينا زيادة', LOST: 'ناقص / مش لاقيينه', DAMAGED: 'تالف', CORRECTION: 'تصحيح إدخال غلط', OPENING: 'رصيد افتتاحي', STAFF_USE: 'استهلاك العاملين', TASTING: 'تذوق / عينات', OTHER: 'سبب تاني' };
const OTHER_REASONS: Record<string, string> = { COUNT: 'جرد', SUPPLIER_RETURN: 'مرتجع للمورد', RECEIPT_REVERSAL: 'إلغاء استلام', SHORT_RECEIVED: 'وصل ناقص', VOID_AFTER_KITCHEN_START: 'اتلغى بعد ما المطبخ بدأ', VOID_BEFORE_KITCHEN_START: 'اتلغى قبل ما المطبخ يبدأ', OVER_RECEIPT: 'استلام زيادة' };
export const reasonText = (r?: string | null) => (r ? t(WASTE_REASON_TEXT[r] ?? ADJUST_REASON_TEXT[r] ?? OTHER_REASONS[r] ?? r) : '');

export const LEVEL_TEXT: Record<string, { ar: string; tone: 'success' | 'warning' | 'error' | 'neutral' }> = {
  OK: { ar: 'كويس', tone: 'success' }, LOW: { ar: 'قرب يخلص', tone: 'warning' }, OUT: { ar: 'خلص', tone: 'error' }, NEGATIVE: { ar: 'بالسالب', tone: 'error' }, NO_LEVEL: { ar: 'من غير حد أدنى', tone: 'neutral' },
};
export function LevelPill({ state }: { state: string }) {
  const s = LEVEL_TEXT[state] ?? LEVEL_TEXT.NO_LEVEL;
  return <Pill tone={s.tone}>{t(s.ar)}</Pill>;
}
export const PO_STATE: Record<string, { ar: string; tone: 'neutral' | 'info' | 'warning' | 'success' | 'error' | 'primary' }> = {
  DRAFT: { ar: 'مسودة', tone: 'neutral' }, ISSUED: { ar: 'اتبعت للمورد', tone: 'info' }, PARTIALLY_RECEIVED: { ar: 'اتستلم جزء', tone: 'warning' }, RECEIVED: { ar: 'اتستلم كله', tone: 'success' }, CLOSED: { ar: 'مقفول', tone: 'primary' }, CANCELLED: { ar: 'ملغي', tone: 'error' },
};
export const TRANSFER_STATE: Record<string, { ar: string; tone: 'neutral' | 'info' | 'success' | 'error' }> = {
  DRAFT: { ar: 'مسودة', tone: 'neutral' }, DISPATCHED: { ar: 'في الطريق', tone: 'info' }, RECEIVED: { ar: 'اتستلم', tone: 'success' }, CANCELLED: { ar: 'ملغي', tone: 'error' },
};
export const COUNT_STATE: Record<string, { ar: string; tone: 'neutral' | 'info' | 'warning' | 'success' | 'error' }> = {
  DRAFT: { ar: 'العد شغال', tone: 'info' }, SUBMITTED: { ar: 'مستني الاعتماد', tone: 'warning' }, POSTED: { ar: 'اتعتمد', tone: 'success' }, CANCELLED: { ar: 'ملغي', tone: 'error' },
};
export function StatePill({ map, state }: { map: Record<string, { ar: string; tone: any }>; state: string }) {
  const s = map[state];
  return <Pill tone={s?.tone ?? 'neutral'}>{s ? t(s.ar) : state}<Tech><span className="num opacity-60 ms-1">{state}</span></Tech></Pill>;
}
export const WH_KIND: Record<string, string> = { STORE: 'مخزن', KITCHEN: 'مطبخ', BAR: 'بار' };

// ───────── numbers
export function fmtQty(v: string | number | null | undefined, maxDec = 3): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString('en-US', { maximumFractionDigits: maxDec });
}
/** "12.5 كجم" (negative in red when signed). Small amounts of kg/L also show grams/ml. */
export function Qty({ v, unit, signed, className, hint = true }: { v: string | number | null | undefined; unit?: string | null; signed?: boolean; className?: string; hint?: boolean }) {
  const n = Number(v ?? 0);
  const small = hint && (unit === 'KG' || unit === 'L') && Math.abs(n) > 0 && Math.abs(n) < 1;
  return (
    <span className={cn('num whitespace-nowrap', signed && n < 0 ? 'text-[var(--error)]' : signed && n > 0 ? 'text-[var(--success)]' : '', className)}>
      {signed && n > 0 ? '+' : ''}{fmtQty(v)} <span className="text-dim text-[11px]">{unitLabel(unit)}</span>
      {small && <span className="text-dim text-[10px] ms-1">({fmtQty(n * 1000, 0)} {unit === 'KG' ? t('جم') : t('مل')})</span>}
    </span>
  );
}
export function Pct({ v, band }: { v: string | null | undefined; band?: string }) {
  if (v === null || v === undefined) return <span className="text-dim">—</span>;
  const tone = band === 'HIGH' ? 'text-[var(--error)]' : band === 'WATCH' ? 'text-[var(--warning)]' : band === 'GOOD' ? 'text-[var(--success)]' : '';
  return <span className={cn('num font-bold', tone)}>{v}%</span>;
}
export const BAND_TEXT: Record<string, { ar: string; tone: 'success' | 'warning' | 'error' | 'neutral' }> = {
  GOOD: { ar: 'كويسة', tone: 'success' }, WATCH: { ar: 'خلي بالك', tone: 'warning' }, HIGH: { ar: 'عالية', tone: 'error' }, UNKNOWN: { ar: 'مفيش سعر', tone: 'neutral' },
};
export function BandPill({ band }: { band: string }) {
  const b = BAND_TEXT[band] ?? BAND_TEXT.UNKNOWN;
  return <Pill tone={b.tone}>{t(b.ar)}</Pill>;
}
export const today = () => new Date().toISOString().slice(0, 10);
export const newKey = (prefix: string) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ───────── data hooks
export function useList<T = any>(opId: string | null, query: Record<string, any> = {}, enabled = true) {
  const q = useQuery<any>(opId, { query }, enabled);
  return { ...q, items: (q.data?.items ?? []) as T[], raw: q.data };
}
export function useWarehouses(allBranches = true) {
  const q = useList<any>('Warehouse.List', allBranches ? { branchId: 'ALL' } : {});
  return q;
}
export function useItemsCatalog() {
  return useList<any>('InventoryItem.Find', { branchId: 'ALL', active: 'true' });
}

/** Branch scope switch shown on lists: this device's branch or every branch. */
export function useBranchScope() {
  const { auth } = useDev();
  const [all, setAll] = useState(false);
  return { all, setAll, branchId: all ? 'ALL' : auth.branchId ?? undefined, myBranch: auth.branchId };
}
export function BranchScope({ scope }: { scope: ReturnType<typeof useBranchScope> }) {
  return (
    <div className="flex gap-1 p-1 rounded-xl surface-1">
      <button data-fb="inv:scope-branch" onClick={() => scope.setAll(false)} className={cn('px-3 h-8 rounded-lg text-xs', !scope.all ? 'bg-[var(--primary)] text-[var(--primary-foreground)] font-bold' : 'text-soft')}>{t('الفرع ده')}</button>
      <button data-fb="inv:scope-all" onClick={() => scope.setAll(true)} className={cn('px-3 h-8 rounded-lg text-xs', scope.all ? 'bg-[var(--primary)] text-[var(--primary-foreground)] font-bold' : 'text-soft')}>{t('كل الفروع')}</button>
    </div>
  );
}

export function WarehouseSelect({ value, onChange, warehouses, includeAll, fb, branchId, activeOnly = true, exclude }: { value: string; onChange: (v: string) => void; warehouses: any[]; includeAll?: string; fb?: string; branchId?: string | null; activeOnly?: boolean; exclude?: string }) {
  const list = warehouses.filter((w) => (!activeOnly || w.active) && (!branchId || w.branchId === branchId) && w.id !== exclude);
  const multiBranch = new Set(list.map((w) => w.branchId)).size > 1;
  return <Select data-fb={fb} value={value} onChange={(e) => onChange(e.target.value)} options={[...(includeAll ? [{ value: '', label: includeAll }] : []), ...list.map((w) => ({ value: w.id, label: `${w.name}${multiBranch ? ' — ' + w.branchName : ''}${w.salesDefault ? ' ★' : ''}` }))]} />;
}

/** Searchable item picker (name / code / category). */
export function ItemPicker({ items, value, onChange, placeholder, fb, exclude = [], className }: { items: any[]; value: string; onChange: (id: string, item: any) => void; placeholder?: string; fb?: string; exclude?: string[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const cur = items.find((i) => i.id === value);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const shown = useMemo(() => {
    const s = text.trim().toLowerCase();
    return items.filter((i) => !exclude.includes(i.id) && (!s || `${i.name.ar} ${i.name.en} ${i.sku} ${i.category}`.toLowerCase().includes(s))).slice(0, 60);
  }, [items, text, exclude]);
  return (
    <div ref={ref} className={cn('relative', className)}>
      <button type="button" data-fb={fb} onClick={() => setOpen(!open)} className="glass-input w-full text-start flex items-center justify-between gap-2 min-h-[40px]">
        <span className={cn('truncate', !cur && 'text-dim')}>{cur ? L(cur.name) : placeholder ?? t('اختار صنف')}</span>
        {cur && <span className="text-[11px] text-dim shrink-0">{unitLabel(cur.unit)}</span>}
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[260px] glass-strong rounded-xl p-2 shadow-xl">
          <div className="relative mb-2"><Search className="w-4 h-4 absolute top-2.5 start-2.5 text-dim" /><Input autoFocus data-fb={fb ? `${fb}:search` : undefined} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('دوّر بالاسم')} style={{ paddingInlineStart: 32 }} /></div>
          <div className="max-h-64 overflow-y-auto">
            {shown.length === 0 && <div className="text-xs text-dim p-3 text-center">{t('مفيش نتايج')}</div>}
            {shown.map((i) => (
              <button key={i.id} type="button" data-fb={fb ? `${fb}:opt:${i.id}` : undefined} onClick={() => { onChange(i.id, i); setOpen(false); setText(''); }} className={cn('w-full text-start px-2 py-1.5 rounded-lg hover:surface-2 flex items-center justify-between gap-2 text-sm', i.id === value && 'surface-2')}>
                <span className="truncate">{L(i.name)}</span><span className="text-[11px] text-dim shrink-0">{i.category} · {unitLabel(i.unit)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Unit choices for an item: its stock unit, the smaller unit (g/ml) and its packs. */
export function unitOptions(item: any): { value: string; label: string; factor: number }[] {
  if (!item) return [];
  const out = [{ value: item.stockUnitId, label: unitLabel(item.unit), factor: 1 }];
  if (item.unit === 'KG') out.push({ value: 'unit_g', label: t('جم'), factor: 0.001 });
  if (item.unit === 'L') out.push({ value: 'unit_ml', label: t('مل'), factor: 0.001 });
  for (const p of item.packs ?? []) out.push({ value: p.id, label: `${L(p.name)}`, factor: Number(p.factor) });
  return out;
}

// ───────── movements
export function MovementTable({ items, showItem = true, showWarehouse = true, empty, compact }: { items: any[]; showItem?: boolean; showWarehouse?: boolean; empty?: React.ReactNode; compact?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <Table empty={empty ?? t('مفيش حركات')} head={[t('إمتى'), t('نوع الحركة'), ...(showItem ? [t('الصنف')] : []), ...(showWarehouse ? [t('المخزن')] : []), t('الكمية'), ...(compact ? [] : [t('التكلفة')]), t('القيمة'), t('الرصيد بعدها'), t('المصدر')]}
        rows={items.map((m) => [
          <button className="text-xs text-dim whitespace-nowrap hover:text-[var(--primary)]" data-fb={`movement:${m.id}`} onClick={() => setOpen(m.id)}>{dateTime(m.at)}</button>,
          <span className="inline-flex items-center gap-1">{Number(m.quantity) >= 0 ? <ArrowDownLeft className="w-3.5 h-3.5 text-[var(--success)]" /> : <ArrowUpRight className="w-3.5 h-3.5 text-[var(--error)]" />}<KindPill kind={m.kind} />{m.negative && <Pill tone="error">{t('سالب')}</Pill>}</span>,
          ...(showItem ? [<span className="font-bold">{L(m.item?.name)}</span>] : []),
          ...(showWarehouse ? [<span className="text-xs">{m.warehouse?.name}</span>] : []),
          <Qty v={m.quantity} unit={m.item?.unit} signed />,
          ...(compact ? [] : [<span className="num text-xs">{money(m.unitCost)}</span>]),
          <Money v={m.value} className="text-xs" tone={Number(m.value) < 0 ? 'error' : undefined} />,
          <Qty v={m.balanceAfter} unit={m.item?.unit} hint={false} />,
          <span className="text-xs">{sourceText(m)}{m.reason ? <span className="text-dim"> · {reasonText(m.reason)}</span> : null}{m.userName ? <span className="text-dim"> · {m.userName}</span> : null}</span>,
        ])} />
      <MovementDialog id={open} onClose={() => setOpen(null)} />
    </>
  );
}
export function sourceText(m: any): string {
  const s = m.source ?? {};
  if (s.label && !s.number) return s.label;
  const mod: Record<string, string> = { orders: 'شيك', receiving: 'استلام', transfers: 'تحويل', production: 'تحضير', waste: 'هالك', counts: 'جرد', suppliers: 'مرتجع مورد', returns: 'مرتجع زبون', inventory: 'تسوية' };
  const base = `${t(mod[s.module] ?? s.module ?? '')} ${s.number ?? ''}`.trim();
  return s.label && s.number ? `${base} · ${s.label}` : base || '—';
}
export function MovementDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useQuery<any>(id ? 'Movement.Get' : null, { params: { movementId: id } });
  const m = q.data;
  return (
    <Modal open={!!id} onClose={onClose} wide title={t('تفاصيل الحركة')} badge={<StateBadge ops={['Movement.Get', 'StockMovement.Get']} />}>
      {!m ? <Spinner /> : (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap"><KindPill kind={m.kind} /><span className="font-bold text-lg">{L(m.item?.name)}</span><Qty v={m.quantity} unit={m.item?.unit} signed className="text-lg" /></div>
          <KV rows={[
            [t('المخزن'), `${m.warehouse?.name} — ${m.warehouse?.branchName}`],
            [t('إمتى'), dateTime(m.at)],
            [t('التكلفة للوحدة'), money(m.unitCost)],
            [t('القيمة'), <Money v={m.value} />],
            [t('الرصيد بعد الحركة'), <Qty v={m.balanceAfter} unit={m.item?.unit} />],
            [t('متوسط التكلفة بعدها'), money(m.avgCostAfter)],
            [t('السبب'), reasonText(m.reason) || '—'],
            [t('ملاحظة'), m.note || '—'],
            [t('مين'), m.userName || '—'],
            [t('المصدر'), <span className="inline-flex items-center gap-1"><Link2 className="w-3.5 h-3.5" />{sourceText(m)}{m.sourceTrace?.orderStatus && <Pill tone="neutral">{t('حالة الشيك')}: {m.sourceTrace.orderStatus === 'COMPLETED' ? t('اتقفل') : m.sourceTrace.orderStatus === 'VOIDED' ? t('اتلغى') : m.sourceTrace.orderStatus === 'CONFIRMED' ? t('اتأكد') : m.sourceTrace.orderStatus}</Pill>}</span>],
            ...(m.sourceTrace?.approverName ? [[t('وافق عليها'), m.sourceTrace.approverName] as [string, string]] : []),
          ]} />
          {m.lots?.length > 0 && (
            <div>
              <div className="text-xs font-bold text-soft mb-1">{t('الدفعات (الأقرب في الصلاحية الأول)')}</div>
              <div className="flex flex-wrap gap-1.5">{m.lots.map((l: any, i: number) => <Pill key={i} tone="neutral"><span className="num">{l.lotCode}</span> · {fmtQty(l.quantity)} {l.expiryDate ? `· ${t('صلاحية')} ${l.expiryDate}` : ''}</Pill>)}</div>
            </div>
          )}
          <Tech><pre className="text-[11px] num surface-1 rounded-lg p-2 overflow-x-auto" dir="ltr">{JSON.stringify({ id: m.id, seq: m.seq, source: m.source, commandId: m.commandId, approvalGrantId: m.approvalGrantId }, null, 1)}</pre></Tech>
        </div>
      )}
    </Modal>
  );
}

export function Stat({ label, value, sub, tone, icon, onClick, fb }: { label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode; tone?: 'error' | 'warning' | 'success' | 'primary'; icon?: React.ReactNode; onClick?: () => void; fb?: string }) {
  const c = tone === 'error' ? 'text-[var(--error)]' : tone === 'warning' ? 'text-[var(--warning)]' : tone === 'success' ? 'text-[var(--success)]' : tone === 'primary' ? 'text-[var(--primary)]' : '';
  const Comp: any = onClick ? 'button' : 'div';
  return (
    <Comp data-fb={fb} onClick={onClick} className={cn('glass rounded-xl p-4 text-start flex flex-col gap-1 min-w-0', onClick && 'hover:border-[var(--primary)] transition-colors cursor-pointer')}>
      <div className="flex items-center justify-between gap-2 text-xs text-soft"><span className="truncate">{label}</span>{icon}</div>
      <div className={cn('text-2xl font-bold num', c)}>{value}</div>
      {sub && <div className="text-[11px] text-dim">{sub}</div>}
    </Comp>
  );
}

export function ClearButton({ onClick }: { onClick: () => void }) {
  return <button type="button" onClick={onClick} className="w-8 h-8 rounded-lg flex items-center justify-center hover:surface-2 text-dim" title={t('شيل')}><X className="w-4 h-4" /></button>;
}
