// Approvals & audit: every manager grant (single use, bound to its context, expiring) and the audit trail.
// ux-06: a grant or an audit entry opens beside the list (wide) or as a full page (narrow); params keep the tab and
// the selected record (grant / event) so refresh and back keep them.
import React, { useMemo, useState } from 'react';
import { ShieldCheck, ScrollText, CheckCircle2, Clock3, TimerOff, ChevronLeft } from 'lucide-react';
import { Button, DetailPane, EmptyState, FILL_BODY, FILL_CARD, FillPage, FilterChips, KV, MasterDetail, PageHeader, Pill, SearchInput, Select, Spinner, StatCard, StatGrid, StateBadge, Table, Tabs, Card, Toolbar, useNow } from '../../ui';
import { t } from '../../i18n';
import { useDev, useQuery } from '../../app/hooks';
import { Tech } from '../../app/tech';
import { dateTime } from '../../lib/format';
import { APPROVAL_ACTIONS } from '../../mock/policyRegistry';
import { clock } from '../../mock/clock';
import { contextFieldLabel, contextValueText, actionTitle } from '../../demo/policyText';
import { deviceName, personName } from '../../demo/people';
import { useList, Refused } from './org/common';
import { opText } from './org/permText';
import { ReversalTrace, StagePill } from '../control/VoidReview'; // r3A: removals by stage
import { STAGE_TEXT } from '../../mock/control-registry';
import type { StageId } from '../../mock/types-control';

const CRED_AR: Record<string, string> = { PIN: 'بالرقم السري', CARD: 'بالكارت', FINGERPRINT: 'بالبصمة', REMOTE: 'من جهازه' };

type AuditTab = 'grants' | 'audit' | 'removals';
export default function Audit() {
  const { params, nav } = useDev();
  const tab: AuditTab = params?.tab === 'audit' || params?.tab === 'removals' ? params.tab : 'grants';
  const go = (p: Record<string, any>) => nav('audit', p);
  const users = useList<any>('User.Find');
  const terms = useList<any>('Terminal.List');
  const nameOf = (id: string | null) => { if (!id) return '—'; const u = users.items.find((x) => x.id === id); return u ? personName(u.username, u.displayName) : t('مستخدم'); };
  const termOf = (id: string | null) => { if (!id) return t('من غير جهاز'); const x = terms.items.find((y) => y.id === id); return x ? deviceName(x.code, x.kind, x.name) : t('جهاز'); };
  const grant: string | null = tab === 'grants' ? params?.grant ?? null : null;
  const event: string | null = tab === 'audit' ? params?.event ?? null : null;
  const list = (compact: boolean) => (
    <FillPage fb="screen:AUD">
      <PageHeader className="!mb-0" icon={<ShieldCheck />} title={t('الموافقات والسجل')} badge={<StateBadge ops={['Approval.Find', 'Audit.Find', 'User.Find']} />} />
      <Tabs variant="underline" value={tab} onChange={(v) => go(v === 'grants' ? {} : { tab: v })} tabs={[{ id: 'grants', icon: <ShieldCheck className="w-4 h-4" />, label: t('موافقات المدير'), fb: 'audit-tab:grants' }, { id: 'audit', icon: <ScrollText className="w-4 h-4" />, label: t('سجل الحركات'), fb: 'audit-tab:audit' }, { id: 'removals', icon: <ScrollText className="w-4 h-4" />, label: t('الإلغاءات والمرتجعات بالمرحلة'), fb: 'audit-tab:removals' }]} />
      {tab === 'grants' ? <Grants nameOf={nameOf} termOf={termOf} compact={compact} selected={grant} onOpen={(id) => go({ grant: id })} />
        : tab === 'audit' ? <AuditLog nameOf={nameOf} termOf={termOf} compact={compact} selected={event} onOpen={(id) => go({ tab: 'audit', event: id })} />
        : <div className="flex-1 min-h-0 overflow-y-auto" data-scroll-region><ReversalTrace /></div>}
    </FillPage>
  );
  const detail = grant ? <GrantDetail id={grant} nameOf={nameOf} termOf={termOf} onClose={() => go({})} /> : event ? <EventDetail id={event} nameOf={nameOf} termOf={termOf} onClose={() => go({ tab: 'audit' })} /> : null;
  return <MasterDetail fb="audit" open={!!detail} list={list} detail={detail} />;
}

const grantState = (g: any) => (g.consumedAt ? 'used' : g.expiresAtMs > clock.now() ? 'waiting' : 'expired');
const grantPill = (g: any) => grantState(g) === 'used' ? <Pill tone="success" dot>{t('اتستخدمت')}</Pill> : grantState(g) === 'waiting' ? <Pill tone="warning" dot>{t('مستنية الاستخدام')}</Pill> : <Pill tone="neutral" dot>{t('انتهت من غير استخدام')}</Pill>;

