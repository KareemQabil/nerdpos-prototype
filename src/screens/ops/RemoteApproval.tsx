// Remote approval inside the manager-approval popup: instead of the manager walking over to type a PIN, the cashier
// sends a request that appears on the manager's device. On accept, the waiting command continues with the same
// command id and the grant the manager issued.
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BellRing, Loader2, XCircle, Clock, Send, Maximize2, Minimize2 } from 'lucide-react';
import { useQuery, errorText } from '../../app/hooks';
import { call } from '../../api/client';
import { store } from '../../mock/store';
import { capabilityOn } from '../../mock/ops-registry';
import { Button, Pill, toast, useNow } from '../../ui';
import { t } from '../../i18n';
import { Tech } from '../../app/tech';
import { personText } from '../../demo/people';

interface Req { id: number; deviceId: string; auth: any; details: any; resolve: (g: string | null) => void }
/** request id per waiting popup, so the request survives switching between the popup and the small floating card */
const sent = new Map<number, string>();

export function RemoteApproval({ req, floating, onExpand, onBackground }: { req: Req; floating?: boolean; onExpand?: () => void; onBackground?: () => void }) {
  const d = req.details ?? {};
  const branchId = req.auth.branchId ?? store.db.terminals.find((x) => x.id === req.auth.terminalId)?.branchId ?? null;
  const [requestId, setRequestIdState] = useState<string | null>(sent.get(req.id) ?? null);
  const setRequestId = (id: string | null) => { if (id) sent.set(req.id, id); else sent.delete(req.id); setRequestIdState(id); };
  const [busy, setBusy] = useState(false);
  const q = useQuery<any>(requestId ? 'ApprovalRequest.Get' : null, { params: { requestId } });
  const r = q.data;
  const resolved = useRef(false);
  useNow(1000);
  useEffect(() => {
    if (r?.state === 'APPROVED' && r.grantId && !resolved.current) {
      resolved.current = true;
      toast('success', t('{n} وافق — بنكمّل نفس العملية', { n: personText(r.decidedByName) ?? t('المدير') }), `grant ${r.grantId}`, req.auth.label);
      sent.delete(req.id);
      req.resolve(r.grantId);
    }
  }, [r?.state, r?.grantId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d.action || !capabilityOn(store.db, 'REMOTE_APPROVALS', branchId)) return null;

  const send = async () => {
    setBusy(true);
    try {
      const res = await call<any>(req.auth, 'ApprovalRequest.Create', { body: { action: d.action, targetType: d.targetType, targetId: d.targetId, context: d.context ?? {}, opId: d.opId, commandId: d.commandId } });
      setRequestId(res.data.id);
      resolved.current = false;
    } catch (e) { toast('error', errorText(e), (e as any).code, req.auth.label); } finally { setBusy(false); }
  };
  const cancel = async () => {
    if (requestId) { try { await call(req.auth, 'ApprovalRequest.Cancel', { params: { requestId }, body: {} }); } catch { /* ignore */ } }
    req.resolve(null);
  };

  if (floating) {
    return createPortal(
      <div className="fixed bottom-4 end-4 z-[65] w-[320px] glass-strong rounded-2xl p-3 shadow-2xl border border-[color-mix(in_srgb,var(--warning)_45%,transparent)]" data-fb="approval-remote-floating" data-state={r?.state ?? 'PENDING'}>
        <div className="flex items-center gap-2">
          {r?.state === 'PENDING' || !r ? <Loader2 className="w-4 h-4 animate-spin text-[var(--warning)]" /> : r.state === 'APPROVED' ? <BellRing className="w-4 h-4 text-[var(--success)]" /> : <XCircle className="w-4 h-4 text-[var(--error)]" />}
          <div className="flex-1 min-w-0"><div className="text-sm font-bold truncate">{r?.state === 'REJECTED' ? t('المدير رفض الطلب') : r?.state === 'EXPIRED' ? t('الطلب خلص وقته') : t('مستني موافقة المدير')}</div><div className="text-[11px] text-dim truncate">{r?.actionTitle ?? ''}{r?.summary?.ar ? ` · ${r.summary.ar}` : ''}</div></div>
          <Button size="sm" variant="ghost" onClick={onExpand} title={t('افتح')}><Maximize2 className="w-4 h-4" /></Button>
        </div>
      </div>, document.body);
  }
  if (!requestId || !r) {
    return (
      <div className="rounded-xl border border-dashed border-[color-mix(in_srgb,var(--primary)_45%,transparent)] p-3 flex items-center gap-3 flex-wrap" data-fb="approval-remote">
        <BellRing className="w-5 h-5 text-[var(--primary)] shrink-0" />
        <div className="flex-1 min-w-[180px]"><div className="text-sm font-bold">{t('المدير مش جنبك؟')}</div><div className="text-xs text-dim">{t('ابعت له الطلب على جهازه يوافق أو يرفض من مكانه.')}</div></div>
        <Button variant="outline" loading={busy || (!!requestId && q.loading)} onClick={send} data-fb="approval-remote-send"><Send className="w-4 h-4" />{t('ابعت طلب للمدير')}</Button>
      </div>
    );
  }
  const left = Math.max(0, r.secondsLeft ?? 0);
  return (
    <div className="rounded-xl border p-3 space-y-2 border-[color-mix(in_srgb,var(--warning)_45%,transparent)] bg-[color-mix(in_srgb,var(--warning)_8%,transparent)]" data-fb="approval-remote-status" data-state={r.state}>
      {r.state === 'PENDING' && (
        <div className="flex items-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-[var(--warning)]" />
          <div className="flex-1"><div className="text-sm font-bold">{t('الطلب وصل للمدير — مستني رده')}</div><div className="text-xs text-dim">{t('أول ما يوافق العملية هتكمل لوحدها. ممكن برضه المدير ييجي ويكتب رقمه السري هنا.')}</div></div>
          <Pill tone="warning"><Clock className="w-3 h-3" /><span className="num">{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span></Pill>
        </div>
      )}
      {r.state === 'APPROVED' && <div className="text-sm font-bold text-[var(--success)]">{t('اتوافق — بنكمّل…')}</div>}
      {(r.state === 'REJECTED' || r.state === 'EXPIRED' || r.state === 'CANCELLED') && (
        <div className="flex items-start gap-2">
          <XCircle className="w-5 h-5 text-[var(--error)] shrink-0" />
          <div className="flex-1 text-sm"><b>{r.state === 'REJECTED' ? t('{n} رفض الطلب', { n: personText(r.decidedByName) ?? t('المدير') }) : r.state === 'EXPIRED' ? t('الطلب خلص وقته من غير رد') : t('الطلب اتلغى')}</b>{r.decisionNote && <div className="text-xs text-dim">"{r.decisionNote}"</div>}</div>
          <Button size="sm" variant="ghost" onClick={() => { setRequestId(null); }}>{t('ابعت تاني')}</Button>
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <Tech><span className="num text-[10px] text-dim">{r.id} · {r.commandId?.slice(0, 8)}</span></Tech>
        {r.state === 'PENDING' && <div className="flex gap-1">{onBackground && <Button size="sm" variant="outline" onClick={onBackground} data-fb="approval-remote-background"><Minimize2 className="w-3.5 h-3.5" />{t('استنى في الخلفية')}</Button>}<Button size="sm" variant="ghost" onClick={cancel} data-fb="approval-remote-cancel">{t('اسحب الطلب وإلغي العملية')}</Button></div>}
      </div>
    </div>
  );
}
