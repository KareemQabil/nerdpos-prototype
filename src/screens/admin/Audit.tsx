// Approvals & audit: every manager grant (single use, bound to its context, expiring) and the audit trail.
import React, { useMemo, useState } from 'react';
import { ShieldCheck, ScrollText, CheckCircle2, Clock3, TimerOff, ChevronLeft } from 'lucide-react';
import { Button, Drawer, EmptyState, FilterChips, KV, PageHeader, Pill, SearchInput, Select, StatCard, StatGrid, StateBadge, Table, Tabs, Card, Toolbar, useNow } from '../../ui';
import { t } from '../../i18n';
import { Tech } from '../../app/tech';
import { dateTime } from '../../lib/format';
import { APPROVAL_ACTIONS } from '../../mock/policyRegistry';
import { clock } from '../../mock/clock';
import { contextFieldLabel, contextValueText, actionTitle } from '../../demo/policyText';
import { deviceName, personName } from '../../demo/people';
import { useList, Refused } from './org/common';
import { opText } from './org/permText';

export default function Audit() {
  const [tab, setTab] = useState<'grants' | 'audit'>('grants');
  const users = useList<any>('User.Find');
  const terms = useList<any>('Terminal.List');
  const nameOf = (id: string | null) => { if (!id) return '—'; const u = users.items.find((x) => x.id === id); return u ? personName(u.username, u.displayName) : t('مستخدم'); };
  const termOf = (id: string | null) => { if (!id) return t('من غير جهاز'); const x = terms.items.find((y) => y.id === id); return x ? deviceName(x.code, x.kind, x.name) : t('جهاز'); };
  return (
    <div className="space-y-4" data-fb="screen:AUD">
      <PageHeader
        icon={<ShieldCheck />}
        title={t('الموافقات والسجل')}
        badge={<StateBadge ops={['Approval.Find', 'Audit.Find', 'User.Find']} />}
        description={t('كل موافقة مدير بتتستخدم مرة واحدة على حركة واحدة بعينها. والسجل بيقول مين عمل إيه، إمتى، ومن أنهي جهاز.')}
      />
      <Tabs variant="underline" value={tab} onChange={setTab} tabs={[{ id: 'grants', icon: <ShieldCheck className="w-4 h-4" />, label: t('موافقات المدير') }, { id: 'audit', icon: <ScrollText className="w-4 h-4" />, label: t('سجل الحركات') }]} />
      {tab === 'grants' ? <Grants nameOf={nameOf} termOf={termOf} /> : <AuditLog nameOf={nameOf} termOf={termOf} />}
    </div>
  );
}

