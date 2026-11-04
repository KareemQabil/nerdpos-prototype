// Approvals & reviews board (ux-05): everything waiting for a decision in one place — remote approval requests
// (ApprovalRequest.Find), held waste waiting for the accountant (VoidReview.Find) and purchase orders waiting for
// approval (PurchaseOrder.Find). Each source is read only with its permission (authorization before the read).
// Decisions go through the owners' commands and their existing flows: a request is decided in a centered popup
// (ApprovalRequest.Decide); a held item is checked (VoidReview.Decide, note required for «غير موجود»); a purchase
// order is approved by issuing it, which opens the approval popup with the PIN (same X-Command-Id retry). Decided
// items never move again.
import React, { useState } from 'react';
import { BellRing, PackageSearch, ShoppingBag, Check, X, ShieldCheck } from 'lucide-react';
import { useDev, useQuery, useCommand } from '../../app/hooks';
import { Board, BoardViewToggle, heatOf, minutesSince, FRESH, type ColumnDef, type MoveCheck, type Aging, type CardAction } from '../../ui/board';
import { Money, Pill, Popup, Button, Field, Textarea, KV } from '../../ui';
import { t, L, tv } from '../../i18n';
import { dateTime, qty, money } from '../../lib/format';
import { clock } from '../../mock/clock';
import { APPROVAL_ACTIONS } from '../../mock/policyRegistry';
import { personName, deviceName } from '../../demo/people';
import { useBoardRules, usePendingMove, AgeChip } from './common';
import { PoView } from '../inventory/PurchaseOrders';

type Kind = 'request' | 'void' | 'po';
type Status = 'pending' | 'approved' | 'rejected' | 'expired';
interface Item { key: string; kind: Kind; status: Status; title: string; sub: string; who: string; value: string | null; atMs: number; raw: any }

const reqStatus = (s: string): Status => (s === 'PENDING' ? 'pending' : s === 'APPROVED' ? 'approved' : s === 'REJECTED' ? 'rejected' : 'expired');
const voidStatus = (s?: string): Status => (s === 'VERIFIED' ? 'approved' : s === 'MISSING' ? 'rejected' : 'pending');
const KIND_ICON: Record<Kind, React.ReactNode> = { request: <BellRing className="w-3.5 h-3.5" />, void: <PackageSearch className="w-3.5 h-3.5" />, po: <ShoppingBag className="w-3.5 h-3.5" /> };
const kindLabel = (k: Kind) => (k === 'request' ? t('طلب موافقة') : k === 'void' ? t('مراجعة الهالك') : t('أمر شراء'));
const amountOf = (ctx: any): string | null => { const v = ctx?.amount ?? ctx?.lineAmount ?? ctx?.payable ?? ctx?.absVariance; return typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? v : null; };

