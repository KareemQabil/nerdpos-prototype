// Remote approvals inbox (manager's device): requests sent from a cashier / waiter popup. Accept issues the same
// one-use grant as typing the PIN at the till; the waiting device continues the command on its own.
import React, { useState } from 'react';
import { BellRing, Check, X, Clock, Monitor, User, Inbox } from 'lucide-react';
import { useQuery, useCommand } from '../../app/hooks';
import { Section, StateBadge, Card, Button, Pill, Tabs, Empty, Input, KV, useNow, Banner } from '../../ui';
import { t, L } from '../../i18n';
import { Tech } from '../../app/tech';
import { money, dateTime, cn } from '../../lib/format';
import { store } from '../../mock/store';

const FIELD: Record<string, string> = {
  amount: 'المبلغ', lineAmount: 'قيمة الصنف', payable: 'إجمالي الشيك', discountPercent: 'نسبة الخصم', absVariance: 'الفرق', countedCash: 'المعدود', expectedCash: 'المتوقع',
  reasonCode: 'السبب', fireRound: 'الجولة', kind: 'النوع', method: 'طريقة الدفع', priorReprintCount: 'طبع قبل كده', oldUnitPrice: 'السعر القديم', newUnitPrice: 'السعر الجديد', attempts: 'المحاولات', warnings: 'التحذيرات', date: 'اليوم',
};
const MONEY = new Set(['amount', 'lineAmount', 'payable', 'absVariance', 'countedCash', 'expectedCash', 'oldUnitPrice', 'newUnitPrice', 'currentEffectivePaid']);
const KIND: Record<string, string> = { PERCENTAGE: 'نسبة', FIXED_AMOUNT: 'مبلغ ثابت', CASH: 'كاش', CARD: 'كارت', DIGITAL_WALLET: 'محفظة' };
function plainValue(k: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (MONEY.has(k)) return money(String(v));
  if (k === 'discountPercent') return `${v}%`;
  if (k === 'reasonCode') return L(store.db.reasonCodes.find((r) => r.code === v)?.label) || String(v);
  if (typeof v === 'string' && KIND[v]) return t(KIND[v]);
  return String(v);
}

export default function ApprovalsInbox() {
  useNow(5000);
  const [tab, setTab] = useState<'PENDING' | 'DONE'>('PENDING');
  const q = useQuery<any>('ApprovalRequest.Find', { query: { state: tab === 'PENDING' ? 'PENDING' : 'APPROVED,REJECTED,EXPIRED,CANCELLED', limit: 100 } });
  const items: any[] = q.data?.items ?? [];
  return (
    <div className="space-y-4" data-screen="APR">
      <Section title={t('طلبات الموافقة')} badge={<StateBadge ops={['ApprovalRequest.Find', 'ApprovalRequest.Decide', 'ApprovalRequest.Create']} />}
        sub={t('الكاشير أو الويتر لما يحتاج موافقة يقدر يبعتها هنا بدل ما تروح له. موافقتك بتتستخدم مرة واحدة للعملية دي بالظبط.')}
        actions={<Tabs value={tab} onChange={setTab} tabs={[{ id: 'PENDING', label: <span className="flex items-center gap-1.5">{t('مستنية')}{tab !== 'PENDING' || !items.length ? '' : <Pill tone="warning">{items.length}</Pill>}</span> }, { id: 'DONE', label: t('اتردّ عليها') }]} />} />
      {tab === 'PENDING' && items.length === 0 && !q.loading && <Card><Empty icon={<Inbox className="w-10 h-10 opacity-40" />} text={t('مفيش طلبات مستنية دلوقتي')}><div className="text-xs">{t('جرّب: على الكاشير اعمل خصم كبير، وفي شاشة الموافقة اضغط "ابعت طلب للمدير".')}</div></Empty></Card>}
      <div className="grid xl:grid-cols-2 gap-3">
        {items.map((r) => <RequestCard key={r.id} r={r} />)}
      </div>
    </div>
  );
}

