// Reconciliation: drawer cash expected vs counted, card and wallet payments vs the provider's settlement, and sales vs
// accepted e-receipts. A difference is never edited away: the manager writes why it happened (acknowledge with reason).
import React, { useState } from 'react';
import { Scale, Play, CheckCircle2, AlertTriangle, HelpCircle, MessageSquareText, Banknote, CreditCard, Smartphone, FileCheck2 } from 'lucide-react';
import { useQuery, useCommand, useDev } from '../../app/hooks';
import { Section, StateBadge, Card, Button, Pill, Tabs, Table, Modal, Money, Field, Input, Textarea, Banner, Empty, KV } from '../../ui';
import { t, L } from '../../i18n';
import { Tech } from '../../app/tech';
import { cn, dateTime } from '../../lib/format';
import { clock, businessDate } from '../../mock/clock';

const ICON: Record<string, React.ComponentType<{ className?: string }>> = { DRAWER_CASH: Banknote, CARD_SETTLEMENT: CreditCard, WALLETS: Smartphone, E_RECEIPTS: FileCheck2 };
const STATUS: Record<string, { label: string; tone: any }> = {
  MATCHED: { label: 'مطابق', tone: 'success' }, UNEXPLAINED_DIFFERENCE: { label: 'فرق من غير تفسير', tone: 'error' },
  EXPLAINED: { label: 'فرق متفسر', tone: 'info' }, MISSING: { label: 'ناقص بيانات', tone: 'warning' },
};
const addDays = (iso: string, n: number) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);