export default function ApprovalsBoard({ onList }: { onList?: () => void }) {
  const { me, can } = useDev();
  const rules = useBoardRules();
  const { run } = useCommand();
  const myId = me?.user?.id;
  const now = clock.now();
  const reqQ = useQuery<any>(can('approval:read') ? 'ApprovalRequest.Find' : null, { query: { limit: 200 } });
  const voidQ = useQuery<any>(can('audit:read') ? 'VoidReview.Find' : null, {});
  const poQ = useQuery<any>(can('purchasing:read') ? 'PurchaseOrder.Find' : null, { query: { limit: 300 } });
  const decide = usePendingMove<{ item: Item; to: 'approved' | 'rejected' }>();
  const ready = (!can('approval:read') || reqQ.data) && (!can('audit:read') || voidQ.data) && (!can('purchasing:read') || poQ.data);
  const dayAgo = now - 24 * 3600_000;
  const items: Item[] | null = ready ? [
    ...((reqQ.data?.items ?? []) as any[]).map((r) => ({ key: `r:${r.id}`, kind: 'request' as const, status: reqStatus(r.state), title: L(r.summary) || tv(r.actionTitle), sub: tv(r.actionTitle), who: personName(null, r.requesterName), value: amountOf(r.context), atMs: r.createdAtMs, raw: r })),
    ...((voidQ.data?.items ?? []) as any[]).map((v) => ({ key: `v:${v.id}`, kind: 'void' as const, status: voidStatus(v.review?.state), title: `${L(v.name)} ×${qty(v.quantity)}`, sub: `#${v.orderNumber}`, who: personName(null, v.approverName ?? v.actorName), value: v.value ?? null, atMs: Date.parse(v.at), raw: v })),
    ...((poQ.data?.items ?? []) as any[]).filter((p) => p.state === 'PENDING_APPROVAL' || (p.approvedAt && Date.parse(p.approvedAt) > dayAgo) || (p.returnedAt && p.state === 'DRAFT' && Date.parse(p.returnedAt) > dayAgo))
      .map((p) => ({ key: `p:${p.id}`, kind: 'po' as const, status: (p.state === 'PENDING_APPROVAL' ? 'pending' : p.state === 'DRAFT' ? 'rejected' : 'approved') as Status, title: `${p.number} — ${tv(p.supplierName)}`, sub: t('أمر شراء'), who: personName(null, p.submittedByName ?? p.createdByName), value: p.total, atMs: Date.parse(p.submittedAt ?? p.createdAt), raw: p })),
  ] : null;

  const columns: ColumnDef[] = [
    { id: 'pending', title: t('بانتظار'), tone: 'warning' },
    { id: 'approved', title: t('معتمد'), tone: 'success', final: true },
    { id: 'rejected', title: t('مرفوض'), tone: 'error', final: true },
    { id: 'expired', title: t('انتهت أو سُحبت'), tone: 'neutral', final: true, collapsed: true },
  ];
  const aging = (x: Item): Aging => {
    if (x.status !== 'pending') return FRESH;
    if (x.kind === 'request') {
      const m = x.raw.minutesWaiting ?? minutesSince(x.atMs, now);
      const heat = heatOf(m, rules.approvalWarnMinutes, rules.approvalLateMinutes);
      const s = x.raw.secondsLeft ?? 0;
      return { heat, late: heat === 3, timer: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, title: t('ينتظر منذ {n} دقيقة', { n: m }) };
    }
    const h = Math.floor(minutesSince(x.atMs, now) / 60);
    const heat = heatOf(h, rules.reviewLateHours / 2, rules.reviewLateHours);
    return { heat, late: heat === 3, timer: h >= 1 ? t('{n} س', { n: h }) : t('الآن'), title: t('ينتظر منذ {n} ساعة', { n: h }) };
  };
  const canMove = (x: Item, to: string): MoveCheck | null => {
    if (x.status === to) return null;
    if (x.status !== 'pending') return { ok: false, reason: t('القرار مسجل — السجل لا يتغير') };
    if (to === 'expired') return { ok: false, reason: t('ينتهي الطلب وحده عند انتهاء وقته') };
    const approve = to === 'approved';
    if (x.kind === 'request') {
      const def = APPROVAL_ACTIONS.find((a) => a.id === x.raw.action);
      if (def && !can(def.permission)) return { ok: false, reason: t('لا تملك صلاحية هذه الموافقة') };
      if (x.raw.requesterUserId === myId) return { ok: false, reason: t('لا يمكنك الرد على طلبك') };
      return { ok: true, label: approve ? t('موافقة') : t('رفض') };
    }
    if (x.kind === 'void') {
      if (!can('voidreview:decide')) return { ok: false, reason: t('المراجعة للمحاسب أو المالك') };
      if (x.raw.actorId === myId || x.raw.approverId === myId) return { ok: false, reason: t('من ألغى الصنف أو وافق عليه لا يراجعه') };
      return { ok: true, label: approve ? t('تم التحقق') : t('غير موجود') };
    }
    if (!can('purchaseorder:issue')) return { ok: false, reason: t('لا تملك صلاحية اعتماد أمر الشراء') };
    return { ok: true, label: approve ? t('اعتماد وإرسال') : t('إعادة للمسودة') };
  };
  const onMove = async (x: Item, to: string) => {
    if (x.kind === 'po' && to === 'approved') return !!(await run('PurchaseOrder.Issue', { params: { purchaseOrderId: x.raw.id }, body: { expectedVersion: x.raw.version } }, { success: t('تم الاعتماد والإرسال للمورد'), refId: x.raw.id }));
    return decide.ask({ item: x, to: to as 'approved' | 'rejected' });
  };
  const actions = (x: Item): CardAction[] => x.status !== 'pending' ? [] : [
    { id: 'approve', label: x.kind === 'void' ? t('تم التحقق') : x.kind === 'po' ? t('اعتماد وإرسال') : t('موافقة'), icon: <Check className="w-4 h-4" />, tone: 'primary', onSelect: () => void onMove(x, 'approved'), disabled: !canMove(x, 'approved')?.ok, reason: canMove(x, 'approved')?.reason },
    { id: 'reject', label: x.kind === 'void' ? t('غير موجود') : x.kind === 'po' ? t('إعادة للمسودة') : t('رفض'), icon: <X className="w-4 h-4" />, tone: 'danger', onSelect: () => void onMove(x, 'rejected'), disabled: !canMove(x, 'rejected')?.ok, reason: canMove(x, 'rejected')?.reason },
  ];
  return (
    <div className="h-full flex flex-col min-h-0" data-screen="APR" data-fb="approvals-board">
      <Board id="approvals" title={t('الموافقات والمراجعات')} userId={myId} items={items} itemKey={(x) => x.key} columns={columns} columnOf={(x) => x.status} aging={aging} amount={(x) => x.value}
        search={(x) => `${x.title} ${x.sub} ${x.who}`} searchPlaceholder={t('بحث بالعملية أو الشيك أو الاسم')}
        filters={[
          { id: 'late', label: t('متأخر'), test: (x) => aging(x).late },
          { id: 'mine', label: t('طلباتي'), test: (x) => (x.kind === 'request' && x.raw.requesterUserId === myId) || (x.kind === 'po' && (x.raw.submittedBy ?? x.raw.createdBy) === myId) },
          { id: 'k:request', label: t('طلبات الموافقة'), group: 'kind', test: (x) => x.kind === 'request' },
          { id: 'k:void', label: t('مراجعة الهالك'), group: 'kind', test: (x) => x.kind === 'void' },
          { id: 'k:po', label: t('أوامر الشراء'), group: 'kind', test: (x) => x.kind === 'po' },
        ]}
        timeBuckets={{ columns: [{ id: 't:late', title: t('متأخر'), tone: 'error' }, { id: 't:now', title: t('الآن'), tone: 'warning' }, { id: 't:hour', title: t('خلال ساعة'), tone: 'info' }, { id: 't:day', title: t('اليوم'), tone: 'neutral' }],
          of: (x) => { if (aging(x).late) return 't:late'; const m = minutesSince(x.atMs, now); return m < 15 ? 't:now' : m < 60 ? 't:hour' : 't:day'; } }}
        sort={(a, b) => a.atMs - b.atMs}
        canMove={canMove} onMove={onMove} cardActions={actions}
        cardLabel={(x) => `${kindLabel(x.kind)} · ${x.title}`}
        renderCard={(x, c) => (
          <div className="space-y-1.5" data-fb={`approval-card:${x.key}`} data-kind={x.kind}>
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-soft">{KIND_ICON[x.kind]}{kindLabel(x.kind)}{x.kind === 'request' && <span className="text-dim font-normal truncate">· {x.sub}</span>}</div>
            <div className="font-bold text-sm leading-snug line-clamp-2">{x.title}</div>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-soft truncate">{x.who}</span>
              {x.value && <Money v={x.value} className="font-bold text-sm" />}
            </div>
            {x.status === 'pending' ? <AgeChip a={c.aging} /> : <DecidedLine x={x} />}
          </div>
        )}
        renderDetail={(x, close) => x.kind === 'po' ? <PoView id={x.raw.id} onClose={close} onEdit={() => undefined} /> : <ItemDetail x={x} onDecide={(to) => void onMove(x, to)} canMove={canMove} />}
        toolbarEnd={onList && <BoardViewToggle value="board" onChange={(v) => v === 'list' && onList()} />} />
      {decide.open && <DecisionPopup item={decide.open.item} to={decide.open.to} onDone={decide.done} />}
    </div>
  );
}

