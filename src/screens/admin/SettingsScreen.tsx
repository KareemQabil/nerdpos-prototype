// B4 Settings & reason codes: the REAL settings screen. Every change is an append-only policy row through
// Settings.UpdatePolicy and needs SENSITIVE_POLICY_CHANGE approval by policy (the Policy Panel is the demo shortcut).
// Everything is shown in plain words (src/demo/policyText.ts); raw ids, JSON and codes only inside <Tech>.
import React, { useMemo, useState } from 'react';
import { History, Pencil, Search, ShieldAlert, Undo2, Plus, Power, ListChecks, SlidersHorizontal, HelpCircle } from 'lucide-react';
import { useCommand, useQuery } from '../../app/hooks';
import { Banner, Button, Card, EmptyState, Field, Input, KV, PageHeader, Pill, SearchInput, Select, StateBadge, Switch, Table, Tabs, Textarea, Toolbar } from '../../ui';
import { Tech } from '../../app/tech';
import { t, useLang } from '../../i18n';
import { cn, dateTime } from '../../lib/format';
import { POLICIES, POLICY_GROUPS, type PolicyMeta } from '../../mock/policyRegistry';
import { useList, usePerm, Refused, REASON_KINDS, Modal, useApprovalRule } from './org/common';
import { PolicyEditor, PolicyValueView, PolicyCompare, ScopesLine, rawJson } from '../../demo/PolicyEditors';
import { policyTitle, policyExplain, policyReacts, policyQuestion, STATE_TEXT, appliesToText, scopeText, valueSummary, viaText, historyValueText, reasonKindText, ruleSentence, optionText, type Ctx } from '../../demo/policyText';
import { branchLabel } from '../../demo/people';

const stateTone = { CANONICAL: 'success', CORE: 'info', PENDING: 'warning', DIRECTION: 'violet' } as const;
const TENANT_ID = 'biz'; // the business id (Business.Get) is the TENANT scope id

export default function SettingsScreen() {
  const [tab, setTab] = useState<'policies' | 'reasons'>('policies');
  return (
    <div className="space-y-4" data-fb="screen:B4">
      <PageHeader
        icon={<SlidersHorizontal />}
        title={t('الإعدادات والأسباب')}
        badge={<StateBadge ops={['Settings.Effective', 'Settings.UpdatePolicy', 'Policy.History', 'ReasonCode.List', 'ReasonCode.Create', 'ReasonCode.Configure']} />}
        description={t('هنا بتتغيّر طريقة شغل المطعم بجد. كل تغيير بيتسجل ومش بيمسح اللي قبله، والإعدادات الحساسة محتاجة موافقة مدير تاني.')}
        meta={<SensitiveRulePill />}
      />
      <Tabs variant="underline" value={tab} onChange={setTab} tabs={[{ id: 'policies', icon: <SlidersHorizontal className="w-4 h-4" />, label: t('إعدادات المطعم') }, { id: 'reasons', icon: <ListChecks className="w-4 h-4" />, label: t('أسباب الإلغاء والخصم') }]} />
      {tab === 'policies' ? <PoliciesTab /> : <ReasonsTab />}
    </div>
  );
}

function SensitiveRulePill() {
  const { rule } = useApprovalRule('SENSITIVE_POLICY_CHANGE');
  const needs = rule && rule.mode !== 'NEVER';
  return <Pill tone={needs ? 'warning' : 'neutral'} title={t('قاعدة موافقة «تغيير إعداد حساس»')}>{t('تغيير إعداد')}: {ruleSentence('SENSITIVE_POLICY_CHANGE', rule)}</Pill>;
}

function useTaxCtx(): Ctx {
  const taxes = useList<any>('TaxPolicy.List');
  return { taxName: (id) => { const x = taxes.items.find((p) => p.id === id); return x ? (typeof x.name === 'string' ? x.name : x.name?.ar ?? x.name?.en) : undefined; } };
}

