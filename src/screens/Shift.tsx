// E1 Open shift, E2 cash moves and no-sale, E3 X report and close with blind count, variance, approval, Z report.
// Unpaid floor checks are listed as outstanding and never block the close.
import React, { useState } from 'react';
import { DoorOpen, ArrowDownToLine, ArrowUpFromLine, Vault, Inbox, FileText, Lock, HandCoins, Printer, AlertTriangle } from 'lucide-react';
import { useDev, useQuery, useCommand } from '../app/hooks';
import { Section, StateBadge, Card, Button, Field, Input, Select, Money, Banner, KV, Table, Modal, Pill, Tabs, Textarea } from '../ui';
import { t, L } from '../i18n';
import { money, time, dateTime } from '../lib/format';
import { useReasons } from './order/CheckPanel';
import { TransferSessionDialog } from './ops/TransferSessionDialog';
import { ArrowRightLeft } from 'lucide-react';

export default function Shift() {
  const { terminal } = useDev();
  const cur = useQuery<any>(terminal?.drawer ? 'Session.Current' : null, { query: { terminalId: terminal?.id } });
  const past = useQuery<any>('Session.Find', { query: { limit: 30 } });
  const [z, setZ] = useState<string | null>(null);
  return (
    <div data-screen="E1–E3" className="space-y-4">
      <Section title={t('الوردية والدرج')} badge={<StateBadge ops={['Session.Open', 'Cash.Move', 'Drawer.OpenNoSale', 'Session.XReport', 'Session.Close', 'Session.ZReport']} />} sub={terminal?.drawer ? `${terminal.code} · ${terminal.name}` : t('الجهاز ده من غير درج — تقارير الورديات بس')} />
      {terminal?.drawer && (cur.data ? <OpenSession sid={cur.data.id} onZ={setZ} /> : !cur.loading && <OpenShift />)}
      <Card title={t('الورديات')}>
        <Table head={[t('الجهاز'), t('الكاشير'), t('الحالة'), t('اليوم التجاري'), t('فتحت'), t('اتقفلت'), t('الفرق'), '']} rows={(past.data?.items ?? []).map((s: any) => [
          <span className="num">{s.terminalCode}</span>, s.cashierName, <Pill tone={s.state === 'OPEN' ? 'success' : 'neutral'}>{s.state === 'OPEN' ? t('مفتوحة') : t('مقفولة')}</Pill>, <span className="num">{s.businessDate}</span>, <span className="num text-xs">{dateTime(s.openedAt)}</span>, <span className="num text-xs">{dateTime(s.closedAt)}</span>,
          s.close ? <Money v={s.close.variance} tone={s.close.variance === '0.0000' ? 'success' : 'error'} /> : '—',
          s.state === 'CLOSED' && <Button size="sm" onClick={() => setZ(s.id)}><FileText className="w-3.5 h-3.5" />Z</Button>,
        ])} />
      </Card>
      {z && <ZDialog sid={z} onClose={() => setZ(null)} />}
    </div>
  );
}

