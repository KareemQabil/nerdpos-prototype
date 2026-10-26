// Policy Panel (03_DIRECTION §2): every policy, its current value, allowed values, the Egyptian default and scope.
// Flipping a value applies immediately to new actions; existing checks are never rewritten.
import React, { useMemo, useState } from 'react';
import { X, Search, History, Info, RotateCcw } from 'lucide-react';
import { POLICIES, POLICY_GROUPS, APPROVAL_ACTIONS, type PolicyMeta, type Field, type Rule } from '../mock/policyRegistry';
import { store } from '../mock/store';
import { demo } from '../mock/demo';
import { useStoreVersion } from '../app/hooks';
import { Pill, Select, Input, Switch, Button, Tabs, toast } from '../ui';
import { t, useLang } from '../i18n';
import { cn } from '../lib/format';
import { errorText } from '../app/hooks';

const stateTone = { CANONICAL: 'success', CORE: 'info', PENDING: 'warning', DIRECTION: 'violet' } as const;
const stateLabel = { CANONICAL: 'متصمم (canonical)', CORE: 'CORE جديد', PENDING: 'معلّق للخبير', DIRECTION: 'مقترح' } as const;

const getPath = (o: any, path: string) => path.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
function setPath(o: any, path: string, v: any) {
  const out = structuredClone(o ?? {});
  const keys = path.split('.');
  let cur = out;
  keys.slice(0, -1).forEach((k) => { cur[k] = cur[k] ?? {}; cur = cur[k]; });
  if (v === undefined) delete cur[keys.at(-1)!]; else cur[keys.at(-1)!] = v;
  return out;
}
const show = (v: unknown) => (v === undefined || v === null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

export function PolicyPanel({ onClose }: { onClose: () => void }) {
  useStoreVersion();
  const lang = useLang();
  const [group, setGroup] = useState('orders');
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<'TENANT' | 'BRANCH'>('TENANT');
  const branchId = store.db.branches[0]?.id ?? 'branch_main';
  const list = POLICIES.filter((p) => (q ? (p.id + p.title + p.titleEn + p.description).toLowerCase().includes(q.toLowerCase()) : p.group === group));
  return (
    <div className="flex flex-col h-full" data-screen="POLICY_PANEL">
      <div className="px-4 py-3 border-b line flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-bold">{t('لوحة الإعدادات (Policy Panel)')}</div>
          <div className="text-[11px] text-dim">{t('منصة واحدة، مطاعم كتير، من غير اختيارات مكتوبة في الكود. التغيير بيطبق على العمليات الجديدة بس.')}</div>
        </div>
        <button onClick={onClose} className="w-8 h-8 rounded-lg surface-1 flex items-center justify-center"><X className="w-4 h-4" /></button>
      </div>
      <div className="px-4 py-2 space-y-2 border-b line">
        <div className="flex gap-2">
          <div className="relative flex-1"><Search className="w-4 h-4 absolute top-3 start-3 text-dim" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('دوّر على سياسة…')} className="ps-9" /></div>
          <Select value={scope} onChange={(e) => setScope(e.target.value as any)} options={[{ value: 'TENANT', label: t('النطاق: النشاط كله') }, { value: 'BRANCH', label: t('النطاق: الفرع الرئيسي') }]} className="max-w-[180px]" />
        </div>
        {!q && <Tabs value={group} onChange={setGroup} tabs={POLICY_GROUPS.map((g) => ({ id: g.id, label: lang === 'ar' ? g.title : g.titleEn }))} />}
        <div className="text-[11px] text-dim flex items-start gap-1"><Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />{t('وضع العرض: التغيير هنا فوري ومن غير موافقة. الشاشة الحقيقية (B4 الإعدادات) بتطلب موافقة SENSITIVE_POLICY_CHANGE.')}</div>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {list.map((p) => <PolicyCard key={p.id} p={p} scope={scope} branchId={branchId} />)}
        {group === 'direction' && !q && <Button variant="ghost" size="sm" onClick={() => { demo.applyEgProfile(); toast('success', t('اتطبق بروفايل مصر تاني')); }}><RotateCcw className="w-4 h-4" />{t('طبّق بروفايل مصر (EG.profile) تاني')}</Button>}
      </div>
    </div>
  );
}