function RequestCard({ r }: { r: any }) {
  const { run, busy } = useCommand();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const decide = (decision: 'APPROVE' | 'REJECT') => run('ApprovalRequest.Decide', { params: { requestId: r.id }, body: { decision, note: note || undefined, expectedVersion: r.version } }, { success: decision === 'APPROVE' ? t('وافقت — العملية هتكمل على جهاز {d}', { d: r.terminalCode ?? '' }) : t('الطلب اترفض') });
  const ctxRows = Object.entries(r.context ?? {}).filter(([k]) => FIELD[k]).map(([k, v]) => [t(FIELD[k]), plainValue(k, v)] as [string, string]);
  const pending = r.state === 'PENDING';
  const left = r.secondsLeft ?? 0;
  return (
    <Card className={cn(pending && 'border border-[color-mix(in_srgb,var(--warning)_45%,transparent)]')}
      title={<span className="flex items-center gap-2"><BellRing className={cn('w-4 h-4', pending ? 'text-[var(--warning)]' : 'text-dim')} />{r.actionTitle}</span>}
      actions={pending ? <Pill tone="warning"><Clock className="w-3 h-3" />{t('باقي')} <span className="num">{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span></Pill> : <StatePill s={r.state} />}>
      <div className="space-y-3" data-fb={`approval-request:${r.id}`}>
        {r.summary?.ar && <div className="text-lg font-bold">{L(r.summary)}</div>}
        <div className="flex flex-wrap gap-2 text-xs text-soft">
          <span className="flex items-center gap-1"><User className="w-3.5 h-3.5" />{r.requesterName}</span>
          <span className="flex items-center gap-1"><Monitor className="w-3.5 h-3.5" />{r.terminalName ?? r.terminalCode ?? t('من غير جهاز')}</span>
          <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{dateTime(r.createdAt)}{pending ? ` · ${t('مستني من')} ${r.minutesWaiting} ${t('دقيقة')}` : ''}</span>
        </div>
        {ctxRows.length > 0 && <KV rows={ctxRows} />}
        <Tech><KV className="num text-[11px]" rows={[['action', r.action], ['target', `${r.targetType} ${r.targetId}`], ['op', r.opId], ['X-Command-Id', r.commandId ?? '—'], ['grant', r.grantId ?? '—']]} /></Tech>
        {!pending && r.decidedByName && <div className="text-xs text-dim">{r.state === 'APPROVED' ? t('وافق') : t('رفض')}: {r.decidedByName} · {dateTime(r.decidedAt)}{r.decisionNote ? ` — "${r.decisionNote}"` : ''}</div>}
        {pending && (rejecting ? (
          <div className="flex gap-2 items-center">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('سبب الرفض (اختياري) — هيظهر للي طلب')} data-fb="approval-reject-note" />
            <Button variant="danger" loading={busy} onClick={() => decide('REJECT')} data-fb="approval-reject-confirm">{t('ارفض')}</Button>
            <Button variant="ghost" onClick={() => setRejecting(false)}>{t('رجوع')}</Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button variant="success" className="flex-1" loading={busy} onClick={() => decide('APPROVE')} data-fb="approval-accept"><Check className="w-4 h-4" />{t('وافق')}</Button>
            <Button variant="danger" onClick={() => setRejecting(true)} data-fb="approval-reject"><X className="w-4 h-4" />{t('ارفض')}</Button>
          </div>
        ))}
        {pending && r.requesterName && <Banner tone="info">{t('لو وافقت، {n} مش هيحتاج يعمل حاجة — العملية هتكمل لوحدها على جهازه.', { n: r.requesterName })}</Banner>}
      </div>
    </Card>
  );
}

function StatePill({ s }: { s: string }) {
  const m: Record<string, [string, any]> = { APPROVED: ['اتوافق', 'success'], REJECTED: ['اترفض', 'error'], EXPIRED: ['خلص وقته', 'neutral'], CANCELLED: ['اتسحب', 'neutral'], PENDING: ['مستني', 'warning'] };
  const [l, tone] = m[s] ?? [s, 'neutral'];
  return <Pill tone={tone}>{t(l)}</Pill>;
}