function OpenShift() {
  const { terminal } = useDev();
  const { run, busy } = useCommand();
  const [float, setFloat] = useState('500.00');
  return (
    <Card title={<span className="flex items-center gap-2"><DoorOpen className="w-5 h-5" />{t('فتح وردية')}</span>} badge={<StateBadge ops={['Session.Open']} />}>
      <div className="flex items-end gap-3 flex-wrap">
        <Field label={t('رصيد الفكة الافتتاحي')}><Input value={float} onChange={(e) => setFloat(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" className="text-xl w-40" data-fb="opening-float" /></Field>
        <Button variant="primary" size="lg" loading={busy} onClick={() => run('Session.Open', { body: { terminalId: terminal!.id, openingFloat: float } }, { success: t('الوردية اتفتحت') })} data-fb="open-shift">{t('افتح الوردية')}</Button>
      </div>
      <div className="text-[11px] text-dim mt-2">{t('وردية واحدة مفتوحة لكل جهاز درج (SESSION_ALREADY_OPEN). شيكات الصالة ممكن تتحصل على أي درج مفتوح في الفرع.')}</div>
    </Card>
  );
}

function OpenSession({ sid, onZ }: { sid: string; onZ: (id: string) => void }) {
  const s = useQuery<any>('Session.Get', { params: { sessionId: sid } });
  const [dlg, setDlg] = useState<null | 'move' | 'nosale' | 'x' | 'close' | 'tips'>(null);
  const ses = s.data;
  if (!ses) return null;
  return (
    <>
      <Card title={<span className="flex items-center gap-2">{t('وردية مفتوحة')} <Pill tone="success">{ses.cashierName}</Pill></span>}>
        <div className="grid md:grid-cols-[1fr_auto] gap-4">
          <KV rows={[[t('من'), `${dateTime(ses.openedAt)} (${ses.hoursOpen} ${t('ساعة')})`], [t('الفكة'), <Money v={ses.openingFloat} />], [t('اليوم التجاري'), <span className="num">{ses.businessDate}</span>], [t('حركات الدرج'), ses.cashEntries.length]]} />
          <div className="grid grid-cols-3 gap-2">
            <Button onClick={() => setDlg('move')}><ArrowDownToLine className="w-4 h-4" />{t('إدخال / صرف')}</Button>
            <Button onClick={() => setDlg('nosale')}><Inbox className="w-4 h-4" />{t('فتح الدرج')}</Button>
            <Button onClick={() => setDlg('x')} data-fb="x-report"><FileText className="w-4 h-4" />{t('تقرير X')}</Button>
            <Button onClick={() => setDlg('tips')}><HandCoins className="w-4 h-4" />{t('البقشيش')} <StateBadge state="PROPOSED" /></Button>
            <Button variant="warning" className="col-span-2" onClick={() => setDlg('close')} data-fb="close-shift"><Lock className="w-4 h-4" />{t('قفل الوردية (عد الدرج)')}</Button>
          </div>
        </div>
        {ses.durationWarning && <Banner tone="warning"><AlertTriangle className="w-4 h-4 inline" /> {t('الوردية مفتوحة من وقت طويل (SessionDurationPolicy)')}</Banner>}
        <OpenOrders sid={ses.id} />
        <div className="mt-3">
          <Table head={[t('الوقت'), t('النوع'), t('المبلغ'), t('السبب'), t('المرجع')]} rows={ses.cashEntries.slice().reverse().map((e: any) => [<span className="num text-xs">{time(e.at)}</span>, kindLabel(e.kind), <Money v={e.amount} />, e.reasonCode ?? '', <span className="num text-xs">{e.ref ?? ''}{e.approvalGrantId ? ' · ✓' : ''}</span>])} />
        </div>
      </Card>
      {dlg === 'move' && <CashMoveDialog ses={ses} onClose={() => setDlg(null)} />}
      {dlg === 'nosale' && <NoSaleDialog ses={ses} onClose={() => setDlg(null)} />}
      {dlg === 'x' && <XDialog sid={sid} onClose={() => setDlg(null)} />}
      {dlg === 'close' && <CloseDialog ses={ses} onClose={() => setDlg(null)} onZ={onZ} />}
      {dlg === 'tips' && <TipsDialog ses={ses} onClose={() => setDlg(null)} />}
    </>
  );
}

const kindLabel = (k: string) => ({ OPENING_FLOAT: t('فكة افتتاحية'), TENDER_IN: t('تحصيل كاش'), REFUND_OUT: t('مرتجع كاش'), PAY_IN: t('إدخال'), PAY_OUT: t('صرف'), SAFE_DROP: t('إيداع الخزنة'), NO_SALE: t('فتح الدرج بدون بيع'), TIP_IN: t('بقشيش كاش'), TIP_OUT: t('توزيع بقشيش'), DEPOSIT_IN: t('عربون'), TENDER_CORRECTION_IN: t('تصحيح دفع (داخل)'), TENDER_CORRECTION_OUT: t('تصحيح دفع (خارج)') } as Record<string, string>)[k] ?? k;

function CashMoveDialog({ ses, onClose }: { ses: any; onClose: () => void }) {
  const { run, busy } = useCommand();
  const reasons = useReasons('CASH_MOVE');
  const [kind, setKind] = useState('PAY_OUT');
  const [amount, setAmount] = useState('');
  const [rc, setRc] = useState('');
  const [note, setNote] = useState('');
  return (
    <Modal open onClose={onClose} title={t('حركة نقدية')} badge={<StateBadge ops={['Cash.Move']} />} footer={<Button variant="primary" loading={busy} disabled={!amount || !rc} onClick={async () => { if (await run('Cash.Move', { params: { sessionId: ses.id }, body: { kind, amount, reasonCode: rc, reason: note || undefined, sourceType: 'MANUAL', sourceId: ses.id } }, { success: t('الحركة اتسجلت') })) onClose(); }}>{t('سجّل')}</Button>}>
      <div className="space-y-3">
        <Tabs value={kind} onChange={setKind} tabs={[{ id: 'PAY_IN', label: t('إدخال') }, { id: 'PAY_OUT', label: t('صرف') }, { id: 'SAFE_DROP', label: t('إيداع الخزنة') }]} />
        <Field label={t('المبلغ')}><Input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" /></Field>
        <Field label={t('السبب')}><Select value={rc} onChange={(e) => setRc(e.target.value)} options={[{ value: '', label: t('اختار') }, ...reasons.map((r) => ({ value: r.code, label: `${L(r.label)}${r.requiresNote ? ' *' : ''}` }))]} /></Field>
        <Field label={t('ملاحظة')}><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="text-[11px] text-dim">{t('الموافقة حسب CASH_MOVE (الافتراضي: أي مبلغ فوق 0.00 محتاج مدير).')}</div>
      </div>
    </Modal>
  );
}

function NoSaleDialog({ ses, onClose }: { ses: any; onClose: () => void }) {
  const { run, busy } = useCommand();
  const reasons = useReasons('NO_SALE');
  const [rc, setRc] = useState('');
  const [note, setNote] = useState('');
  return (
    <Modal open onClose={onClose} title={t('فتح الدرج بدون بيع')} badge={<StateBadge ops={['Drawer.OpenNoSale']} />} footer={<Button variant="primary" loading={busy} disabled={!rc} onClick={async () => { if (await run('Drawer.OpenNoSale', { params: { sessionId: ses.id }, body: { reasonCode: rc, reason: note || undefined } }, { success: t('الدرج اتفتح (اتسجل)') })) onClose(); }}>{t('افتح الدرج')}</Button>}>
      <div className="space-y-3">
        <Field label={t('السبب')}><Select value={rc} onChange={(e) => setRc(e.target.value)} options={[{ value: '', label: t('اختار') }, ...reasons.map((r) => ({ value: r.code, label: L(r.label) }))]} /></Field>
        <Field label={t('ملاحظة')}><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="text-[11px] text-dim">{t('مفيش فلوس بتتحرك، بس الفتحة بتتسجل في تقرير الاستثناءات. الموافقة حسب DRAWER_NO_SALE (الافتراضي: مش محتاجة).')}</div>
      </div>
    </Modal>
  );
}

export function ReportView({ r, z }: { r: any; z?: boolean }) {
  return (
    <div className="space-y-3 text-sm">
      <KV rows={[[t('الجهاز'), <span className="num">{r.terminalCode}</span>], [t('الكاشير'), r.cashierName], [t('اليوم التجاري'), <span className="num">{r.businessDate}</span>], [t('الفكة'), <Money v={r.openingFloat} />]]} />
      <div><b>{t('وسائل الدفع')}</b>{Object.keys(r.tenderBreakdown).length === 0 && <div className="text-dim text-xs">—</div>}{Object.entries(r.tenderBreakdown).map(([k, v]) => <div key={k} className="flex justify-between"><span>{k}</span><Money v={v as string} /></div>)}</div>
      {Object.keys(r.refundBreakdown ?? {}).length > 0 && <div><b>{t('المرتجعات')}</b>{Object.entries(r.refundBreakdown).map(([k, v]) => <div key={k} className="flex justify-between"><span>{k}</span><Money v={v as string} /></div>)}</div>}
      <div><b>{t('حركات الكاش')}</b>{Object.entries(r.cashByKind).map(([k, v]) => <div key={k} className="flex justify-between"><span>{kindLabel(k)}</span><Money v={v as string} /></div>)}</div>
      {r.tips && r.tips !== '0.0000' && <div className="flex justify-between"><span>{t('البقشيش (مش مبيعات)')}</span><Money v={r.tips} /></div>}
      <div className="border-t line pt-2 space-y-1">
        <div className="flex justify-between"><span>{t('الكاش المتوقع')}</span>{r.expectedCash !== undefined ? <Money v={r.expectedCash} /> : <Pill tone="neutral">{t('مخفي لحد العد (إقفال أعمى)')}</Pill>}</div>
        {z && <><div className="flex justify-between"><span>{t('المعدود')}</span><Money v={r.countedCash} /></div><div className="flex justify-between"><span>{t('الفرق')}</span><Money v={r.variance} tone={r.variance === '0.0000' ? 'success' : 'error'} /></div></>}
      </div>
      <div><b>{t('شيكات مفتوحة (مش بتمنع القفل)')}</b>{r.outstandingChecks.length === 0 ? <div className="text-dim text-xs">—</div> : r.outstandingChecks.map((o: any) => <div key={o.orderId} className="flex justify-between text-xs"><span>#{o.number} {o.table ? `· ${t('ترابيزة')} ${o.table}` : ''}</span><Money v={o.payable} /></div>)}</div>
      <div className="text-[11px] text-dim">{z ? t('تقرير Z متجمد وقت القفل.') : t('تقرير X لحظي ومؤقت.')} · {dateTime(r.snapshotAt)}</div>
    </div>
  );
}

function XDialog({ sid, onClose }: { sid: string; onClose: () => void }) {
  const x = useQuery<any>('Session.XReport', { params: { sessionId: sid } });
  const { run } = useCommand();
  const { auth } = useDev();
  return (
    <Modal open onClose={onClose} title={t('تقرير X')} badge={<StateBadge ops={['Session.XReport']} />} footer={<Button onClick={() => run('Print.Document', { body: { documentType: 'X_REPORT', documentId: sid, terminalId: auth.terminalId, label: 'X ' + sid } }, { success: t('اتبعت للطابعة') })}><Printer className="w-4 h-4" />{t('اطبع')}</Button>}>
      {x.data ? <ReportView r={x.data} /> : null}
    </Modal>
  );
}

function ZDialog({ sid, onClose }: { sid: string; onClose: () => void }) {
  const z = useQuery<any>('Session.ZReport', { params: { sessionId: sid } });
  return <Modal open onClose={onClose} title={t('تقرير Z')} badge={<StateBadge ops={['Session.ZReport']} />}>{z.data ? <ReportView r={z.data} z /> : z.error ? <Banner tone="error">{z.error.code}</Banner> : null}</Modal>;
}

function CloseDialog({ ses, onClose, onZ }: { ses: any; onClose: () => void; onZ: (id: string) => void }) {
  const { run, busy } = useCommand();
  const blind = useQuery<any>('Settings.Effective', { query: { policyId: 'BlindClosePolicy', scopeType: 'TENANT', scopeId: 'biz' } });
  const x = useQuery<any>('Session.XReport', { params: { sessionId: ses.id } });
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const close = async () => {
    const r = await run<any>('Session.Close', { params: { sessionId: ses.id }, body: { expectedVersion: ses.version, countedCash: counted, reason: note || undefined } }, { success: t('الوردية اتقفلت') });
    if (r) { onClose(); onZ(ses.id); }
  };
  return (
    <Modal open onClose={onClose} title={t('قفل الوردية')} badge={<StateBadge ops={['Session.Close', 'Approval.Grant']} />} footer={<Button variant="warning" loading={busy} disabled={!counted} onClick={close}>{t('اقفل')}</Button>}>
      <div className="space-y-3">
        {blind.data?.value !== false ? <Banner tone="info">{t('إقفال أعمى: اعد الدرج واكتب المبلغ من غير ما تشوف المتوقع (BlindClosePolicy). الفرق بيطلع من السيرفر بعد القفل.')}</Banner> : <Banner tone="warning">{t('الإقفال الأعمى مقفول: المتوقع')} {x.data?.expectedCash ? money(x.data.expectedCash) : '—'}</Banner>}
        <Field label={t('الكاش المعدود في الدرج')}><Input value={counted} onChange={(e) => setCounted(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" className="text-2xl" data-fb="counted-cash" /></Field>
        <Field label={t('ملاحظة (لو في فرق)')}><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <OpenOrders sid={ses.id} warn />
        <div className="text-[11px] text-dim">{t('الفرق فوق حد SESSION_VARIANCE بيطلب موافقة مدير. شيكات الصالة المأكدة والمش مدفوعة مش بتمنع القفل — بتظهر في Z كشيكات مفتوحة. طلبات التيك أواي المفتوحة على الوردية دي بتمنع (SESSION_HAS_OPEN_ORDERS).')}</div>
      </div>
    </Modal>
  );
}

function TipsDialog({ ses, onClose }: { ses: any; onClose: () => void }) {
  const { run, busy } = useCommand();
  const [res, setRes] = useState<any>(null);
  return (
    <Modal open onClose={onClose} title={t('توزيع البقشيش')} badge={<StateBadge ops={['Tip.Distribute']} />} footer={<Button variant="primary" loading={busy} onClick={async () => setRes(await run('Tip.Distribute', { params: { sessionId: ses.id }, body: {} }, { success: t('البقشيش اتوزع') }))}>{t('وزّع')}</Button>}>
      <div className="space-y-3 text-sm">
        <Banner tone="info">{t('البقشيش فلوس لوحدها مش مبيعات. TipPolicy لازم تكون ON (من لوحة الإعدادات) عشان يظهر في الدفع. التوزيع حسب TipDistributionPolicy (لكل ويتر أو صندوق مشترك).')}</Banner>
        {res && <div><b>{res.mode}</b> · {t('الإجمالي')} <Money v={res.total} />{res.lines.map((l: any) => <div key={l.userId} className="flex justify-between"><span>{l.name}</span><Money v={l.amount} /></div>)}</div>}
      </div>
    </Modal>
  );
}

/** Open checks that belong to this drawer (takeaway / counter). They must be paid, cancelled or handed over before closing. */
function OpenOrders({ sid, warn }: { sid: string; warn?: boolean }) {
  const q = useQuery<any>('Order.Find', { query: { sessionId: sid, lifecycle: 'DRAFT,CONFIRMED', limit: 50 } });
  const [move, setMove] = useState<any[] | null>(null);
  const list: any[] = (q.data?.items ?? []).filter((o: any) => o.sessionId === sid);
  if (!list.length) return null;
  return (
    <div className="mt-3 rounded-xl border p-3 space-y-2 border-[color-mix(in_srgb,var(--warning)_40%,transparent)] bg-[color-mix(in_srgb,var(--warning)_8%,transparent)]" data-fb="shift-open-orders">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-sm font-bold">{t('{n} شيك مفتوح على الدرج ده', { n: list.length })}{warn && <span className="text-xs font-normal text-dim"> — {t('لازم يتحصلوا أو يتلغوا أو يتنقلوا لدرج تاني قبل القفل')}</span>}</div>
        <Button size="sm" variant="outline" onClick={() => setMove(list)} data-fb="shift-transfer-all"><ArrowRightLeft className="w-3.5 h-3.5" />{t('انقلهم كلهم لدرج تاني')}</Button>
      </div>
      {list.map((o) => (
        <div key={o.id} className="flex items-center gap-2 text-sm px-2 py-1 rounded-lg surface-1">
          <span className="num font-bold">#{o.number}</span><span className="text-dim text-xs">{o.channel === 'TAKEAWAY' ? t('تيك أواي') : t('كاونتر')} · {o.serverName}</span>
          <span className="flex-1" /><Money v={o.totals?.payable} />
          <Button size="sm" variant="ghost" onClick={() => setMove([o])} data-fb={`shift-transfer:${o.number}`}><ArrowRightLeft className="w-3.5 h-3.5" /></Button>
        </div>
      ))}
      {move && <TransferSessionDialog orders={move} onClose={() => setMove(null)} />}
    </div>
  );
}