function PolicyCard({ p, scope, branchId }: { p: PolicyMeta; scope: 'TENANT' | 'BRANCH'; branchId: string }) {
  const [hist, setHist] = useState(false);
  const scopeId = scope === 'TENANT' ? 'biz' : branchId;
  const row = store.db.policyValues.find((v) => v.policyId === p.id && v.scopeType === scope && v.scopeId === scopeId);
  const effective = demo.policy(p.id, scope === 'BRANCH' ? { branchId } : {});
  const value = row?.value ?? effective;
  const scopeAllowed = p.scopes.includes(scope);
  const set = (v: unknown) => {
    try {
      demo.setPolicy(p.id, v, scope, scopeId);
      toast('success', t('اتغيرت {p} — بتطبق على العمليات الجديدة بس', { p: p.title }), `${p.id} @ ${scope}`);
    } catch (e) { toast('error', errorText(e), (e as any).code); }
  };
  const history = store.db.policyHistory.filter((h) => h.policyId === p.id).slice(0, 8);
  return (
    <div className="rounded-xl border line surface-1 p-3 space-y-2" data-fb={`policy:${p.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-bold text-sm">{p.title}</div>
          <div className="text-[11px] text-dim num">{p.id}</div>
        </div>
        <div className="flex items-center gap-1 flex-wrap justify-end">
          <Pill tone={stateTone[p.state]}>{t(stateLabel[p.state])}</Pill>
          <Pill tone="neutral">{p.appliesTo === 'NEW_CHECKS' ? t('للشيكات الجديدة') : t('للعمليات الجديدة')}</Pill>
        </div>
      </div>
      <div className="text-xs text-soft">{p.description}</div>
      {!scopeAllowed ? <div className="text-xs text-[var(--warning)]">{t('النطاق ده مش مسموح للسياسة دي')} ({p.scopes.join(', ')})</div> : <Editor p={p} value={value} onChange={set} />}
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
        <span className="text-dim">{t('الحالي')}</span><span className="num break-all">{show(effective)}{row ? '' : ` (${t('موروث')})`}</span>
        <span className="text-dim">{t('بروفايل مصر')}</span><span className="num break-all">{show(p.egValue)}{p.confidence ? ` · ${p.confidence}` : ''}</span>
        <span className="text-dim">{t('الافتراضي الآمن')}</span><span className="num break-all">{show(p.canonicalDefault)}</span>
        <span className="text-dim">{t('النطاقات')}</span><span className="num">{p.scopes.join(' · ')}</span>
        {p.reacts && <><span className="text-dim">{t('بيأثر على')}</span><span>{p.reacts}</span></>}
      </div>
      {p.question && <div className="text-[11px] rounded-lg bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] border border-[color-mix(in_srgb,var(--warning)_30%,transparent)] px-2 py-1"><b>{t('سؤال للخبير')}:</b> {p.question}</div>}
      <div className="flex items-center gap-2">
        <button className="text-[11px] text-dim flex items-center gap-1 hover:text-[var(--primary)]" onClick={() => setHist(!hist)}><History className="w-3 h-3" />{t('السجل')} ({history.length})</button>
        {row && scope === 'BRANCH' && <button className="text-[11px] text-dim hover:text-[var(--error)]" onClick={() => demo.clearPolicyScope(p.id, 'BRANCH', scopeId)}>{t('ارجع للموروث')}</button>}
      </div>
      {hist && <div className="space-y-1">{history.map((h) => <div key={h.id} className="text-[10px] num text-dim break-all">{h.at.slice(0, 16).replace('T', ' ')} · {h.via} · {h.scopeType} · {show(h.oldValue)} → {show(h.newValue)}</div>)}</div>}
    </div>
  );
}

function Editor({ p, value, onChange }: { p: PolicyMeta; value: any; onChange: (v: unknown) => void }) {
  const e = p.editor;
  if (e.kind === 'readonly') return <div className="text-xs num">{show(value)}</div>;
  if (e.kind === 'enum') return <div className="flex flex-wrap gap-1">{e.options.map((o) => <button key={o} onClick={() => onChange(o)} className={cn('px-2 h-7 rounded-lg text-[11px] num border', value === o ? 'bg-[var(--primary)] text-[var(--primary-foreground)] border-transparent font-bold' : 'surface-2 border-[var(--glass-border)]')}>{o}</button>)}</div>;
  if (e.kind === 'bool') return <Switch checked={!!value} onChange={(v) => onChange(v)} label={value ? 'true' : 'false'} />;
  if (e.kind === 'approvals') return <ApprovalsEditor value={value ?? {}} onChange={onChange} />;
  if (e.kind === 'selfApproval') return <SelfApprovalEditor value={value ?? {}} onChange={onChange} />;
  return <div className="grid grid-cols-2 gap-2">{e.fields.map((f) => <FieldEditor key={f.key} f={f} value={getPath(value, f.key)} onChange={(v) => onChange(setPath(value, f.key, v))} />)}</div>;
}

function FieldEditor({ f, value, onChange }: { f: Field; value: any; onChange: (v: any) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (v: string) => { setDraft(null); onChange(v); };
  return (
    <label className="flex flex-col gap-1 min-w-0">
      <span className="text-[10px] text-dim">{f.label}</span>
      {f.kind === 'enum' && <Select value={value ?? ''} onChange={(e) => onChange(e.target.value)} options={[...(value ? [] : [{ value: '', label: '—' }]), ...f.options.map((o) => ({ value: o, label: o }))]} className="!py-1 text-xs num" />}
      {f.kind === 'bool' && <Switch checked={!!value} onChange={onChange} />}
      {f.kind === 'multi' && <div className="flex flex-wrap gap-1">{f.options.map((o) => { const arr: string[] = value ?? []; const on = arr.includes(o); return <button key={o} onClick={() => onChange(on ? arr.filter((x) => x !== o) : [...arr, o])} className={cn('px-1.5 h-6 rounded text-[10px] num border', on ? 'bg-[var(--primary-container)] border-[var(--primary)] text-[var(--primary)]' : 'surface-2 border-[var(--glass-border)]')}>{o}</button>; })}</div>}
      {(f.kind === 'number' || f.kind === 'money' || f.kind === 'percent' || f.kind === 'text' || f.kind === 'time' || f.kind === 'percentOrNone') && (
        <div className="flex gap-1">
          <Input value={draft ?? (value ?? '')} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft !== null && commit(f.kind === 'number' ? (Number(draft) as any) : draft)} onKeyDown={(e) => e.key === 'Enter' && draft !== null && commit(f.kind === 'number' ? (Number(draft) as any) : draft)} className="!py-1 text-xs" inputMode={f.kind === 'text' ? 'text' : 'decimal'} placeholder={f.kind === 'percentOrNone' ? t('فاضي = مفيش') : ''} />
          {f.kind === 'percentOrNone' && value !== undefined && <button className="text-[10px] text-dim px-1" onClick={() => onChange(undefined)}>✕</button>}
        </div>
      )}
    </label>
  );
}

function ApprovalsEditor({ value, onChange }: { value: Record<string, Rule>; onChange: (v: unknown) => void }) {
  return (
    <div className="space-y-1.5">
      {APPROVAL_ACTIONS.map((a) => {
        const r: any = value[a.id] ?? a.defaultRule;
        const set = (nr: any) => onChange({ ...value, [a.id]: nr });
        const fields = r.mode === 'WHEN_TRUE' ? a.boolean : a.numeric;
        return (
          <div key={a.id} className="rounded-lg surface-2 px-2 py-1.5" data-fb={`approval-rule:${a.id}`}>
            <div className="flex items-center justify-between gap-2"><div className="text-xs font-bold min-w-0 truncate">{a.title} <span className="num text-dim font-normal text-[10px]">{a.id}</span></div>{a.state !== 'CANONICAL' && <Pill tone={a.state === 'CORE' ? 'info' : 'violet'}>{a.state === 'CORE' ? 'CORE' : t('مقترح')}</Pill>}</div>
            <div className="flex flex-wrap items-center gap-1 mt-1">
              {(['ALWAYS', 'NEVER', 'ABOVE_THRESHOLD', 'WHEN_TRUE', 'ANY_OF'] as const).filter((m) => (m === 'WHEN_TRUE' ? a.boolean.length : m === 'ABOVE_THRESHOLD' || m === 'ANY_OF' ? a.numeric.length : true)).map((m) => (
                <button key={m} onClick={() => set(m === 'ABOVE_THRESHOLD' ? { mode: m, field: a.numeric[0], threshold: r.threshold ?? '0' } : m === 'WHEN_TRUE' ? { mode: m, field: a.boolean[0] } : m === 'ANY_OF' ? { mode: m, rules: a.numeric.slice(0, 2).map((f, i) => ({ mode: 'ABOVE_THRESHOLD', field: f, threshold: i === 0 ? '10' : '100.00' })) } : { mode: m })}
                  className={cn('px-1.5 h-6 rounded text-[10px] num border', r.mode === m ? 'bg-[var(--primary)] text-[var(--primary-foreground)] border-transparent font-bold' : 'surface-1 border-[var(--glass-border)]')}>{m}{m === 'ANY_OF' ? ' ✦' : ''}</button>
              ))}
            </div>
            {(r.mode === 'ABOVE_THRESHOLD' || r.mode === 'WHEN_TRUE') && (
              <div className="flex items-center gap-1 mt-1">
                <Select value={r.field} onChange={(e) => set({ ...r, field: e.target.value })} options={fields.map((f) => ({ value: f, label: f }))} className="!py-0.5 text-[11px] num" />
                {r.mode === 'ABOVE_THRESHOLD' && <ThresholdInput value={r.threshold} onCommit={(v) => set({ ...r, threshold: v })} />}
              </div>
            )}
            {r.mode === 'ANY_OF' && (
              <div className="mt-1 space-y-1">{r.rules.map((sub: any, i: number) => (
                <div key={i} className="flex items-center gap-1 text-[11px]"><span className="text-dim">{i ? t('أو') : t('لو')}</span>
                  <Select value={sub.field} onChange={(e) => set({ ...r, rules: r.rules.map((x: any, j: number) => (j === i ? { ...x, field: e.target.value } : x)) })} options={a.numeric.map((f) => ({ value: f, label: f }))} className="!py-0.5 text-[11px] num" />
                  <span>&gt;</span><ThresholdInput value={sub.threshold} onCommit={(v) => set({ ...r, rules: r.rules.map((x: any, j: number) => (j === i ? { ...x, threshold: v } : x)) })} />
                </div>))}
                <div className="text-[10px] text-dim">{t('ANY_OF مستني اعتماد في المالك (CORE §5) — مقترح')}</div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ThresholdInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [d, setD] = useState<string | null>(null);
  return <Input value={d ?? value} onChange={(e) => setD(e.target.value)} onBlur={() => { if (d !== null) { onCommit(d); setD(null); } }} onKeyDown={(e) => { if (e.key === 'Enter' && d !== null) { onCommit(d); setD(null); } }} className="!py-0.5 text-[11px] w-20" inputMode="decimal" />;
}

function SelfApprovalEditor({ value, onChange }: { value: Record<string, { mode: string }>; onChange: (v: unknown) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1">
      {APPROVAL_ACTIONS.map((a) => {
        const mode = value[a.id]?.mode ?? 'DENY';
        return (
          <button key={a.id} onClick={() => onChange({ ...value, [a.id]: { mode: mode === 'DENY' ? 'ALLOW' : 'DENY' } })} className={cn('text-[10px] px-2 py-1 rounded border text-start num', mode === 'ALLOW' ? 'border-[var(--warning)] text-[var(--warning)]' : 'border-[var(--glass-border)] text-dim')}>{a.id}: {mode}</button>
        );
      })}
    </div>
  );
}
