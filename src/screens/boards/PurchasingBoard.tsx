// Purchasing board (ux-05): purchase orders by their lifecycle — draft, waiting for approval, sent to the supplier,
// partly received, received. Reads PurchaseOrder.Find. Moves are the purchasing owner's commands: send for approval
// (PurchaseOrder.Submit), issue (PurchaseOrder.Issue — from «بانتظار الاعتماد» it needs an approver's grant, so the
// approval popup with the PIN opens), return to draft (reason popup), receive (the receiving page).
import React, { useState } from 'react';
import { Plus, Wand2, ShieldCheck, CalendarClock } from 'lucide-react';
import { useDev, useCommand } from '../../app/hooks';
import { Board, BoardViewToggle, FRESH, type ColumnDef, type MoveCheck, type Aging, type CardAction } from '../../ui/board';
import { Money, Pill, Button } from '../../ui';
import { t, tv } from '../../i18n';
import { clock, businessDate } from '../../mock/clock';
import { sign } from '../../lib/cash';
import { useBoardRules, usePendingMove, AgeChip } from './common';
import { useList, useBranchScope, BranchScope } from '../inventory/common';
import { PoView, PoEditor, Suggestions, ReturnPopup } from '../inventory/PurchaseOrders';
import { ReceiveDialog } from '../inventory/Receipts';

const STAGE: Record<string, string> = { DRAFT: 'draft', PENDING_APPROVAL: 'pending', ISSUED: 'issued', PARTIALLY_RECEIVED: 'partial', RECEIVED: 'received', CLOSED: 'received' };
export const poStage = (p: any): string | null => STAGE[p.state] ?? null;
const dayDiff = (a: string, b: string) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86_400_000);

