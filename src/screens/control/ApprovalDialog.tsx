// C5 — manager approval on the SAME device, as a small quick popup: action · value · reason on one line, the shared
// Numpad for the PIN (keyboard digits too; a full PIN submits itself). After approval the command continues by itself
// (useCommand retries with the same X-Command-Id and the grant).
// (F3-04, F2-01, P1-038): the person at the terminal keeps working; a
// supervisor proves who they are with a PIN, a manager card swipe or a fingerprint (card / finger are simulated:
// picking a card = swiping it, picking a finger = the reader matching it), or receives a request on their own device.
// When the actor lacks the permission itself, the supervisor lends it ("override") and the record keeps both names.
import React, { useMemo, useRef, useState } from 'react';
import { ShieldAlert, KeyRound, CreditCard, Fingerprint, Loader2, X, Send, AlertTriangle } from 'lucide-react';
import { errorText } from '../../app/hooks';
import { call, ApiFailure, type DeviceAuth } from '../../api/client';
import { store } from '../../mock/store';
import { demo } from '../../mock/demo';
import { permsOf } from '../../mock/kernel';
import { policy } from '../../mock/policies';
import { APPROVAL_ACTIONS } from '../../mock/policyRegistry';
import { STAGE_TEXT, DISPOSITION_TEXT } from '../../mock/control-registry';
import { Button, Popup, StateBadge, KV, SegmentedControl, Pill, toast, Numpad, applyNumpadKey, useNumpadKeys, Kbd, Avatar, IconButton, type NumpadKey } from '../../ui';
import { t, L } from '../../i18n';
import { cn, dateTime, qty } from '../../lib/format';
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

/** Short action names for the one-line summary (the long registry title stays in the policy screens). */
const SHORT: Record<string, string> = {
  LINE_REMOVE_UNSENT: 'حذف صنف', LINE_VOID: 'إلغاء صنف مُرسل', ORDER_VOID: 'إلغاء الشيك', ORDER_DISCOUNT: 'خصم', ORDER_COMP: 'ضيافة',
  REFUND_APPROVE: 'اعتماد مرتجع', RETURN_AFTER_CLOSE: 'مرتجع بعد الإغلاق', SESSION_VARIANCE: 'فرق الدرج', CASH_MOVE: 'حركة نقدية', DRAWER_NO_SALE: 'فتح الدرج',
  TENDER_CORRECTION: 'تصحيح وسيلة الدفع', PRICE_OVERRIDE: 'تعديل سعر', RECEIPT_REPRINT: 'إعادة طباعة إيصال', STAFF_MEAL: 'وجبة موظف', DELIVERY_CANCEL: 'إلغاء طلب دليفري',
};
/** The item a line action is about: «حمص ×1». */
function lineText(ctx: any): string | null {
  if (!ctx?.lineId || ctx.lineId === 'ALL') return null;
  const o = store.db.orders.find((x) => x.id === ctx.orderId);
  const l: any = o?.lines.find((x: any) => x.id === ctx.lineId);
  if (!l) return null;
  const q = ctx.quantity ?? l.quantity;
  return `${L(l.name)} ×${qty(String(q))}`;
}
/** Money-like context fields shown in the one-line summary (the value being approved). */
const VALUE_KEYS = ['lineAmount', 'amount', 'payable', 'discountPercent', 'absVariance'];