function GrantDetail({ id, nameOf, termOf, onClose }: { id: string; nameOf: (id: string | null) => string; termOf: (id: string | null) => string; onClose: () => void }) {
  useNow(5000);
  const q = useQuery<any>('Approval.Get', { params: { grantId: id } });
  const sel = q.data?.id === id ? q.data : null;
  return (
    <DetailPane fb="grant-detail" onClose={onClose} backLabel={t('موافقات المدير')} icon={<ShieldCheck />} title={sel ? actionTitle(sel.action) : t('موافقة')} badge={sel ? grantPill(sel) : undefined}>
      {!sel ? (q.error ? <Refused error={q.error} /> : <Spinner />) : (
        <div className="space-y-5">
          <KV rows={[
            [t('مين طلب'), nameOf(sel.requesterUserId)],
            [t('مين وافق'), <b>{nameOf(sel.approverUserId)}</b>],
            [t('إزاي'), t(CRED_AR[sel.credentialKind ?? 'PIN'] ?? '')],
            ...(sel.overridePermission ? [[t('الصلاحية'), t('الحركة مش من صلاحية اللي طلب — المدير وافق في مكانه')] as [string, string]] : []),
            [t('من جهاز'), termOf(sel.terminalId)],
            [t('اتمنحت'), dateTime(sel.issuedAt)],
            [t('تنتهي'), dateTime(sel.expiresAt ?? new Date(sel.expiresAtMs).toISOString())],
            ...(sel.consumedAt ? [[t('اتستخدمت'), dateTime(sel.consumedAt)] as [string, string]] : []),
            ...(sel.reason ? [[t('السبب'), sel.reason] as [string, string]] : []),
          ]} />
          <div>
            <div className="text-sm font-bold mb-2">{t('اللي اتوافق عليه')}</div>
            <div className="rounded-xl surface-1 border line p-3">
              <KV rows={Object.entries(sel.context ?? {}).filter(([, v]) => v !== null && v !== undefined && !/Hash$|Id$/.test(String(v))).filter(([k]) => !/Hash$|Id$/.test(k)).map(([k, v]) => [contextFieldLabel(k), contextValueText(k, v)] as [string, string])} />
              {Object.keys(sel.context ?? {}).length === 0 && <div className="text-xs text-dim">{t('مفيش تفاصيل إضافية')}</div>}
            </div>
          </div>
          <Tech>
            <div className="rounded-xl surface-2 p-3 num text-[11px]" dir="ltr">
              <KV rows={[['grantId', sel.id], ['action', sel.action], ['target', `${sel.targetType} ${sel.targetId}`], ['consumedBy (X-Command-Id)', String(sel.consumedBy ?? '—')], ...Object.entries(sel.context ?? {}).map(([k, v]) => [k, v === null ? 'null' : String(v)] as [string, string])]} />
            </div>
          </Tech>
        </div>
      )}
    </DetailPane>
  );
}

function EventDetail({ id, nameOf, termOf, onClose }: { id: string; nameOf: (id: string | null) => string; termOf: (id: string | null) => string; onClose: () => void }) {
  const q = useQuery<any>('Audit.Get', { params: { auditEntryId: id } });
  const sel = q.data?.id === id ? q.data : null;
  return (
    <DetailPane fb="event-detail" onClose={onClose} backLabel={t('سجل الحركات')} icon={<ScrollText />} title={sel ? opText(sel.op) : t('حركة')} badge={sel?.sensitive ? <Pill tone="warning">{t('حساس')}</Pill> : undefined}>
      {!sel ? (q.error ? <Refused error={q.error} /> : <Spinner />) : (
        <div className="space-y-4">
          <KV rows={[[t('الوقت'), dateTime(sel.at)], [t('مين عمل'), nameOf(sel.userId)], [t('الجهاز'), termOf(sel.terminalId)], [t('مين سمح'), sel.approverUserId ? `${nameOf(sel.approverUserId)} (${t(CRED_AR[sel.credentialKind ?? 'PIN'] ?? '')})` : sel.approvalGrantId ? t('أيوه') : t('من غير موافقة')], ...(sel.stage ? [[t('المرحلة'), t(STAGE_TEXT[sel.stage as StageId].short)] as [string, string]] : [])]} />
          <Tech>
            <div className="rounded-xl surface-2 p-3 num text-[11px]" dir="ltr"><KV rows={[['op', sel.op], ['summary', sel.summary], ['target', sel.target ?? '—'], ['X-Command-Id', sel.commandId ?? '—'], ['grant', sel.approvalGrantId ?? '—']]} /></div>
          </Tech>
        </div>
      )}
    </DetailPane>
  );
}

