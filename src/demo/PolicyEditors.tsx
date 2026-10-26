// Shared plain-language policy views and editors (Policy Panel + Settings screen B4).
// Editing controls use the same labels as the read view (radio cards with explanations, chips, numbers with units);
// raw enum strings, ids and JSON only appear inside <Tech>.
import React, { useState } from 'react';
import { Check } from 'lucide-react';
import { APPROVAL_ACTIONS, type PolicyMeta, type Field, type Rule } from '../mock/policyRegistry';
import { Input, Pill, Select, Switch } from '../ui';
import { Tech, useTech } from '../app/tech';
import { t } from '../i18n';
import { cn } from '../lib/format';
import {
  optionText, fieldLabel, fieldValueText, valueRows, valueSummary, boolPolicyText, ruleSentence, RULE_MODE_TEXT, contextFieldLabel, contextFieldUnit,
  approvalDiff, scopesText, confidenceText, type Ctx,
} from './policyText';

export const getPath = (o: any, path: string) => path.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
export function setPath(o: any, path: string, v: any) {
  const out = structuredClone(o ?? {});
  const keys = path.split('.');
  let cur = out;
  keys.slice(0, -1).forEach((k) => { cur[k] = cur[k] ?? {}; cur = cur[k]; });
  if (v === undefined) delete cur[keys.at(-1)!]; else cur[keys.at(-1)!] = v;
  return out;
}
export const rawJson = (v: unknown) => (v === undefined ? 'undefined' : v === null ? 'null' : typeof v === 'object' ? JSON.stringify(v) : String(v));

// ───────── read view
export function PolicyValueView({ p, value, ctx, big }: { p: PolicyMeta; value: unknown; ctx?: Ctx; big?: boolean }) {
  const rows = valueRows(p, value, ctx);
  if (rows.length === 1 && !rows[0].label) return <div className={cn('font-bold', big ? 'text-sm' : 'text-xs')}>{rows[0].value}</div>;
  return (
    <div className={cn('grid grid-cols-[auto_1fr] gap-x-3 gap-y-1', big ? 'text-sm' : 'text-xs')}>
      {rows.map((r, i) => <React.Fragment key={i}><span className="text-dim">{r.label}</span><span className="font-bold">{r.value}</span></React.Fragment>)}
    </div>
  );
}

/** "Now / Egypt profile / safe default" in words, plus the raw values inside <Tech>. */
export function PolicyCompare({ p, current, inherited, ctx }: { p: PolicyMeta; current: unknown; inherited?: boolean; ctx?: Ctx }) {
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const hasEg = p.egValue !== undefined;
  const diffFromEg = hasEg && !same(current, p.egValue);
  const conf = confidenceText(p.confidence, p.reviewer);
  return (
    <div className="space-y-1 text-[11px]">
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        {hasEg && <><span className="text-dim">{t('في بروفايل مصر')}</span><span>{valueSummary(p, p.egValue, ctx)}{conf ? <span className="text-dim"> · {conf}</span> : null}</span></>}
        <span className="text-dim">{t('الافتراضي الآمن')}</span><span>{valueSummary(p, p.canonicalDefault, ctx)}</span>
      </div>
      {hasEg && (diffFromEg ? <Pill tone="warning">{t('متغيّرة عن بروفايل مصر')}</Pill> : <Pill tone="success">{t('زي بروفايل مصر')}</Pill>)}
      {inherited && <span className="text-dim ms-2">{t('القيمة جاية من مستوى أعلى')}</span>}
      {p.editor.kind === 'approvals' && hasEg && diffFromEg && (
        <ul className="list-disc ps-5 text-dim">{approvalDiff(p.egValue, current).map((l, i) => <li key={i}>{t('بروفايل مصر')}: {l}</li>)}</ul>
      )}
      <Tech>
        <div className="rounded-lg bg-black/20 p-2 mt-1 num text-[10px] break-all space-y-0.5" dir="ltr" style={{ textAlign: 'left' }}>
          <div><b>{p.id}</b> · {p.state} · {p.appliesTo} · scopes {p.scopes.join(', ')}</div>
          <div>current: {rawJson(current)}</div>
          {hasEg && <div>EG.profile: {rawJson(p.egValue)}{p.confidence ? ` · ${p.confidence}` : ''}{p.reviewer ? ` · ${p.reviewer}` : ''}</div>}
          <div>canonical default: {rawJson(p.canonicalDefault)}</div>
          {p.reacts && <div>reacts: {p.reacts}</div>}
          {p.question && <div>Q: {p.question}</div>}
        </div>
      </Tech>
    </div>
  );
}