// ───────── policies
function PoliciesTab() {
  const lang = useLang();
  const branches = useList<any>('Branch.List');
  const users = useList<any>('User.Find');
  const ctx = useTaxCtx();
  const [group, setGroup] = useState('orders');
  const [q, setQ] = useState('');
  const [scope, setScope] = useState('TENANT');
  const scopeType = scope === 'TENANT' ? 'TENANT' : 'BRANCH';
  const scopeId = scope === 'TENANT' ? TENANT_ID : scope;
  const branch = branches.items.find((b) => b.id === scope);
  const needle = q.trim().toLowerCase();
  const list = POLICIES.filter((p) => (needle ? (p.id + p.title + p.titleEn + p.description + policyTitle(p) + policyExplain(p)).toLowerCase().includes(needle) : p.group === group));
  const nameOf = (id: string) => users.items.find((u) => u.id === id)?.displayName ?? (id === 'demo' ? t('لوحة العرض') : id === 'provisioning' ? t('التجهيز') : t('شخص تاني'));
  return (
    <div className="space-y-3">
      <Toolbar className="mb-0">
        <SearchInput value={q} onChange={setQ} placeholder={t('دوّر على إعداد… (مثلًا: خدمة، درج، خصم)')} data-fb="settings:search" />
        <Toolbar.Spacer />
        <Select value={scope} onChange={(e) => setScope(e.target.value)} className="!w-auto min-w-[220px]" data-fb="settings:scope"
          options={[{ value: 'TENANT', label: t('بتظبط: المطعم كله') }, ...branches.items.map((b) => ({ value: b.id, label: t('بتظبط: {b} بس', { b: branchLabel(b) }) }))]} />
      </Toolbar>
      {!needle && <Tabs value={group} onChange={setGroup} tabs={POLICY_GROUPS.map((g) => ({ id: g.id, label: lang === 'ar' ? g.title.replace(' (مقترح)', '') : g.titleEn, count: POLICIES.filter((p) => p.group === g.id).length }))} />}
      <div className="text-xs text-dim leading-relaxed">{t('الفرع اللي مالوش قيمة خاصة بياخد قيمة المطعم كله. التغيير بيطبق على اللي جاي بس — الشيكات القديمة محتفظة بقيمتها. الموافقة لازم تيجي من مدير غير اللي طلب التغيير (مثلًا هبة — مديرة الفرع).')}</div>
      <div className="grid xl:grid-cols-2 gap-3 items-start">
        {list.map((p) => <PolicyCard key={`${p.id}:${scopeId}`} p={p} scopeType={scopeType} scopeId={scopeId} scopeName={branch ? branchLabel(branch) : undefined} nameOf={nameOf} ctx={ctx} />)}
      </div>
      {list.length === 0 && <EmptyState compact icon={<Search />} title={t('مفيش إعداد بالاسم ده')} text={t('جرّب كلمة تانية زي: خدمة، درج، خصم، ضريبة.')} />}
    </div>
  );
}

