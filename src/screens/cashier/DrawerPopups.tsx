// ux-10: the drawer's work as popups over the sale screen — open the shift with the opening float, cash in / out
// (and safe drop), open the drawer without a sale (reason), the X report and the blind count by denomination that
// closes the shift. Opening and closing never leave the sale screen (`counter`). The shared Numpad enters every amount
// and count; the physical keyboard types the same keys (useNumpadKeys). Reached from «المزيد» → «الوردية والدرج»,
// the header's shift chip, the no-shift call to action and the profile's keys (drawerBus). The same server commands
// and approval rules as before: Session.Open, Cash.Move, Drawer.OpenNoSale, Session.XReport, Session.Close
// (SESSION_VARIANCE approval), Tip.Distribute. The expected cash is never shown before the count is confirmed.
import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Inbox, FileText, Lock, HandCoins, Printer, AlertTriangle, ArrowRightLeft, DoorOpen, Minus, Plus, Clock, Wallet, ShieldCheck, Landmark, RotateCcw, Repeat } from 'lucide-react';
import { useDev, useQuery, useCommand } from '../../app/hooks';
import { Popup, Button, Money, Numpad, applyNumpadKey, useNumpadKeys, Kbd, Pill, Input, Skeleton, SegmentedControl, StateBadge, DateTime, EmptyState, type NumpadKey } from '../../ui';
import { t, L, tv } from '../../i18n';
import { cn } from '../../lib/format';
import { useReasons } from '../order/CheckPanel';
import { TransferSessionDialog } from '../ops/TransferSessionDialog';
import { personName, personText } from '../../demo/people';
import { store } from '../../mock/store';
import { approvalRule, policy, policyFields, reasonMinLength } from '../../mock/policies';
import { handoverRules, recountMode } from '../../mock/drawer-count'; // ux-10b: the handover mode, the recount rule (the server enforces both)
import { HandoverAcceptPopup, HandoverCancelPopup } from './HandoverPopups';
import { Tech } from '../../app/tech';
import { useProfile } from '../../app/useProfile';
import { useHotkeys, useKeymap, keyLabel, type KeyAction } from '../../app/keymap';
import { drawerBus, type DrawerJob } from '../../app/drawerBus';
import { plainAmount, sign, changePreview } from '../../lib/cash';
import { useBlindCount, CountBoard, enterOr } from './CountBoard';
import { DENOMS, fromPiasters, OUT_KINDS, kindLabel, ReportView, VarianceText, ZPopup } from './ShiftReport';

type MoveKind = 'PAY_IN' | 'PAY_OUT' | 'SAFE_DROP';
type Job = Exclude<DrawerJob, 'cashIn' | 'cashOut'> | 'move' | 'z';
/** ux-10b: the handover being accepted / cancelled, kept while the session changes under it (the result stays on screen). */
type Hand = { sid: string; handover: any };

/** A count confirmed by the cashier stays confirmed on this device until the shift closes (no recount after the
 *  approval popup has shown the variance). Memory only, per session. */
const confirmed = new Map<string, { counted: string; note: string }>();

/** Whether this person works the drawer on this device (profile + device). Permissions stay with the server. */
export function useDrawerOn() {
  const { terminal } = useDev();
  const profile = useProfile();
  return !!terminal?.drawer && !profile.hidden.includes('drawer');
}

/**
 * Lives on the sale screen (with or without an open shift) and owns the drawer popups: takes requests from drawerBus
 * and runs the drawer keys of the profile's map. A closing count stays on screen after the shift is closed.
 */