function Grants({ nameOf, termOf, compact, selected, onOpen }: { nameOf: (id: string | null) => string; termOf: (id: string | null) => string; compact: boolean; selected: string | null; onOpen: (id: string) => void }) {
  useNow(5000);
  const [action, setAction] = useState('');
  const [st, setSt] = useState<'all' | 'used' | 'waiting' | 'expired'>('all');
  const grants = useList<any>('Approval.Find', { query: { action: action || undefined, limit: 200 } });
  const base = grants.items.filter((g) => !action || g.action === action);
  const items = base.filter((g) => st === 'all' || grantState(g) === st);
  const c = { used: base.filter((g) => grantState(g) === 'used').length, waiting: base.filter((g) => grantState(g) === 'waiting').length, expired: base.filter((g) => grantState(g) === 'expired').length };
  return (
    <>
      {!compact && <StatGrid>
        <StatCard label={t('موافقات اتستخدمت')} value={c.used} icon={<CheckCircle2 />} tone="success" loading={grants.loading && !grants.data} />
        <StatCard label={t('مستنية الاستخدام')} value={c.waiting} icon={<Clock3 />} tone={c.waiting ? 'warning' : 'neutral'} loading={grants.loading && !grants.data} />
        <StatCard label={t('انتهت من غير استخدام')} value={c.expired} icon={<TimerOff />} loading={grants.loading && !grants.data} />
      </StatGrid>}
      <Card padding="sm" className={FILL_CARD} bodyClassName={FILL_BODY}>
        <Toolbar>
          <FilterChips value={st} onChange={setSt} options={[{ id: 'all', label: t('الكل'), count: base.length }, { id: 'used', label: t('اتستخدمت'), count: c.used }, { id: 'waiting', label: t('مستنية'), count: c.waiting, tone: 'warning' }, { id: 'expired', label: t('انتهت'), count: c.expired }]} />
          <Toolbar.Spacer />
          <Select value={action} onChange={(e) => setAction(e.target.value)} className="!w-auto min-w-[220px]" options={[{ value: '', label: t('كل الحركات') }, ...APPROVAL_ACTIONS.map((a) => ({ value: a.id, label: t(a.title) }))]} data-fb="audit:grant-action" />
        </Toolbar>
        <Refused error={grants.error} />
        <Table fill head={compact ? [t('الحركة'), t('الحالة')] : [t('الحركة'), t('مين طلب'), t('مين وافق'), t('إمتى'), t('الحالة'), '']} align={compact ? undefined : [undefined, undefined, undefined, undefined, undefined, 'end']}
          loading={grants.loading && !grants.data} onRowClick={(i) => onOpen(items[i].id)} rowClassName={(i) => (items[i].id === selected ? 'row-selected' : undefined)}
          rows={items.map((g) => compact ? [
            <div data-fb={`audit:grant:${g.id}`}><div className="font-bold">{actionTitle(g.action)}</div><div className="text-[11px] text-dim">{nameOf(g.approverUserId)} · {dateTime(g.issuedAt)}</div></div>,
            grantPill(g),
          ] : [
            <div><div className="font-bold">{actionTitle(g.action)}</div><Tech><div className="num text-[10px] text-dim">{g.action} · {g.targetType} {g.targetId}</div></Tech></div>,
            <span>{nameOf(g.requesterUserId)}</span>,
            <span><span className="font-bold">{nameOf(g.approverUserId)}</span><div className="text-[11px] text-dim">{t(CRED_AR[g.credentialKind ?? 'PIN'] ?? '')}{g.overridePermission ? ` · ${t('وافق في مكان الموظف')}` : ''}</div></span>,
            <span className="text-xs whitespace-nowrap">{dateTime(g.issuedAt)}<div className="text-[11px] text-dim">{termOf(g.terminalId)}</div></span>,
            grantPill(g),
            <span className="text-dim" data-fb={`audit:grant:${g.id}`}><ChevronLeft className="w-4 h-4 ltr:rotate-180" /></span>,
          ])}
          empty={<EmptyState compact icon={<ShieldCheck />} title={t('مفيش موافقات لسه')} />} />
      </Card>
    </>
  );
}

