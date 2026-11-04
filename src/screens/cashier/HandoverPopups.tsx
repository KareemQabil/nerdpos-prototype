// ux-10b: shift handover on the sale screen. While the drawer waits (HANDOVER_PENDING) the sale screen shows one
// waiting panel instead of the sale: the outgoing cashier switches the user (or cancels), the next cashier signs in on
// the same terminal and accepts — a blind count (DUAL_COUNT) or the previous count (DIRECT_SWAP). A mismatch asks for a
// recount, then a manager with a reason; a difference over the SESSION_VARIANCE rule asks for a manager. The amounts of
// the other count and the expected cash are never on screen before the incoming count is confirmed.
import React, { useRef, useState } from 'react';
import { Repeat, LogOut, X, Lock, ShieldCheck, AlertTriangle, Clock, RotateCcw, CheckCircle2 } from 'lucide-react';
import { useDev, useCommand, errorText } from '../../app/hooks';
import { Popup, Button, Money, Input, StateBadge, DateTime, EmptyState, KV, Pill, Banner, Kbd, toast } from '../../ui';
import { t } from '../../i18n';
import { call, ApiFailure } from '../../api/client';
import { devices } from '../../app/devices';
import { drawerBus } from '../../app/drawerBus';
import { personName, personText } from '../../demo/people';
import { store } from '../../mock/store';
import { reasonMinLength } from '../../mock/policies';
import { useProfile } from '../../app/useProfile';
import { useBlindCount, CountBoard } from './CountBoard';
import { VarianceText } from './ShiftReport';

const Footer = ({ children }: { children: React.ReactNode }) => <div className="flex items-center justify-end gap-2 pt-3 mt-3 border-t line flex-wrap">{children}</div>;
const userText = (id: string | null | undefined) => { const u = id ? store.db.users.find((x) => x.id === id) : null; return u ? personName(u.username, u.displayName) : '—'; };
export const handoverModeText = (m: string) => (m === 'DIRECT_SWAP' ? t('استلام بعدّ الكاشير السابق') : m === 'FULL_CLOSE' ? t('إغلاق كامل ثم فتح جديد') : t('عدّ مزدوج أعمى'));

/** The sale screen's body while the drawer waits for the next cashier (sales are locked for everyone). */
export function HandoverWaiting({ session }: { session: any }) {
  const { id: deviceId, me, can } = useDev();
  const h = session.handover ?? {};
  const mine = me?.user?.id === session.userId;
  const switchUser = async () => { try { await call(devices.auth(deviceId), 'Auth.Logout', { body: {} }); } catch { /* ignore */ } devices.logout(deviceId); };
  return (
    <div data-screen="C2" data-fb="handover-waiting" data-handover={h.id} className="h-full flex items-center justify-center">
      <EmptyState icon={<Repeat />} title={t('بانتظار استلام الكاشير التالي')}
        text={<span className="inline-flex flex-col items-center gap-1.5 text-sm">
          <span className="inline-flex items-center gap-3 flex-wrap justify-center"><span className="font-bold">{personName(null, personText(h.outgoingName ?? ''))}</span><span className="text-soft inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" /><DateTime v={h.startedAt} time /></span><span className="num text-dim">{h.number}</span></span>
          <Pill tone="neutral" size="sm">{handoverModeText(h.mode)}</Pill>
        </span>}
        action={<div className="flex items-center gap-2 flex-wrap justify-center">
          {!mine && can('session:open') && <Button variant="primary" size="xl" onClick={() => drawerBus.request(deviceId, 'handoverAccept')} data-fb="handover-accept-open"><Repeat className="w-5 h-5" />{t('استلام الدرج')}</Button>}
          {mine && <Button variant="primary" size="xl" onClick={switchUser} data-fb="handover-switch-user"><LogOut className="w-5 h-5" />{t('تبديل المستخدم')}</Button>}
          {(mine || can('approve:session_variance')) && <Button variant="outline" size="lg" onClick={() => drawerBus.request(deviceId, 'handoverCancel')} data-fb="handover-cancel-open"><X className="w-4 h-4" />{t('إلغاء التسليم')}</Button>}
        </div>} />
    </div>
  );
}