export function DrawerHost({ session, pending = null }: { session: any | null; pending?: any | null }) {
  const { id: deviceId } = useDev();
  const profile = useProfile();
  const on = useDrawerOn();
  const [job, setJob] = useState<Job | null>(null);
  const [kind, setKind] = useState<MoveKind>('PAY_IN');
  const [countSid, setCountSid] = useState<string | null>(null);
  const [zSid, setZSid] = useState<string | null>(null);
  const [fromHub, setFromHub] = useState(false); // a job picked in the shift popup returns there; a key returns to the sale
  const [hand, setHand] = useState<Hand | null>(null);
  const waiting = useSyncExternalStore(drawerBus.subscribe, () => drawerBus.peek(deviceId));
  const open = (j: DrawerJob, viaHub = false) => {
    if (!on) return;
    setFromHub(viaHub);
    // ux-10b: a drawer waiting for its handover: only accepting it or cancelling it
    if (pending) { if ((j === 'handoverAccept' || j === 'handoverCancel') && pending.handover) { setHand({ sid: pending.id, handover: pending.handover }); setJob(j); } return; }
    if (j === 'handoverAccept' || j === 'handoverCancel') return;
    if (!session) { setJob('open'); return; }
    if (j === 'handover' && handoverRules(session.branchId ?? null).mode === 'FULL_CLOSE') return;
    if (j === 'open' || j === 'hub') return setJob('hub');
    if (j === 'cashIn' || j === 'cashOut') { setKind(j === 'cashIn' ? 'PAY_IN' : 'PAY_OUT'); return setJob('move'); }
    if (j === 'count') setCountSid(session.id);
    setJob(j);
  };
  useEffect(() => { if (waiting) { const j = drawerBus.take(deviceId); if (j) open(j); } }, [waiting, session?.id, pending?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useHotkeys(deviceId, on && !job && !pending, {
    drawer: () => open('hub'), cashIn: () => open('cashIn'), cashOut: () => open('cashOut'), noSale: () => open('noSale'), xReport: () => open('x'), closeShift: () => open('count'), handover: () => open('handover'),
  }, 'sale', profile.keys);
  const back = () => setJob(session && fromHub ? 'hub' : null);
  const close = () => setJob(null);
  if (!job) return null;
  if (job === 'handoverAccept' && hand) return <HandoverAcceptPopup sid={hand.sid} handover={hand.handover} onClose={() => { setHand(null); close(); }} />;
  if (job === 'handoverCancel' && hand) return <HandoverCancelPopup sid={hand.sid} handover={hand.handover} onClose={() => { setHand(null); close(); }} />;
  if (job === 'open') return session || pending ? null : <OpenShiftPopup onClose={close} onOpened={close} />;
  if (job === 'z' && zSid) return <ZPopup sid={zSid} onClose={close} />;
  if (job === 'count' && countSid) return <CountPopup sid={countSid} onClose={() => (session ? back() : close())} onZ={(id) => { setZSid(id); setJob('z'); }} />;
  if (!session) return null;
  if (job === 'hub') return <HubPopup sid={session.id} onClose={close} onPick={(j) => open(j, true)} />;
  if (job === 'move') return <CashMovePopup sid={session.id} initial={kind} onClose={back} />;
  if (job === 'noSale') return <NoSalePopup sid={session.id} onClose={back} />;
  if (job === 'x') return <XPopup sid={session.id} onClose={back} />;
  if (job === 'tips') return <TipsPopup sid={session.id} onClose={back} />;
  if (job === 'handover') return <HandoverStartPopup sid={session.id} onClose={back} />;
  return null;
}

/** The no-shift call to action on the sale screen: one button, the popup opens over the screen. */
export function NoShiftCta() {
  const { id: deviceId, can } = useDev();
  const profile = useProfile();
  const keys = useKeymap(deviceId, 'sale', profile.keys);
  const on = useDrawerOn();
  return (
    <EmptyState compact icon={<Wallet />} title={t('لا توجد وردية مفتوحة')}
      action={on ? <Button variant="primary" size="xl" disabled={!can('session:open')} onClick={() => drawerBus.request(deviceId, 'open')} data-fb="counter-open-shift"><DoorOpen className="w-5 h-5" />{t('فتح وردية')}{profile.input !== 'touch' && keys.drawer && <Kbd className="!bg-black/10 !border-black/10 !text-current">{keyLabel(keys.drawer)}</Kbd>}</Button> : undefined} />
  );
}

// ───────── amount entry: the shared Numpad + the keyboard

function AmountEntry({ value, onKey, fb, quick, onQuick }: { value: string; onKey: (k: NumpadKey) => void; fb: string; quick?: string[]; onQuick?: (v: string) => void }) {
  return (
    <div className="space-y-2">
      <div className="rounded-2xl border px-4 h-[68px] flex items-center justify-end border-[color-mix(in_srgb,var(--primary)_45%,var(--glass-border))] bg-[var(--surface-1)]" data-fb={fb} data-value={value}>
        <Money v={value || '0'} className={cn('text-[34px] leading-none', !value && 'opacity-45')} />
      </div>
      {quick && <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${quick.length}, minmax(0, 1fr))` }}>{quick.map((v) => <button key={v} type="button" onClick={() => onQuick?.(v)} data-fb={`${fb}-quick:${v}`} className={cn('h-11 rounded-xl border font-bold num', value === v ? 'bg-[var(--primary)] text-[var(--primary-foreground)] border-transparent' : 'surface-1 border-[var(--glass-border)] hover:bg-[var(--surface-2)]')}>{v.replace('.00', '')}</button>)}</div>}
      <Numpad onKey={onKey} mode="amount" size="md" fb={`${fb}-numpad`} />
    </div>
  );
}

/** Managed reasons as large tiles; 1–9 on the keyboard pick one where the popup has no amount. */
function ReasonTiles({ reasons, value, onChange, fb, numbered }: { reasons: any[]; value: string; onChange: (code: string) => void; fb: string; numbered?: boolean }) {
  if (!reasons.length) return <div className="text-sm text-dim">{t('لا توجد أسباب')}</div>;
  return (
    <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label={t('السبب')}>
      {reasons.map((r, i) => (
        <button key={r.code} type="button" role="radio" aria-checked={value === r.code} onClick={() => onChange(r.code)} data-fb={`${fb}:${r.code}`}
          className={cn('relative min-h-12 px-3 py-2 rounded-xl border text-sm font-semibold text-start', value === r.code ? 'border-[var(--primary)] bg-[var(--primary-container)] text-[var(--primary)]' : 'surface-1 border-[var(--glass-border)] hover:bg-[var(--surface-2)]')}>
          {tv(L(r.label))}{r.requiresNote && <span className="text-[var(--warning-text)]"> *</span>}
          {numbered && i < 9 && <span className="absolute top-1 end-1.5 num text-[10px] opacity-60">{i + 1}</span>}
        </button>
      ))}
    </div>
  );
}

const Footer = ({ children }: { children: React.ReactNode }) => <div className="flex items-center justify-end gap-2 pt-3 mt-3 border-t line flex-wrap">{children}</div>;

// ───────── open the shift

function OpenShiftPopup({ onClose, onOpened }: { onClose: () => void; onOpened: () => void }) {
  const { terminal } = useDev();
  const { run, busy } = useCommand();
  // ux-10b OpeningFloatPolicy: the standard float is filled in; another amount needs a manager (APPROVAL) or is refused (LOCKED)
  const fp = policyFields<{ standardFloat: string; change: string }>('OpeningFloatPolicy', { branchId: terminal?.branchId });
  const std = plainAmount(String(fp.standardFloat ?? '0')) || '0.00';
  const locked = fp.change === 'LOCKED';
  const [float, setFloat] = useState(std);
  const panel = useRef<HTMLDivElement>(null);
  const differs = !!float && sign(changePreview(float, std)) !== 0; // display only (Decimal); the server decides
  const key = (k: NumpadKey) => { if (!locked) setFloat((cur) => applyNumpadKey(cur, k)); };
  const submit = async () => { if (!float || busy) return; if (await run('Session.Open', { body: { terminalId: terminal!.id, openingFloat: float } }, { success: t('فُتحت الوردية') })) onOpened(); };
  useNumpadKeys(true, key, { onEnter: enterOr(panel, submit), scope: panel });
  return (
    <Popup open onClose={onClose} size="sm" fb="open-shift-popup" title={<span className="flex items-center gap-2"><DoorOpen className="w-5 h-5 text-[var(--primary)]" />{t('فتح وردية')}</span>} badge={<StateBadge ops={['Session.Open']} />}>
      <div ref={panel} className="space-y-2">
        <div className="text-sm font-bold text-soft">{t('الرصيد الافتتاحي')}</div>
        {locked ? <div className="rounded-2xl border px-4 h-[68px] flex items-center justify-between border-[var(--glass-border)] bg-[var(--surface-1)]" data-fb="opening-float" data-value={float}><Lock className="w-4 h-4 text-soft" aria-label={t('ثابت')} /><Money v={float} className="text-[34px] leading-none" /></div>
          : <AmountEntry value={float} onKey={key} fb="opening-float" quick={[std]} onQuick={setFloat} />}
        <Footer><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" size="lg" loading={busy} disabled={!float} onClick={submit} data-fb="open-shift">{differs && fp.change === 'APPROVAL' ? <Lock className="w-4 h-4" /> : <DoorOpen className="w-5 h-5" />}{t('فتح الوردية')}<Kbd className="!bg-black/10 !border-black/10 !text-current">Enter</Kbd></Button></Footer>
      </div>
    </Popup>
  );
}

// ───────── the shift popup: who, since when, the float, the jobs and the drawer's entries (never the expected cash)

function HubPopup({ sid, onClose, onPick }: { sid: string; onClose: () => void; onPick: (j: DrawerJob) => void }) {
  const { id: deviceId, auth } = useDev();
  const profile = useProfile();
  const keys = useKeymap(deviceId, 'sale', profile.keys);
  const showKeys = profile.input !== 'touch';
  const s = useQuery<any>('Session.Get', { params: { sessionId: sid } });
  const ses = s.data;
  const lockOf = (action: string) => approvalRule(action, { branchId: auth.branchId }).mode !== 'NEVER';
  const handover = handoverRules(auth.branchId ?? null).mode !== 'FULL_CLOSE'; // ux-10b
  const tiles: { j: DrawerJob; a?: KeyAction; icon: React.ReactNode; label: string; lock?: boolean; proposed?: boolean; tone?: 'warning' }[] = [
    { j: 'cashIn', a: 'cashIn', icon: <ArrowDownToLine />, label: t('إدخال نقدية'), lock: lockOf('CASH_MOVE') },
    { j: 'cashOut', a: 'cashOut', icon: <ArrowUpFromLine />, label: t('صرف نقدية'), lock: lockOf('CASH_MOVE') },
    { j: 'noSale', a: 'noSale', icon: <Inbox />, label: t('فتح الدرج من غير بيع'), lock: lockOf('DRAWER_NO_SALE') },
    { j: 'x', a: 'xReport', icon: <FileText />, label: t('تقرير X') },
    { j: 'tips', icon: <HandCoins />, label: t('توزيع البقشيش'), proposed: true },
    ...(handover ? [{ j: 'handover' as DrawerJob, a: 'handover' as KeyAction, icon: <Repeat />, label: t('تسليم الوردية'), proposed: true }] : []),
    { j: 'count', a: 'closeShift', icon: <Lock />, label: t('عدّ الدرج وإغلاق الوردية'), tone: 'warning' },
  ];
  return (
    <Popup open onClose={onClose} size="lg" fb="drawer-hub" title={<span className="flex items-center gap-2"><Wallet className="w-5 h-5 text-[var(--primary)]" />{t('الوردية والدرج')}</span>} badge={<StateBadge ops={['Session.Get']} />}>
      {!ses ? <Skeleton lines={6} /> : (
        <div className="space-y-3">
          <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-sm rounded-xl surface-1 border line px-3 py-2" data-fb="drawer-hub-summary">
            <span className="font-bold">{personName(null, personText(ses.cashierName))}</span>
            <span className="text-soft inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{t('منذ')} <DateTime v={ses.openedAt} time /></span>
            <span className="text-soft">{t('الرصيد الافتتاحي')} <Money v={ses.openingFloat} /></span>
            {ses.durationWarning && <Pill tone="warning" size="sm"><AlertTriangle className="w-3 h-3" />{t('الوردية مفتوحة من وقت طويل')}</Pill>}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {tiles.map((x) => (
              <button key={x.j} type="button" onClick={() => onPick(x.j)} data-fb={`drawer:${x.j}`}
                className={cn('relative min-h-[76px] rounded-2xl border flex flex-col items-center justify-center gap-1.5 px-2 text-sm font-bold text-center [&>svg]:w-5 [&>svg]:h-5', x.tone === 'warning' ? 'border-[color-mix(in_srgb,var(--warning)_45%,transparent)] bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] text-[var(--warning-text)]' : 'surface-1 border-[var(--glass-border)] hover:bg-[var(--surface-2)] [&>svg]:text-[var(--primary)]')}>
                {x.icon}<span className="leading-tight">{x.label}</span>
                {x.a && showKeys && keys[x.a] && <span className="absolute top-1.5 start-2 num text-[10px] font-semibold opacity-60">{keyLabel(keys[x.a])}</span>}
                {x.lock && <Lock className="!w-3 !h-3 absolute top-2 end-2 text-[var(--warning-text)]" aria-label={t('يتطلب موافقة')} />}
                {x.proposed && <Tech><span className="absolute bottom-2 end-2 w-1.5 h-1.5 rounded-full" style={{ background: 'var(--violet)' }} title={t('مقترح')} /></Tech>}
              </button>
            ))}
          </div>
          <div>
            <div className="text-sm font-bold mb-1.5">{t('حركات الدرج')}</div>
            <div className="max-h-[188px] overflow-y-auto rounded-xl border line divide-y divide-[var(--glass-border)]" data-fb="drawer-entries">
              {ses.cashEntries.length === 0 ? <div className="text-sm text-dim p-3">{t('لسه مفيش حركات')}</div> : ses.cashEntries.slice().reverse().map((e: any) => (
                <div key={e.id} className="flex items-center gap-3 px-3 h-10 text-sm">
                  <DateTime v={e.at} time className="text-xs text-dim w-16 shrink-0" />
                  <span className="flex-1 min-w-0 truncate">{kindLabel(e.kind)}{(e.reasonCode || e.reason) && <span className="text-dim"> · {e.reasonCode ? (tv(L(store.db.reasonCodes.find((x) => x.code === e.reasonCode)?.label)) || e.reason || '') : e.reason}</span>}</span>
                  {e.approvalGrantId && <ShieldCheck className="w-3.5 h-3.5 text-soft shrink-0" aria-label={t('بموافقة مدير')} />}
                  <Money v={e.amount} tone={OUT_KINDS.has(e.kind) ? 'error' : undefined} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Popup>
  );
}

// ───────── cash in / out / safe drop

function CashMovePopup({ sid, initial, onClose }: { sid: string; initial: MoveKind; onClose: () => void }) {
  const { auth } = useDev();
  const { run, busy } = useCommand();
  const reasons = useReasons('CASH_MOVE');
  const [kind, setKind] = useState<MoveKind>(initial);
  const [amount, setAmount] = useState('');
  const [rc, setRc] = useState('');
  const [note, setNote] = useState('');
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!rc && reasons.length === 1) setRc(reasons[0].code); }, [reasons.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const needNote = !!reasons.find((r) => r.code === rc)?.requiresNote;
  const ready = !!amount && !!rc && (!needNote || !!note.trim());
  const key = (k: NumpadKey) => setAmount((cur) => applyNumpadKey(cur, k));
  const submit = async () => { if (!ready || busy) return; if (await run('Cash.Move', { params: { sessionId: sid }, body: { kind, amount, reasonCode: rc, reason: note.trim() || undefined, sourceType: 'MANUAL', sourceId: sid } }, { success: t('الحركة اتسجلت') })) onClose(); };
  useNumpadKeys(true, key, { onEnter: enterOr(panel, submit), scope: panel });
  const lock = approvalRule('CASH_MOVE', { branchId: auth.branchId }).mode !== 'NEVER';
  const title = kind === 'PAY_IN' ? t('إدخال نقدية') : kind === 'PAY_OUT' ? t('صرف نقدية') : t('إيداع في الخزنة');
  return (
    <Popup open onClose={onClose} size="lg" fb="cash-move-popup" title={<span className="flex items-center gap-2">{kind === 'PAY_IN' ? <ArrowDownToLine className="w-5 h-5 text-[var(--primary)]" /> : kind === 'PAY_OUT' ? <ArrowUpFromLine className="w-5 h-5 text-[var(--primary)]" /> : <Landmark className="w-5 h-5 text-[var(--primary)]" />}{title}</span>} badge={<StateBadge ops={['Cash.Move']} />}>
      <div ref={panel}>
        <div className="grid sm:grid-cols-2 gap-4">
          <AmountEntry value={amount} onKey={key} fb="cash-amount" />
          <div className="space-y-3 min-w-0">
            <SegmentedControl full value={kind} onChange={setKind} options={[{ id: 'PAY_IN', label: t('إدخال'), fb: 'cash-kind:PAY_IN' }, { id: 'PAY_OUT', label: t('صرف'), fb: 'cash-kind:PAY_OUT' }, { id: 'SAFE_DROP', label: t('إيداع في الخزنة'), fb: 'cash-kind:SAFE_DROP' }]} />
            <div className="text-sm font-bold text-soft">{t('السبب')}</div>
            <ReasonTiles reasons={reasons} value={rc} onChange={setRc} fb="cash-reason" />
            <Input value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }} placeholder={needNote ? t('ملاحظة (مطلوبة)') : t('ملاحظة')} maxLength={200} data-fb="cash-note" className="!h-12" />
          </div>
        </div>
        <Footer><Button variant="ghost" onClick={onClose}>{t('رجوع')}</Button><Button variant="primary" size="lg" loading={busy} disabled={!ready} onClick={submit} data-fb="cash-move-confirm">{lock && <Lock className="w-4 h-4" />}{t('سجّل')}<Kbd className="!bg-black/10 !border-black/10 !text-current">Enter</Kbd></Button></Footer>
      </div>
    </Popup>
  );
}

// ───────── open the drawer without a sale (reason required)

function NoSalePopup({ sid, onClose }: { sid: string; onClose: () => void }) {
  const { auth } = useDev();
  const { run, busy } = useCommand();
  const reasons = useReasons('NO_SALE');
  const [rc, setRc] = useState('');
  const [note, setNote] = useState('');
  const panel = useRef<HTMLDivElement>(null);
  const needNote = !!reasons.find((r) => r.code === rc)?.requiresNote;
  const ready = !!rc && (!needNote || !!note.trim());
  const submit = async () => { if (!ready || busy) return; if (await run('Drawer.OpenNoSale', { params: { sessionId: sid }, body: { reasonCode: rc, reason: note.trim() || undefined } }, { success: t('الدرج اتفتح واتسجل') })) onClose(); };
  // 1–9 pick a reason; Enter opens the drawer
  useNumpadKeys(true, (k) => { const i = Number(k) - 1; if (/^[1-9]$/.test(k) && reasons[i]) setRc(reasons[i].code); }, { onEnter: enterOr(panel, submit), scope: panel, decimals: false });
  const lock = approvalRule('DRAWER_NO_SALE', { branchId: auth.branchId }).mode !== 'NEVER';
  return (
    <Popup open onClose={onClose} size="md" fb="nosale-popup" title={<span className="flex items-center gap-2"><Inbox className="w-5 h-5 text-[var(--primary)]" />{t('فتح الدرج من غير بيع')}</span>} badge={<StateBadge ops={['Drawer.OpenNoSale']} />}>
      <div ref={panel} className="space-y-3">
        <div className="text-sm font-bold text-soft">{t('السبب')}</div>
        <ReasonTiles reasons={reasons} value={rc} onChange={setRc} fb="nosale-reason" numbered />
        <Input value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }} placeholder={needNote ? t('ملاحظة (مطلوبة)') : t('ملاحظة')} maxLength={200} data-fb="nosale-note" className="!h-12" />
        <Footer><Button variant="ghost" onClick={onClose}>{t('رجوع')}</Button><Button variant="primary" size="lg" loading={busy} disabled={!ready} onClick={submit} data-fb="nosale-confirm">{lock && <Lock className="w-4 h-4" />}{t('افتح الدرج')}<Kbd className="!bg-black/10 !border-black/10 !text-current">Enter</Kbd></Button></Footer>
      </div>
    </Popup>
  );
}

// ───────── X report (live; the expected cash only when the server sends it — not while the count is blind)

function XPopup({ sid, onClose }: { sid: string; onClose: () => void }) {
  const x = useQuery<any>('Session.XReport', { params: { sessionId: sid } });
  const { run } = useCommand();
  const { auth } = useDev();
  return (
    <Popup open onClose={onClose} size="lg" fb="x-popup" title={<span className="flex items-center gap-2"><FileText className="w-5 h-5 text-[var(--primary)]" />{t('تقرير نص الوردية (X)')}</span>} badge={<StateBadge ops={['Session.XReport']} />}>
      {x.data ? <ReportView r={x.data} /> : <Skeleton lines={8} />}
      <Footer><Button variant="ghost" onClick={onClose}>{t('رجوع')}</Button><Button onClick={() => run('Print.Document', { body: { documentType: 'X_REPORT', documentId: sid, terminalId: auth.terminalId, label: 'X ' + sid } }, { success: t('اتبعت للطابعة') })} data-fb="x-print"><Printer className="w-4 h-4" />{t('اطبع')}</Button></Footer>
    </Popup>
  );
}

// ───────── blind count → Session.Close (a confirmed count is locked; BlindRecountPolicy may allow an approved recount)

function CountPopup({ sid, onClose, onZ }: { sid: string; onClose: () => void; onZ: (sid: string) => void }) {
  const { can, auth } = useDev();
  const profile = useProfile();
  const showExpected = !profile.hidden.includes('expectedCash');
  const { run, busy } = useCommand();
  const s = useQuery<any>('Session.Get', { params: { sessionId: sid } });
  // BlindClosePolicy off: the expected cash may be read while counting (the server sends it only then)
  const blind = policy<boolean>('BlindClosePolicy', { branchId: auth.branchId }) !== false;
  const x = useQuery<any>(!blind && showExpected ? 'Session.XReport' : null, { params: { sessionId: sid } });
  const recount = recountMode(auth.branchId ?? null) === 'WITH_APPROVAL';
  const minReason = reasonMinLength({ branchId: auth.branchId });
  const [note, setNote] = useState('');
  const [lockedAt, setLockedAt] = useState(confirmed.get(sid) ?? null);
  const [recounting, setRecounting] = useState(false);
  const [rcReason, setRcReason] = useState('');
  const [result, setResult] = useState<any>(null);
  const panel = useRef<HTMLDivElement>(null);
  // the server keeps the confirmed count: after a reload the count is still locked
  const server = s.data?.confirmedCount ?? null;
  useEffect(() => { if (server && !lockedAt && !result) setLockedAt({ counted: server.counted, note: '' }); }, [server?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const editable = (!lockedAt || recounting) && !result;
  const bc = useBlindCount(editable, () => (recounting ? doRecount() : confirm()), panel);
  const counted = recounting ? bc.counted : lockedAt?.counted ?? bc.counted;
  const closeShift = async (c: { counted: string; note: string }, version?: number) => {
    const ses = s.data;
    if (!ses || busy) return;
    const r = await run<any>('Session.Close', { params: { sessionId: sid }, body: { expectedVersion: version ?? ses.version, countedCash: c.counted, reason: c.note || undefined } }, { success: t('الوردية اتقفلت') });
    if (r) { confirmed.delete(sid); setResult(r); }
  };
  const confirm = () => { if (!counted || !editable) return; const c = { counted, note: note.trim() }; confirmed.set(sid, c); setLockedAt(c); closeShift(c); };
  const doRecount = async () => {
    if (!bc.counted || rcReason.trim().length < minReason || busy || !s.data) return;
    const r = await run<any>('Session.Recount', { params: { sessionId: sid }, body: { countedCash: bc.counted, reason: rcReason.trim(), expectedVersion: s.data.version } }, { success: t('سُجّلت إعادة العد') });
    if (!r) return;
    const c = { counted: r.count.counted, note: note.trim() };
    confirmed.set(sid, c); setLockedAt(c); setRecounting(false); setRcReason('');
    closeShift(c, r.session.version);
  };
  const grant = result?.session?.close?.approvalGrantId ? store.db.grants.find((g) => g.id === result.session.close.approvalGrantId) : null;
  const approver = grant ? store.db.users.find((u) => u.id === grant.approverUserId) : null;

  if (result) return (
    <Popup open onClose={onClose} size="sm" fb="count-popup" title={<span className="flex items-center gap-2"><Lock className="w-5 h-5 text-[var(--primary)]" />{t('الوردية اتقفلت')}</span>} badge={<StateBadge ops={['Session.Close']} />}>
      <div className="space-y-3" data-fb="count-result">
        <div className="rounded-2xl surface-1 border line p-4 text-center"><VarianceText v={result.variance} className="text-[30px] leading-tight" /></div>
        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between"><span className="text-soft">{t('المعدود')}</span><Money v={result.countedCash} /></div>
          {showExpected && <div className="flex justify-between"><span className="text-soft">{t('المتوقع')}</span><Money v={result.expectedCash} fb="count-expected" /></div>}
          {(result.session?.close?.recounts ?? 0) > 0 && <div className="flex justify-between"><span className="text-soft">{t('إعادة العد')}</span><span className="num font-semibold">{result.session.close.recounts}</span></div>}
          {approver && <div className="flex justify-between"><span className="text-soft">{t('بموافقة مدير')}</span><span className="font-semibold">{personName(approver.username, approver.displayName)}</span></div>}
        </div>
        <Footer>{can('session:zreport') && <Button onClick={() => onZ(sid)} data-fb="count-z"><FileText className="w-4 h-4" />{t('تقرير Z')}</Button>}<Button variant="primary" size="lg" onClick={onClose} data-fb="count-done">{t('تم')}</Button></Footer>
      </div>
    </Popup>
  );
  return (
    <Popup open onClose={onClose} size="xl" fb="count-popup" title={<span className="flex items-center gap-2"><Lock className="w-5 h-5 text-[var(--primary)]" />{t('عدّ الدرج وإغلاق الوردية')}</span>} badge={<StateBadge ops={recount ? ['Session.Close', 'Session.Recount', 'Approval.Grant'] : ['Session.Close', 'Approval.Grant']} />}>
      <div ref={panel}>
        <CountBoard bc={bc} editable={editable} shown={counted}>
          {!blind && showExpected && x.data?.expectedCash !== undefined && <div className="flex justify-between text-sm rounded-xl surface-1 border line px-3 py-2" data-fb="count-expected-open"><span className="text-soft">{t('المتوقع')}</span><Money v={x.data.expectedCash} /></div>}
          {editable && !recounting && <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('ملاحظة')} maxLength={200} data-fb="count-note" className="!h-11" />}
          {recounting && <Input value={rcReason} onChange={(e) => setRcReason(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); doRecount(); } }} placeholder={t('سبب إعادة العد')} maxLength={200} data-fb="recount-reason" className="!h-11" />}
          {!editable && (
            <div className="rounded-xl border p-3 space-y-2 border-[color-mix(in_srgb,var(--warning)_40%,transparent)] bg-[color-mix(in_srgb,var(--warning)_8%,transparent)]" data-fb="count-locked">
              <div className="text-sm font-bold flex items-center gap-1.5"><ShieldCheck className="w-4 h-4 text-[var(--warning)]" />{t('العد مؤكد — بانتظار موافقة المدير')}</div>
              <Button variant="warning" size="lg" className="w-full" loading={busy} onClick={() => lockedAt && closeShift(lockedAt)} data-fb="count-retry">{t('طلب الموافقة')}</Button>
              {recount && <Button variant="outline" className="w-full" onClick={() => { bc.reset(); setRecounting(true); }} data-fb="count-recount"><RotateCcw className="w-4 h-4" />{t('إعادة العد')}<Lock className="w-3.5 h-3.5 text-[var(--warning-text)]" /></Button>}
            </div>
          )}
          <OpenOrders sid={sid} />
          {editable && !recounting && <Footer><Button variant="ghost" onClick={onClose}>{t('رجوع')}</Button><Button variant="warning" size="lg" loading={busy} disabled={!counted} onClick={confirm} data-fb="count-confirm"><Lock className="w-4 h-4" />{t('تأكيد العد')}</Button></Footer>}
          {recounting && <Footer><Button variant="ghost" onClick={() => setRecounting(false)}>{t('رجوع')}</Button><Button variant="warning" size="lg" loading={busy} disabled={!bc.counted || rcReason.trim().length < minReason} onClick={doRecount} data-fb="recount-confirm"><Lock className="w-4 h-4" />{t('تأكيد إعادة العد')}</Button></Footer>}
        </CountBoard>
      </div>
    </Popup>
  );
}

// ───────── shift handover: the outgoing cashier's blind count → Session.HandoverStart (the drawer then waits)

function HandoverStartPopup({ sid, onClose }: { sid: string; onClose: () => void }) {
  const { auth } = useDev();
  const { run, busy } = useCommand();
  const s = useQuery<any>('Session.Get', { params: { sessionId: sid } });
  const rules = handoverRules(auth.branchId ?? null);
  const [note, setNote] = useState('');
  const panel = useRef<HTMLDivElement>(null);
  const server = s.data?.confirmedCount ?? null; // a confirmed count still stands: the handover takes the same amount
  const bc = useBlindCount(!server, () => submit(), panel);
  const counted = server?.counted ?? bc.counted;
  const submit = async () => {
    if (!counted || busy || !s.data) return;
    if (await run('Session.HandoverStart', { params: { sessionId: sid }, body: { countedCash: counted, note: note.trim() || undefined, expectedVersion: s.data.version } }, { success: t('الدرج بانتظار استلام الكاشير التالي') })) onClose();
  };
  return (
    <Popup open onClose={onClose} size="xl" fb="handover-popup" title={<span className="flex items-center gap-2"><Repeat className="w-5 h-5 text-[var(--primary)]" />{t('تسليم الوردية')}</span>} badge={<StateBadge ops={['Session.HandoverStart']} />}>
      <div ref={panel}>
        <CountBoard bc={bc} editable={!server} shown={counted}>
          <div className="text-xs text-soft flex items-center gap-1.5" data-fb="handover-mode" data-mode={rules.mode}><Repeat className="w-3.5 h-3.5" />{rules.mode === 'DIRECT_SWAP' ? t('يستلم الكاشير التالي بعدّك') : t('يعدّ الكاشير التالي الدرج بعدك')}</div>
          {!server && <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('ملاحظة')} maxLength={200} data-fb="handover-note" className="!h-11" />}
          {server && <div className="rounded-xl border p-2.5 text-sm font-bold flex items-center gap-1.5 border-[color-mix(in_srgb,var(--warning)_40%,transparent)] bg-[color-mix(in_srgb,var(--warning)_8%,transparent)]" data-fb="handover-count-locked"><ShieldCheck className="w-4 h-4 text-[var(--warning)]" />{t('العد مؤكد ومقفل')}</div>}
          <OpenOrders sid={sid} />
          <Footer><Button variant="ghost" onClick={onClose}>{t('رجوع')}</Button><Button variant="warning" size="lg" loading={busy} disabled={!counted} onClick={submit} data-fb="handover-confirm"><Lock className="w-4 h-4" />{t('تأكيد العد وتسليم الوردية')}</Button></Footer>
        </CountBoard>
      </div>
    </Popup>
  );
}

// ───────── tips (proposed Tip.Distribute)

function TipsPopup({ sid, onClose }: { sid: string; onClose: () => void }) {
  const { run, busy } = useCommand();
  const [res, setRes] = useState<any>(null);
  return (
    <Popup open onClose={onClose} size="sm" fb="tips-popup" title={<span className="flex items-center gap-2"><HandCoins className="w-5 h-5 text-[var(--primary)]" />{t('توزيع البقشيش')}</span>} badge={<StateBadge ops={['Tip.Distribute']} />}>
      <div className="space-y-3 text-sm">
        {res && <div className="rounded-xl surface-1 border line p-3 space-y-1"><div className="font-bold flex justify-between">{res.mode === 'POOLED' ? t('صندوق مشترك') : t('كل ويتر بتاعه')}<Money v={res.total} /></div>{res.lines.map((l: any) => <div key={l.userId} className="flex justify-between"><span>{personName(null, l.name)}</span><Money v={l.amount} /></div>)}</div>}
        <Footer><Button variant="ghost" onClick={onClose}>{t('رجوع')}</Button><Button variant="primary" loading={busy} onClick={async () => setRes(await run('Tip.Distribute', { params: { sessionId: sid }, body: {} }, { success: t('البقشيش اتوزع') }))}>{t('وزّع')}</Button></Footer>
      </div>
    </Popup>
  );
}

/** Takeaway / counter checks still open on this drawer: they are paid, cancelled or moved before the close. */
function OpenOrders({ sid }: { sid: string }) {
  const q = useQuery<any>('Order.Find', { query: { sessionId: sid, lifecycle: 'DRAFT,CONFIRMED', limit: 50 } });
  const [move, setMove] = useState<any[] | null>(null);
  const list: any[] = (q.data?.items ?? []).filter((o: any) => o.sessionId === sid);
  if (!list.length) return null;
  return (
    <div className="rounded-xl border p-2.5 space-y-1.5 border-[color-mix(in_srgb,var(--warning)_40%,transparent)] bg-[color-mix(in_srgb,var(--warning)_8%,transparent)]" data-fb="shift-open-orders">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-sm font-bold flex items-center gap-1.5"><AlertTriangle className="w-4 h-4 text-[var(--warning)]" />{t('{n} شيك مفتوح على الدرج ده', { n: list.length })}</div>
        <Button size="sm" variant="outline" onClick={() => setMove(list)} data-fb="shift-transfer-all"><ArrowRightLeft className="w-3.5 h-3.5" />{t('انقلهم كلهم لدرج تاني')}</Button>
      </div>
      <div className="max-h-[120px] overflow-y-auto space-y-1">
        {list.map((o) => (
          <div key={o.id} className="flex items-center gap-2 text-sm px-2 py-1 rounded-lg surface-1">
            <span className="num font-bold">#{o.number}</span><span className="text-dim text-xs">{o.channel === 'TAKEAWAY' ? t('تيك أواي') : o.channel === 'DELIVERY' ? t('دليفري') : t('كاونتر')}</span>
            <span className="flex-1" /><Money v={o.totals?.payable} />
            <Button size="sm" variant="ghost" onClick={() => setMove([o])} data-fb={`shift-transfer:${o.number}`} title={t('انقل لدرج تاني')} aria-label={t('انقل لدرج تاني')}><ArrowRightLeft className="w-3.5 h-3.5" /></Button>
          </div>
        ))}
      </div>
      {move && <TransferSessionDialog orders={move} onClose={() => setMove(null)} />}
    </div>
  );
}