function PolicyCard({ p, scopeType, scopeId, scopeName, nameOf, ctx }: { p: PolicyMeta; scopeType: 'TENANT' | 'BRANCH'; scopeId: string; scopeName?: string; nameOf: (id: string) => string; ctx: Ctx }) {
  const eff = useQuery<any>('Settings.Effective', { query: { policyId: p.id, scopeType, scopeId } });
  const perm = usePerm('settings:updatepolicy');
  const [draft, setDraft] = useState<any>(undefined);
  const [confirm, setConfirm] = useState<null | { state: 'SET' | 'INHERIT' }>(null);
  const [hist, setHist] = useState(false);
  const row = (eff.data?.rows ?? []).find((r: any) => r.scopeType === scopeType && r.scopeId === scopeId) ?? null;
  const value = eff.data?.value;
  const scopeAllowed = p.scopes.includes(scopeType);
  const editable = p.editor.kind !== 'readonly';
  const editing = draft !== undefined;
  const reacts = policyReacts(p);
  const question = policyQuestion(p);
  return (
    <div className={cn('glass card-surface rounded-2xl p-4 space-y-2.5', editing && 'ring-2 ring-[var(--primary)]')} data-fb={`settings:policy:${p.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-bold text-sm">{policyTitle(p)}</div>
          <Tech><div className="text-[10px] text-dim num" dir="ltr">{p.id}</div></Tech>
        </div>
        <div className="flex items-center gap-1 flex-wrap justify-end">
          <Pill tone={stateTone[p.state]} title={t(STATE_TEXT[p.state].help)}>{t(STATE_TEXT[p.state].label)}</Pill>
          {p.sensitive && <Pill tone="warning">{t('حساس')}</Pill>}
        </div>
      </div>
      <div className="text-xs text-soft leading-relaxed">{policyExplain(p)}</div>
      <Refused error={eff.error} />
      <div className="rounded-lg surface-1 p-2.5">
        <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
          <span className="text-[11px] text-dim">{editing ? t('القيمة الجديدة (لسه ما اتحفظتش)') : t('دلوقتي')} · {scopeText(scopeType, scopeName)}</span>
          {!editing && <span className="text-[10px] text-dim">{row ? t('متظبطة هنا (التعديل رقم {v})', { v: row.version }) : t('جاية من مستوى أعلى أو الافتراضي')}</span>}
        </div>
        {editing ? <PolicyEditor p={p} value={draft} onChange={setDraft} /> : value === undefined && !eff.error ? <div className="text-xs text-dim">{t('بيحمّل…')}</div> : <PolicyValueView p={p} value={value} ctx={ctx} big />}
      </div>
      {row && <div className="text-[10px] text-dim">{t('آخر تغيير')}: {dateTime(row.updatedAt)} · {nameOf(row.updatedBy)}<Tech> · <span className="num">{row.source}</span></Tech></div>}
      {reacts && <div className="text-[11px]"><span className="text-dim">{t('هتلاحظ التغيير في')}: </span>{reacts}</div>}
      {value !== undefined && <PolicyCompare p={p} current={value} inherited={!row} ctx={ctx} />}
      <div className="flex items-center gap-3 flex-wrap text-[11px] text-dim"><span>{appliesToText(p.appliesTo)}</span><ScopesLine p={p} /></div>
      {question && <div className="text-[11px] rounded-lg bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] border border-[color-mix(in_srgb,var(--warning)_30%,transparent)] px-2 py-1 flex gap-1"><HelpCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[var(--warning)]" /><span><b>{t('سؤال للخبير')}:</b> {question}</span></div>}
      {!scopeAllowed && <div className="text-[11px] text-[var(--warning)]">{t('الإعداد ده مينفعش يتظبط لفرع لوحده — اختار «المطعم كله» من فوق.')}</div>}
      <div className="flex items-center gap-2 flex-wrap">
        {editing ? (
          <>
            <Button size="sm" variant="primary" data-fb={`settings:save:${p.id}`} onClick={() => setConfirm({ state: 'SET' })}>{t('احفظ…')}</Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft(undefined)}>{t('إلغاء')}</Button>
            <span className="text-[11px] text-[var(--warning)]">{t('فيه تغيير لسه ما اتحفظش')}</span>
          </>
        ) : (
          editable && <Button size="sm" variant="outline" data-fb={`settings:edit:${p.id}`} disabled={!perm.ok || !scopeAllowed || value === undefined} title={perm.ok ? undefined : t('الحساب ده مش مسموح له يغيّر الإعدادات')} onClick={() => setDraft(structuredClone(value ?? (p.editor.kind === 'object' ? {} : value)))}><Pencil className="w-3.5 h-3.5" />{t('غيّر')}</Button>
        )}
        {!editing && row && scopeType === 'BRANCH' && <Button size="sm" variant="ghost" disabled={!perm.ok} onClick={() => setConfirm({ state: 'INHERIT' })} data-fb={`settings:inherit:${p.id}`}><Undo2 className="w-3.5 h-3.5" />{t('رجّعه زي المطعم كله')}</Button>}
        <button className="text-[11px] text-dim flex items-center gap-1 hover:text-[var(--primary)] ms-auto" onClick={() => setHist(!hist)} data-fb={`settings:history:${p.id}`}><History className="w-3 h-3" />{t('اتغيّر إمتى')}</button>
      </div>
      {hist && <PolicyHistory p={p} nameOf={nameOf} ctx={ctx} />}
      {confirm && <SaveModal p={p} scopeType={scopeType} scopeId={scopeId} scopeName={scopeName} row={row} oldValue={value} newValue={confirm.state === 'INHERIT' ? undefined : draft} state={confirm.state} ctx={ctx} onClose={(ok) => { setConfirm(null); if (ok) setDraft(undefined); }} />}
    </div>
  );
}

function SaveModal({ p, scopeType, scopeId, scopeName, row, oldValue, newValue, state, ctx, onClose }: { p: PolicyMeta; scopeType: string; scopeId: string; scopeName?: string; row: any | null; oldValue: any; newValue: any; state: 'SET' | 'INHERIT'; ctx: Ctx; onClose: (ok: boolean) => void }) {
  const { run, busy } = useCommand();
  const [note, setNote] = useState('');
  const save = async () => {
    const body: any = { scopeType, scopeId, changeNote: note.trim() || undefined, state };
    if (state === 'SET') body.value = newValue;
    if (row) body.expectedVersion = row.version;
    const r = await run('Settings.UpdatePolicy', { params: { policyId: p.id }, body }, { success: t('اتحفظ «{p}» — هيطبق على اللي جاي بس', { p: policyTitle(p) }) });
    if (r) onClose(true);
  };
  return (
    <Modal open wide onClose={() => onClose(false)} title={<span className="flex items-center gap-2"><ShieldAlert className="w-5 h-5 text-[var(--warning)]" />{t('تأكيد تغيير إعداد')}</span>} badge={<StateBadge ops={['Settings.UpdatePolicy']} />}
      footer={<><Button variant="ghost" onClick={() => onClose(false)}>{t('إلغاء')}</Button><Button variant="primary" loading={busy} onClick={save} data-fb="settings:confirm-save">{t('ابعت التغيير')}</Button></>}>
      <div className="space-y-3">
        <KV className="text-sm" rows={[
          [t('الإعداد'), <b>{policyTitle(p)}</b>],
          [t('على'), scopeText(scopeType, scopeName)],
          [t('دلوقتي'), <span className="text-xs">{valueSummary(p, oldValue, ctx)}</span>],
          [t('هيبقى'), state === 'INHERIT' ? <Pill tone="info">{t('يرجع زي المطعم كله')}</Pill> : <span className="text-xs font-bold">{valueSummary(p, newValue, ctx)}</span>],
        ]} />
        <Tech>
          <div className="rounded-lg bg-black/20 p-2 num text-[10px] break-all space-y-0.5" dir="ltr" style={{ textAlign: 'left' }}>
            <div>{p.id} · {scopeType}:{scopeId} · state {state} · expectedVersion {row ? row.version : '— (first row)'}</div>
            <div>old: {rawJson(oldValue)}</div><div>new: {rawJson(newValue)}</div>
          </div>
        </Tech>
        <Field label={t('ملاحظة (بتتسجل في السجل)')}><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('مثلًا: صاحب المطعم وافق على ...')} data-fb="settings:change-note" /></Field>
        <div className="flex items-center gap-2 flex-wrap"><SensitiveRulePill /></div>
        <Banner tone="warning">{t('لو التغيير محتاج موافقة، هتظهر شاشة «موافقة مدير». نفس الشخص مينفعش يوافق على طلبه — اختار مدير تاني (مثلًا هبة — مديرة الفرع). الموافقة بتبقى على التغيير ده بالظبط.')}</Banner>
      </div>
    </Modal>
  );
}

function PolicyHistory({ p, nameOf, ctx }: { p: PolicyMeta; nameOf: (id: string) => string; ctx: Ctx }) {
  const h = useList<any>('Policy.History', { params: { policyId: p.id }, query: { limit: 20 } });
  return (
    <div className="rounded-lg surface-1 p-2 space-y-1">
      <div className="flex items-center gap-2"><span className="text-[11px] font-bold">{t('اتغيّر إمتى')}</span><StateBadge ops={['Policy.History']} /></div>
      <Refused error={h.error} />
      {h.items.length === 0 && !h.error && <div className="text-[11px] text-dim">{t('ما اتغيّرش لسه')}</div>}
      {h.items.map((x) => (
        <div key={x.id} className="text-[11px] border-t line pt-1">
          <span className="text-soft">{dateTime(x.at)}</span> · <Pill tone={x.via === 'SETTINGS' ? 'success' : x.via === 'PANEL' ? 'violet' : 'neutral'}>{viaText(x.via)}</Pill> · {scopeText(x.scopeType)} · {nameOf(x.by)}
          <div>{historyValueText(p, x.oldValue, ctx)} ← <b>{historyValueText(p, x.newValue, ctx)}</b></div>
          {x.note && <div>“{x.note}”</div>}
          <Tech><div className="num text-[10px] text-dim break-all" dir="ltr">{x.via} · {x.scopeType}:{x.scopeId} · {rawJson(x.oldValue)} → {rawJson(x.newValue)}</div></Tech>
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
  const toggle = (c: any) => run('ReasonCode.Configure', { params: { reasonCodeId: c.id }, body: { active: !c.active, label: c.label, requiresNote: c.requiresNote, sortOrder: c.sortOrder, expectedVersion: c.version } }, { success: c.active ? t('اتوقف السبب «{c}»', { c: c.label?.ar ?? c.code }) : t('اتفعّل السبب «{c}»', { c: c.label?.ar ?? c.code }) });
  const permTitle = perm.ok ? undefined : t('الحساب ده مش مسموح له يعدّل الأسباب');
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="text-xs text-dim leading-relaxed max-w-3xl">{t('لكل نوع حركة: «من قايمة ثابتة» يعني الموظف يختار سبب من القايمة دي بس، و«كتابة حرة» يعني يكتب السبب بإيده (بتتغير من تبويب «إعدادات المطعم»). القايمة لازم يفضل فيها سبب واحد شغال على الأقل.')}</div>
        <Button variant="primary" data-fb="reasons:new" disabled={!perm.ok} title={permTitle} onClick={() => setCreate('LINE_VOID')}><Plus className="w-4 h-4" />{t('سبب جديد')}</Button>
      </div>
      <Refused error={codes.error} />
      <div className="grid xl:grid-cols-2 gap-3">
        {kinds.map((k) => {
          const list = codes.items.filter((c) => c.kind === k);
          const m = mode(k);
          const active = list.filter((c) => c.active).length;
          return (
            <Card key={k} title={<span>{reasonKindText(k)}<Tech><span className="num text-xs text-dim font-normal ms-1">{k}</span></Tech></span>}
              badge={<>{m ? <Pill tone={m === 'MANAGED' ? 'success' : 'neutral'}>{optionText('ReasonCodePolicy', k, m).label}</Pill> : <Pill tone="neutral">{t('كتابة حرة (الافتراضي)')}</Pill>}{k === 'VARIANCE' && <StateBadge state="SPECIFIED" />}{k === 'REPRINT' && <StateBadge state="PROPOSED" />}</>}
              description={t('{a} سبب شغال من {n}', { a: active, n: list.length })}
              actions={<Button size="sm" variant="ghost" disabled={!perm.ok} title={permTitle ?? t('سبب جديد')} onClick={() => setCreate(k)} data-fb={`reasons:new:${k}`}><Plus className="w-3.5 h-3.5" /></Button>}>
              {m === 'MANAGED' && active === 0 && <Banner tone="error">{t('النوع ده بيختار من قايمة، ومفيش ولا سبب شغال فيها! فعّل سبب.')}</Banner>}
              <Table dense align={[undefined, undefined, undefined, 'end', undefined, 'end']} head={[t('السبب'), t('بالإنجليزي'), t('ملاحظة'), t('الترتيب'), t('الحالة'), '']}
                rows={list.map((c) => [
                  <span>{c.label?.ar}<Tech><span className="num text-[10px] text-dim ms-1" dir="ltr">{c.code}</span></Tech></span>, <span dir="ltr">{c.label?.en}</span>,
                  c.requiresNote ? <Pill tone="warning">{t('إجبارية')}</Pill> : <span className="text-dim">—</span>,
                  <span className="num">{c.sortOrder}</span>,
                  c.active ? <Pill tone="success">{t('شغال')}</Pill> : <Pill tone="neutral">{t('موقوف')}</Pill>,
                  <div className="flex gap-1 justify-end">
                    <Button size="sm" variant="ghost" disabled={!perm.ok} title={permTitle ?? t('تعديل')} onClick={() => setEdit(c)} data-fb={`reasons:edit:${k}:${c.code}`}><Pencil className="w-3.5 h-3.5" /></Button>
                    <Button size="sm" variant="ghost" disabled={!perm.ok || busy} title={c.active ? t('إيقاف') : t('تفعيل')} onClick={() => toggle(c)} data-fb={`reasons:toggle:${k}:${c.code}`}><Power className={cn('w-3.5 h-3.5', c.active ? 'text-[var(--error)]' : 'text-[var(--success)]')} /></Button>
                  </div>,
                ])} empty={<span>{t('مفيش أسباب للنوع ده — ضيف سبب من زرار +')}</span>} />
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
      : await run('ReasonCode.Create', { body: { kind: k, code: c, label, requiresNote, sortOrder: Number(sortOrder) } }, { success: t('اتعمل السبب «{c}»', { c: label.ar }) });
    if (r) onClose();
  };
  return (
    <Modal open onClose={onClose} title={code ? t('تعديل السبب «{c}»', { c: code.label?.ar ?? code.code }) : t('سبب جديد')} badge={<StateBadge ops={[code ? 'ReasonCode.Configure' : 'ReasonCode.Create']} />}
      footer={<><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" loading={busy} disabled={!ar.trim() || !en.trim() || (!code && !codeOk)} onClick={save} data-fb="reasons:save">{t('حفظ')}</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('نوع الحركة')}><Select value={k} disabled={!!code} onChange={(e) => setK(e.target.value)} options={kinds.map((x) => ({ value: x, label: reasonKindText(x) }))} data-fb="reasons:kind" /></Field>
        <Field label={t('كود قصير بالإنجليزي')} hint={t('حروف إنجليزي كبيرة وأرقام و _ — مثلًا WRONG_ITEM. مينفعش يتكرر في نفس النوع.')} error={c && !codeOk ? t('الكود لازم يبقى حروف إنجليزي كبيرة وأرقام و _ بس') : null}>
          <Input value={c} disabled={!!code} onChange={(e) => setC(e.target.value.toUpperCase().replace(/[\s-]+/g, '_'))} dir="ltr" data-fb="reasons:code" />
        </Field>
        <Field label={t('السبب بالعربي')}><Input value={ar} maxLength={80} onChange={(e) => setAr(e.target.value)} data-fb="reasons:label-ar" /></Field>
        <Field label={t('السبب بالإنجليزي')}><Input value={en} maxLength={80} onChange={(e) => setEn(e.target.value)} dir="ltr" data-fb="reasons:label-en" /></Field>
        <Field label={t('الترتيب في القايمة')}><Input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} /></Field>
        <Field label={t('الملاحظة')}><Switch checked={requiresNote} onChange={setRequiresNote} label={requiresNote ? t('لازم الموظف يكتب ملاحظة') : t('اختيارية')} /></Field>
        {code && <Field label={t('الحالة')}><Switch checked={active} onChange={setActive} label={active ? t('شغال') : t('موقوف')} /></Field>}
      </div>
      {code && <div className="text-[11px] text-dim mt-3">{t('تغيير الاسم مش بيغيّر اللي اتسجل قبل كده: كل حركة محتفظة بالسبب زي ما كان وقتها.')}<Tech> <span className="num">expectedVersion = {code.version}</span></Tech></div>}
    </Modal>
  );
}