function DecidedLine({ x }: { x: Item }) {
  const r = x.raw;
  const by = x.kind === 'request' ? r.decidedByName : x.kind === 'void' ? r.reviewerName : x.status === 'approved' ? r.approvedByName : r.returnedByName;
  const note = x.kind === 'request' ? r.decisionNote : x.kind === 'void' ? r.review?.note : x.status === 'rejected' ? r.returnReason : null;
  if (x.status === 'expired') return <div className="text-[11px] text-dim">{r.state === 'CANCELLED' ? t('سحبه الطالب') : t('انتهى وقته')}</div>;
  return <div className="text-[11px] text-dim truncate">{by ? personName(null, by) : ''}{note ? ` — «${note}»` : ''}</div>;
}

function ItemDetail({ x, onDecide, canMove }: { x: Item; onDecide: (to: 'approved' | 'rejected') => void; canMove: (x: Item, to: string) => MoveCheck | null }) {
  const r = x.raw;
  const rows: [React.ReactNode, React.ReactNode][] = x.kind === 'request'
    ? [[t('العملية'), tv(r.actionTitle)], [t('الطالب'), personName(null, r.requesterName)], [t('الجهاز'), r.terminalId ? deviceName(r.terminalId, null, r.terminalName) : '—'], [t('الوقت'), dateTime(r.createdAt)], ...(amountOf(r.context) ? [[t('القيمة'), money(amountOf(r.context))] as [string, string]] : [])]
    : [[t('الصنف'), `${L(r.name)} ×${qty(r.quantity)}`], [t('الشيك'), `#${r.orderNumber}`], [t('من ألغى'), personName(null, r.actorName)], [t('من وافق'), r.approverName ? personName(null, r.approverName) : '—'], [t('السبب'), r.reason ?? '—'], [t('القيمة'), money(r.value)], [t('الوقت'), dateTime(r.at)]];
  const ok = canMove(x, 'approved'), no = canMove(x, 'rejected');
  return (
    <div className="space-y-4" data-fb="approval-detail">
      <div className="flex items-center gap-2 flex-wrap"><Pill tone="neutral">{KIND_ICON[x.kind]}{kindLabel(x.kind)}</Pill><h2 className="text-lg font-bold">{x.title}</h2></div>
      <KV rows={rows} />
      {x.status !== 'pending' && <DecidedLine x={x} />}
      {x.status === 'pending' && (
        <div className="flex gap-2 flex-wrap">
          <Button variant="success" disabled={!ok?.ok} title={ok?.reason} onClick={() => onDecide('approved')} data-fb="approval-detail:approve"><Check className="w-4 h-4" />{ok?.label ?? t('موافقة')}</Button>
          <Button variant="danger" disabled={!no?.ok} title={no?.reason} onClick={() => onDecide('rejected')} data-fb="approval-detail:reject"><X className="w-4 h-4" />{no?.label ?? t('رفض')}</Button>
        </div>
      )}
      {x.status === 'pending' && !ok?.ok && ok?.reason && <div className="text-xs text-dim">{ok.reason}</div>}
    </div>
  );
}

