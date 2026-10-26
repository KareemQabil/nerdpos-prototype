// Hand an open check over to another open drawer (shift handover, or the takeaway counter takes it).
import React, { useState } from 'react';
import { ArrowRightLeft, Monitor } from 'lucide-react';
import { useQuery, useCommand } from '../../app/hooks';
import { Modal, Button, Field, Input, StateBadge, Banner, Money, Empty, Switch } from '../../ui';
import { t } from '../../i18n';
import { cn, dateTime } from '../../lib/format';
import { deviceName } from '../../demo/people';

/** orders: one or more open checks of the same drawer session. */
export function TransferSessionDialog({ orders, onClose }: { orders: any[]; onClose: () => void }) {
  const from = orders[0]?.sessionId;
  const sessions = useQuery<any>('Session.Find', { query: { state: 'OPEN', limit: 50 } });
  const { run, busy } = useCommand();
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [toServer, setToServer] = useState(true);
  const targets = (sessions.data?.items ?? []).filter((s: any) => s.id !== from);
  const submit = async () => {
    let ok = 0;
    for (const o of orders) {
      const r = await run('Order.TransferSession', { params: { orderId: o.id }, body: { toSessionId: to, expectedVersion: o.version, reason: reason || undefined, toServer } });
      if (r) ok++;
    }
    if (ok) { onClose(); }
  };
  const target = targets.find((s: any) => s.id === to);
  return (
    <Modal open onClose={onClose} title={<span className="flex items-center gap-2"><ArrowRightLeft className="w-5 h-5" />{orders.length > 1 ? t('نقل {n} شيكات لوردية تانية', { n: orders.length }) : t('نقل الشيك #{n} لوردية تانية', { n: orders[0]?.number })}</span>} badge={<StateBadge ops={['Order.TransferSession']} />}
      footer={<><Button variant="ghost" onClick={onClose}>{t('رجوع')}</Button><Button variant="primary" loading={busy} disabled={!to} onClick={submit} data-fb="transfer-session-submit">{t('انقل')}</Button></>}>
      <div className="space-y-4">
        <div className="space-y-1">
          {orders.map((o) => <div key={o.id} className="flex items-center justify-between text-sm px-3 py-1.5 rounded-lg surface-1"><span><span className="num font-bold">#{o.number}</span> · {o.channel === 'TAKEAWAY' ? t('تيك أواي') : o.tableName ? `${t('ترابيزة')} ${o.tableName}` : t('كاونتر')} · {o.serverName}</span><Money v={o.totals?.payable ?? o.payable} /></div>)}
        </div>
        <Field label={t('لأنهي درج مفتوح؟')}>
          {targets.length === 0 ? <Empty text={t('مفيش درج تاني مفتوح دلوقتي — الكاشير التاني يفتح ورديته الأول')} /> : (
            <div className="grid gap-2">
              {targets.map((s: any) => (
                <button key={s.id} onClick={() => setTo(s.id)} data-fb={`transfer-to:${s.terminalCode}`} className={cn('flex items-center gap-3 px-3 py-2 rounded-xl border text-start', to === s.id ? 'border-[var(--primary)] bg-[var(--primary-container)]' : 'border-[var(--glass-border)] surface-1 hover:surface-2')}>
                  <Monitor className="w-4 h-4 text-dim" />
                  <div className="flex-1"><div className="font-bold text-sm">{s.cashierName}</div><div className="text-[11px] text-dim">{deviceName(s.terminalId)} · {t('فاتحة من')} {dateTime(s.openedAt)}</div></div>
                </button>
              ))}
            </div>
          )}
        </Field>
        <Switch checked={toServer} onChange={setToServer} label={target ? t('{n} يبقى المسؤول عن الشيك', { n: target.cashierName }) : t('الكاشير الجديد يبقى المسؤول عن الشيك')} />
        <Field label={t('السبب (اختياري)')}><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('مثلاً: تسليم وردية')} data-fb="transfer-reason" /></Field>
        <Banner tone="info">{t('الشيك بيتنقل بكل اللي عليه (الأصناف والدفعات اللي اتعملت). الكاشير الجديد هو اللي هيحصّل الباقي، والنقل بيتسجل في تاريخ الشيك. بعد كده الوردية القديمة تقدر تقفل.')}</Banner>
      </div>
    </Modal>
  );
}