export function ControlApprovalDialog({ req }: { req: Req }) {
  const d = req.details;
  const def = APPROVAL_ACTIONS.find((a) => a.id === d.action);
  const branchId = req.auth.branchId ?? store.db.terminals.find((x) => x.id === req.auth.terminalId)?.branchId ?? null;
  const me = store.db.authSessions.find((s) => s.id === req.auth.token)?.userId ?? null;
  const meUser = store.db.users.find((u) => u.id === me);
  const lend: string | null = d.override ?? null;
  const all = useMemo(() => approversFor(d.action, lend, branchId), [d.action, lend, branchId]);
  const approvers = all.filter((a) => a.id !== me);
  const able = approvers.filter((a) => a.can);
  const methods = (policy<{ methods?: string[] }>('ApprovalCredentialPolicy', { branchId })?.methods ?? ['PIN', 'CARD', 'FINGERPRINT', 'REMOTE']);
  const kinds = (['PIN', 'CARD', 'FINGERPRINT'] as Kind[]).filter((k) => methods.includes(k));
  const [kind, setKind] = useState<Kind>(kinds[0] ?? 'PIN');
  const [approver, setApprover] = useState(able[0]?.id ?? '');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [errCode, setErrCode] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [waitInBackground, setWaitInBackground] = useState(false);
  const [remote, setRemote] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  const grant = async (k: Kind, approverUserId: string, secret: string, tag: string) => {
    setBusy(tag); setErr(null); setErrCode(null);
    try {
      if (k === 'FINGERPRINT') await new Promise((r) => setTimeout(r, 650)); // the reader scanning
      const r = await call<any>(req.auth, 'Approval.Grant', { body: { action: d.action, targetType: d.targetType, targetId: d.targetId, context: d.context, approverUserId, approverCredentialKind: k, approverSecret: secret, ...(lend ? { overridePermission: lend } : {}) } });
      const who = personName(null, store.db.users.find((u) => u.id === r.data.approverId)?.displayName);
      toast('success', t('وافق {n} · تُستكمل العملية', { n: who || t('المدير') }), `grant ${r.data.grantId} · ${k} · expires ${dateTime(r.data.expiresAt)}`, req.auth.label);
      req.resolve(r.data.grantId);
    } catch (e) {
      const f = e as ApiFailure;
      setErr(errorText(e)); setErrCode(f.code);
      setPin('');
    } finally { setBusy(null); }
  };
  const submitPin = (p = pin) => { if (approver && p.length >= 4 && !busy) grant('PIN', approver, p, 'pin'); };
  const key = (k: NumpadKey) => {
    if (busy) return;
    setErr(null);
    const next = applyNumpadKey(pin, k, { decimals: 0, maxDigits: 6 });
    setPin(next);
    if (next.length === 6 && pin.length === 5) submitPin(next); // a full PIN submits itself
  };
  useNumpadKeys(kind === 'PIN' && !waitInBackground, key, { onEnter: () => submitPin(), scope: panel, decimals: false });

  if (waitInBackground) return <RemoteApproval req={req} floating onExpand={() => setWaitInBackground(false)} />;
  const rows = Object.entries(d.context ?? {}).filter(([k, v]) => v !== null && v !== '' && v !== undefined && !HIDDEN.test(k) && !(k === 'lineId' && v === 'ALL')).map(([k, v]) => [contextFieldLabel(k), plainValue(k, v)] as [string, string]);
  const ctx = d.context ?? {};
  const valueKey = VALUE_KEYS.find((k) => ctx[k] !== undefined && ctx[k] !== null && ctx[k] !== '');
  const value = valueKey ? plainValue(valueKey, ctx[valueKey]) : null;
  const reason = ctx.reasonCode ? plainValue('reasonCode', ctx.reasonCode) : null;
  const stage = ctx.stage ?? d.stage;
  const actionTitle = SHORT[d.action] ? t(SHORT[d.action]) : def?.title ? t(def.title) : t('عملية تتطلب موافقة');
  const item = lineText(ctx);
  return (
    <Popup open onClose={() => req.resolve(null)} size="md" bare fb="approval-popup" labelledBy="approval-title">
      <div ref={panel} className="flex flex-col min-h-0" data-screen="C5" data-fb="approval-dialog">
        <div className="px-5 pt-4 pb-3 border-b line">
          <div className="flex items-center gap-2">
            <span className="w-9 h-9 rounded-xl flex items-center justify-center bg-[color-mix(in_srgb,var(--warning)_16%,transparent)] text-[var(--warning)] shrink-0"><ShieldAlert className="w-5 h-5" /></span>
            <h2 id="approval-title" className="text-lg font-bold flex-1 min-w-0 truncate">{t('موافقة المدير')}</h2>
            <StateBadge ops={['Approval.Grant']} />
            <IconButton onClick={() => req.resolve(null)} title={t('إغلاق')}><X className="w-4 h-4" /></IconButton>
          </div>
          {/* action · value · reason on one line */}
          <div className="mt-2.5 flex items-center gap-2 min-w-0 text-sm" data-fb="approval-summary">
            <b className="shrink-0">{actionTitle}</b>
            {item && <><span className="text-dim">·</span><span className="truncate">{item}</span></>}
            {value && <><span className="text-dim">·</span><span className="font-semibold shrink-0">{value}</span></>}
            {reason && <><span className="text-dim">·</span><span className="truncate text-soft">{reason}</span></>}
            {stage && (STAGE_TEXT as any)[stage] && <Pill size="sm" tone={stage === 'S3' ? 'error' : stage === 'S2' ? 'warning' : 'info'} className="ms-auto shrink-0" data-fb="approval-stage">{t((STAGE_TEXT as any)[stage].short)}</Pill>}
          </div>
          {lend && <div className="mt-1.5 text-xs text-[var(--warning-text)]" data-fb="approval-override">{t('بصلاحية المدير نيابة عن {n}', { n: personName(meUser?.username, meUser?.displayName) || t('الموظف') })}</div>}
          <Tech><div className="text-[10px] text-dim num mt-1">{d.action} · {d.opId}{lend ? ` · override ${lend}` : ''} · {ruleSentence(d.action, d.rule)}</div><KV className="num text-[10px] mt-1" rows={[...rows, ['targetType', d.targetType], ['targetId', d.targetId]]} /></Tech>
        </div>

        <div className="px-5 py-4 space-y-3 overflow-y-auto">
          {kinds.length > 1 && <SegmentedControl full value={kind} onChange={(v) => { setKind(v); setErr(null); }} options={kinds.map((k) => ({ id: k, fb: `approval-kind:${k}`, icon: k === 'PIN' ? <KeyRound className="w-4 h-4" /> : k === 'CARD' ? <CreditCard className="w-4 h-4" /> : <Fingerprint className="w-4 h-4" />, label: k === 'PIN' ? t('الرمز السري') : k === 'CARD' ? t('بطاقة المدير') : t('البصمة') }))} />}

          {kind === 'PIN' && (
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-4 items-start">
              <div className="space-y-2 min-w-0">
                <div className="text-xs font-semibold text-soft h-5 flex items-center">{t('المدير')}</div>
                <div className="grid gap-1.5" data-fb="approval-approver" role="radiogroup">
                  {(able.length ? able : approvers).slice(0, 5).map((a) => (
                    <button key={a.id} role="radio" aria-checked={approver === a.id} disabled={!a.can} onClick={() => { setApprover(a.id); setPin(''); setErr(null); }} data-fb={`approval-approver:${a.username}`}
                      className={cn('h-12 px-2.5 rounded-xl border flex items-center gap-2 text-sm text-start disabled:opacity-40', approver === a.id ? 'border-[var(--primary)] bg-[var(--primary-container)] font-semibold' : 'surface-1 border-[var(--glass-border)] hover:bg-[var(--surface-2)]')}>
                      <Avatar name={personName(a.username, a.displayName)} size="sm" /><span className="truncate">{userLabel(a.username, a.displayName)}</span>
                    </button>
                  ))}
                  {!able.length && <div className="text-xs text-[var(--error)]">{t('لا يوجد مدير بهذه الصلاحية')}</div>}
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex gap-1.5 justify-center num h-12 items-center" dir="ltr" data-fb="approval-pin" aria-label={t('الرمز السري')}>
                  {Array.from({ length: 6 }, (_, i) => <span key={i} className={cn('w-8 h-10 rounded-lg border flex items-center justify-center text-lg transition-colors', i < pin.length ? 'border-[var(--primary)] bg-[var(--primary-container)] text-[var(--primary)]' : 'border-[var(--glass-border)] surface-1')}>{i < pin.length ? '•' : ''}</span>)}
                </div>
                <Numpad mode="pin" size="md" onKey={key} disabled={!approver || busy === 'pin'} fb="approval-numpad" />
              </div>
            </div>
          )}

          {kind === 'CARD' && (
            <div className="grid grid-cols-2 gap-2" data-fb="approval-card">
              {all.filter((a) => a.card).map((a) => (
                <button key={a.id} data-fb={`approval-swipe:${a.username}`} disabled={!!busy} onClick={() => grant('CARD', a.id, a.card!, 'card:' + a.id)}
                  className={cn('h-14 text-start rounded-xl border px-3 text-sm flex items-center gap-2 surface-1 hover:bg-[var(--surface-2)] border-[var(--glass-border)] disabled:opacity-50', !a.can && 'opacity-60')}>
                  {busy === 'card:' + a.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4 text-soft" />}
                  <span className="min-w-0 flex-1 truncate font-semibold">{t('بطاقة')} {personName(a.username, a.displayName)}</span>
                </button>
              ))}
              <button data-fb="approval-swipe:unknown" disabled={!!busy} onClick={() => grant('CARD', '', 'CARD-UNKNOWN-0000', 'card:x')} className="h-14 text-start rounded-xl border px-3 text-sm flex items-center gap-2 surface-1 hover:bg-[var(--surface-2)] border-[var(--glass-border)]">
                <CreditCard className="w-4 h-4 text-dim" /><span className="font-semibold">{t('بطاقة غير مسجلة')}</span>
              </button>
            </div>
          )}

          {kind === 'FINGERPRINT' && (
            <div className="grid grid-cols-2 gap-2" data-fb="approval-finger">
              {all.filter((a) => a.finger).map((a) => (
                <button key={a.id} data-fb={`approval-finger:${a.username}`} disabled={!!busy} onClick={() => grant('FINGERPRINT', a.id, a.finger!, 'fp:' + a.id)}
                  className={cn('h-14 text-start rounded-xl border px-3 text-sm flex items-center gap-2 surface-1 hover:bg-[var(--surface-2)] border-[var(--glass-border)] disabled:opacity-50', !a.can && 'opacity-60')}>
                  {busy === 'fp:' + a.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Fingerprint className="w-4 h-4 text-soft" />}
                  <span className="min-w-0 flex-1 truncate font-semibold">{personName(a.username, a.displayName)}</span>
                </button>
              ))}
              <button data-fb="approval-finger:unknown" disabled={!!busy} onClick={() => grant('FINGERPRINT', '', 'FP-UNKNOWN', 'fp:x')} className="h-14 text-start rounded-xl border px-3 text-sm flex items-center gap-2 surface-1 hover:bg-[var(--surface-2)] border-[var(--glass-border)]">
                <Fingerprint className="w-4 h-4 text-dim" /><span className="font-semibold">{t('بصمة غير معروفة')}</span>
              </button>
            </div>
          )}

          {err && <div className="rounded-xl px-3 py-2 text-sm text-[var(--error)] bg-[color-mix(in_srgb,var(--error)_10%,transparent)] flex items-center gap-2" role="alert"><AlertTriangle className="w-4 h-4 shrink-0" />{err}<Tech><span className="num text-[11px] text-dim">({errCode})</span></Tech></div>}
          {remote && methods.includes('REMOTE') && <RemoteApproval req={req} onBackground={() => setWaitInBackground(true)} />}
        </div>

        <div className="px-5 py-3 border-t line overlay-footer rounded-b-3xl flex items-center gap-2">
          {methods.includes('REMOTE') && !remote && <Button variant="ghost" onClick={() => setRemote(true)} data-fb="approval-remote-open"><Send className="w-4 h-4 rtl:-scale-x-100" />{t('إرسال لجهاز المدير')}</Button>}
          <span className="text-[11px] text-dim">{t('تجربة')} <span className="num">{demo.pin}</span></span>
          <div className="flex-1" />
          <Button variant="ghost" size="lg" onClick={() => req.resolve(null)} data-fb="approval-cancel">{t('إلغاء')}</Button>
          {kind === 'PIN' && <Button variant="primary" size="lg" loading={busy === 'pin'} disabled={!approver || pin.length < 4} onClick={() => submitPin()} data-fb="approval-pin-ok">{t('موافقة')}<Kbd className="!bg-black/10 !border-black/10 !text-current">Enter</Kbd></Button>}
        </div>
      </div>
    </Popup>
  );
}
