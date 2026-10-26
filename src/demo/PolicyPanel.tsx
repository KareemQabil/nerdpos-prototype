// Policy Panel (03_DIRECTION §2): every policy in plain words — what it changes in the restaurant, its current value,
// the Egyptian profile value and the safe default. Flipping a value applies immediately to new actions;
// existing checks are never rewritten. Raw ids/JSON/scope keys only with technical details on.
import React, { useState } from 'react';
import { X, Search, History, Info, RotateCcw, HelpCircle } from 'lucide-react';
import { POLICIES, POLICY_GROUPS, policyMeta, type PolicyMeta } from '../mock/policyRegistry';
import { store } from '../mock/store';
import { demo } from '../mock/demo';
import { useStoreVersion, errorText } from '../app/hooks';
import { Pill, Select, Input, Button, Tabs, toast } from '../ui';
import { Tech } from '../app/tech';
import { t, useLang } from '../i18n';
import { PolicyEditor, PolicyCompare, ScopesLine, PolicyValueView, rawJson } from './PolicyEditors';
import { policyTitle, policyExplain, policyReacts, policyQuestion, STATE_TEXT, appliesToText, scopeText, viaText, historyValueText, type Ctx } from './policyText';
import { branchLabel } from './people';

const stateTone = { CANONICAL: 'success', CORE: 'info', PENDING: 'warning', DIRECTION: 'violet' } as const;
const GROUP_HINT: Record<string, string> = {
  orders: 'إزاي الويتر والكاشير بيفتحوا الشيكات ويبعتوها للمطبخ ويقفلوها.',
  pricing: 'الخدمة والضريبة والخصومات والتقريب — كل اللي بيأثر على أرقام الشيك.',
  catalog: 'الأصناف الجديدة وأكوادها ووقف الأصناف.',
  payments: 'طرق الدفع، المرتجع، الدرج والوردية.',
  approvals: 'إمتى الحركات الحساسة محتاجة موافقة مدير.',
  kitchen: 'وقت المطبخ، طباعة الإيصال، وقوايم الأسباب.',
  fiscal: 'الإيصال الإلكتروني واليوم التجاري.',
  access: 'الرقم السري وقفل الحساب ومدة الدخول.',
  direction: 'أفكار جديدة لسه مش في التصميم — جرّبها وقولنا رأيك.',
};

export const policyCtx = (): Ctx => ({ taxName: (id) => { const x = store.db.taxPolicies.find((p) => p.id === id); return x ? (typeof x.name === 'string' ? x.name : x.name?.ar ?? x.name?.en) : undefined; } });

export function PolicyPanel({ onClose }: { onClose: () => void }) {
  useStoreVersion();
  const lang = useLang();
  const [group, setGroup] = useState('orders');
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<'TENANT' | 'BRANCH'>('TENANT');
  const mainBranch = store.db.branches[0];
  const branchId = mainBranch?.id ?? 'branch_main';
  const needle = q.trim().toLowerCase();
  const list = POLICIES.filter((p) => (needle ? (p.id + p.title + p.titleEn + p.description + policyTitle(p) + policyExplain(p)).toLowerCase().includes(needle) : p.group === group));
  return (
    <div className="flex flex-col h-full" data-screen="POLICY_PANEL">
      <div className="px-4 py-3 border-b line flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-bold">{t('إعدادات المطعم (للتجربة)')}<Tech><span className="text-dim font-normal text-xs ms-1">Policy Panel</span></Tech></div>
          <div className="text-[11px] text-dim">{t('كل اختيار هنا بيغيّر طريقة شغل المطعم. جرّب تغيّر واحد وشوف الأجهزة بتتصرف إزاي. التغيير بيطبق على اللي جاي بس — الشيكات القديمة زي ما هي.')}</div>
        </div>
        <button onClick={onClose} title={t('قفل')} className="w-8 h-8 rounded-lg surface-1 flex items-center justify-center"><X className="w-4 h-4" /></button>
      </div>
      <div className="px-4 py-2 space-y-2 border-b line">
        <div className="flex gap-2">
          <div className="relative flex-1"><Search className="w-4 h-4 absolute top-3 start-3 text-dim" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('دوّر على إعداد… (مثلًا: خدمة، درج، خصم)')} className="ps-9" data-fb="policy-panel:search" /></div>
          <Select value={scope} onChange={(e) => setScope(e.target.value as any)} data-fb="policy-panel:scope" options={[{ value: 'TENANT', label: t('للمطعم كله') }, { value: 'BRANCH', label: t('لـ{b} بس', { b: branchLabel(mainBranch) || t('الفرع الرئيسي') }) }]} className="max-w-[180px]" />
        </div>
        {!needle && <Tabs value={group} onChange={setGroup} tabs={POLICY_GROUPS.map((g) => ({ id: g.id, label: lang === 'ar' ? g.title.replace(' (مقترح)', '') : g.titleEn }))} />}
        {!needle && GROUP_HINT[group] && <div className="text-[11px] text-soft">{t(GROUP_HINT[group])}</div>}
        <div className="text-[11px] text-dim flex items-start gap-1"><Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />{t('دي نسخة سريعة للتجربة: التغيير فوري ومن غير موافقة. في المطعم الحقيقي التغيير بيتعمل من شاشة «الإعدادات» وبيحتاج موافقة مدير تاني.')}</div>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {list.map((p) => <PolicyCard key={p.id} p={p} scope={scope} branchId={branchId} branchName={branchLabel(mainBranch)} />)}
        {list.length === 0 && <div className="text-sm text-dim text-center py-6">{t('مفيش إعداد بالاسم ده')}</div>}
        {group === 'direction' && !needle && <Button variant="ghost" size="sm" onClick={() => { demo.applyEgProfile(); toast('success', t('رجعت كل الإعدادات لقيم بروفايل مصر')); }}><RotateCcw className="w-4 h-4" />{t('رجّع كل الإعدادات لبروفايل مصر')}</Button>}
      </div>
    </div>
  );
}

