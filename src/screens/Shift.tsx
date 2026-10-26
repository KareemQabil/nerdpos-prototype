// E1 Open shift, E2 cash moves and no-sale, E3 X report and close with a blind count by EGP notes and coins,
// variance explained in words, approval, Z report. Unpaid floor checks are listed as outstanding and never block the close.
import React, { useMemo, useState } from 'react';
import { DoorOpen, ArrowDownToLine, Inbox, FileText, Lock, HandCoins, Printer, AlertTriangle, ArrowRightLeft, Clock, Wallet, Receipt, Minus, Plus, CheckCircle2, Scale, History } from 'lucide-react';
import { useDev, useQuery, useCommand, errorText } from '../app/hooks';
import { PageHeader, StateBadge, Card, Button, Field, Input, Select, Money, Banner, KV, Table, Modal, Pill, Tabs, Textarea, Stepper, StatGrid, StatCard, EmptyState, Skeleton } from '../ui';
import { t, L } from '../i18n';
import { cn, money, time, dateTime } from '../lib/format';
import { useReasons } from './order/CheckPanel';
import { TransferSessionDialog } from './ops/TransferSessionDialog';
import { METHOD_AR } from './ops/BusinessDay';
import { deviceName, personName } from '../demo/people';
import { store } from '../mock/store';
import { Tech } from '../app/tech';

/** Egyptian notes and coins, in piasters (100 = 1 جنيه). */
const DENOMS: { p: number; label: string; coin?: boolean }[] = [
  { p: 20000, label: '200' }, { p: 10000, label: '100' }, { p: 5000, label: '50' }, { p: 2000, label: '20' }, { p: 1000, label: '10' }, { p: 500, label: '5' },
  { p: 100, label: '1', coin: true }, { p: 50, label: '0.50', coin: true }, { p: 25, label: '0.25', coin: true },
];
const fromPiasters = (p: number) => `${Math.floor(p / 100)}.${String(p % 100).padStart(2, '0')}`;

export default function Shift() {
  const { terminal, can } = useDev();
  const canZ = can('session:zreport');
  const cur = useQuery<any>(terminal?.drawer ? 'Session.Current' : null, { query: { terminalId: terminal?.id } });
  const past = useQuery<any>('Session.Find', { query: { limit: 30 } });
  const [z, setZ] = useState<string | null>(null);
  const open = !!cur.data;
  return (
    <div data-screen="E1–E3" className="space-y-4">
      <PageHeader title={t('الوردية والدرج')} ops={['Session.Open', 'Cash.Move', 'Drawer.OpenNoSale', 'Session.XReport', 'Session.Close', 'Session.ZReport']}
        description={terminal?.drawer ? t('افتح الوردية بالفلوس اللي في الدرج، اشتغل، وفي الآخر اعد الدرج واقفل.') : t('الجهاز ده من غير درج — هنا تقدر تشوف تقارير الورديات بس.')} />
      {terminal?.drawer && (
        <Card padding="md">
          <Stepper steps={[{ label: t('افتح الوردية'), hint: t('الفكة أول اليوم') }, { label: t('اشتغل'), hint: t('بيع وتحصيل') }, { label: t('اعد الدرج'), hint: t('بالفئات') }, { label: t('اقفل'), hint: t('تقرير القفلة') }]} current={open ? 1 : 0} />
        </Card>
      )}
      {terminal?.drawer && (cur.loading && !cur.data ? <Skeleton className="h-48 rounded-2xl" /> : open ? <OpenSession sid={cur.data.id} onZ={(id) => (canZ ? setZ(id) : undefined)} /> : <OpenShift />)}
      <Card title={<span className="flex items-center gap-2"><History className="w-4 h-4" />{t('الورديات')}</span>} padding="none">
        <Table align={['start', 'start', 'start', 'start', 'start', 'end', 'end']} loading={past.loading} maxHeight={420}
          head={[t('الجهاز'), t('الكاشير'), t('الحالة'), t('فتحت'), t('اتقفلت'), t('فرق العد'), '']}
          rows={(past.data?.items ?? []).map((s: any) => [
            deviceName(s.terminalId), personName(null, s.cashierName), <Pill tone={s.state === 'OPEN' ? 'success' : 'neutral'} dot>{s.state === 'OPEN' ? t('مفتوحة') : t('مقفولة')}</Pill>, <span className="num text-xs">{dateTime(s.openedAt)}</span>, <span className="num text-xs">{s.closedAt ? dateTime(s.closedAt) : '—'}</span>,
            s.close ? <VarianceText v={s.close.variance} short /> : <span className="text-dim">—</span>,
            s.state === 'CLOSED' && canZ ? <Button size="sm" variant="ghost" onClick={() => setZ(s.id)} data-fb={`z-open:${s.id}`}><FileText className="w-3.5 h-3.5" />{t('تقرير القفلة')}</Button> : null,
          ])} empty={<EmptyState compact icon={<Clock />} title={t('لسه مفيش ورديات')} text={t('أول وردية هتظهر هنا بعد ما تتفتح.')} />} />
      </Card>
      {z && <ZDialog sid={z} onClose={() => setZ(null)} />}
    </div>
  );
}