export default function PurchasingBoard({ onList }: { onList?: () => void }) {
  const { me, can } = useDev();
  const { run } = useCommand();
  const rules = useBoardRules();
  const scope = useBranchScope();
  const q = useList<any>('PurchaseOrder.Find', { branchId: scope.branchId, limit: 300 });
  const ret = usePendingMove<any>();
  const recv = usePendingMove<any>();
  const [editor, setEditor] = useState<any | null>(null);
  const [suggest, setSuggest] = useState(false);
  const today = businessDate(clock.now());
  const columns: ColumnDef[] = [
    { id: 'draft', title: t('مسودة'), tone: 'neutral' },
    { id: 'pending', title: t('بانتظار الاعتماد'), tone: 'warning' },
    { id: 'issued', title: t('مرسل للمورد'), tone: 'info' },
    { id: 'partial', title: t('استلام جزئي'), tone: 'violet' },
    { id: 'received', title: t('مستلم'), tone: 'success', final: true, collapsed: true },
  ];
  const aging = (p: any): Aging => {
    if (poStage(p) === 'received') return FRESH;
    if (!p.expectedDate) return FRESH;
    const left = dayDiff(p.expectedDate, today);
    const late = left < -rules.purchaseGraceDays;
    const heat = late ? 3 : left <= 0 ? 2 : left <= rules.purchaseWarnDays ? 1 : 0;
    return { heat: heat as 0 | 1 | 2 | 3, late, timer: left === 0 ? t('التوريد اليوم') : left > 0 ? t('التوريد بعد {n} يوم', { n: left }) : t('متأخر {n} يوم', { n: -left }), title: `${t('موعد التوريد')} ${p.expectedDate}` };
  };
  const canMove = (p: any, to: string): MoveCheck | null => {
    const from = poStage(p);
    if (from === to) return null;
    if (from === 'received') return { ok: false, reason: t('أمر الشراء مغلق — السجل لا يتغير') };
    if (from === 'draft' && to === 'pending') return can('purchaseorder:update') ? { ok: true, label: t('إرسال للاعتماد') } : { ok: false, reason: t('لا تملك صلاحية تعديل أمر الشراء') };
    if ((from === 'draft' || from === 'pending') && to === 'issued') return can('purchaseorder:issue') ? { ok: true, label: from === 'pending' ? t('اعتماد وإرسال') : t('إرسال للمورد') } : { ok: false, reason: t('لا تملك صلاحية إرسال أمر الشراء') };
    if (from === 'pending' && to === 'draft') return can('purchaseorder:issue') ? { ok: true, label: t('إعادة للمسودة') } : { ok: false, reason: t('لا تملك صلاحية إعادة أمر الشراء') };
    if ((from === 'issued' || from === 'partial') && (to === 'partial' || to === 'received')) return can('goodsreceipt:post') ? { ok: true, label: t('استلام') } : { ok: false, reason: t('لا تملك صلاحية الاستلام') };
    if (to === 'partial' || to === 'received') return { ok: false, reason: t('الاستلام يكون بعد إرسال أمر الشراء للمورد') };
    if (to === 'draft') return { ok: false, reason: t('لا يمكن إرجاع أمر أُرسل للمورد') };
    if (to === 'pending') return { ok: false, reason: t('الاعتماد يُطلب من المسودة فقط') };
    return { ok: false, reason: t('لا يمكن النقل إلى هذا العمود') };
  };
  const onMove = async (p: any, to: string) => {
    const from = poStage(p);
    if (from === 'draft' && to === 'pending') return !!(await run('PurchaseOrder.Submit', { params: { purchaseOrderId: p.id }, body: { expectedVersion: p.version } }, { success: t('تم الإرسال للاعتماد'), refId: p.id }));
    if (to === 'issued') return !!(await run('PurchaseOrder.Issue', { params: { purchaseOrderId: p.id }, body: { expectedVersion: p.version } }, { success: from === 'pending' ? t('تم الاعتماد والإرسال للمورد') : t('أمر الشراء اتبعت للمورد'), refId: p.id }));
    if (from === 'pending' && to === 'draft') return ret.ask(p);
    if (to === 'partial' || to === 'received') return recv.ask(p);
    return false;
  };
  const actions = (p: any): CardAction[] => {
    const st = poStage(p);
    const out: CardAction[] = [];
    if (st === 'draft') out.push({ id: 'edit', label: t('تعديل'), onSelect: () => setEditor({ po: p }), disabled: !can('purchaseorder:update'), reason: t('لا تملك صلاحية تعديل أمر الشراء') });
    if (st === 'pending') out.push({ id: 'approve', label: t('اعتماد وإرسال'), icon: <ShieldCheck className="w-4 h-4" />, tone: 'primary', onSelect: () => void onMove(p, 'issued'), disabled: !can('purchaseorder:issue') });
    return out;
  };
  const suppliers = [...new Map(q.items.filter((p) => poStage(p)).map((p) => [p.supplierId, tv(p.supplierName)])).entries()].slice(0, 5);
  return (
    <div className="h-full flex flex-col min-h-0" data-screen="INV10" data-fb="purchasing-board">
      <Board id="purchasing" title={t('أوامر الشراء')} userId={me?.user?.id} items={q.raw ? q.items : null} itemKey={(p: any) => p.id} columns={columns} columnOf={poStage} aging={aging} amount={(p: any) => p.total}
        search={(p: any) => `${p.number} ${tv(p.supplierName)} ${p.supplierName} ${p.note ?? ''}`} searchPlaceholder={t('رقم الأمر أو المورد')}
        filters={[
          { id: 'mine', label: t('أوامري'), test: (p: any) => p.createdBy === me?.user?.id },
          { id: 'late', label: t('متأخر'), test: (p: any) => aging(p).late },
          ...suppliers.map(([id, name]) => ({ id: `sup:${id}`, label: name, group: 'supplier', test: (p: any) => p.supplierId === id })),
        ]}
        timeBuckets={{ columns: [{ id: 't:late', title: t('متأخر'), tone: 'error' }, { id: 't:today', title: t('اليوم'), tone: 'warning' }, { id: 't:week', title: t('خلال أسبوع'), tone: 'info' }, { id: 't:later', title: t('لاحقًا'), tone: 'neutral' }],
          of: (p: any) => { if (aging(p).late) return 't:late'; if (!p.expectedDate) return 't:later'; const d = dayDiff(p.expectedDate, today); return d <= 0 ? 't:today' : d <= 7 ? 't:week' : 't:later'; } }}
        sort={(a: any, b: any) => (a.expectedDate ?? '9999').localeCompare(b.expectedDate ?? '9999')}
        canMove={canMove} onMove={onMove} cardActions={actions}
        cardLabel={(p: any) => `${p.number} · ${tv(p.supplierName)}`}
        renderCard={(p: any, c) => (
          <div className="space-y-1.5" data-fb={`po-card:${p.number}`}>
            <div className="flex items-center gap-1.5"><span className="num font-extrabold">{p.number}</span>{p.state === 'CLOSED' && <Pill size="sm" tone="primary">{t('مقفول')}</Pill>}{p.returnReason && p.state === 'DRAFT' && <Pill size="sm" tone="warning">{t('أُعيد')}</Pill>}</div>
            <div className="font-bold text-sm truncate">{tv(p.supplierName)}</div>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-dim truncate inline-flex items-center gap-1"><CalendarClock className="w-3 h-3 shrink-0" /><span className="num">{p.expectedDate ?? '—'}</span></span>
              <Money v={p.total} className="font-bold text-sm" />
            </div>
            {sign(p.receivedValue) > 0 && poStage(p) !== 'received' && <div className="text-[11px] text-[var(--success)]">{t('استُلم بقيمة')} <Money v={p.receivedValue} className="text-[11px]" /></div>}
            <AgeChip a={c.aging} />
          </div>
        )}
        detailPane={() => true}
        renderDetail={(p: any, close) => <PoView id={p.id} onClose={close} onEdit={(po) => setEditor({ po })} />}
        toolbarStart={<BranchScope scope={scope} />}
        toolbarEnd={<>
          <Button size="sm" data-fb="po:suggest" onClick={() => setSuggest(true)}><Wand2 className="w-4 h-4" />{t('من النواقص')}</Button>
          {can('purchaseorder:create') && <Button size="sm" variant="primary" data-fb="po:new" onClick={() => setEditor({})}><Plus className="w-4 h-4" />{t('أمر شراء جديد')}</Button>}
          {onList && <BoardViewToggle value="board" onChange={(v) => v === 'list' && onList()} />}
        </>} />
      {ret.open && <ReturnPopup po={ret.open} onClose={() => undefined} onDone={(ok) => ret.done(ok)} />}
      {recv.open && <ReceiveDialog po={recv.open} onClose={() => recv.done(false)} onDone={() => recv.done(true)} />}
      {suggest && <Suggestions branchId={scope.branchId} onClose={() => setSuggest(false)} onDone={() => setSuggest(false)} />}
      {editor && <PoEditor init={editor} onClose={() => setEditor(null)} onSaved={() => setEditor(null)} />}
    </div>
  );
}