/** The incoming cashier accepts the drawer: blind count (or the previous count), then the result on a new shift. */
export function HandoverAcceptPopup({ sid, handover, onClose }: { sid: string; handover: any; onClose: () => void }) {
  const { auth } = useDev();
  const profile = useProfile();
  const showExpected = !profile.hidden.includes('expectedCash');
  const { run, busy } = useCommand();
  const dual = handover.mode !== 'DIRECT_SWAP';
  const minReason = reasonMinLength({ branchId: auth.branchId });
  const panel = useRef<HTMLDivElement>(null);
  const [version] = useState<number>(handover.version);
  const [sent, setSent] = useState<string | null>(null); // the confirmed incoming count (locked)
  const [mismatch, setMismatch] = useState<{ recountsLeft: number; needsApproval: boolean } | null>(null);
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<any>(null);
  const editable = dual && !sent && !result;
  const bc = useBlindCount(editable, () => submit(), panel);
  const counted = sent ?? bc.counted;
  const submit = async (withReason = false) => {
    if (busy || result || (dual && !counted)) return;
    if (withReason && reason.trim().length < minReason) return;
    const body: Record<string, unknown> = { expectedVersion: version };
    if (dual) body.countedCash = counted;
    if (withReason) body.reason = reason.trim();
    if (dual) setSent(counted);
    try {
      const r = await run<any>('Session.HandoverAccept', { params: { sessionId: sid }, body }, { quiet: true, success: t('استلمت الدرج') });
      if (r) { setResult(r); setMismatch(null); }
    } catch (e) {
      const f = e as ApiFailure;
      if (f instanceof ApiFailure && f.code === 'HANDOVER_COUNT_MISMATCH') { setMismatch({ recountsLeft: Number(f.details?.recountsLeft ?? 0), needsApproval: !!f.details?.needsApproval }); return; }
      toast('error', errorText(e), f instanceof ApiFailure ? `${f.code} · ${f.status}` : undefined, auth.label);
    }
  };
  const recount = () => { bc.reset(); setSent(null); setMismatch(null); };
  const grant = result?.handover?.approvalGrantId ? store.db.grants.find((g) => g.id === result.handover.approvalGrantId) : null;

  if (result) return (
    <Popup open onClose={onClose} size="sm" fb="handover-accept-popup" title={<span className="flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-[var(--success)]" />{t('استلمت الدرج')}</span>} badge={<StateBadge ops={['Session.HandoverAccept']} />}>
      <div className="space-y-3" data-fb="handover-result">
        <div className="rounded-2xl surface-1 border line p-4 text-center space-y-1">
          <div className="text-sm text-soft">{t('الرصيد الافتتاحي')}</div>
          <Money v={result.openingFloat} className="text-[30px] leading-tight font-extrabold" fb="handover-opening" />
        </div>
        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between items-center"><span className="text-soft">{t('فرق الدرج على الكاشير السابق')}</span><VarianceText v={result.variance} /></div>
          {result.countDifference && result.countDifference !== '0.0000' && <div className="flex justify-between"><span className="text-soft">{t('الفرق بين العدّين')}</span><Money v={result.countDifference} /></div>}
          {showExpected && <div className="flex justify-between"><span className="text-soft">{t('المتوقع')}</span><Money v={result.handover.expectedCash} /></div>}
          {grant && <div className="flex justify-between"><span className="text-soft">{t('بموافقة مدير')}</span><span className="font-semibold">{userText(grant.approverUserId)}</span></div>}
        </div>
        <Footer><Button variant="primary" size="lg" onClick={onClose} data-fb="handover-done">{t('تم')}</Button></Footer>
      </div>
    </Popup>
  );
  return (
    <Popup open onClose={onClose} size={dual ? 'xl' : 'sm'} fb="handover-accept-popup" title={<span className="flex items-center gap-2"><Repeat className="w-5 h-5 text-[var(--primary)]" />{t('استلام الدرج')}</span>} badge={<StateBadge ops={['Session.HandoverAccept', 'Approval.Grant']} />}>
      <div ref={panel}>
        {!dual ? (
          <div className="space-y-3" data-fb="handover-direct">
            <div className="text-sm rounded-xl surface-1 border line px-3 py-2 flex items-center justify-between gap-2"><span className="font-bold">{personName(null, personText(handover.outgoingName ?? ''))}</span><Pill tone="neutral" size="sm">{handoverModeText(handover.mode)}</Pill></div>
            <Footer><Button variant="ghost" onClick={onClose}>{t('رجوع')}</Button><Button variant="primary" size="lg" loading={busy} onClick={() => submit()} data-fb="handover-accept"><Repeat className="w-4 h-4" />{t('استلام الدرج')}<Kbd className="!bg-black/10 !border-black/10 !text-current">Enter</Kbd></Button></Footer>
          </div>
        ) : (
          <CountBoard bc={bc} editable={editable} shown={counted}>
            {mismatch && (
              <div className="rounded-xl border p-3 space-y-2 border-[color-mix(in_srgb,var(--error)_40%,transparent)] bg-[color-mix(in_srgb,var(--error)_8%,transparent)]" data-fb="handover-mismatch" data-recounts={mismatch.recountsLeft}>
                <div className="text-sm font-bold flex items-center gap-1.5"><AlertTriangle className="w-4 h-4 text-[var(--error)]" />{t('العدّان غير متطابقين')}</div>
                {mismatch.recountsLeft > 0 ? (
                  <Button variant="outline" size="lg" className="w-full" onClick={recount} data-fb="handover-recount"><RotateCcw className="w-4 h-4" />{t('إعادة العد')}</Button>
                ) : (
                  <>
                    <Input value={reason} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(true); } }} placeholder={t('سبب عدم التطابق')} maxLength={200} data-fb="handover-reason" className="!h-11" />
                    <Button variant="warning" size="lg" className="w-full" loading={busy} disabled={reason.trim().length < minReason} onClick={() => submit(true)} data-fb="handover-approve"><Lock className="w-4 h-4" />{t('طلب موافقة المدير')}</Button>
                  </>
                )}
              </div>
            )}
            {sent && !mismatch && !busy && (
              <div className="rounded-xl border p-3 space-y-2 border-[color-mix(in_srgb,var(--warning)_40%,transparent)] bg-[color-mix(in_srgb,var(--warning)_8%,transparent)]" data-fb="handover-locked">
                <div className="text-sm font-bold flex items-center gap-1.5"><ShieldCheck className="w-4 h-4 text-[var(--warning)]" />{t('العد مؤكد — بانتظار موافقة المدير')}</div>
                <Button variant="warning" size="lg" className="w-full" loading={busy} onClick={() => submit()} data-fb="handover-retry">{t('طلب الموافقة')}</Button>
              </div>
            )}
            {editable && <Footer><Button variant="ghost" onClick={onClose}>{t('رجوع')}</Button><Button variant="warning" size="lg" loading={busy} disabled={!counted} onClick={() => submit()} data-fb="handover-accept"><Lock className="w-4 h-4" />{t('تأكيد العد واستلام الدرج')}</Button></Footer>}
          </CountBoard>
        )}
      </div>
    </Popup>
  );
}