/** One-line decision popup: action · item · value, the note (required to refuse), Enter confirms, Esc closes. */
function DecisionPopup({ item, to, onDone }: { item: Item; to: 'approved' | 'rejected'; onDone: (ok: boolean) => void }) {
  const { run, busy } = useCommand();
  const [note, setNote] = useState('');
  const approve = to === 'approved';
  const needNote = !approve; // a refusal always carries its reason
  const go = async () => {
    if (needNote && note.trim().length < 3) return;
    let r: any = null;
    if (item.kind === 'request') r = await run('ApprovalRequest.Decide', { params: { requestId: item.raw.id }, body: { decision: approve ? 'APPROVE' : 'REJECT', note: note.trim() || undefined, expectedVersion: item.raw.version } }, { success: approve ? t('تمت الموافقة — تُستكمل العملية على جهاز الطالب') : t('تم رفض الطلب') });
    else if (item.kind === 'void') r = await run('VoidReview.Decide', { params: { reversalId: item.raw.id }, body: { decision: approve ? 'VERIFIED' : 'MISSING', note: note.trim() } }, { success: approve ? t('تم التحقق من الصنف') : t('سُجل: الصنف غير موجود') });
    else r = await run('PurchaseOrder.ReturnToDraft', { params: { purchaseOrderId: item.raw.id }, body: { expectedVersion: item.raw.version, reason: note.trim() } }, { success: t('أُعيد أمر الشراء للمسودة') });
    if (r) onDone(true);
  };
  const title = item.kind === 'void' ? (approve ? t('تم التحقق') : t('غير موجود')) : item.kind === 'po' ? t('إعادة للمسودة') : approve ? t('موافقة') : t('رفض');
  return (
    <Popup open onClose={() => onDone(false)} size="sm" fb="decision-popup" title={<span className="flex items-center gap-2">{approve ? <ShieldCheck className="w-4 h-4 text-[var(--success)]" /> : <X className="w-4 h-4 text-[var(--error)]" />}{title}</span>}
      footer={<><Button onClick={() => onDone(false)}>{t('إلغاء')}</Button><Button variant={approve ? 'success' : 'danger'} loading={busy} disabled={needNote && note.trim().length < 3} onClick={go} data-fb="decision:confirm">{title}</Button></>}>
      <div className="space-y-3">
        <div className="rounded-xl surface-1 border line px-3 py-2 text-sm flex items-center gap-2 flex-wrap" data-fb="decision:line">
          <span className="font-bold">{item.kind === 'request' ? tv(item.raw.actionTitle) : kindLabel(item.kind)}</span><span className="text-dim">·</span><span className="truncate">{item.title}</span>
          {item.value && <><span className="text-dim">·</span><Money v={item.value} className="font-bold" /></>}
        </div>
        <Field label={needNote ? t('السبب') : t('ملاحظة')} required={needNote}>
          <Textarea data-autofocus value={note} onChange={(e) => setNote(e.target.value)} data-fb="decision:note" onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void go(); } }} />
        </Field>
      </div>
    </Popup>
  );
}