function Grants({ nameOf, termOf }: { nameOf: (id: string | null) => string; termOf: (id: string | null) => string }) {
  useNow(5000);
  const [action, setAction] = useState('');
  const [st, setSt] = useState<'all' | 'used' | 'waiting' | 'expired'>('all');
  const grants = useList<any>('Approval.Find', { query: { action: action || undefined, limit: 200 } });
  const [sel, setSel] = useState<any | null>(null);
  const stateOf = (g: any) => (g.consumedAt ? 'used' : g.expiresAtMs > clock.now() ? 'waiting' : 'expired');
  const base = grants.items.filter((g) => !action || g.action === action);
  const items = base.filter((g) => st === 'all' || stateOf(g) === st);
  const c = { used: base.filter((g) => stateOf(g) === 'used').length, waiting: base.filter((g) => stateOf(g) === 'waiting').length, expired: base.filter((g) => stateOf(g) === 'expired').length };
  const pill = (g: any) => stateOf(g) === 'used' ? <Pill tone="success" dot>{t('اتستخدمت')}</Pill> : stateOf(g) === 'waiting' ? <Pill tone="warning" dot>{t('مستنية الاستخدام')}</Pill> : <Pill tone="neutral" dot>{t('انتهت من غير استخدام')}</Pill>;
  return (
    <div className="space-y-4">
      <StatGrid>
        <StatCard label={t('موافقات اتستخدمت')} value={c.used} icon={<CheckCircle2 />} tone="success" loading={grants.loading && !grants.data} />
        <StatCard label={t('مستنية الاستخدام')} value={c.waiting} icon={<Clock3 />} tone={c.waiting ? 'warning' : 'neutral'} hint={t('بتنتهي لوحدها بعد دقايق')} loading={grants.loading && !grants.data} />
        <StatCard label={t('انتهت من غير استخدام')} value={c.expired} icon={<TimerOff />} loading={grants.loading && !grants.data} />
      </StatGrid>
      <Card padding="sm">
        <Toolbar>
          <FilterChips value={st} onChange={setSt} options={[{ id: 'all', label: t('الكل'), count: base.length }, { id: 'used', label: t('اتستخدمت'), count: c.used }, { id: 'waiting', label: t('مستنية'), count: c.waiting, tone: 'warning' }, { id: 'expired', label: t('انتهت'), count: c.expired }]} />
          <Toolbar.Spacer />
          <Select value={action} onChange={(e) => setAction(e.target.value)} className="!w-auto min-w-[220px]" options={[{ value: '', label: t('كل الحركات') }, ...APPROVAL_ACTIONS.map((a) => ({ value: a.id, label: t(a.title) }))]} data-fb="audit:grant-action" />
        </Toolbar>
        <Refused error={grants.error} />
        <Table head={[t('الحركة'), t('مين طلب'), t('مين وافق'), t('إمتى'), t('الحالة'), '']} align={[undefined, undefined, undefined, undefined, undefined, 'end']}
          loading={grants.loading && !grants.data} maxHeight={600}
          onRowClick={(i) => setSel(items[i])}
          rows={items.map((g) => [
            <div><div className="font-bold">{actionTitle(g.action)}</div><Tech><div className="num text-[10px] text-dim">{g.action} · {g.targetType} {g.targetId}</div></Tech></div>,
            <span>{nameOf(g.requesterUserId)}</span>,
            <span className="font-bold">{nameOf(g.approverUserId)}</span>,
            <span className="text-xs whitespace-nowrap">{dateTime(g.issuedAt)}<div className="text-[11px] text-dim">{termOf(g.terminalId)}</div></span>,
            pill(g),
            <button className="text-dim hover:text-[var(--primary)]" title={t('التفاصيل')} data-fb={`audit:grant:${g.id}`}><ChevronLeft className="w-4 h-4 ltr:rotate-180" /></button>,
          ])}
          empty={<EmptyState compact icon={<ShieldCheck />} title={t('مفيش موافقات لسه')} text={t('لما مدير يوافق على خصم أو إلغاء أو مرتجع هتظهر هنا.')} />} />
      </Card>
      {sel && (
        <Drawer open onClose={() => setSel(null)} icon={<ShieldCheck />} title={actionTitle(sel.action)} badge={pill(sel)} description={t('الموافقة دي على الحركة دي بالظبط وبالأرقام دي — أي تغيير محتاج موافقة جديدة.')}>
          <div className="space-y-5">
            <KV rows={[
              [t('مين طلب'), nameOf(sel.requesterUserId)],
              [t('مين وافق'), <b>{nameOf(sel.approverUserId)}</b>],
              [t('من جهاز'), termOf(sel.terminalId)],
              [t('اتمنحت'), dateTime(sel.issuedAt)],
              [t('تنتهي'), dateTime(sel.expiresAt)],
              ...(sel.consumedAt ? [[t('اتستخدمت'), dateTime(sel.consumedAt)] as [string, string]] : []),
              ...(sel.reason ? [[t('السبب'), sel.reason] as [string, string]] : []),
            ]} />
            <div>
              <div className="text-sm font-bold mb-2">{t('اللي اتوافق عليه')}</div>
              <div className="rounded-xl surface-1 border line p-3">
                <KV rows={Object.entries(sel.context ?? {}).filter(([, v]) => v !== null && v !== undefined && !/Hash$|Id$/.test(String(v)) ).filter(([k]) => !/Hash$|Id$/.test(k)).map(([k, v]) => [contextFieldLabel(k), contextValueText(k, v)] as [string, string])} />
                {Object.keys(sel.context ?? {}).length === 0 && <div className="text-xs text-dim">{t('مفيش تفاصيل إضافية')}</div>}
              </div>
            </div>
            <Tech>
              <div className="rounded-xl surface-2 p-3 num text-[11px]" dir="ltr">
                <KV rows={[['grantId', sel.id], ['action', sel.action], ['target', `${sel.targetType} ${sel.targetId}`], ['consumedBy (X-Command-Id)', String(sel.consumedBy ?? '—')], ...Object.entries(sel.context ?? {}).map(([k, v]) => [k, v === null ? 'null' : String(v)] as [string, string])]} />
              </div>
            </Tech>
          </div>
        </Drawer>
      )}
    </div>
  );
}