/** The outgoing cashier (or a manager) cancels the handover with a reason; the shift is open again. */
export function HandoverCancelPopup({ sid, handover, onClose }: { sid: string; handover: any; onClose: () => void }) {
  const { auth } = useDev();
  const { run, busy } = useCommand();
  const minReason = reasonMinLength({ branchId: auth.branchId });
  const [reason, setReason] = useState('');
  const ok = reason.trim().length >= minReason;
  const submit = async () => { if (!ok || busy) return; if (await run('Session.HandoverCancel', { params: { sessionId: sid }, body: { reason: reason.trim(), expectedVersion: handover.version } }, { success: t('أُلغي التسليم') })) onClose(); };
  return (
    <Popup open onClose={onClose} size="sm" fb="handover-cancel-popup" title={<span className="flex items-center gap-2"><X className="w-5 h-5 text-[var(--error)]" />{t('إلغاء التسليم')}</span>} badge={<StateBadge ops={['Session.HandoverCancel']} />}>
      <div className="space-y-3">
        <Input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }} placeholder={t('السبب')} maxLength={200} data-fb="handover-cancel-reason" className="!h-12" />
        <Footer><Button variant="ghost" onClick={onClose}>{t('رجوع')}</Button><Button variant="danger" loading={busy} disabled={!ok} onClick={submit} data-fb="handover-cancel">{t('إلغاء التسليم')}</Button></Footer>
      </div>
    </Popup>
  );
}

