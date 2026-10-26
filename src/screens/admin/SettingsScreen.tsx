// B4 Settings & reason codes: the REAL settings screen. Every change is an append-only policy row through
// Settings.UpdatePolicy and needs SENSITIVE_POLICY_CHANGE approval by policy (the Policy Panel is the demo shortcut).
import React, { useMemo, useState } from 'react';
import { History, Pencil, Search, ShieldAlert, Undo2, Plus, Power, ListChecks, SlidersHorizontal } from 'lucide-react';
import { useCommand, useQuery } from '../../app/hooks';
import { Banner, Button, Card, Field, Input, KV, Pill, Section, Select, StateBadge, Switch, Table, Tabs, Textarea } from '../../ui';
import { t, useLang } from '../../i18n';
import { cn, dateTime } from '../../lib/format';
import { POLICIES, POLICY_GROUPS, APPROVAL_ACTIONS, type PolicyMeta, type Field as PField } from '../../mock/policyRegistry';
import { useList, show, getPath, setPath, ruleText, usePerm, RulePill, Refused, REASON_KINDS, reasonKindLabel, Modal } from './org/common';

const stateTone = { CANONICAL: 'success', CORE: 'info', PENDING: 'warning', DIRECTION: 'violet' } as const;
const stateLabel = { CANONICAL: 'متصمم (canonical)', CORE: 'CORE جديد', PENDING: 'معلّق للخبير', DIRECTION: 'مقترح' } as const;
const TENANT_ID = 'biz'; // the business id (Business.Get) is the TENANT scope id

export default function SettingsScreen() {
  const [tab, setTab] = useState<'policies' | 'reasons'>('policies');
  return (
    <div className="space-y-4" data-fb="screen:B4">
      <Section
        title={t('الإعدادات والأسباب')}
        badge={<StateBadge ops={['Settings.Effective', 'Settings.UpdatePolicy', 'Policy.History', 'ReasonCode.List', 'ReasonCode.Create', 'ReasonCode.Configure']} />}
        sub={t('شاشة الإعدادات الحقيقية: كل تغيير صف جديد في السجل (مفيش مسح ولا تعديل لصف قديم)، وبيحتاج موافقة مدير تاني حسب قاعدة SENSITIVE_POLICY_CHANGE. لوحة الإعدادات اللي فوق هي نسخة العرض السريعة.')}
        actions={<RulePill action="SENSITIVE_POLICY_CHANGE" />}
      />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'policies', label: <span className="flex items-center gap-1"><SlidersHorizontal className="w-4 h-4" />{t('السياسات')}</span> }, { id: 'reasons', label: <span className="flex items-center gap-1"><ListChecks className="w-4 h-4" />{t('أسباب الإلغاء والخصم')}</span> }]} />
      {tab === 'policies' ? <PoliciesTab /> : <ReasonsTab />}
    </div>
  );
}

// ───────── policies
function PoliciesTab() {
  const lang = useLang();
  const branches = useList<any>('Branch.List');
  const users = useList<any>('User.Find');
  const [group, setGroup] = useState('orders');
  const [q, setQ] = useState('');
  const [scope, setScope] = useState('TENANT');
  const scopeType = scope === 'TENANT' ? 'TENANT' : 'BRANCH';
  const scopeId = scope === 'TENANT' ? TENANT_ID : scope;
  const list = POLICIES.filter((p) => (q ? (p.id + p.title + p.titleEn + p.description).toLowerCase().includes(q.toLowerCase()) : p.group === group));
  const nameOf = (id: string) => users.items.find((u) => u.id === id)?.displayName ?? id;
  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative flex-1 min-w-[220px]"><Search className="w-4 h-4 absolute top-3 start-3 text-dim" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('دوّر على سياسة…')} className="ps-9" data-fb="settings:search" /></div>
        <Select value={scope} onChange={(e) => setScope(e.target.value)} className="max-w-[260px]" data-fb="settings:scope"
          options={[{ value: 'TENANT', label: t('النطاق: النشاط كله (TENANT)') }, ...branches.items.map((b) => ({ value: b.id, label: t('النطاق: فرع {c} (BRANCH)', { c: `${b.code} · ${b.name}` }) }))]} />
      </div>
      {!q && <Tabs value={group} onChange={setGroup} tabs={POLICY_GROUPS.map((g) => ({ id: g.id, label: lang === 'ar' ? g.title : g.titleEn }))} />}
      <Banner tone="info">{t('الترتيب: الجهاز ← الفرع ← النشاط ← الافتراضي الآمن. التغيير بيطبق على العمليات الجديدة بس، والشيكات اللي اتسجلت محتفظة بقيمتها. الموافقة لازم تيجي من مدير غير اللي طالب التغيير (مثلاً demo-manager-2).')}</Banner>
      <div className="grid xl:grid-cols-2 gap-3">
        {list.map((p) => <PolicyCard key={`${p.id}:${scopeId}`} p={p} scopeType={scopeType} scopeId={scopeId} nameOf={nameOf} />)}
      </div>
    </div>
  );
}