export default function Reconciliation() {
  const today = businessDate(clock.now());
  const [from, setFrom] = useState(addDays(today, -2));
  const [to, setTo] = useState(today);
  const [tab, setTab] = useState<'open' | 'all' | 'explained' | 'matched'>('open');
  const [rule, setRule] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const status = tab === 'open' ? 'UNEXPLAINED_DIFFERENCE,MISSING' : tab === 'explained' ? 'EXPLAINED' : tab === 'matched' ? 'MATCHED' : undefined;
  const board = useQuery<any>('Reconciliation.Board', { query: { status, ruleId: rule || undefined } });
  const all = useQuery<any>('Reconciliation.Board', { query: {} });
  const { run, busy } = useCommand();
  const evaluate = (ruleId: string) => run('Reconciliation.Evaluate', { params: { ruleId }, body: { period: { from, to } } }, { success: t('المطابقة خلصت') });
  const items: any[] = board.data?.items ?? [];
  const counts = all.data?.counts ?? {};
  return (
    <div className="space-y-4" data-screen="REC">
      <Section title={t('المطابقة')} badge={<StateBadge ops={['Reconciliation.Board', 'Reconciliation.Evaluate', 'Reconciliation.GetResult', 'Reconciliation.Acknowledge']} />}
        sub={t('بنقارن اللي السيستم سجله باللي حصل فعلاً: الدرج المعدود، تسوية البنك، كشف المحفظة، والإيصالات المقبولة. أي فرق بيفضل ظاهر لحد ما حد يكتب سببه — الأرقام نفسها عمرها ما بتتعدل.')}
        actions={<div className="flex items-end gap-2 flex-wrap">
          <Field label={t('من')}><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="w-40" /></Field>
          <Field label={t('لحد')}><Input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} className="w-40" /></Field>
          <Button variant="primary" loading={busy} onClick={() => evaluate('ALL')} data-fb="recon-run-all"><Play className="w-4 h-4" />{t('طابق الكل')}</Button>
        </div>} />
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {(all.data?.rules ?? []).map((r: any) => {
          const Icon = ICON[r.id] ?? Scale;
          return (
            <div key={r.id} className={cn('glass rounded-xl p-4 space-y-2 border-2', rule === r.id ? 'border-[var(--primary)]' : 'border-transparent')} data-fb={`recon-rule:${r.id}`}>
              <div className="flex items-center justify-between"><div className="flex items-center gap-2 font-bold"><Icon className="w-5 h-5 text-[var(--primary)]" />{L(r.title)}</div>{r.open > 0 ? <Pill tone="error">{r.open}</Pill> : <CheckCircle2 className="w-4 h-4 text-[var(--success)]" />}</div>
              <div className="text-xs text-dim min-h-[32px]">{L(r.description)}</div>
              <div className="text-[11px] text-dim">{r.lastRunAt ? `${t('آخر مطابقة')} ${dateTime(r.lastRunAt)}` : t('لسه ما اتعملتش')}</div>
              <div className="flex gap-1.5">
                <Button size="sm" onClick={() => evaluate(r.id)} disabled={busy}><Play className="w-3.5 h-3.5" />{t('طابق')}</Button>
                <Button size="sm" variant="ghost" onClick={() => setRule(rule === r.id ? '' : r.id)}>{rule === r.id ? t('الكل') : t('اعرض بس')}</Button>
              </div>
            </div>
          );
        })}
      </div>
      <Card title={<span className="flex items-center gap-2"><Scale className="w-4 h-4" />{t('النتايج')}</span>}
        actions={<Tabs value={tab} onChange={setTab} tabs={[{ id: 'open', label: <span>{t('محتاجة تفسير')} {(counts.UNEXPLAINED_DIFFERENCE ?? 0) > 0 && <Pill tone="error">{counts.UNEXPLAINED_DIFFERENCE}</Pill>}</span> }, { id: 'explained', label: t('اتفسرت') }, { id: 'matched', label: t('مطابقة') }, { id: 'all', label: t('الكل') }]} />}>
        {items.length === 0 ? <Empty icon={<CheckCircle2 className="w-10 h-10 text-[var(--success)] opacity-60" />} text={tab === 'open' ? t('مفيش فروقات مفتوحة — اضغط "طابق الكل" عشان تراجع فترة') : t('مفيش نتايج')} /> : (
          <Table head={[t('إيه'), t('اليوم'), t('المفروض'), t('الفعلي'), t('الفرق'), t('الحالة'), '']} rows={items.map((r) => [
            <div><div className="font-bold text-sm">{L(r.title)}</div>{r.note && <div className="text-[11px] text-dim">{L(r.note)}</div>}</div>,
            <span className="num text-xs">{r.businessDate}</span>, <Money v={r.expected} />, <Money v={r.actual} />,
            <Money v={r.difference} tone={Number(r.difference) === 0 ? 'success' : 'error'} />,
            <div><Pill tone={STATUS[r.status]?.tone}>{t(STATUS[r.status]?.label ?? r.status)}</Pill>{r.status === 'EXPLAINED' && r.ackReason && <div className="text-[11px] text-dim mt-0.5 max-w-[220px] truncate">"{r.ackReason}"</div>}</div>,
            <Button size="sm" variant={r.status === 'UNEXPLAINED_DIFFERENCE' ? 'warning' : 'ghost'} onClick={() => setOpen(r.id)} data-fb={`recon-open:${r.key}`}>{r.status === 'UNEXPLAINED_DIFFERENCE' ? <><MessageSquareText className="w-3.5 h-3.5" />{t('فسّر')}</> : t('التفاصيل')}</Button>,
          ])} />
        )}
      </Card>
      {open && <ResultDialog id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ResultDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery<any>('Reconciliation.GetResult', { params: { resultId: id } });
  const { run, busy } = useCommand();
  const [reason, setReason] = useState('');
  const r = q.data;
  const canAck = r && (r.status === 'UNEXPLAINED_DIFFERENCE' || r.status === 'EXPLAINED');
  const ack = async () => { if (await run('Reconciliation.Acknowledge', { params: { resultId: id }, body: { reason, expectedVersion: r.version } }, { success: t('التفسير اتسجل') })) onClose(); };
  return (
    <Modal open onClose={onClose} wide title={r ? L(r.title) : '…'} badge={<StateBadge ops={['Reconciliation.GetResult', 'Reconciliation.Acknowledge']} />}
      footer={canAck ? <Button variant="primary" loading={busy} disabled={reason.trim().length < 5} onClick={ack} data-fb="recon-ack">{r.status === 'EXPLAINED' ? t('حدّث التفسير') : t('سجّل التفسير')}</Button> : undefined}>
      {r && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl surface-1 p-3"><div className="text-[11px] text-dim">{t('المفروض حسب السيستم')}</div><Money v={r.expected} big /></div>
            <div className="rounded-xl surface-1 p-3"><div className="text-[11px] text-dim">{t('الفعلي')}</div><Money v={r.actual} big /></div>
            <div className={cn('rounded-xl p-3', Number(r.difference) === 0 ? 'surface-1' : 'bg-[color-mix(in_srgb,var(--error)_10%,transparent)]')}><div className="text-[11px] text-dim">{t('الفرق')}</div><Money v={r.difference} big tone={Number(r.difference) === 0 ? 'success' : 'error'} /></div>
          </div>
          {r.note && <Banner tone="info">{L(r.note)}</Banner>}
          <KV rows={[[t('نوع المطابقة'), L(r.rule?.title)], [t('اليوم'), <span className="num">{r.businessDate}</span>], [t('الحالة'), <Pill tone={STATUS[r.status]?.tone}>{t(STATUS[r.status]?.label ?? r.status)}</Pill>], ...(r.ackByName ? [[t('فسّره'), `${r.ackByName} · ${dateTime(r.ackAt)}`] as [string, string], [t('السبب'), r.ackReason] as [string, string]] : [])]} />
          {r.drilldown?.length > 0 && (
            <div>
              <div className="text-xs font-bold text-soft mb-1">{t('التفاصيل')}</div>
              <div className="space-y-1 max-h-56 overflow-y-auto">{r.drilldown.map((x: any) => <div key={x.id} className="flex items-center justify-between text-xs px-2 py-1.5 rounded-lg surface-1"><span>{x.kind === 'SETTLEMENT' ? '🏦 ' : ''}{/^[A-Z_]+$/.test(x.label) ? t(KIND_AR[x.label] ?? 'حركة') : x.label}</span>{x.amount && <Money v={x.amount} />}</div>)}</div>
            </div>
          )}
          {canAck ? (
            <Field label={t('ليه حصل الفرق ده؟')} hint={t('اكتب السبب بوضوح (5 حروف على الأقل). التفسير بيتسجل باسمك، والأرقام بتفضل زي ما هي.')}><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('مثلاً: عملية كارت اتعملت مرتين على الماكينة واترجعت تاني يوم')} data-fb="recon-reason" /></Field>
          ) : r.status === 'MISSING' ? <Banner tone="warning">{t('مفيش رقم فعلي نقارن بيه لسه (الوردية مفتوحة أو التسوية ما وصلتش). طابق تاني بعدين.')}</Banner> : null}
          <Tech><div className="num text-[10px] text-dim">{r.id} · {r.key} · run {r.runId} · v{r.version}</div></Tech>
        </div>
      )}
    </Modal>
  );
}
const KIND_AR: Record<string, string> = { OPENING_FLOAT: 'فكة أول الوردية', TENDER_IN: 'تحصيل كاش', REFUND_OUT: 'مرتجع كاش', PAY_IN: 'إدخال', PAY_OUT: 'صرف', SAFE_DROP: 'إيداع الخزنة', NO_SALE: 'فتح الدرج', TIP_IN: 'بقشيش', TIP_OUT: 'توزيع بقشيش', DEPOSIT_IN: 'عربون', TENDER_CORRECTION_IN: 'تصحيح دفع', TENDER_CORRECTION_OUT: 'تصحيح دفع' };