/** A handover from the shift history: both counts, the expected cash, the difference, who and when (read only). */
export function HandoverDetailsPopup({ h, onClose }: { h: any; onClose: () => void }) {
  const rows: [React.ReactNode, React.ReactNode][] = [
    [t('طريقة التسليم'), handoverModeText(h.mode)],
    [t('سلّمها'), userText(h.outgoingUserId)],
    [t('بدأ التسليم'), <DateTime v={h.startedAt} />],
    [t('عدّ الكاشير المُسلِّم'), <Money v={h.outgoingCount} />],
  ];
  if (h.state === 'ACCEPTED') {
    rows.push([t('استلمها'), userText(h.incomingUserId)], [t('وقت الاستلام'), <DateTime v={h.acceptedAt} />]);
    (h.incomingCounts ?? []).forEach((c: any, i: number) => rows.push([i === 0 ? t('عدّ الكاشير المستلم') : t('إعادة العد'), <span className="inline-flex items-center gap-1.5"><Money v={c.counted} />{c.mismatch && <Pill tone="error" size="sm">{t('غير مطابق')}</Pill>}</span>]));
    rows.push([t('المتوقع'), <Money v={h.expectedCash} />], [t('فرق الدرج على الكاشير المُسلِّم'), <VarianceText v={h.variance} />]);
    if (h.countDifference && h.countDifference !== '0.0000') rows.push([t('الفرق بين العدّين'), <Money v={h.countDifference} />]);
    if (h.approverUserId) rows.push([t('بموافقة مدير'), userText(h.approverUserId)]);
    if (h.reason) rows.push([t('السبب'), h.reason]);
  }
  if (h.state === 'CANCELLED') rows.push([t('ألغاه'), userText(h.cancelledBy)], [t('وقت الإلغاء'), <DateTime v={h.cancelledAt} />], [t('السبب'), h.cancelReason]);
  return (
    <Popup open onClose={onClose} size="md" fb="handover-details" title={<span className="flex items-center gap-2"><Repeat className="w-5 h-5 text-[var(--primary)]" />{t('تسليم الوردية')} <span className="num text-dim text-sm">{h.number}</span></span>} badge={<StateBadge ops={['Session.Find']} />}>
      {h.state === 'PENDING' ? <Banner tone="warning">{t('بانتظار استلام الكاشير التالي')}</Banner> : <KV rows={rows} />}
    </Popup>
  );
}

/** Tiny hook for screens that list sessions: the handover popup they opened. */
export function useHandoverDetails() {
  const [h, setH] = useState<any>(null);
  return { open: setH, node: h ? <HandoverDetailsPopup h={h} onClose={() => setH(null)} /> : null };
}