const PAGE = 50;
function AuditLog({ nameOf, termOf }: { nameOf: (id: string | null) => string; termOf: (id: string | null) => string }) {
  const audit = useList<any>('Audit.Find', { query: { limit: 500 } });
  const [sens, setSens] = useState<'all' | 'sensitive'>('all');
  const [q, setQ] = useState('');
  const [n, setN] = useState(PAGE);
  const [sel, setSel] = useState<any | null>(null);
  const items = useMemo(() => audit.items.filter((a) => (sens === 'all' || a.sensitive) && (!q || (opText(a.op) + ' ' + a.op + ' ' + a.summary + ' ' + (a.target ?? '') + ' ' + nameOf(a.userId)).toLowerCase().includes(q.toLowerCase()))), [audit.items, sens, q, nameOf]);
  const sensitive = audit.items.filter((a) => a.sensitive).length;
  return (
    <Card padding="sm">
      <Toolbar>
        <SearchInput value={q} onChange={(v) => { setQ(v); setN(PAGE); }} placeholder={t('دوّر باسم الموظف أو الحركة')} data-fb="audit:search" />
        <FilterChips value={sens} onChange={(v) => { setSens(v); setN(PAGE); }} options={[{ id: 'all', label: t('كل الحركات'), count: audit.items.length }, { id: 'sensitive', label: t('الحساس بس'), count: sensitive, tone: 'warning' }]} />
      </Toolbar>
      <Refused error={audit.error} />
      <Table dense maxHeight={620} head={[t('الوقت'), t('الموظف'), t('الجهاز'), t('الحركة'), t('موافقة مدير')]}
        loading={audit.loading && !audit.data} onRowClick={(i) => setSel(items[i])}
        rows={items.slice(0, n).map((a) => [
          <span className="text-xs whitespace-nowrap">{dateTime(a.at)}</span>,
          <span className="text-sm">{nameOf(a.userId)}</span>,
          <span className="text-xs text-dim">{termOf(a.terminalId)}</span>,
          <div className="text-sm min-w-0"><span className="font-bold">{opText(a.op)}</span>{a.sensitive && <Pill tone="warning" className="ms-2">{t('حساس')}</Pill>}<Tech><div className="num text-[10px] text-dim break-all" dir="ltr">{a.op} · {a.summary}{a.target ? ` · ${a.target}` : ''}</div></Tech></div>,
          a.approvalGrantId ? <Pill tone="info">{t('بموافقة')}</Pill> : <span className="text-dim">—</span>,
        ])}
        empty={<EmptyState compact icon={<ScrollText />} title={t('مفيش حركات بالبحث ده')} text={t('غيّر البحث أو الفلتر.')} />} />
      <div className="flex items-center justify-between gap-2 mt-2 px-1">
        <span className="text-[11px] text-dim">{t('بيظهر {a} من {b} حركة', { a: Math.min(n, items.length), b: items.length })}</span>
        {n < items.length && <Button size="sm" variant="ghost" onClick={() => setN(n + PAGE)} data-fb="audit:more">{t('اعرض أكتر')}</Button>}
      </div>
      {sel && (
        <Drawer open onClose={() => setSel(null)} icon={<ScrollText />} title={opText(sel.op)} badge={sel.sensitive ? <Pill tone="warning">{t('حساس')}</Pill> : undefined}>
          <div className="space-y-4">
            <KV rows={[[t('الوقت'), dateTime(sel.at)], [t('الموظف'), nameOf(sel.userId)], [t('الجهاز'), termOf(sel.terminalId)], [t('موافقة مدير'), sel.approvalGrantId ? t('أيوه') : t('لأ')]]} />
            <Tech>
              <div className="rounded-xl surface-2 p-3 num text-[11px]" dir="ltr"><KV rows={[['op', sel.op], ['summary', sel.summary], ['target', sel.target ?? '—'], ['X-Command-Id', sel.commandId ?? '—'], ['grant', sel.approvalGrantId ?? '—']]} /></div>
            </Tech>
          </div>
        </Drawer>
      )}
    </Card>
  );
}
