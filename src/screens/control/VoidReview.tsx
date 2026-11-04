// r3A — the control loop the experts described (T1 ~1576–1600): a spoiled ("long void") item is kept wrapped by the
// branch manager until the accountant checks it. Verified = the approver is clear; missing = a red flag on the
// approver. Plus the full removal trace at every stage (who did it, who allowed it, terminal, stage, reason, value).
import React, { useMemo, useState } from 'react';
import { ClipboardCheck, PackageSearch, Flag, CheckCircle2, XCircle, ListTree, ShieldCheck } from 'lucide-react';
import { useQuery, useCommand, useDev } from '../../app/hooks';
import { PageHeader, Card, Table, Pill, Button, Tabs, StatGrid, StatCard, FilterChips, Toolbar, EmptyState, Modal, Field, Textarea, Money, Banner, Popup, KV, DateTime, DataTable, cols } from '../../ui';
import { t, L } from '../../i18n';
import { dateTime, money, qty } from '../../lib/format';
import { Tech } from '../../app/tech';
import { personName, deviceName } from '../../demo/people';
import { STAGE_TEXT, DISPOSITION_TEXT } from '../../mock/control-registry';
import type { StageId } from '../../mock/types-control';

const first = (s?: string | null) => (s ? personName(null, s) : '—');
const KIND_AR: Record<string, string> = { LINE_REMOVE: 'شيل صنف', QTY_DECREASE: 'تقليل كمية', ORDER_CANCEL: 'إلغاء شيك قبل الإرسال', LINE_VOID: 'إلغاء صنف اتبعت', ORDER_VOID: 'إلغاء شيك بعد الإرسال', REFUND: 'مرتجع نفس اليوم', RETURN_AFTER_CLOSE: 'مرتجع بعد قفل اليوم', STAFF_MEAL_CANCEL: 'إلغاء/مرتجع وجبة موظف' };
const CRED_AR: Record<string, string> = { PIN: 'رقم سري', CARD: 'كارت', FINGERPRINT: 'بصمة', REMOTE: 'من جهازه' };
const stageTone = (s: string) => (s === 'S3' ? 'error' : s === 'S2' ? 'warning' : s === 'S1' ? 'info' : 'neutral') as any;
export const StagePill = ({ s }: { s: StageId }) => <Pill tone={stageTone(s)} size="sm">{t(STAGE_TEXT[s]?.short ?? s)}</Pill>;

export default function VoidReview() {
  const { can } = useDev();
  const [tab, setTab] = useState<'queue' | 'trace' | 'flags'>('queue');
  const q = useQuery<any>('VoidReview.Find', {});
  const pending = q.data?.pending ?? 0;
  return (
    <div className="space-y-4" data-screen="CTL1" data-fb="screen:void-review">
      <PageHeader icon={<ClipboardCheck className="w-5 h-5" />} title={t('مراجعة الإلغاءات والهالك')} ops={['VoidReview.Find', 'VoidReview.Decide', 'Reversal.Find']}
        description={t('كل صنف اتشال أو اتلغى أو اترجع: مين عمل، مين وافق، من أنهي جهاز، وفي أنهي مرحلة. والهالك المحفوظ بيستنى المحاسب يشوفه.')} />
      {!can('voidreview:decide') && <Banner tone="info">{t('المراجعة نفسها (اتشاف / مش موجود) للمحاسب أو صاحب المطعم. انت شايف بس.')}</Banner>}
      <Tabs variant="underline" value={tab} onChange={setTab} tabs={[{ id: 'queue', icon: <PackageSearch className="w-4 h-4" />, label: t('هالك مستني المراجعة'), count: pending || undefined, fb: 'void-review-tab:queue' }, { id: 'trace', icon: <ListTree className="w-4 h-4" />, label: t('سجل الإلغاءات والمرتجعات'), fb: 'void-review-tab:trace' }, { id: 'flags', icon: <Flag className="w-4 h-4" />, label: t('علامات على المديرين'), fb: 'void-review-tab:flags' }]} />
      {tab === 'queue' && <Queue q={q} canDecide={can('voidreview:decide')} />}
      {tab === 'trace' && <ReversalTrace />}
      {tab === 'flags' && <Flags flags={q.data?.flags ?? []} />}
    </div>
  );
}