const PAGE = 50;
function AuditLog({ nameOf, termOf, compact, selected, onOpen }: { nameOf: (id: string | null) => string; termOf: (id: string | null) => string; compact: boolean; selected: string | null; onOpen: (id: string) => void }) {
  const audit = useList<any>('Audit.Find', { query: { limit: 500 } });
  const [sens, setSens] = useState<'all' | 'sensitive'>('all');
  const [stage, setStage] = useState<'all' | 'approved' | StageId>('all');
  const [q, setQ] = useState('');
  const [n, setN] = useState(PAGE);
  const items = useMemo(() => audit.items.filter((a) => (sens === 'all' || a.sensitive) && (stage === 'all' || (stage === 'approved' ? !!a.approverUserId : a.stage === stage)) && (!q || (opText(a.op) + ' ' + a.op + ' ' + a.summary + ' ' + (a.target ?? '') + ' ' + nameOf(a.userId) + ' ' + nameOf(a.approverUserId ?? null)).toLowerCase().includes(q.toLowerCase()))), [audit.items, sens, stage, q, nameOf]);
  const sensitive = audit.items.filter((a) => a.sensitive).length;
  return (
    <Card padding="sm" className={FILL_CARD} bodyClassName={FILL_BODY}>
      <Toolbar>
        <SearchInput value={q} onChange={(v) => { setQ(v); setN(PAGE); }} placeholder={t('دوّر باسم الموظف أو الحركة')} data-fb="audit:search" />
        <FilterChips value={sens} onChange={(v) => { setSens(v); setN(PAGE); }} options={[{ id: 'all', label: t('كل الحركات'), count: audit.items.length }, { id: 'sensitive', label: t('الحساس بس'), count: sensitive, tone: 'warning' }]} />
      </Toolbar>
      <Toolbar>
        <FilterChips value={stage} onChange={(v) => { setStage(v); setN(PAGE); }} options={[{ id: 'all', label: t('أي مرحلة') }, { id: 'approved', label: t('بموافقة مدير'), count: audit.items.filter((a) => a.approverUserId).length }, ...(['S0', 'S1', 'S2', 'S3'] as StageId[]).map((s) => ({ id: s, label: t(STAGE_TEXT[s].short), count: audit.items.filter((a) => a.stage === s).length, tone: s === 'S3' ? 'error' as const : undefined }))]} />
      </Toolbar>
      <Refused error={audit.error} />
      <Table fill dense head={compact ? [t('الحركة'), t('الوقت')] : [t('الوقت'), t('مين عمل'), t('الجهاز'), t('الحركة'), t('مين سمح')]}
        loading={audit.loading && !audit.data} onRowClick={(i) => onOpen(items[i].id)} rowClassName={(i) => (items[i].id === selected ? 'row-selected' : undefined)}
        rows={items.slice(0, n).map((a) => compact ? [
          <div className="text-sm min-w-0" data-fb={`audit:event:${a.id}`}><span className="font-bold">{opText(a.op)}</span>{a.sensitive && <Pill tone="warning" className="ms-2">{t('حساس')}</Pill>}<div className="text-[11px] text-dim">{nameOf(a.userId)}</div></div>,
          <span className="text-xs whitespace-nowrap">{dateTime(a.at)}</span>,
        ] : [
          <span className="text-xs whitespace-nowrap">{dateTime(a.at)}</span>,
          <span className="text-sm">{nameOf(a.userId)}</span>,
          <span className="text-xs text-dim">{termOf(a.terminalId)}</span>,
          <div className="text-sm min-w-0" data-fb={`audit:event:${a.id}`}><span className="font-bold">{opText(a.op)}</span>{a.sensitive && <Pill tone="warning" className="ms-2">{t('حساس')}</Pill>}{a.stage && <span className="ms-2"><StagePill s={a.stage} /></span>}<Tech><div className="num text-[10px] text-dim break-all" dir="ltr">{a.op} · {a.summary}{a.target ? ` · ${a.target}` : ''}</div></Tech></div>,
          a.approverUserId ? <span className="text-sm"><b>{nameOf(a.approverUserId)}</b><div className="text-[10px] text-dim">{t(CRED_AR[a.credentialKind ?? 'PIN'] ?? '')}{a.override ? ` · ${t('في مكان الموظف')}` : ''}</div></span> : a.approvalGrantId ? <Pill tone="info">{t('بموافقة')}</Pill> : <span className="text-dim">—</span>,
        ])}
        empty={<EmptyState compact icon={<ScrollText />} title={t('مفيش حركات بالبحث ده')} />} />
      <div className="flex items-center justify-between gap-2 mt-2 px-1">
        <span className="text-[11px] text-dim">{t('بيظهر {a} من {b} حركة', { a: Math.min(n, items.length), b: items.length })}</span>
        {n < items.length && <Button size="sm" variant="ghost" onClick={() => setN(n + PAGE)} data-fb="audit:more">{t('اعرض أكتر')}</Button>}
      </div>
    </Card>
  );
}