function PolicyCard({ p, scope, branchId, branchName }: { p: PolicyMeta; scope: 'TENANT' | 'BRANCH'; branchId: string; branchName: string }) {
  const [hist, setHist] = useState(false);
  const scopeId = scope === 'TENANT' ? 'biz' : branchId;
  const row = store.db.policyValues.find((v) => v.policyId === p.id && v.scopeType === scope && v.scopeId === scopeId);
  const effective = demo.policy(p.id, scope === 'BRANCH' ? { branchId } : {});
  const value = row?.value ?? effective;
  const scopeAllowed = p.scopes.includes(scope);
  const ctx = policyCtx();
  const set = (v: unknown) => {
    try {
      demo.setPolicy(p.id, v, scope, scopeId);
      toast('success', t('اتغيّر «{p}» — هيطبق على اللي جاي بس', { p: policyTitle(p) }), `${p.id} @ ${scope}:${scopeId}`);
    } catch (e) { toast('error', errorText(e), (e as any).code); }
  };
  const history = store.db.policyHistory.filter((h) => h.policyId === p.id).slice(0, 8);
  const reacts = policyReacts(p);
  const question = policyQuestion(p);
  return (
    <div className="rounded-xl border line surface-1 p-3 space-y-2" data-fb={`policy:${p.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-bold text-sm">{policyTitle(p)}</div>
          <Tech><div className="text-[10px] text-dim num" dir="ltr">{p.id}</div></Tech>
        </div>
        <div className="flex items-center gap-1 flex-wrap justify-end">
          <Pill tone={stateTone[p.state]} title={t(STATE_TEXT[p.state].help)}>{t(STATE_TEXT[p.state].label)}</Pill>
        </div>
      </div>
      <div className="text-xs text-soft leading-relaxed">{policyExplain(p)}</div>
      <div className="rounded-lg surface-2 px-2.5 py-2">
        <div className="text-[10px] text-dim mb-1">{t('دلوقتي')} · {scopeText(scope, scope === 'BRANCH' ? branchName : undefined)}{!row && scope === 'BRANCH' ? ` · ${t('جاية من المطعم كله')}` : ''}</div>
        <PolicyValueView p={p} value={effective} ctx={ctx} big />
      </div>
      {!scopeAllowed
        ? <div className="text-xs text-[var(--warning)]">{t('الإعداد ده مينفعش يتظبط لفرع لوحده — بيتظبط للمطعم كله بس.')}</div>
        : p.editor.kind !== 'readonly' && <div><div className="text-[11px] font-bold text-soft mb-1">{t('غيّره')}</div><PolicyEditor p={p} value={value} onChange={set} /></div>}
      {reacts && <div className="text-[11px]"><span className="text-dim">{t('هتلاحظ التغيير في')}: </span>{reacts}</div>}
      <PolicyCompare p={p} current={effective} ctx={ctx} />
      <div className="flex items-center gap-3 flex-wrap text-[11px] text-dim"><span>{appliesToText(p.appliesTo)}</span><ScopesLine p={p} /></div>
      {question && <div className="text-[11px] rounded-lg bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] border border-[color-mix(in_srgb,var(--warning)_30%,transparent)] px-2 py-1 flex gap-1"><HelpCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[var(--warning)]" /><span><b>{t('سؤال للخبير')}:</b> {question}</span></div>}
      <div className="flex items-center gap-3">
        <button className="text-[11px] text-dim flex items-center gap-1 hover:text-[var(--primary)]" onClick={() => setHist(!hist)}><History className="w-3 h-3" />{t('اتغيّر إمتى')} ({history.length})</button>
        {row && scope === 'BRANCH' && <button className="text-[11px] text-dim hover:text-[var(--error)]" onClick={() => demo.clearPolicyScope(p.id, 'BRANCH', scopeId)}>{t('رجّعه زي المطعم كله')}</button>}
      </div>
      {hist && (
        <div className="space-y-1">
          {history.length === 0 && <div className="text-[11px] text-dim">{t('ما اتغيّرش لسه')}</div>}
          {history.map((h) => (
            <div key={h.id} className="text-[11px] border-t line pt-1">
              <span className="text-dim num">{h.at.slice(0, 16).replace('T', ' ')}</span> · {viaText(h.via)} · {scopeText(h.scopeType)}
              <div>{historyValueText(policyMeta.get(h.policyId), h.oldValue, ctx)} ← <b>{historyValueText(policyMeta.get(h.policyId), h.newValue, ctx)}</b></div>
              <Tech><div className="num text-[10px] text-dim break-all" dir="ltr">{h.via} · {h.scopeType}:{h.scopeId} · {rawJson(h.oldValue)} → {rawJson(h.newValue)}</div></Tech>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
