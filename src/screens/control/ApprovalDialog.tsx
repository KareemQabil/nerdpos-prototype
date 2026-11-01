// C5 — manager approval on the SAME device (F3-04, F2-01, P1-038): the person at the terminal keeps working; a
// supervisor proves who they are with a PIN, a manager card swipe or a fingerprint (card / finger are simulated:
// picking a card = swiping it, picking a finger = the reader matching it), or receives a request on their own device.
// When the actor lacks the permission itself, the supervisor lends it ("override") and the record keeps both names.
import React, { useMemo, useState } from 'react';
import { ShieldAlert, KeyRound, CreditCard, Fingerprint, Loader2, UserCheck, Info } from 'lucide-react';
import { errorText } from '../../app/hooks';
import { call, ApiFailure, type DeviceAuth } from '../../api/client';
import { store } from '../../mock/store';
import { demo } from '../../mock/demo';
import { permsOf } from '../../mock/kernel';
import { policy } from '../../mock/policies';
import { APPROVAL_ACTIONS } from '../../mock/policyRegistry';
import { STAGE_TEXT, DISPOSITION_TEXT } from '../../mock/control-registry';
import { Button, Modal, StateBadge, KV, Banner, Select, Input, SegmentedControl, Pill, toast } from '../../ui';
import { t, L } from '../../i18n';
import { cn, dateTime } from '../../lib/format';
import { Tech } from '../../app/tech';
import { personName, userLabel } from '../../demo/people';
import { ruleSentence, contextFieldLabel, contextValueText } from '../../demo/policyText';
import { RemoteApproval } from '../ops/RemoteApproval';

interface Req { id: number; deviceId: string; auth: DeviceAuth; details: any; resolve: (grantId: string | null) => void }
type Kind = 'PIN' | 'CARD' | 'FINGERPRINT';

const CTX_KIND: Record<string, string> = { PERCENTAGE: 'نسبة', FIXED_AMOUNT: 'مبلغ ثابت', CASH: 'كاش', CARD: 'كارت', DIGITAL_WALLET: 'محفظة', PAY_IN: 'إدخال فلوس للدرج', PAY_OUT: 'صرف من الدرج', SAFE_DROP: 'إيداع في الخزنة', SALE_PRICE: 'بسعر البيع', COST: 'بالتكلفة', NONE: '—' };
const HIDDEN = /Id$|Version$|Hash$|^payableBasis$|^captureCount$|^currentEffectivePaid$|^fireRound$/;
function plainValue(k: string, v: unknown): string {
  if (k === 'reasonCode') return L(store.db.reasonCodes.find((r) => r.code === v)?.label) || t('سبب من القايمة');
  if (k === 'stage' && typeof v === 'string' && (STAGE_TEXT as any)[v]) return t((STAGE_TEXT as any)[v].short);
  if (k === 'disposition' && typeof v === 'string' && (DISPOSITION_TEXT as any)[v]) return t((DISPOSITION_TEXT as any)[v].label);
  if (k === 'employeeName' && typeof v === 'string') return personName(null, v);
  if ((k === 'quantity' || k === 'fromQuantity' || k === 'toQuantity') && v !== null) return String(Number(v));
  if (typeof v === 'string' && CTX_KIND[v]) return t(CTX_KIND[v]);
  if (typeof v === 'string' && /^[A-Z][A-Z_]{2,}$/.test(v)) return '—';
  return contextValueText(k, v);
}

/** Who can approve here: holds the approval permission (and the operation's permission when it is lent). */
function approversFor(action: string, lend: string | null, branchId: string | null) {
  const def = APPROVAL_ACTIONS.find((a) => a.id === action);
  const db = store.db;
  return db.users.filter((u) => u.active).map((u) => {
    const p = permsOf(db, u, branchId);
    const has = (x?: string | null) => !x || p.has('*') || p.has(x);
    return { id: u.id, username: u.username, displayName: u.displayName, card: u.cardCode ?? null, finger: u.fingerprintId ?? null, can: has(def?.permission) && has(lend) };
  });
}