function Queue({ q, canDecide }: { q: any; canDecide: boolean }) {
  const [st, setSt] = useState<'PENDING' | 'VERIFIED' | 'MISSING' | 'ALL'>('PENDING');
  const [dec, setDec] = useState<{ r: any; d: 'VERIFIED' | 'MISSING' } | null>(null);
  const all: any[] = q.data?.items ?? [];
  const items = st === 'ALL' ? all : all.filter((r) => (r.review?.state ?? 'PENDING') === st);
  const c = (s: string) => all.filter((r) => (r.review?.state ?? 'PENDING') === s).length;
  const VC = cols<any>();
  return (
    <div className="space-y-3">
      <StatGrid>
        <StatCard label={t('مستني المراجعة')} value={c('PENDING')} tone={c('PENDING') ? 'warning' : 'neutral'} icon={<PackageSearch />} hint={t('المدير محتفظ بيها ملفوفة ومكتوب عليها')} />
        <StatCard label={t('اتشاف ومتأكد')} value={c('VERIFIED')} tone="success" icon={<CheckCircle2 />} />
        <StatCard label={t('مش موجود')} value={c('MISSING')} tone={c('MISSING') ? 'error' : 'neutral'} icon={<XCircle />} hint={t('علامة على المدير اللي وافق')} />
      </StatGrid>
      <Card padding="sm">
        <Toolbar><FilterChips value={st} onChange={setSt} options={[{ id: 'PENDING', label: t('مستني'), count: c('PENDING'), tone: 'warning' }, { id: 'VERIFIED', label: t('اتشاف'), count: c('VERIFIED') }, { id: 'MISSING', label: t('مش موجود'), count: c('MISSING'), tone: 'error' }, { id: 'ALL', label: t('الكل'), count: all.length }]} /></Toolbar>
        <DataTable rows={items} rowKey={(r: any) => r.id} loading={q.loading && !q.data} label={t('مراجعة الإلغاءات والهالك')}
          columns={[
            VC.text('item', t('الصنف'), (r) => L(r.name), { cell: (r) => <span className="font-bold">{L(r.name)} <span className="num text-dim">×{qty(r.quantity)}</span></span> }),
            VC.number('check', t('الشيك'), (r) => r.orderNumber, { align: 'start', cell: (r) => <span className="text-xs"><span className="num">#{r.orderNumber}</span><DateTime v={r.at} className="block text-dim" /></span> }),
            VC.status('stage', t('المرحلة'), (r) => ({ label: t(STAGE_TEXT[r.stage as StageId]?.short ?? r.stage) }), { cell: (r) => <StagePill s={r.stage} /> }),
            VC.custom('who', t('مين لغى ومين وافق'), (r) => <span className="text-xs">{first(r.actorName)}<br /><ShieldCheck className="w-3 h-3 inline" /> <b>{first(r.approverName)}</b> {r.credentialKind ? <span className="text-dim">({t(CRED_AR[r.credentialKind] ?? '')})</span> : null}</span>),
            VC.text('reason', t('السبب'), (r) => r.reason, { maxChars: 28, className: 'text-soft' }),
            VC.money('value', t('القيمة'), (r) => r.value),
            VC.status('review', t('المراجعة'), (r) => ({ label: r.review?.state ?? 'PENDING' }), { cell: (r) => r.review?.state === 'PENDING' ? <Pill tone="warning" dot>{t('مستني')}</Pill> : r.review?.state === 'VERIFIED' ? <Pill tone="success" dot>{t('اتشاف')} · {first(r.reviewerName)}</Pill> : <Pill tone="error" dot>{t('مش موجود')} · {first(r.reviewerName)}</Pill> }),
            VC.actions('act', (r) => r.review?.state === 'PENDING' && canDecide ? <><Button size="sm" variant="success" onClick={() => setDec({ r, d: 'VERIFIED' })} data-fb={`void-review-ok:${r.orderNumber}`}><CheckCircle2 className="w-3.5 h-3.5" />{t('اتشاف')}</Button><Button size="sm" variant="danger" onClick={() => setDec({ r, d: 'MISSING' })} data-fb={`void-review-missing:${r.orderNumber}`}><XCircle className="w-3.5 h-3.5" />{t('مش موجود')}</Button></> : r.review?.note ? <span className="text-[11px] text-dim">{r.review.note}</span> : null),
          ]}
          empty={<EmptyState compact icon={<PackageSearch />} title={t('مفيش هالك مستني')} text={t('لما صنف يتلغى ويتسجل «هالك محفوظ للمراجعة» هيظهر هنا.')} />} />
      </Card>
      {dec && <DecideDialog r={dec.r} d={dec.d} onClose={() => setDec(null)} />}
    </div>
  );
}

function DecideDialog({ r, d, onClose }: { r: any; d: 'VERIFIED' | 'MISSING'; onClose: () => void }) {
  const { run, busy } = useCommand();
  const [note, setNote] = useState('');
  return (
    <Modal open onClose={onClose} title={d === 'VERIFIED' ? t('الصنف موجود ومتأكد') : t('الصنف مش موجود')} footer={<><Button variant="ghost" onClick={onClose}>{t('رجوع')}</Button><Button variant={d === 'VERIFIED' ? 'success' : 'danger'} loading={busy} disabled={d === 'MISSING' && !note.trim()} onClick={async () => { if (await run('VoidReview.Decide', { params: { reversalId: r.id }, body: { decision: d, note } }, { success: d === 'VERIFIED' ? t('اتسجل: الصنف اتشاف') : t('اتسجل: الصنف مش موجود — اتعمل تنبيه') })) onClose(); }} data-fb="void-review-confirm">{t('تأكيد')}</Button></>}>
      <div className="space-y-3">
        <KV rows={[[t('الصنف'), `${L(r.name)} ×${qty(r.quantity)}`], [t('الشيك'), `#${r.orderNumber}`], [t('مين لغى'), first(r.actorName)], [t('مين وافق'), first(r.approverName)], [t('القيمة'), money(r.value)]]} />
        {d === 'MISSING' && <Banner tone="error">{t('«مش موجود» بيعمل تنبيه وعلامة على المدير اللي وافق على الإلغاء.')}</Banner>}
        <Field label={d === 'MISSING' ? t('لقيت إيه؟ (مطلوب)') : t('ملاحظة (اختياري)')}><Textarea value={note} onChange={(e) => setNote(e.target.value)} data-fb="void-review-note" /></Field>
      </div>
    </Modal>
  );
}

function Flags({ flags }: { flags: any[] }) {
  return (
    <Card padding="sm">
      <Table head={[t('المدير / المسؤول'), t('مستني'), t('اتشاف'), t('مش موجود')]} align={['start', 'end', 'end', 'end']}
        rows={flags.map((f) => [<span className="font-bold">{first(f.name)}</span>, <span className="num">{f.pending}</span>, <span className="num">{f.verified}</span>, f.missing ? <Pill tone="error"><Flag className="w-3 h-3" /><span className="num">{f.missing}</span></Pill> : <span className="num text-dim">0</span>])}
        empty={<EmptyState compact icon={<Flag />} title={t('مفيش علامات')} text={t('العلامة بتظهر لما المحاسب يلاقي صنف هالك مش موجود.')} />} />
    </Card>
  );
}

/** Every removal at every stage — also used in the black box (Audit). */
export function ReversalTrace({ orderId }: { orderId?: string }) {
  const [stage, setStage] = useState<'ALL' | StageId>('ALL');
  const q = useQuery<any>('Reversal.Find', { query: { ...(orderId ? { orderId } : {}), limit: 500 } });
  const [sel, setSel] = useState<any>(null);
  const all: any[] = q.data?.items ?? [];
  const items = useMemo(() => (stage === 'ALL' ? all : all.filter((r) => r.stage === stage)), [all, stage]);
  const by = q.data?.byStage ?? {};
  const VC = cols<any>();
  return (
    <Card padding="sm">
      <Toolbar>
        <FilterChips value={stage} onChange={setStage} options={[{ id: 'ALL', label: t('كل المراحل'), count: all.length }, ...(['S0', 'S1', 'S2', 'S3'] as StageId[]).map((s) => ({ id: s, label: t(STAGE_TEXT[s].short), count: by[s]?.count ?? 0, tone: s === 'S3' ? 'error' as const : undefined }))]} />
      </Toolbar>
      <DataTable dense maxHeight={560} rows={items} rowKey={(r: any) => r.id} loading={q.loading && !q.data} onRowOpen={(r) => setSel(r)} label={t('الإلغاءات والمرتجعات بالمرحلة')} defaultSort={{ id: 'at', dir: 'desc' }}
        columns={[
          VC.date('at', t('الوقت'), (r) => r.at),
          VC.text('kind', t('الحركة'), (r) => t(KIND_AR[r.kind] ?? r.kind), { cell: (r) => <span className="text-xs font-bold">{t(KIND_AR[r.kind] ?? r.kind)}<span className="block num text-dim font-normal">#{r.orderNumber}</span></span> }),
          VC.text('item', t('الصنف'), (r) => L(r.name), { cell: (r) => <span className="text-sm">{L(r.name)} <span className="num text-dim">×{qty(r.quantity)}</span></span> }),
          VC.status('stage', t('المرحلة'), (r) => ({ label: t(STAGE_TEXT[r.stage as StageId]?.short ?? r.stage) }), { cell: (r) => <StagePill s={r.stage} /> }),
          VC.text('actor', t('مين عمل'), (r) => first(r.actorName), { maxChars: 16 }),
          VC.text('approver', t('مين وافق'), (r) => (r.approverName ? first(r.approverName) : null), { cell: (r) => r.approverName ? <span className="text-sm font-bold">{first(r.approverName)} <span className="text-[10px] text-dim font-normal">({t(CRED_AR[r.credentialKind] ?? '')})</span></span> : <span className="text-dim text-xs">{t('من غير موافقة')}</span> }),
          VC.text('device', t('الجهاز'), (r) => deviceName(r.terminalId), { maxChars: 16, className: 'text-dim' }),
          VC.money('value', t('القيمة'), (r) => r.value),
          VC.text('disp', t('الصنف راح فين'), (r) => (r.disposition ? t(DISPOSITION_TEXT[r.disposition as 'WASTE_HELD'].label) : null), { maxChars: 22 }),
        ]}
        empty={<EmptyState compact icon={<ListTree />} title={t('مفيش إلغاءات أو مرتجعات لسه')} text={t('أي شيل أو إلغاء أو مرتجع — في أي مرحلة — بيتسجل هنا.')} />} />
      {sel && (
        <Popup open onClose={() => setSel(null)} size="md" fb="void-review-popup" title={<span className="flex items-center gap-2 flex-wrap">{t(KIND_AR[sel.kind] ?? sel.kind)}<StagePill s={sel.stage} /></span>}>
          <KV rows={[
            [t('الشيك'), `#${sel.orderNumber}`], [t('الصنف'), `${L(sel.name)} ×${qty(sel.quantity)}`], [t('القيمة'), money(sel.value)],
            [t('مين عمل'), first(sel.actorName)], [t('مين وافق'), sel.approverName ? `${first(sel.approverName)} (${t(CRED_AR[sel.credentialKind] ?? '')})` : t('من غير موافقة')], [t('الجهاز'), deviceName(sel.terminalId)],
            ...(sel.drawerOwnerName ? [[t('الفلوس طلعت من درج'), first(sel.drawerOwnerName)] as [string, string]] : []),
            [t('اتسجل على يوم'), sel.businessDate], ...(sel.afterClose ? [[t('يوم البيع الأصلي'), sel.originalBusinessDate] as [string, string]] : []),
            [t('السبب'), sel.reason ?? '—'], [t('الصنف راح فين'), sel.disposition ? t(DISPOSITION_TEXT[sel.disposition as 'WASTE_HELD'].label) : '—'],
            ...(sel.review ? [[t('مراجعة المحاسب'), sel.review.state === 'PENDING' ? t('مستني') : sel.review.state === 'VERIFIED' ? t('اتشاف') : t('مش موجود')] as [string, string]] : []),
          ]} />
          <Tech><div className="num text-[10px] mt-3" dir="ltr">{JSON.stringify({ id: sel.id, grantId: sel.grantId, kind: sel.kind, stage: sel.stage, refundId: sel.refundId })}</div></Tech>
        </Popup>
      )}
    </Card>
  );
}