function PolicyCard({ p, scopeType, scopeId, nameOf }: { p: PolicyMeta; scopeType: 'TENANT' | 'BRANCH'; scopeId: string; nameOf: (id: string) => string }) {
  const eff = useQuery<any>('Settings.Effective', { query: { policyId: p.id, scopeType, scopeId } });
  const perm = usePerm('settings:updatepolicy');
  const [draft, setDraft] = useState<any>(undefined);
  const [confirm, setConfirm] = useState<null | { state: 'SET' | 'INHERIT' }>(null);
  const [hist, setHist] = useState(false);
  const row = (eff.data?.rows ?? []).find((r: any) => r.scopeType === scopeType && r.scopeId === scopeId) ?? null;
  const value = eff.data?.value;
  const scopeAllowed = p.scopes.includes(scopeType);
  const editable = p.editor.kind === 'enum' || p.editor.kind === 'bool' || p.editor.kind === 'object';
  const editing = draft !== undefined;
  return (
    <div className="glass rounded-xl p-3 space-y-2" data-fb={`settings:policy:${p.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-bold text-sm">{p.title}</div>
          <div className="text-[11px] text-dim num">{p.id}</div>
        </div>
        <div className="flex items-center gap-1 flex-wrap justify-end">
          {p.state === 'DIRECTION' ? <StateBadge state="PROPOSED" /> : <Pill tone={stateTone[p.state]}>{t(stateLabel[p.state])}</Pill>}
          {p.sensitive && <Pill tone="warning">{t('حساس')}</Pill>}
          <Pill tone="neutral">{p.appliesTo === 'NEW_CHECKS' ? t('للشيكات الجديدة') : t('للعمليات الجديدة')}</Pill>
        </div>
      </div>
      <div className="text-xs text-soft">{p.description}</div>
      <Refused error={eff.error} />
      <div className="rounded-lg surface-1 p-2">
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="text-[11px] text-dim">{editing ? t('القيمة الجديدة (لسه متحفظتش)') : t('القيمة الفعلية')}</span>
          {!editing && <span className="text-[10px] text-dim">{row ? t('من النطاق ده · نسخة {v}', { v: row.version }) : t('موروثة من نطاق أعلى أو الافتراضي')}</span>}
        </div>
        {editing ? <Editor p={p} value={draft} onChange={setDraft} /> : <ValueView p={p} value={value} />}
      </div>
      {row && <div className="text-[10px] text-dim">{t('آخر تغيير')}: {dateTime(row.updatedAt)} · {nameOf(row.updatedBy)} · <span className="num">{row.source}</span></div>}
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
        <span className="text-dim">{t('بروفايل مصر')}</span><span className="num break-all">{show(p.egValue)}{p.confidence ? ` · ${p.confidence}` : ''}{p.reviewer ? ` · ${p.reviewer}` : ''}</span>
        <span className="text-dim">{t('الافتراضي الآمن')}</span><span className="num break-all">{show(p.canonicalDefault)}</span>
        <span className="text-dim">{t('النطاقات المسموحة')}</span><span className="num">{p.scopes.join(' · ')}</span>
        {p.reacts && <><span className="text-dim">{t('بيأثر على')}</span><span>{p.reacts}</span></>}
      </div>
      {p.question && <div className="text-[11px] rounded-lg bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] border border-[color-mix(in_srgb,var(--warning)_30%,transparent)] px-2 py-1"><b>{t('سؤال للخبير')}:</b> {p.question}</div>}
      {!scopeAllowed && <div className="text-[11px] text-[var(--warning)]">{t('النطاق ده مش مسموح للسياسة دي (SETTINGS_POLICY_SCOPE_NOT_ALLOWED) — المسموح: {s}', { s: p.scopes.join(', ') })}</div>}
      {!editable && <div className="text-[11px] text-dim">{t('بتتعدل من لوحة الإعدادات (Policy Panel) — هنا عرض بس.')}</div>}
      <div className="flex items-center gap-2 flex-wrap">
        {editing ? (
          <>
            <Button size="sm" variant="primary" data-fb={`settings:save:${p.id}`} onClick={() => setConfirm({ state: 'SET' })}>{t('حفظ…')}</Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft(undefined)}>{t('إلغاء')}</Button>
          </>
        ) : (
          editable && <Button size="sm" variant="outline" data-fb={`settings:edit:${p.id}`} disabled={!perm.ok || !scopeAllowed || value === undefined} title={perm.title} onClick={() => setDraft(structuredClone(value ?? (p.editor.kind === 'object' ? {} : value)))}><Pencil className="w-3.5 h-3.5" />{t('تعديل')}</Button>
        )}
        {!editing && row && scopeType === 'BRANCH' && <Button size="sm" variant="ghost" disabled={!perm.ok} onClick={() => setConfirm({ state: 'INHERIT' })} data-fb={`settings:inherit:${p.id}`}><Undo2 className="w-3.5 h-3.5" />{t('ارجع للموروث')}</Button>}
        <button className="text-[11px] text-dim flex items-center gap-1 hover:text-[var(--primary)] ms-auto" onClick={() => setHist(!hist)} data-fb={`settings:history:${p.id}`}><History className="w-3 h-3" />{t('السجل')}</button>
      </div>
      {hist && <PolicyHistory policyId={p.id} nameOf={nameOf} />}
      {confirm && <SaveModal p={p} scopeType={scopeType} scopeId={scopeId} row={row} oldValue={value} newValue={confirm.state === 'INHERIT' ? undefined : draft} state={confirm.state} onClose={(ok) => { setConfirm(null); if (ok) setDraft(undefined); }} />}
    </div>
  );
}

function ValueView({ p, value }: { p: PolicyMeta; value: any }) {
  if (p.editor.kind === 'approvals') {
    return (
      <div className="space-y-1">
        <Table head={[t('العملية'), t('القاعدة'), '']} rows={APPROVAL_ACTIONS.map((a) => [
          <span className="text-xs">{a.title} <span className="num text-dim text-[10px]">{a.id}</span></span>,
          <span className="num text-xs">{ruleText(value?.[a.id] ?? a.defaultRule)}</span>,
          a.state !== 'CANONICAL' ? <Pill tone={a.state === 'CORE' ? 'info' : 'violet'}>{a.state === 'CORE' ? 'CORE' : t('مقترح')}</Pill> : null,
        ])} />
        <div className="text-[11px] text-dim">{t('تعديل قواعد الموافقة من لوحة الإعدادات (Policy Panel). تخفيض قاعدة SENSITIVE_POLICY_CHANGE نفسه بيحتاج موافقة تحت القاعدة القديمة.')}</div>
      </div>
    );
  }
  if (p.editor.kind === 'selfApproval') {
    const allowed = Object.entries(value ?? {}).filter(([, v]: any) => v?.mode === 'ALLOW').map(([k]) => k);
    return <div className="text-xs">{allowed.length ? <>{t('مسموح يوافق على طلبه في:')} <span className="num">{allowed.join('، ')}</span></> : t('ممنوع في كل العمليات (SELF_APPROVAL_DENIED)')}</div>;
  }
  if (p.editor.kind === 'object') {
    return <KV className="text-xs" rows={p.editor.fields.map((f) => [f.label, <span className="num">{show(getPath(value, f.key))}</span>] as [React.ReactNode, React.ReactNode])} />;
  }
  return <div className="text-sm num font-bold break-all">{show(value)}</div>;
}

function Editor({ p, value, onChange }: { p: PolicyMeta; value: any; onChange: (v: unknown) => void }) {
  const e = p.editor;
  if (e.kind === 'enum') return <div className="flex flex-wrap gap-1">{e.options.map((o) => <button key={o} type="button" onClick={() => onChange(o)} className={cn('px-2 h-7 rounded-lg text-[11px] num border', value === o ? 'bg-[var(--primary)] text-[var(--primary-foreground)] border-transparent font-bold' : 'surface-2 border-[var(--glass-border)]')}>{o}</button>)}</div>;
  if (e.kind === 'bool') return <Switch checked={!!value} onChange={(v) => onChange(v)} label={value ? 'true' : 'false'} />;
  if (e.kind === 'object') return <div className="grid grid-cols-2 gap-2">{e.fields.map((f) => <FieldEditor key={f.key} f={f} value={getPath(value, f.key)} onChange={(v) => onChange(setPath(value, f.key, v))} />)}</div>;
  return <ValueView p={p} value={value} />;
}

function FieldEditor({ f, value, onChange }: { f: PField; value: any; onChange: (v: any) => void }) {
  return (
    <label className="flex flex-col gap-1 min-w-0">
      <span className="text-[10px] text-dim">{f.label}</span>
      {f.kind === 'enum' && <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)} options={[{ value: '', label: '—' }, ...f.options.map((o) => ({ value: o, label: o }))]} className="!py-1 text-xs num" />}
      {f.kind === 'bool' && <Switch checked={!!value} onChange={onChange} />}
      {f.kind === 'multi' && <div className="flex flex-wrap gap-1">{f.options.map((o) => { const arr: string[] = value ?? []; const on = arr.includes(o); return <button key={o} type="button" onClick={() => onChange(on ? arr.filter((x) => x !== o) : [...arr, o])} className={cn('px-1.5 h-6 rounded text-[10px] num border', on ? 'bg-[var(--primary)] text-[var(--primary-foreground)] border-transparent font-bold' : 'surface-2 border-[var(--glass-border)]')}>{o}</button>; })}</div>}
      {f.kind === 'number' && <Input type="number" value={value ?? ''} min={f.min} max={f.max} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} className="!py-1 text-xs" />}
      {(f.kind === 'money' || f.kind === 'percent' || f.kind === 'percentOrNone') && (
        <div className="flex gap-1 items-center">
          {/* decimals travel as strings, never floats (docs/24 §3) */}
          <Input inputMode="decimal" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value.replace(/[^\d.]/g, ''))} className="!py-1 text-xs" placeholder={f.kind === 'percentOrNone' ? t('مش متفعلة') : ''} />
          {f.kind === 'percentOrNone' && value !== undefined && <button type="button" className="text-[10px] text-dim px-1" onClick={() => onChange(undefined)}>✕</button>}
        </div>
      )}
      {(f.kind === 'text' || f.kind === 'time') && <Input type={f.kind === 'time' ? 'time' : 'text'} value={value ?? ''} onChange={(e) => onChange(e.target.value)} className="!py-1 text-xs" dir="ltr" />}
    </label>
  );
}

function SaveModal({ p, scopeType, scopeId, row, oldValue, newValue, state, onClose }: { p: PolicyMeta; scopeType: string; scopeId: string; row: any | null; oldValue: any; newValue: any; state: 'SET' | 'INHERIT'; onClose: (ok: boolean) => void }) {
  const { run, busy } = useCommand();
  const [note, setNote] = useState('');
  const save = async () => {
    const body: any = { scopeType, scopeId, changeNote: note.trim() || undefined, state };
    if (state === 'SET') body.value = newValue;
    if (row) body.expectedVersion = row.version;
    const r = await run('Settings.UpdatePolicy', { params: { policyId: p.id }, body }, { success: t('اتحفظت {p} — بتطبق على العمليات الجديدة بس', { p: p.title }) });
    if (r) onClose(true);
  };
  return (
    <Modal open wide onClose={() => onClose(false)} title={<span className="flex items-center gap-2"><ShieldAlert className="w-5 h-5 text-[var(--warning)]" />{t('تأكيد تغيير إعداد')}</span>} badge={<StateBadge ops={['Settings.UpdatePolicy']} />}
      footer={<><Button variant="ghost" onClick={() => onClose(false)}>{t('إلغاء')}</Button><Button variant="primary" loading={busy} onClick={save} data-fb="settings:confirm-save">{t('ابعت التغيير')}</Button></>}>
      <div className="space-y-3">
        <KV className="text-sm" rows={[
          [t('السياسة'), <span>{p.title} <span className="num text-dim text-xs">{p.id}</span></span>],
          [t('النطاق'), <span className="num">{scopeType}:{scopeId}</span>],
          [t('القيمة الحالية'), <span className="num text-xs break-all">{show(oldValue)}</span>],
          [t('القيمة الجديدة'), state === 'INHERIT' ? <Pill tone="info">INHERIT — {t('يرجع للنطاق الأعلى')}</Pill> : <span className="num text-xs break-all font-bold">{show(newValue)}</span>],
          ['expectedVersion', <span className="num">{row ? row.version : t('مفيش صف في النطاق ده (أول قيمة)')}</span>],
        ]} />
        <Field label={t('ملاحظة التغيير (بتتسجل في السجل)')}><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('مثلاً: صاحب المطعم وافق على ...')} data-fb="settings:change-note" /></Field>
        <div className="flex items-center gap-2 flex-wrap"><RulePill action="SENSITIVE_POLICY_CHANGE" /></div>
        <Banner tone="warning">{t('لو القاعدة بتطلب موافقة هتظهر شاشة موافقة المدير. نفس الشخص مينفعش يوافق على طلبه (SELF_APPROVAL_DENIED) — اختار مدير تاني زي demo-manager-2. الموافقة مربوطة بالقيمة القديمة والجديدة بالظبط.')}</Banner>
      </div>
    </Modal>
  );
}

function PolicyHistory({ policyId, nameOf }: { policyId: string; nameOf: (id: string) => string }) {
  const h = useList<any>('Policy.History', { params: { policyId }, query: { limit: 20 } });
  return (
    <div className="rounded-lg surface-1 p-2 space-y-1">
      <div className="flex items-center gap-2"><span className="text-[11px] font-bold">{t('السجل')}</span><StateBadge ops={['Policy.History']} /></div>
      <Refused error={h.error} />
      {h.items.length === 0 && !h.error && <div className="text-[11px] text-dim">{t('مفيش تغييرات متسجلة')}</div>}
      {h.items.map((x) => (
        <div key={x.id} className="text-[10px] num text-dim break-all border-t line pt-1">
          <span className="text-soft">{dateTime(x.at)}</span> · <Pill tone={x.via === 'SETTINGS' ? 'success' : x.via === 'PANEL' ? 'violet' : 'neutral'}>{x.via}</Pill> · {x.scopeType}:{x.scopeId} · {nameOf(x.by)}
          <div>{show(x.oldValue)} → <span className="text-[var(--foreground)]">{show(x.newValue)}</span></div>
          {x.note && <div className="font-sans">“{x.note}”</div>}
        </div>
      ))}
    </div>
  );
}

// ───────── reason codes
function ReasonsTab() {
  const codes = useList<any>('ReasonCode.List');
  const pol = useQuery<any>('Settings.Effective', { query: { policyId: 'ReasonCodePolicy', scopeType: 'TENANT', scopeId: TENANT_ID } });
  const perm = usePerm('reasoncode:upsert');
  const [create, setCreate] = useState<string | null>(null);
  const [edit, setEdit] = useState<any | null>(null);
  const { run, busy } = useCommand();
  const kinds = useMemo(() => [...new Set([...REASON_KINDS, ...codes.items.map((c) => c.kind)])], [codes.items]);
  const mode = (k: string) => pol.data?.value?.[k] ?? null;
  const toggle = (c: any) => run('ReasonCode.Configure', { params: { reasonCodeId: c.id }, body: { active: !c.active, label: c.label, requiresNote: c.requiresNote, sortOrder: c.sortOrder, expectedVersion: c.version } }, { success: c.active ? t('اتوقف السبب {c}', { c: c.code }) : t('اتفعّل السبب {c}', { c: c.code }) });
  return (
    <div className="space-y-3">
      <Banner tone="info">{t('لكل نوع: MANAGED = الموظف يختار من القايمة دي بس (والملاحظة إجبارية لو السبب محتاجها)، FREE_TEXT = نص حر. التحويل لـ MANAGED بيتعمل من تبويب السياسات (ReasonCodePolicy) وبيترفض لو النوع مفيهوش سبب شغال، وآخر سبب شغال في نوع MANAGED مينفعش يتوقف. الكود والنوع ثابتين بعد الإنشاء.')}</Banner>
      <div className="flex justify-end"><Button size="sm" variant="primary" data-fb="reasons:new" disabled={!perm.ok} title={perm.title} onClick={() => setCreate('LINE_VOID')}><Plus className="w-4 h-4" />{t('سبب جديد')}</Button></div>
      <Refused error={codes.error} />
      <div className="grid xl:grid-cols-2 gap-3">
        {kinds.map((k) => {
          const list = codes.items.filter((c) => c.kind === k);
          const m = mode(k);
          const active = list.filter((c) => c.active).length;
          return (
            <Card key={k} title={<span>{reasonKindLabel(k)} <span className="num text-xs text-dim font-normal">{k}</span></span>}
              badge={<>{m ? <Pill tone={m === 'MANAGED' ? 'success' : 'neutral'}>{m}</Pill> : <Pill tone="neutral" title={t('مش في ReasonCodePolicy — الافتراضي نص حر')}>FREE_TEXT · {t('افتراضي')}</Pill>}{k === 'VARIANCE' && <StateBadge state="SPECIFIED" />}{k === 'REPRINT' && <StateBadge state="PROPOSED" />}</>}
              actions={<Button size="sm" variant="ghost" disabled={!perm.ok} title={perm.title} onClick={() => setCreate(k)} data-fb={`reasons:new:${k}`}><Plus className="w-3.5 h-3.5" /></Button>}>
              {m === 'MANAGED' && active === 0 && <Banner tone="error">{t('النوع ده MANAGED ومفيهوش سبب شغال!')}</Banner>}
              <Table head={[t('الكود'), t('عربي'), 'English', t('ملاحظة'), t('ترتيب'), t('الحالة'), '']}
                rows={list.map((c) => [
                  <span className="num font-bold text-xs">{c.code}</span>, c.label?.ar, <span dir="ltr">{c.label?.en}</span>,
                  c.requiresNote ? <Pill tone="warning">{t('إجبارية')}</Pill> : <span className="text-dim">—</span>,
                  <span className="num">{c.sortOrder}</span>,
                  c.active ? <Pill tone="success">{t('شغال')}</Pill> : <Pill tone="neutral">{t('موقوف')}</Pill>,
                  <div className="flex gap-1 justify-end">
                    <Button size="sm" variant="ghost" disabled={!perm.ok} title={perm.title} onClick={() => setEdit(c)} data-fb={`reasons:edit:${k}:${c.code}`}><Pencil className="w-3.5 h-3.5" /></Button>
                    <Button size="sm" variant="ghost" disabled={!perm.ok || busy} title={c.active ? t('إيقاف') : t('تفعيل')} onClick={() => toggle(c)} data-fb={`reasons:toggle:${k}:${c.code}`}><Power className={cn('w-3.5 h-3.5', c.active ? 'text-[var(--error)]' : 'text-[var(--success)]')} /></Button>
                  </div>,
                ])} empty={t('مفيش أسباب للنوع ده')} />
            </Card>
          );
        })}
      </div>
      {create && <ReasonModal kinds={kinds} kind={create} onClose={() => setCreate(null)} />}
      {edit && <ReasonModal kinds={kinds} code={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function ReasonModal({ kinds, kind, code, onClose }: { kinds: string[]; kind?: string; code?: any; onClose: () => void }) {
  const { run, busy } = useCommand();
  const [k, setK] = useState(code?.kind ?? kind ?? 'LINE_VOID');
  const [c, setC] = useState(code?.code ?? '');
  const [ar, setAr] = useState(code?.label?.ar ?? '');
  const [en, setEn] = useState(code?.label?.en ?? '');
  const [requiresNote, setRequiresNote] = useState<boolean>(code?.requiresNote ?? false);
  const [sortOrder, setSortOrder] = useState<string>(String(code?.sortOrder ?? 100));
  const [active, setActive] = useState<boolean>(code?.active ?? true);
  const codeOk = /^[A-Z0-9_]{1,32}$/.test(c);
  const save = async () => {
    const label = { ar: ar.trim(), en: en.trim() };
    const r = code
      ? await run('ReasonCode.Configure', { params: { reasonCodeId: code.id }, body: { label, requiresNote, sortOrder: Number(sortOrder), active, expectedVersion: code.version } }, { success: t('اتحفظ السبب') })
      : await run('ReasonCode.Create', { body: { kind: k, code: c, label, requiresNote, sortOrder: Number(sortOrder) } }, { success: t('اتعمل السبب {c}', { c }) });
    if (r) onClose();
  };
  return (
    <Modal open onClose={onClose} title={code ? t('تعديل السبب {c}', { c: code.code }) : t('سبب جديد')} badge={<StateBadge ops={[code ? 'ReasonCode.Configure' : 'ReasonCode.Create']} />}
      footer={<><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" loading={busy} disabled={!ar.trim() || !en.trim() || (!code && !codeOk)} onClick={save} data-fb="reasons:save">{t('حفظ')}</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('النوع')}><Select value={k} disabled={!!code} onChange={(e) => setK(e.target.value)} options={kinds.map((x) => ({ value: x, label: `${reasonKindLabel(x)} (${x})` }))} data-fb="reasons:kind" /></Field>
        <Field label={t('الكود')} hint={t('حروف إنجليزي كبيرة وأرقام و _ (لحد 32). تكراره في نفس النوع بيرجع REASON_CODE_TAKEN')} error={c && !codeOk ? t('شكل الكود غلط') : null}>
          <Input value={c} disabled={!!code} onChange={(e) => setC(e.target.value.toUpperCase().replace(/[\s-]+/g, '_'))} dir="ltr" data-fb="reasons:code" />
        </Field>
        <Field label={t('الاسم بالعربي')}><Input value={ar} maxLength={80} onChange={(e) => setAr(e.target.value)} data-fb="reasons:label-ar" /></Field>
        <Field label="English"><Input value={en} maxLength={80} onChange={(e) => setEn(e.target.value)} dir="ltr" data-fb="reasons:label-en" /></Field>
        <Field label={t('الترتيب')}><Input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} /></Field>
        <Field label={t('الملاحظة')}><Switch checked={requiresNote} onChange={setRequiresNote} label={requiresNote ? t('إجبارية') : t('اختيارية')} /></Field>
        {code && <Field label={t('الحالة')}><Switch checked={active} onChange={setActive} label={active ? t('شغال') : t('موقوف')} /></Field>}
      </div>
      {code && <div className="text-[11px] text-dim mt-3">{t('تغيير الاسم مش بيعدّل اللي اتسجل قبل كده: كل عملية محتفظة بنسخة السبب وقت ما اتعملت. expectedVersion = {v}', { v: code.version })}</div>}
    </Modal>
  );
}