export const ScopesLine = ({ p }: { p: PolicyMeta }) => <div className="text-[11px] text-dim">{scopesText(p.scopes)}</div>;

// ───────── editors
export function PolicyEditor({ p, value, onChange }: { p: PolicyMeta; value: any; onChange: (v: unknown) => void }) {
  const e = p.editor;
  if (e.kind === 'readonly') return <PolicyValueView p={p} value={value} big />;
  if (e.kind === 'enum') return <OptionCards policyId={p.id} fieldKey={null} options={e.options} value={value} onChange={onChange} />;
  if (e.kind === 'bool') return <Switch checked={!!value} onChange={(v) => onChange(v)} label={boolPolicyText(p.id, !!value)} />;
  if (e.kind === 'approvals') return <ApprovalsEditor value={value ?? {}} onChange={onChange} />;
  if (e.kind === 'selfApproval') return <SelfApprovalEditor value={value ?? {}} onChange={onChange} />;
  return <div className="space-y-2.5">{e.fields.map((f) => <FieldEditor key={f.key} policyId={p.id} f={f} value={getPath(value, f.key)} onChange={(v) => onChange(setPath(value, f.key, v))} />)}</div>;
}

/** Radio cards: plain label + one-line explanation; raw enum value only with technical details on. */
export function OptionCards({ policyId, fieldKey, options, value, onChange, compact }: { policyId: string; fieldKey: string | null; options: string[]; value: any; onChange: (v: string) => void; compact?: boolean }) {
  const tech = useTech();
  return (
    <div className={cn('grid gap-1.5', options.length > 2 || compact ? 'grid-cols-1' : 'sm:grid-cols-2')} role="radiogroup">
      {options.map((o) => {
        const ot = optionText(policyId, fieldKey, o);
        const on = value === o;
        return (
          <button key={o} type="button" role="radio" aria-checked={on} onClick={() => onChange(o)} data-fb={`policy-option:${policyId}${fieldKey ? '.' + fieldKey : ''}:${o}`}
            className={cn('text-start rounded-lg border px-2.5 py-1.5 transition-colors flex items-start gap-2', on ? 'border-[var(--primary)] bg-[var(--primary-container)]' : 'border-[var(--glass-border)] surface-2 hover:border-[var(--primary)]')}>
            <span className={cn('mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center shrink-0', on ? 'border-[var(--primary)] bg-[var(--primary)]' : 'border-[var(--glass-border)]')}>{on && <Check className="w-3 h-3 text-[var(--primary-foreground)]" />}</span>
            <span className="min-w-0">
              <span className={cn('block text-xs', on && 'font-bold text-[var(--primary)]')}>{ot.label}</span>
              {ot.help && !compact && <span className="block text-[10px] text-dim leading-snug">{ot.help}</span>}
              {tech && <span className="block text-[9px] num text-dim" dir="ltr">{o}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

const UNIT_SUFFIX: Record<string, string> = {
  'SessionDurationPolicy.maxHours': 'ساعة', 'SessionDurationPolicy.warningHours': 'ساعة', 'ApprovalTtlPolicy.seconds': 'ثانية', 'KitchenTimingPolicy.targetMinutes': 'دقيقة',
  'KitchenTimingPolicy.alertMinutes': 'دقيقة', 'LoginLockoutPolicy.maxFailedAttempts': 'محاولة', 'LoginLockoutPolicy.lockMinutes': 'دقيقة', 'AuthSessionPolicy.maxHours': 'ساعة',
  'AuthSessionPolicy.pinSessionMaxHours': 'ساعة', 'CredentialPolicy.passwordMinLength': 'حرف', 'CredentialPolicy.pinLength': 'رقم', 'OrderNumberPolicy.width': 'رقم',
  'RoundingPolicy.scale': 'رقم', 'SkuGenerationPolicy.width': 'رقم',
};

export function FieldEditor({ policyId, f, value, onChange }: { policyId: string; f: Field; value: any; onChange: (v: any) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const label = fieldLabel(policyId, f);
  const commit = () => {
    if (draft === null) return;
    const d = draft.trim();
    setDraft(null);
    if (f.kind === 'number') onChange(d === '' ? undefined : Number(d));
    else if (f.kind === 'text' || f.kind === 'time') onChange(d);
    else onChange(d === '' ? undefined : d.replace(/[^\d.]/g, '')); // decimals travel as strings, never floats
  };
  const suffix = f.kind === 'money' ? t('جنيه') : f.kind === 'percent' || f.kind === 'percentOrNone' ? '%' : UNIT_SUFFIX[`${policyId}.${f.key}`] ? t(UNIT_SUFFIX[`${policyId}.${f.key}`]) : '';
  return (
    <div className="flex flex-col gap-1 min-w-0" data-fb={`policy-field:${policyId}.${f.key}`}>
      <span className="text-[11px] font-bold text-soft">{label}<Tech><span className="num text-dim font-normal text-[9px] ms-1" dir="ltr">{f.key}</span></Tech></span>
      {f.kind === 'enum' && (f.options.length <= 3
        ? <OptionCards policyId={policyId} fieldKey={f.key} options={f.options} value={value} onChange={onChange} compact={f.options.length > 2} />
        : <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)} options={[...(value ? [] : [{ value: '', label: t('اختار…') }]), ...f.options.map((o) => ({ value: o, label: optionText(policyId, f.key, o).label }))]} className="!py-1 text-xs" />)}
      {f.kind === 'bool' && <Switch checked={!!value} onChange={onChange} label={fieldValueText(policyId, f, !!value)} />}
      {f.kind === 'multi' && (
        <div className="flex flex-wrap gap-1">{f.options.map((o) => { const arr: string[] = value ?? []; const on = arr.includes(o); return (
          <button key={o} type="button" onClick={() => onChange(on ? arr.filter((x) => x !== o) : [...arr, o])} className={cn('px-2 h-7 rounded-lg text-[11px] border flex items-center gap-1', on ? 'bg-[var(--primary-container)] border-[var(--primary)] text-[var(--primary)] font-bold' : 'surface-2 border-[var(--glass-border)] text-soft')}>
            {on && <Check className="w-3 h-3" />}{optionText(policyId, f.key, o).label}
          </button>); })}</div>
      )}
      {(f.kind === 'number' || f.kind === 'money' || f.kind === 'percent' || f.kind === 'percentOrNone' || f.kind === 'text' || f.kind === 'time') && (
        <div className="flex items-center gap-1.5">
          <Input value={draft ?? (value ?? '')} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()}
            className="!py-1 text-xs max-w-[160px]" inputMode={f.kind === 'text' || f.kind === 'time' ? 'text' : f.kind === 'number' ? 'numeric' : 'decimal'}
            placeholder={f.kind === 'percentOrNone' ? t('فاضي = مفيش') : f.kind === 'text' ? t('فاضي') : ''} dir={f.kind === 'text' ? 'auto' : 'ltr'} />
          {suffix && <span className="text-[11px] text-dim">{suffix}</span>}
          {f.kind === 'percentOrNone' && value !== undefined && <button type="button" className="text-[11px] text-dim hover:text-[var(--error)]" onClick={() => onChange(undefined)}>{t('شيلها')}</button>}
        </div>
      )}
    </div>
  );
}

export function ApprovalsEditor({ value, onChange }: { value: Record<string, Rule>; onChange: (v: unknown) => void }) {
  const tech = useTech();
  return (
    <div className="space-y-1.5">
      {APPROVAL_ACTIONS.map((a) => {
        const r: any = value[a.id] ?? a.defaultRule;
        const set = (nr: any) => onChange({ ...value, [a.id]: nr });
        const modes = (['ALWAYS', 'NEVER', 'ABOVE_THRESHOLD', 'WHEN_TRUE', 'ANY_OF'] as const).filter((m) => (m === 'WHEN_TRUE' ? a.boolean.length : m === 'ABOVE_THRESHOLD' ? a.numeric.length : m === 'ANY_OF' ? a.numeric.length > 1 : true));
        const fields = r.mode === 'WHEN_TRUE' ? a.boolean : a.numeric;
        return (
          <div key={a.id} className="rounded-lg surface-2 px-2.5 py-2" data-fb={`approval-rule:${a.id}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-bold min-w-0">{t(a.title)}<Tech><span className="num text-dim font-normal text-[9px] ms-1" dir="ltr">{a.id}</span></Tech></div>
              {a.state === 'DIRECTION' && <Pill tone="violet">{t('فكرة مقترحة')}</Pill>}
            </div>
            <div className="text-[11px] text-[var(--primary)] mt-0.5">{ruleSentence(a.id, r)}</div>
            <div className="flex flex-wrap items-center gap-1 mt-1.5">
              {modes.map((m) => (
                <button key={m} type="button" title={t(RULE_MODE_TEXT[m].help)} onClick={() => set(m === 'ABOVE_THRESHOLD' ? { mode: m, field: a.numeric[0], threshold: r.threshold ?? '0' } : m === 'WHEN_TRUE' ? { mode: m, field: a.boolean[0] } : m === 'ANY_OF' ? { mode: m, rules: a.numeric.slice(0, 2).map((f, i) => ({ mode: 'ABOVE_THRESHOLD', field: f, threshold: i === 0 ? '10' : '100.00' })) } : { mode: m })}
                  className={cn('px-2 h-6 rounded text-[10px] border', r.mode === m ? 'bg-[var(--primary)] text-[var(--primary-foreground)] border-transparent font-bold' : 'surface-1 border-[var(--glass-border)] text-soft')}>
                  {t(RULE_MODE_TEXT[m].label)}{tech ? <span className="num opacity-70 ms-1">{m}</span> : null}
                </button>
              ))}
            </div>
            {(r.mode === 'ABOVE_THRESHOLD' || r.mode === 'WHEN_TRUE') && (
              <div className="flex items-center gap-1.5 mt-1.5 text-[11px] flex-wrap">
                <span className="text-dim">{t('لو')}</span>
                {fields.length > 1
                  ? <Select value={r.field} onChange={(e) => set({ ...r, field: e.target.value })} options={fields.map((f) => ({ value: f, label: contextFieldLabel(f) }))} className="!py-0.5 text-[11px] max-w-[180px]" />
                  : <b>{contextFieldLabel(r.field)}</b>}
                {r.mode === 'ABOVE_THRESHOLD' && <><span className="text-dim">{t('أكتر من')}</span><ThresholdInput value={r.threshold} onCommit={(v) => set({ ...r, threshold: v })} /><span className="text-dim">{unitWord(r.field)}</span></>}
              </div>
            )}
            {r.mode === 'ANY_OF' && (
              <div className="mt-1.5 space-y-1">{r.rules.map((sub: any, i: number) => (
                <div key={i} className="flex items-center gap-1.5 text-[11px] flex-wrap"><span className="text-dim">{i ? t('أو') : t('لو')}</span>
                  <Select value={sub.field} onChange={(e) => set({ ...r, rules: r.rules.map((x: any, j: number) => (j === i ? { ...x, field: e.target.value } : x)) })} options={a.numeric.map((f) => ({ value: f, label: contextFieldLabel(f) }))} className="!py-0.5 text-[11px] max-w-[180px]" />
                  <span className="text-dim">{t('أكتر من')}</span><ThresholdInput value={sub.threshold} onCommit={(v) => set({ ...r, rules: r.rules.map((x: any, j: number) => (j === i ? { ...x, threshold: v } : x)) })} /><span className="text-dim">{unitWord(sub.field)}</span>
                </div>))}
                <div className="text-[10px] text-dim">{t('«أي شرط من اتنين» لسه فكرة مقترحة ومستنية موافقة.')}</div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
const unitWord = (field: string) => { const u = contextFieldUnit(field); return u === 'egp' ? t('جنيه') : u === 'pct' ? '%' : ''; };

function ThresholdInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [d, setD] = useState<string | null>(null);
  const done = () => { if (d !== null) { onCommit(d.replace(/[^\d.]/g, '') || '0'); setD(null); } };
  return <Input value={d ?? value} onChange={(e) => setD(e.target.value)} onBlur={done} onKeyDown={(e) => e.key === 'Enter' && done()} className="!py-0.5 text-[11px] w-20" inputMode="decimal" dir="ltr" />;
}

export function SelfApprovalEditor({ value, onChange }: { value: Record<string, { mode: string }>; onChange: (v: unknown) => void }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] text-dim">{t('اضغط على الحركة عشان تسمح للمدير يوافق على طلبه هو فيها (مش منصوح بيه).')}</div>
      <div className="grid sm:grid-cols-2 gap-1">
        {APPROVAL_ACTIONS.map((a) => {
          const allow = value[a.id]?.mode === 'ALLOW';
          return (
            <button key={a.id} type="button" onClick={() => onChange({ ...value, [a.id]: { mode: allow ? 'DENY' : 'ALLOW' } })} className={cn('text-[11px] px-2 py-1 rounded border text-start flex items-center justify-between gap-2', allow ? 'border-[var(--warning)] text-[var(--warning)]' : 'border-[var(--glass-border)] text-soft')}>
              <span>{t(a.title)}</span><span className="font-bold">{allow ? t('مسموح') : t('ممنوع')}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
