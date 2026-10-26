// Approvals & audit: every manager grant (single use, bound to its context, expiring) and the audit trail.
import React, { useState } from 'react';
import { ShieldCheck, ScrollText, Search, ChevronDown, ChevronUp } from 'lucide-react';
import { useQuery } from '../../app/hooks';
import { Input, KV, Pill, Section, Select, StateBadge, Switch, Table, Tabs, Card, useNow } from '../../ui';
import { t } from '../../i18n';
import { dateTime } from '../../lib/format';
import { APPROVAL_ACTIONS } from '../../mock/policyRegistry';
import { clock } from '../../mock/clock';
import { useList, Refused } from './org/common';

export default function Audit() {
  const [tab, setTab] = useState<'grants' | 'audit'>('grants');
  const users = useList<any>('User.Find');
  const terms = useList<any>('Terminal.List');
  const nameOf = (id: string | null) => (id ? users.items.find((u) => u.id === id)?.displayName ?? id : '—');
  const termOf = (id: string | null) => (id ? terms.items.find((x) => x.id === id)?.code ?? id : t('من غير جهاز'));
  return (
    <div className="space-y-4" data-fb="screen:AUD">
      <Section
        title={t('الموافقات والسجل')}
        badge={<StateBadge ops={['Approval.Find', 'Audit.Find', 'User.Find']} />}
        sub={t('كل موافقة مدير بتتستخدم مرة واحدة، ومربوطة بالعملية والسياق والطالب والفرع والجهاز، وليها وقت انتهاء. السجل بيقول مين عمل إيه، وبأي أمر، وبأي موافقة.')}
      />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'grants', label: <span className="flex items-center gap-1"><ShieldCheck className="w-4 h-4" />{t('الموافقات')}</span> }, { id: 'audit', label: <span className="flex items-center gap-1"><ScrollText className="w-4 h-4" />{t('السجل')}</span> }]} />
      {tab === 'grants' ? <Grants nameOf={nameOf} termOf={termOf} /> : <AuditLog nameOf={nameOf} termOf={termOf} />}
    </div>
  );
}

function Grants({ nameOf, termOf }: { nameOf: (id: string | null) => string; termOf: (id: string | null) => string }) {
  useNow(5000);
  const [action, setAction] = useState('');
  const grants = useList<any>('Approval.Find', { query: { action: action || undefined, limit: 200 } });
  const [open, setOpen] = useState<string | null>(null);
  const items = grants.items.filter((g) => !action || g.action === action);
  return (
    <Card title={t('الموافقات (Approval grants)')} badge={<StateBadge ops={['Approval.Find']} />}
      actions={<Select value={action} onChange={(e) => setAction(e.target.value)} className="max-w-[240px]" options={[{ value: '', label: t('كل العمليات') }, ...APPROVAL_ACTIONS.map((a) => ({ value: a.id, label: `${a.title} (${a.id})` }))]} data-fb="audit:grant-action" />}>
      <Refused error={grants.error} />
      <Table head={[t('العملية'), t('الطالب'), t('الموافق'), t('على إيه'), t('اتمنحت'), t('تنتهي'), t('الحالة'), '']}
        rows={items.map((g) => {
          const def = APPROVAL_ACTIONS.find((a) => a.id === g.action);
          return [
            <div><div className="font-bold text-xs">{def?.title ?? g.action}</div><div className="num text-[10px] text-dim">{g.action}</div></div>,
            <span className="text-xs">{nameOf(g.requesterUserId)}</span>,
            <span className="text-xs font-bold">{nameOf(g.approverUserId)}</span>,
            <div className="num text-[11px] max-w-[320px]">
              <div>{g.targetType || '—'}</div><div className="text-dim break-all">{g.targetId}</div>
              {open === g.id && <div className="mt-1 rounded-lg surface-2 p-2"><div className="text-dim mb-1 font-sans">{t('السياق اللي اتوافق عليه بالظبط')}</div><KV className="text-[11px]" rows={[['grantId', g.id], ...Object.entries(g.context ?? {}).map(([k, v]) => [k, v === null ? 'null' : String(v)] as [string, string]), ...(g.reason ? [[t('السبب'), g.reason] as [string, string]] : [])]} /></div>}
            </div>,
            <span className="text-xs">{dateTime(g.issuedAt)}<div className="text-[10px] text-dim num">{termOf(g.terminalId)}</div></span>,
            <span className="text-xs">{dateTime(g.expiresAt)}</span>,
            <div>{g.consumedAt ? <Pill tone="success">{t('اتستخدمت')}</Pill> : g.expiresAtMs > clock.now() ? <Pill tone="warning">{t('مستنية الاستخدام')}</Pill> : <Pill tone="neutral">{t('انتهت من غير استخدام')}</Pill>}{g.consumedBy && <div className="num text-[10px] text-dim" title={g.consumedBy}>X-Command-Id {String(g.consumedBy).slice(0, 8)}…</div>}</div>,
            <button className="text-dim hover:text-[var(--primary)]" title={t('السياق')} onClick={() => setOpen(open === g.id ? null : g.id)} data-fb={`audit:grant:${g.id}`}>{open === g.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</button>,
          ];
        })}
        empty={t('مفيش موافقات لسه')} />
    </Card>
  );
}

function AuditLog({ nameOf, termOf }: { nameOf: (id: string | null) => string; termOf: (id: string | null) => string }) {
  const audit = useList<any>('Audit.Find', { query: { limit: 500 } });
  const [sensitive, setSensitive] = useState(false);
  const [q, setQ] = useState('');
  const items = audit.items.filter((a) => (!sensitive || a.sensitive) && (!q || (a.op + ' ' + a.summary + ' ' + (a.target ?? '') + ' ' + nameOf(a.userId)).toLowerCase().includes(q.toLowerCase())));
  return (
    <Card title={t('سجل العمليات (Audit)')} badge={<StateBadge ops={['Audit.Find']} />}
      actions={<div className="flex items-center gap-3"><Switch checked={sensitive} onChange={setSensitive} label={t('الحساس بس')} /><div className="relative"><Search className="w-4 h-4 absolute top-3 start-3 text-dim" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('دوّر…')} className="ps-9 w-48" data-fb="audit:search" /></div></div>}>
      <Refused error={audit.error} />
      <Table head={[t('الوقت'), t('المستخدم'), t('الجهاز'), t('العملية'), t('الملخص'), t('حساس'), 'X-Command-Id', t('الموافقة')]}
        rows={items.map((a) => [
          <span className="text-xs whitespace-nowrap">{dateTime(a.at)}</span>,
          <span className="text-xs">{nameOf(a.userId)}</span>,
          <span className="num text-xs">{termOf(a.terminalId)}</span>,
          <span className="num text-xs font-bold">{a.op}</span>,
          <div className="text-xs"><div>{a.summary}</div>{a.target && <div className="num text-[10px] text-dim break-all">{a.target}</div>}</div>,
          a.sensitive ? <Pill tone="warning">{t('حساس')}</Pill> : <span className="text-dim">—</span>,
          a.commandId ? <span className="num text-[10px]" title={a.commandId}>{String(a.commandId).slice(0, 8)}…</span> : <span className="text-dim">—</span>,
          a.approvalGrantId ? <span className="num text-[10px]">{a.approvalGrantId}</span> : <span className="text-dim">—</span>,
        ])}
        empty={t('مفيش عمليات متسجلة')} />
      <div className="text-[11px] text-dim mt-2">{t('بيظهر آخر {n} عملية.', { n: audit.items.length })}</div>
    </Card>
  );
}