/** Variance in words: «مظبوط» / «ناقص 20 جنيه» / «زيادة 5 جنيه». */
function VarianceText({ v, short }: { v: string; short?: boolean }) {
  const n = Number(v);
  if (n === 0) return <span className="text-[var(--success)] font-bold inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" />{t('مظبوط')}</span>;
  const amt = money(String(Math.abs(n)));
  return <span className={cn('font-bold', n < 0 ? 'text-[var(--error)]' : 'text-[var(--warning-text)]')}>{n < 0 ? t('ناقص') : t('زيادة')} <span className="num">{amt}</span>{!short && <span className="text-dim font-normal text-xs"> {n < 0 ? t('— الدرج فيه أقل من المفروض') : t('— الدرج فيه أكتر من المفروض')}</span>}</span>;
}

function OpenShift() {
  const { terminal } = useDev();
  const { run, busy } = useCommand();
  const [float, setFloat] = useState('500.00');
  return (
    <Card title={<span className="flex items-center gap-2"><DoorOpen className="w-5 h-5 text-[var(--primary)]" />{t('افتح وردية جديدة')}</span>} badge={<StateBadge ops={['Session.Open']} />} description={t('اعد الفكة اللي في الدرج واكتبها — دي بتبقى نقطة البداية لعد آخر الوردية.')}>
      <div className="flex items-end gap-3 flex-wrap">
        <Field label={t('الفكة في الدرج (جنيه)')}><Input value={float} onChange={(e) => setFloat(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" className="w-44 h-14" style={{ fontSize: 24 }} data-fb="opening-float" /></Field>
        <div className="flex gap-1.5 pb-1">{['300.00', '500.00', '1000.00'].map((v) => <button key={v} onClick={() => setFloat(v)} className={cn('h-12 px-4 rounded-xl border font-bold num', float === v ? 'bg-[var(--primary)] text-[var(--primary-foreground)] border-transparent' : 'surface-1 border-[var(--glass-border)]')}>{v.replace('.00', '')}</button>)}</div>
        <Button variant="primary" size="xl" loading={busy} onClick={() => run('Session.Open', { body: { terminalId: terminal!.id, openingFloat: float } }, { success: t('الوردية اتفتحت — بالتوفيق') })} data-fb="open-shift"><DoorOpen className="w-5 h-5" />{t('افتح الوردية')}</Button>
      </div>
      <div className="text-[11px] text-dim mt-3">{t('على كل جهاز درج وردية واحدة مفتوحة بس. شيكات الصالة ممكن تتحصّل على أي درج مفتوح في الفرع.')}</div>
    </Card>
  );
}

function OpenSession({ sid, onZ }: { sid: string; onZ: (id: string) => void }) {
  const s = useQuery<any>('Session.Get', { params: { sessionId: sid } });
  const [dlg, setDlg] = useState<null | 'move' | 'nosale' | 'x' | 'close' | 'tips'>(null);
  const ses = s.data;
  if (!ses) return <Skeleton className="h-48 rounded-2xl" />;
  const cashIn = ses.cashEntries.filter((e: any) => e.kind === 'TENDER_IN').reduce((a: number, e: any) => a + Number(e.amount), 0);
  return (
    <>
      <StatGrid min={170}>
        <StatCard label={t('الكاشير')} value={<span className="text-lg">{personName(null, ses.cashierName)}</span>} hint={t('من {h} · {n} ساعة', { h: time(ses.openedAt), n: ses.hoursOpen })} icon={<Clock />} />
        <StatCard label={t('الفكة أول الوردية')} value={<Money v={ses.openingFloat} />} icon={<Wallet />} />
        <StatCard label={t('كاش اتحصّل')} value={<Money v={String(cashIn)} />} tone="success" icon={<Receipt />} hint={t('من الشيكات على الدرج ده')} />
        <StatCard label={t('حركات الدرج')} value={<span className="num">{ses.cashEntries.length}</span>} icon={<ArrowDownToLine />} hint={t('إدخال وصرف وتحصيل')} />
      </StatGrid>
      {ses.durationWarning && <Banner tone="warning" title={t('الوردية مفتوحة من وقت طويل')}>{t('اقفلها واعد الدرج، وافتح وردية جديدة.')}</Banner>}
      <Card title={t('أثناء الوردية')} actions={<Button variant="warning" size="lg" onClick={() => setDlg('close')} data-fb="close-shift"><Lock className="w-4 h-4" />{t('اعد الدرج واقفل')}</Button>}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Tile icon={<ArrowDownToLine />} label={t('إدخال / صرف فلوس')} onClick={() => setDlg('move')} fb="cash-move-open" />
          <Tile icon={<Inbox />} label={t('فتح الدرج من غير بيع')} onClick={() => setDlg('nosale')} fb="nosale-open" />
          <Tile icon={<FileText />} label={t('تقرير نص الوردية (X)')} onClick={() => setDlg('x')} fb="x-report" />
          <Tile icon={<HandCoins />} label={t('توزيع البقشيش')} onClick={() => setDlg('tips')} proposed fb="tips-open" />
        </div>
        <OpenOrders sid={ses.id} />
        <div className="mt-4">
          <div className="text-sm font-bold mb-2">{t('حركات الدرج')}</div>
          <Table maxHeight={320} dense align={['start', 'start', 'end', 'start', 'start']} head={[t('الوقت'), t('النوع'), t('المبلغ'), t('السبب'), '']} rows={ses.cashEntries.slice().reverse().map((e: any) => [<span className="num text-xs">{time(e.at)}</span>, kindLabel(e.kind), <Money v={e.amount} tone={OUT_KINDS.has(e.kind) ? 'error' : undefined} />, e.reasonCode ? (L(store.db.reasonCodes.find((x) => x.code === e.reasonCode)?.label) || e.reason || '') : (e.reason ?? ''), <span className="text-xs text-dim">{e.approvalGrantId ? t('بموافقة مدير') : ''}<Tech><span className="num"> {e.ref ?? ''}</span></Tech></span>])} empty={t('لسه مفيش حركات')} />
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

function Tile({ icon, label, onClick, proposed, fb }: { icon: React.ReactNode; label: string; onClick: () => void; proposed?: boolean; fb?: string }) {
  return (
    <button onClick={onClick} data-fb={fb} className="relative min-h-[76px] rounded-2xl border border-[var(--glass-border)] surface-1 hover:bg-[var(--surface-2)] flex flex-col items-center justify-center gap-1.5 px-2 text-sm font-bold text-center [&>svg]:w-5 [&>svg]:h-5 [&>svg]:text-[var(--primary)]">
      {icon}<span className="leading-tight">{label}</span>
      {proposed && <span className="absolute top-2 end-2 w-1.5 h-1.5 rounded-full" style={{ background: 'var(--violet)' }} title={t('مقترح')} />}
    </button>
  );
}

const OUT_KINDS = new Set(['REFUND_OUT', 'PAY_OUT', 'SAFE_DROP', 'TIP_OUT', 'TENDER_CORRECTION_OUT']);
const kindLabel = (k: string) => ({ OPENING_FLOAT: t('فكة أول الوردية'), TENDER_IN: t('تحصيل كاش'), REFUND_OUT: t('مرتجع كاش'), PAY_IN: t('إدخال'), PAY_OUT: t('صرف'), SAFE_DROP: t('إيداع في الخزنة'), NO_SALE: t('فتح الدرج من غير بيع'), TIP_IN: t('بقشيش كاش'), TIP_OUT: t('توزيع بقشيش'), DEPOSIT_IN: t('عربون'), TENDER_CORRECTION_IN: t('تصحيح دفع (داخل)'), TENDER_CORRECTION_OUT: t('تصحيح دفع (خارج)') } as Record<string, string>)[k] ?? t('حركة تانية');

function CashMoveDialog({ ses, onClose }: { ses: any; onClose: () => void }) {
  const { run, busy } = useCommand();
  const reasons = useReasons('CASH_MOVE');
  const [kind, setKind] = useState('PAY_OUT');
  const [amount, setAmount] = useState('');
  const [rc, setRc] = useState('');
  const [note, setNote] = useState('');
  return (
    <Modal open onClose={onClose} title={t('إدخال أو صرف فلوس من الدرج')} badge={<StateBadge ops={['Cash.Move']} />} footer={<><Button variant="ghost" onClick={onClose}>{t('رجوع')}</Button><Button variant="primary" loading={busy} disabled={!amount || !rc} onClick={async () => { if (await run('Cash.Move', { params: { sessionId: ses.id }, body: { kind, amount, reasonCode: rc, reason: note || undefined, sourceType: 'MANUAL', sourceId: ses.id } }, { success: t('الحركة اتسجلت') })) onClose(); }}>{t('سجّل')}</Button></>}>
      <div className="space-y-4">
        <Tabs value={kind} onChange={setKind} tabs={[{ id: 'PAY_IN', label: t('إدخال') }, { id: 'PAY_OUT', label: t('صرف') }, { id: 'SAFE_DROP', label: t('إيداع في الخزنة') }]} />
        <Field label={t('المبلغ (جنيه)')}><Input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" className="h-12" style={{ fontSize: 20 }} /></Field>
        <Field label={t('السبب')}><Select value={rc} onChange={(e) => setRc(e.target.value)} options={[{ value: '', label: t('اختار السبب') }, ...reasons.map((r) => ({ value: r.code, label: `${L(r.label)}${r.requiresNote ? ' *' : ''}` }))]} /></Field>
        <Field label={t('ملاحظة')}><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="text-[11px] text-dim">{t('أي فلوس بتخرج من الدرج ممكن تحتاج موافقة مدير (حسب إعدادات الموافقات).')}</div>
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
    <Modal open onClose={onClose} title={t('فتح الدرج من غير بيع')} badge={<StateBadge ops={['Drawer.OpenNoSale']} />} footer={<><Button variant="ghost" onClick={onClose}>{t('رجوع')}</Button><Button variant="primary" loading={busy} disabled={!rc} onClick={async () => { if (await run('Drawer.OpenNoSale', { params: { sessionId: ses.id }, body: { reasonCode: rc, reason: note || undefined } }, { success: t('الدرج اتفتح واتسجل') })) onClose(); }}>{t('افتح الدرج')}</Button></>}>
      <div className="space-y-4">
        <Field label={t('السبب')}><Select value={rc} onChange={(e) => setRc(e.target.value)} options={[{ value: '', label: t('اختار السبب') }, ...reasons.map((r) => ({ value: r.code, label: L(r.label) }))]} /></Field>
        <Field label={t('ملاحظة')}><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="text-[11px] text-dim">{t('مفيش فلوس بتتحرك، بس الفتحة بتتسجل في تقرير الاستثناءات.')}</div>
      </div>
    </Modal>
  );
}

export function ReportView({ r, z }: { r: any; z?: boolean }) {
  const sec = (title: string, rows: [React.ReactNode, React.ReactNode][]) => (
    <div className="rounded-xl surface-1 border line p-3"><div className="text-xs font-bold text-soft mb-1.5">{title}</div>{rows.length ? <div className="space-y-1">{rows.map(([k, v], i) => <div key={i} className="flex justify-between gap-2"><span>{k}</span>{v}</div>)}</div> : <div className="text-dim text-xs">{t('مفيش')}</div>}</div>
  );
  return (
    <div className="space-y-3 text-sm">
      <KV rows={[[t('الجهاز'), deviceName(r.terminalCode)], [t('الكاشير'), personName(null, r.cashierName)], [t('اليوم'), <span className="num">{r.businessDate}</span>], [t('الفكة أول الوردية'), <Money v={r.openingFloat} />]]} />
      <div className="grid sm:grid-cols-2 gap-2">
        {sec(t('الفلوس حسب طريقة الدفع'), Object.entries(r.tenderBreakdown).map(([k, v]) => [t(METHOD_AR[k] ?? 'طريقة تانية'), <Money v={v as string} />]))}
        {sec(t('حركات الكاش'), Object.entries(r.cashByKind).map(([k, v]) => [kindLabel(k), <Money v={v as string} />]))}
        {Object.keys(r.refundBreakdown ?? {}).length > 0 && sec(t('المرتجعات'), Object.entries(r.refundBreakdown).map(([k, v]) => [t(METHOD_AR[k] ?? 'طريقة تانية'), <Money v={v as string} />]))}
        {r.tips && r.tips !== '0.0000' && sec(t('البقشيش (مش مبيعات)'), [[t('الإجمالي'), <Money v={r.tips} />]])}
      </div>
      <div className="rounded-xl border-2 border-[var(--glass-border)] p-3 space-y-1.5">
        <div className="flex justify-between"><span>{t('الكاش المفروض في الدرج')}</span>{r.expectedCash !== undefined ? <Money v={r.expectedCash} /> : <Pill tone="neutral">{t('مخفي لحد ما تعد (عد أعمى)')}</Pill>}</div>
        {z && <><div className="flex justify-between"><span>{t('اللي اتعد فعلًا')}</span><Money v={r.countedCash} /></div><div className="flex justify-between items-center border-t line pt-1.5"><span className="font-bold flex items-center gap-1"><Scale className="w-4 h-4" />{t('الفرق')}</span><VarianceText v={r.variance} /></div></>}
      </div>
      <div className="rounded-xl surface-1 border line p-3"><div className="text-xs font-bold text-soft mb-1.5">{t('شيكات لسه مفتوحة (مش بتمنع القفل)')}</div>{r.outstandingChecks.length === 0 ? <div className="text-dim text-xs">{t('مفيش')}</div> : r.outstandingChecks.map((o: any) => <div key={o.orderId} className="flex justify-between text-xs"><span><span className="num">#{o.number}</span> {o.table ? `· ${t('ترابيزة')} ${o.table}` : ''}</span><Money v={o.payable} /></div>)}</div>
      <div className="text-[11px] text-dim">{z ? t('تقرير القفلة متثبت وقت القفل ومش بيتغير.') : t('تقرير نص الوردية لحظي — الأرقام بتتغير مع الشغل.')} · <span className="num">{dateTime(r.snapshotAt)}</span></div>
    </div>
  );
}

function XDialog({ sid, onClose }: { sid: string; onClose: () => void }) {
  const x = useQuery<any>('Session.XReport', { params: { sessionId: sid } });
  const { run } = useCommand();
  const { auth } = useDev();
  return (
    <Modal open onClose={onClose} wide title={t('تقرير نص الوردية (X)')} badge={<StateBadge ops={['Session.XReport']} />} footer={<><Button variant="ghost" onClick={onClose}>{t('إغلاق')}</Button><Button onClick={() => run('Print.Document', { body: { documentType: 'X_REPORT', documentId: sid, terminalId: auth.terminalId, label: 'X ' + sid } }, { success: t('اتبعت للطابعة') })}><Printer className="w-4 h-4" />{t('اطبع')}</Button></>}>
      {x.data ? <ReportView r={x.data} /> : <Skeleton lines={8} />}
    </Modal>
  );
}

function ZDialog({ sid, onClose }: { sid: string; onClose: () => void }) {
  const z = useQuery<any>('Session.ZReport', { params: { sessionId: sid } });
  return <Modal open onClose={onClose} wide title={t('تقرير قفلة الوردية (Z)')} badge={<StateBadge ops={['Session.ZReport']} />}>{z.data ? <ReportView r={z.data} z /> : z.error ? <Banner tone="error">{errorText(z.error)}</Banner> : <Skeleton lines={8} />}</Modal>;
}

/** Count the drawer by EGP notes and coins (or type the total), blind by default; variance comes from the server. */
function CloseDialog({ ses, onClose, onZ }: { ses: any; onClose: () => void; onZ: (id: string) => void }) {
  const { run, busy } = useCommand();
  const blind = useQuery<any>('Settings.Effective', { query: { policyId: 'BlindClosePolicy', scopeType: 'TENANT', scopeId: 'biz' } });
  const x = useQuery<any>('Session.XReport', { params: { sessionId: ses.id } });
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [typed, setTyped] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const totalP = useMemo(() => DENOMS.reduce((a, d) => a + d.p * (counts[d.p] ?? 0), 0), [counts]);
  const counted = typed ?? (totalP ? fromPiasters(totalP) : '');
  const setCount = (p: number, n: number) => { setTyped(null); setCounts((c) => ({ ...c, [p]: Math.max(0, n) })); };
  const isBlind = blind.data?.value !== false;
  const close = async () => {
    const r = await run<any>('Session.Close', { params: { sessionId: ses.id }, body: { expectedVersion: ses.version, countedCash: counted, reason: note || undefined } }, { success: t('الوردية اتقفلت') });
    if (r) { onClose(); onZ(ses.id); }
  };
  return (
    <Modal open onClose={onClose} size="xl" title={t('اعد الدرج واقفل الوردية')} badge={<StateBadge ops={['Session.Close', 'Approval.Grant']} />}
      description={isBlind ? t('عد أعمى: اعد الفلوس اللي في الدرج من غير ما تشوف المفروض. الفرق بيظهر بعد القفل.') : undefined}
      footer={<><div className="me-auto text-sm">{t('اللي اتعد')}: <b className="num text-lg">{counted ? money(counted) : '—'}</b></div><Button variant="ghost" onClick={onClose}>{t('رجوع')}</Button><Button variant="warning" size="lg" loading={busy} disabled={!counted} onClick={close} data-fb="close-shift-confirm"><Lock className="w-4 h-4" />{t('اقفل الوردية')}</Button></>}>
      <div className="grid lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-5">
        <div>
          <div className="text-sm font-bold mb-2">{t('عدّ بالفئات')}</div>
          <div className="space-y-1.5" data-fb="denoms">
            {DENOMS.map((d) => {
              const n = counts[d.p] ?? 0;
              return (
                <div key={d.p} className={cn('flex items-center gap-2 rounded-xl border px-2 py-1.5', n ? 'border-[color-mix(in_srgb,var(--primary)_35%,transparent)] bg-[var(--primary-container)]' : 'surface-1 border-transparent')} data-fb={`denom:${d.label}`}>
                  <span className={cn('w-16 h-9 flex items-center justify-center font-extrabold num text-sm shrink-0', d.coin ? 'rounded-full bg-[color-mix(in_srgb,var(--warning)_18%,transparent)] text-[var(--warning-text)] w-9' : 'rounded-md bg-[color-mix(in_srgb,var(--success)_15%,transparent)] text-[var(--success)]')}>{d.label}</span>
                  <span className="text-xs text-dim w-14 shrink-0">{d.coin ? t('عملة') : t('ورقة')}</span>
                  <button onClick={() => setCount(d.p, n - 1)} disabled={!n} className="w-10 h-10 rounded-lg surface-2 flex items-center justify-center disabled:opacity-30" aria-label={t('أقل')} data-fb={`denom-minus:${d.label}`}><Minus className="w-4 h-4" /></button>
                  <input value={n || ''} onChange={(e) => setCount(d.p, Number(e.target.value.replace(/\D/g, '') || 0))} inputMode="numeric" placeholder="0" className="num w-14 h-10 text-center rounded-lg glass-input !p-0 font-bold" style={{ fontSize: 18 }} aria-label={t('عدد {d}', { d: d.label })} />
                  <button onClick={() => setCount(d.p, n + 1)} className="w-10 h-10 rounded-lg surface-2 flex items-center justify-center" aria-label={t('أكتر')} data-fb={`denom-plus:${d.label}`}><Plus className="w-4 h-4" /></button>
                  <span className="flex-1 text-end num font-bold text-sm">{n ? money(fromPiasters(d.p * n)) : ''}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="space-y-4">
          <div className="rounded-2xl p-4 text-center border border-[color-mix(in_srgb,var(--primary)_30%,transparent)] bg-[var(--primary-container)]">
            <div className="text-sm text-soft font-bold">{t('إجمالي اللي اتعد')}</div>
            <div className="num font-extrabold text-[var(--primary)]" style={{ fontSize: 40, lineHeight: 1.1 }}>{counted ? money(counted) : '0.00'}</div>
          </div>
          <Field label={t('أو اكتب المبلغ على طول')}><Input value={counted} onChange={(e) => setTyped(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" className="h-12" style={{ fontSize: 20 }} data-fb="counted-cash" /></Field>
          {!isBlind && <Banner tone="info">{t('المفروض في الدرج')}: <b className="num">{x.data?.expectedCash ? money(x.data.expectedCash) : '—'}</b></Banner>}
          <Field label={t('ملاحظة (لو فيه فرق)')}><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('مثلًا: دفعت 20 جنيه مواصلات للطيار')} /></Field>
          <OpenOrders sid={ses.id} warn />
          <p className="text-[11px] text-dim leading-relaxed">{t('لو فيه فرق في العد لازم مدير يوافق. شيكات الصالة اللي لسه ما اتدفعتش مش بتمنع القفل وبتظهر في التقرير. طلبات التيك أواي المفتوحة على الدرج ده لازم تتحصّل أو تتنقل لدرج تاني الأول.')}</p>
        </div>
      </div>
    </Modal>
  );
}

function TipsDialog({ ses, onClose }: { ses: any; onClose: () => void }) {
  const { run, busy } = useCommand();
  const [res, setRes] = useState<any>(null);
  return (
    <Modal open onClose={onClose} title={t('توزيع البقشيش')} badge={<StateBadge ops={['Tip.Distribute']} />} footer={<><Button variant="ghost" onClick={onClose}>{t('إغلاق')}</Button><Button variant="primary" loading={busy} onClick={async () => setRes(await run('Tip.Distribute', { params: { sessionId: ses.id }, body: {} }, { success: t('البقشيش اتوزع') }))}>{t('وزّع')}</Button></>}>
      <div className="space-y-3 text-sm">
        <p className="text-dim">{t('البقشيش فلوس لوحدها مش مبيعات. بيتوزع حسب الإعدادات: كل ويتر بتاعه، أو صندوق مشترك بيتقسم على الكل.')}</p>
        {res && <div className="rounded-xl surface-1 border line p-3 space-y-1"><div className="font-bold flex justify-between">{res.mode === 'POOLED' ? t('صندوق مشترك') : t('كل ويتر بتاعه')}<Money v={res.total} /></div>{res.lines.map((l: any) => <div key={l.userId} className="flex justify-between"><span>{personName(null, l.name)}</span><Money v={l.amount} /></div>)}</div>}
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
        <div className="text-sm font-bold flex items-center gap-1.5"><AlertTriangle className="w-4 h-4 text-[var(--warning)]" />{t('{n} شيك مفتوح على الدرج ده', { n: list.length })}{warn && <span className="text-xs font-normal text-dim"> — {t('لازم يتحصّلوا أو يتلغوا أو يتنقلوا لدرج تاني قبل القفل')}</span>}</div>
        <Button size="sm" variant="outline" onClick={() => setMove(list)} data-fb="shift-transfer-all"><ArrowRightLeft className="w-3.5 h-3.5" />{t('انقلهم كلهم لدرج تاني')}</Button>
      </div>
      {list.map((o) => (
        <div key={o.id} className="flex items-center gap-2 text-sm px-2 py-1 rounded-lg surface-1">
          <span className="num font-bold">#{o.number}</span><span className="text-dim text-xs">{o.channel === 'TAKEAWAY' ? t('تيك أواي') : o.channel === 'DELIVERY' ? t('دليفري') : t('كاونتر')} · {personName(null, o.serverName)}</span>
          <span className="flex-1" /><Money v={o.totals?.payable} />
          <Button size="sm" variant="ghost" onClick={() => setMove([o])} data-fb={`shift-transfer:${o.number}`} title={t('انقل لدرج تاني')} aria-label={t('انقل لدرج تاني')}><ArrowRightLeft className="w-3.5 h-3.5" /></Button>
        </div>
      ))}
      {move && <TransferSessionDialog orders={move} onClose={() => setMove(null)} />}
    </div>
  );
}