export function ControlApprovalDialog({ req }: { req: Req }) {
  const d = req.details;
  const def = APPROVAL_ACTIONS.find((a) => a.id === d.action);
  const branchId = req.auth.branchId ?? store.db.terminals.find((x) => x.id === req.auth.terminalId)?.branchId ?? null;
  const me = store.db.authSessions.find((s) => s.id === req.auth.token)?.userId ?? null;
  const meUser = store.db.users.find((u) => u.id === me);
  const lend: string | null = d.override ?? null;
  const all = useMemo(() => approversFor(d.action, lend, branchId), [d.action, lend, branchId]);
  const approvers = all.filter((a) => a.id !== me);
  const methods = (policy<{ methods?: string[] }>('ApprovalCredentialPolicy', { branchId })?.methods ?? ['PIN', 'CARD', 'FINGERPRINT', 'REMOTE']);
  const kinds = (['PIN', 'CARD', 'FINGERPRINT'] as Kind[]).filter((k) => methods.includes(k));
  const [kind, setKind] = useState<Kind>(kinds[0] ?? 'PIN');
  const [approver, setApprover] = useState(approvers.find((a) => a.can)?.id ?? '');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [errCode, setErrCode] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [waitInBackground, setWaitInBackground] = useState(false);

  const grant = async (k: Kind, approverUserId: string, secret: string, tag: string) => {
    setBusy(tag); setErr(null); setErrCode(null);
    try {
      if (k === 'FINGERPRINT') await new Promise((r) => setTimeout(r, 650)); // the reader scanning
      const r = await call<any>(req.auth, 'Approval.Grant', { body: { action: d.action, targetType: d.targetType, targetId: d.targetId, context: d.context, approverUserId, approverCredentialKind: k, approverSecret: secret, ...(lend ? { overridePermission: lend } : {}) } });
      const who = personName(null, store.db.users.find((u) => u.id === r.data.approverId)?.displayName);
      toast('success', t('{n} وافق — بنكمّل نفس العملية', { n: who || t('المدير') }), `grant ${r.data.grantId} · ${k} · expires ${dateTime(r.data.expiresAt)}`, req.auth.label);
      req.resolve(r.data.grantId);
    } catch (e) {
      const f = e as ApiFailure;
      setErr(errorText(e)); setErrCode(f.code);
      setPin('');
    } finally { setBusy(null); }
  };

  if (waitInBackground) return <RemoteApproval req={req} floating onExpand={() => setWaitInBackground(false)} />;
  const rows = Object.entries(d.context ?? {}).filter(([k, v]) => v !== null && v !== '' && v !== undefined && !HIDDEN.test(k) && !(k === 'lineId' && v === 'ALL')).map(([k, v]) => [contextFieldLabel(k), plainValue(k, v)] as [string, string]);
  const stage = d.context?.stage ?? d.stage;
  return (
    <Modal open onClose={() => req.resolve(null)} title={<span className="flex items-center gap-2"><ShieldAlert className="w-5 h-5 text-[var(--warning)]" />{t('موافقة مدير مطلوبة')}</span>} badge={<StateBadge ops={['Approval.Grant']} />}
      footer={<><Button variant="ghost" onClick={() => req.resolve(null)} data-fb="approval-cancel">{t('إلغاء — مفيش حاجة هتتكتب')}</Button>{kind === 'PIN' && <Button variant="primary" loading={busy === 'pin'} disabled={!approver || pin.length < 4} onClick={() => grant('PIN', approver, pin, 'pin')} data-fb="approval-pin-ok">{t('موافقة')}</Button>}</>}>
      <div className="space-y-4" data-screen="C5" data-fb="approval-dialog">
        <div className="rounded-xl surface-1 p-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-xs text-dim">{t('العملية')}</div>
            {stage && (STAGE_TEXT as any)[stage] && <Pill tone={stage === 'S3' ? 'error' : stage === 'S2' ? 'warning' : 'info'} data-fb="approval-stage">{t((STAGE_TEXT as any)[stage].short)}</Pill>}
          </div>
          <div className="font-bold text-lg">{def?.title ? t(def.title) : t('عملية محتاجة موافقة')}<Tech><span className="num text-xs text-dim ms-1">{d.action}</span></Tech></div>
          <div className="text-xs text-dim mt-1">{ruleSentence(d.action, d.rule)}<Tech><span className="num"> · {d.opId}{lend ? ` · override ${lend}` : ''}</span></Tech></div>
        </div>
        {lend && (
          <Banner tone="warning" title={t('الحركة دي مش من صلاحية {n}', { n: personName(meUser?.username, meUser?.displayName) || t('الموظف') })}>
            <span data-fb="approval-override">{t('مدير عنده الصلاحية يوافق هنا في مكانه — مش محتاج يدخل بحسابه. الحركة هتتسجل باسم {n} وبموافقة المدير.', { n: personName(meUser?.username, meUser?.displayName) || t('الموظف') })}</span>
          </Banner>
        )}
        {rows.length > 0 && (
          <div>
            <div className="text-xs font-bold text-soft mb-1">{t('بالظبط بتوافق على إيه')}</div>
            <KV className="text-xs" rows={rows} />
            <Tech><KV className="num text-[10px] mt-1" rows={[['targetType', d.targetType], ['targetId', d.targetId], ...Object.entries(d.context ?? {}).map(([k, v]) => [k, v === null ? 'null' : String(v)] as [string, string])]} /></Tech>
          </div>
        )}
        {kinds.length > 1 && <SegmentedControl full value={kind} onChange={(v) => { setKind(v); setErr(null); }} options={kinds.map((k) => ({ id: k, fb: `approval-kind:${k}`, icon: k === 'PIN' ? <KeyRound className="w-4 h-4" /> : k === 'CARD' ? <CreditCard className="w-4 h-4" /> : <Fingerprint className="w-4 h-4" />, label: k === 'PIN' ? t('الرقم السري') : k === 'CARD' ? t('كارت المدير') : t('البصمة') }))} />}

        {kind === 'PIN' && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><div className="text-xs font-bold text-soft">{t('المدير')}</div>
              <Select data-fb="approval-approver" value={approver} onChange={(e) => setApprover(e.target.value)} options={[{ value: '', label: t('اختار') }, ...approvers.map((a) => ({ value: a.id, label: `${userLabel(a.username, a.displayName)}${a.can ? '' : ' — ' + t('مالوش صلاحية')}` }))]} />
            </div>
            <div className="space-y-1.5"><div className="text-xs font-bold text-soft">{t('الرقم السري')}</div><Input data-fb="approval-pin" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="••••••" onKeyDown={(e) => e.key === 'Enter' && approver && pin.length >= 4 && grant('PIN', approver, pin, 'pin')} /></div>
          </div>
        )}

        {kind === 'CARD' && (
          <div className="space-y-2" data-fb="approval-card">
            <div className="rounded-xl border-2 border-dashed border-[color-mix(in_srgb,var(--primary)_40%,transparent)] p-3 flex items-center gap-3">
              <CreditCard className="w-8 h-8 text-[var(--primary)] shrink-0" />
              <div className="flex-1"><div className="font-bold text-sm">{t('مرّر كارت المدير على القارئ')}</div><div className="text-[11px] text-dim">{t('محاكاة: اختار الكارت اللي هيتمرر.')}</div></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {all.filter((a) => a.card).map((a) => (
                <button key={a.id} data-fb={`approval-swipe:${a.username}`} disabled={!!busy} onClick={() => grant('CARD', a.id, a.card!, 'card:' + a.id)}
                  className={cn('text-start rounded-xl border px-3 py-2 text-sm flex items-center gap-2 surface-1 hover:bg-[var(--surface-2)] border-[var(--glass-border)] disabled:opacity-50', !a.can && 'opacity-70')}>
                  {busy === 'card:' + a.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4 text-soft" />}
                  <span className="min-w-0 flex-1"><span className="font-bold block truncate">{t('كارت')} {personName(a.username, a.displayName)}</span><span className="text-[11px] text-dim">{a.can ? t('عنده الصلاحية') : t('مالوش صلاحية على دي')}</span></span>
                </button>
              ))}
              <button data-fb="approval-swipe:unknown" disabled={!!busy} onClick={() => grant('CARD', '', 'CARD-UNKNOWN-0000', 'card:x')} className="text-start rounded-xl border px-3 py-2 text-sm flex items-center gap-2 surface-1 hover:bg-[var(--surface-2)] border-[var(--glass-border)]">
                <CreditCard className="w-4 h-4 text-dim" /><span className="font-bold">{t('كارت مش متسجل')}</span>
              </button>
            </div>
          </div>
        )}

        {kind === 'FINGERPRINT' && (
          <div className="space-y-2" data-fb="approval-finger">
            <div className="rounded-xl border-2 border-dashed border-[color-mix(in_srgb,var(--primary)_40%,transparent)] p-3 flex items-center gap-3">
              <Fingerprint className={cn('w-9 h-9 shrink-0', busy?.startsWith('fp') ? 'text-[var(--success)] animate-pulse' : 'text-[var(--primary)]')} />
              <div className="flex-1"><div className="font-bold text-sm">{busy?.startsWith('fp') ? t('بيقرا البصمة…') : t('المدير يحط صباعه على جهاز البصمة')}</div><div className="text-[11px] text-dim">{t('محاكاة جهاز بصمة (زي Digital Persona): اختار مين اللي حط صباعه.')}</div></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {all.filter((a) => a.finger).map((a) => (
                <button key={a.id} data-fb={`approval-finger:${a.username}`} disabled={!!busy} onClick={() => grant('FINGERPRINT', a.id, a.finger!, 'fp:' + a.id)}
                  className={cn('text-start rounded-xl border px-3 py-2 text-sm flex items-center gap-2 surface-1 hover:bg-[var(--surface-2)] border-[var(--glass-border)] disabled:opacity-50', !a.can && 'opacity-70')}>
                  {busy === 'fp:' + a.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4 text-soft" />}
                  <span className="min-w-0 flex-1"><span className="font-bold block truncate">{personName(a.username, a.displayName)}</span><span className="text-[11px] text-dim">{a.can ? t('عنده الصلاحية') : t('مالوش صلاحية على دي')}</span></span>
                </button>
              ))}
              <button data-fb="approval-finger:unknown" disabled={!!busy} onClick={() => grant('FINGERPRINT', '', 'FP-UNKNOWN', 'fp:x')} className="text-start rounded-xl border px-3 py-2 text-sm flex items-center gap-2 surface-1 hover:bg-[var(--surface-2)] border-[var(--glass-border)]">
                <Fingerprint className="w-4 h-4 text-dim" /><span className="font-bold">{t('بصمة مش متعرف عليها')}</span>
              </button>
            </div>
          </div>
        )}

        {err && <Banner tone="error">{err}<Tech><span className="num text-[11px] text-dim ms-1">({errCode})</span></Tech></Banner>}
        <div className="text-[11px] text-dim flex items-start gap-1.5"><Info className="w-3.5 h-3.5 shrink-0 mt-px" />{t('الموافقة بتتستخدم مرة واحدة للعملية دي بالظبط، ومن نفس الجهاز، وبتخلص بعد دقيقتين. صاحب الطلب مينفعش يوافق لنفسه.')}</div>
        {methods.includes('REMOTE') && <RemoteApproval req={req} onBackground={() => setWaitInBackground(true)} />}
        <div className="text-[11px] text-dim">{t('بيانات عرض: الرقم السري')} <span className="num">{demo.pin}</span></div>
      </div>
    </Modal>
  );
}
