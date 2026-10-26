// Failure scenarios in plain words: what we try, what should happen, and the result in words.
// Codes, operations and the raw log are shown only with technical details on.
// Second tab: the 1000 situations, grouped by area (titles are Arabic), to pick extra demo scripts.
import React, { useState } from 'react';
import { FlaskConical, Play, CheckCircle2, XCircle, Circle, Search, PlayCircle, Bookmark } from 'lucide-react';
import negativesJson from '../contracts/negatives.json';
import situationsJson from '../contracts/situations.json';
import { NEGATIVE_RUNS, NEGATIVE_PLAIN } from './negatives';
import type { LogLine } from './runner';
import { Button, Pill, Tabs, Input, Select, toast } from '../ui';
import { Tech, useTech } from '../app/tech';
import { t, getLang } from '../i18n';
import { refreshAll, errorText } from '../app/hooks';
import { feedback, policySnapshot } from './Feedback';

const NEG = negativesJson as { id: string; title: string; operation: string; precondition: string; steps: string; expected: string; codes: string }[];
const SIT = situationsJson as { id: string; title: string; items: { id: string; title: string }[] }[];
const en = () => getLang() === 'en';

export function Scenarios() {
  const [tab, setTab] = useState<'neg' | 'sit'>('neg');
  return (
    <div className="flex flex-col h-full" data-screen="SCENARIOS">
      <div className="px-4 py-3 border-b line space-y-2">
        <div className="font-bold flex items-center gap-2"><FlaskConical className="w-5 h-5" />{t('سيناريوهات الفشل')}</div>
        <div className="text-[11px] text-dim">{t('بنجرّب حاجات المفروض السيستم يرفضها أو يتصرف فيها صح: ضغطتين ورا بعض، جهازين في نفس اللحظة، رد بيضيع، حد بيحاول يوافق لنفسه…')}</div>
        <Tabs value={tab} onChange={setTab} tabs={[{ id: 'neg', label: t('12 تجربة جاهزة') }, { id: 'sit', label: t('1000 موقف للمناقشة') }]} />
      </div>
      {tab === 'neg' ? <Negatives /> : <Situations />}
    </div>
  );
}

function Negatives() {
  const tech = useTech();
  const [logs, setLogs] = useState<Record<string, LogLine[]>>({});
  const [res, setRes] = useState<Record<string, boolean | null>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (id: string) => {
    setBusy(id);
    const lines: LogLine[] = [];
    const log = (l: LogLine) => { lines.push(l); setLogs((m) => ({ ...m, [id]: [...lines] })); };
    try { const ok = await NEGATIVE_RUNS[id](log); setRes((r) => ({ ...r, [id]: ok })); }
    catch (e) { log({ ok: false, text: `${(e as any).code ?? ''} ${errorText(e)}`, plain: `ما نفعش: ${errorText(e)}` }); setRes((r) => ({ ...r, [id]: false })); }
    setBusy(null);
    refreshAll();
  };
  const runAll = async () => { for (const n of NEG) await run(n.id); toast('info', t('خلصت كل التجارب')); };
  const passed = Object.values(res).filter((x) => x === true).length;
  const failed = Object.values(res).filter((x) => x === false).length;
  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] text-dim">{t('كل تجربة بتتأكد إن النتيجة زي المتوقع وإن مفيش حاجة زيادة اتسجلت. بتشتغل على بيانات التجربة الحالية.')}{passed + failed > 0 && <b className="ms-1 text-soft">{t('نجح {p}', { p: passed })}{failed ? ` · ${t('فشل {f}', { f: failed })}` : ''}</b>}</div>
        <Button size="sm" onClick={runAll} disabled={!!busy} data-fb="neg-run-all"><PlayCircle className="w-4 h-4" />{t('جرّب الكل')}</Button>
      </div>
      {NEG.map((n) => {
        const p = NEGATIVE_PLAIN[n.id];
        const r = res[n.id];
        const shown = (logs[n.id] ?? []).filter((l) => tech || l.plain || l.ok === false);
        return (
          <div key={n.id} className="rounded-xl surface-1 border line p-3 space-y-2" data-fb={`neg:${n.id}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-bold text-sm">{p ? (en() ? p.titleEn : p.title) : n.title}<Tech><span className="num text-[10px] text-dim font-normal ms-1">{n.id}</span></Tech></div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {r === true && <Pill tone="success">{t('السيستم اتصرف صح')}</Pill>}
                {r === false && <Pill tone="error">{t('في مشكلة')}</Pill>}
                <Button size="sm" variant="primary" loading={busy === n.id} onClick={() => run(n.id)} title={t('جرّب')} data-fb={`neg-run:${n.id}`}><Play className="w-3.5 h-3.5" />{t('جرّب')}</Button>
              </div>
            </div>
            {p && (
              <div className="grid sm:grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg surface-2 p-2"><div className="text-[10px] font-bold text-dim mb-0.5">{t('بنجرّب إيه')}</div>{en() ? p.tryEn : p.tryAr}</div>
                <div className="rounded-lg p-2 bg-[color-mix(in_srgb,var(--info)_10%,transparent)] border border-[color-mix(in_srgb,var(--info)_25%,transparent)]"><div className="text-[10px] font-bold text-dim mb-0.5">{t('المفروض يحصل إيه')}</div>{en() ? p.expectEn : p.expectAr}</div>
              </div>
            )}
            {shown.length > 0 && (
              <div className="rounded-lg bg-black/10 p-2 space-y-1">
                <div className="text-[10px] font-bold text-dim">{t('اللي حصل')}</div>
                {shown.map((l, i) => (
                  <div key={i} className="flex gap-1.5 items-start text-xs">
                    {l.ok === true ? <CheckCircle2 className="w-3.5 h-3.5 text-[var(--success)] shrink-0 mt-0.5" /> : l.ok === false ? <XCircle className="w-3.5 h-3.5 text-[var(--error)] shrink-0 mt-0.5" /> : <Circle className="w-3.5 h-3.5 text-dim shrink-0 mt-0.5" />}
                    <div className="min-w-0"><div className="break-words">{l.plain ?? (l.ok === false ? t('حاجة ما مشيتش زي المتوقع') : l.text)}</div>{tech && <div className="num text-[10px] text-dim break-words" dir="ltr" style={{ textAlign: 'left' }}>{l.text}</div>}</div>
                  </div>
                ))}
              </div>
            )}
            <Tech>
              <div className="text-[11px] num text-[var(--primary)]" dir="ltr" style={{ textAlign: 'left' }}>{n.codes || 'behavioural (no code)'}</div>
              <details className="text-[11px] text-dim"><summary className="cursor-pointer">{t('التفاصيل الأصلية')}</summary><div className="mt-1 space-y-1" dir="ltr" style={{ textAlign: 'left' }}><div><b>{n.title}</b></div><div><b>Operation:</b> {n.operation}</div><div><b>Precondition:</b> {n.precondition}</div><div className="whitespace-pre-wrap"><b>Steps:</b> {n.steps}</div><div><b>Expected:</b> {n.expected}</div></div></details>
            </Tech>
          </div>
        );
      })}
    </div>
  );
}

function Situations() {
  const [q, setQ] = useState('');
  const [g, setG] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const groups = SIT.filter((x) => !g || x.id === g);
  const total = SIT.reduce((a, x) => a + x.items.length, 0);
  const save = (grp: { id: string; title: string }, i: { id: string; title: string }) => {
    feedback.add({ id: `fb_${Date.now()}`, screen: 'SITUATIONS', element: `${grp.id} ${i.id}`, type: 'missing', text: `سيناريو مطلوب: ${i.title}`, expert: '', role: '', policy_snapshot: policySnapshot(), at: new Date().toISOString() });
    toast('success', t('اتحفظ في الملاحظات عشان نعمله سيناريو'));
  };
  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3">
      <div className="text-[11px] text-dim">{t('{n} موقف ممكن يحصل في مطعم، متقسمين على {g} مجال. اختار المواقف اللي عاوز تشوفها في العرض واضغط «عاوز أشوف ده» — بتتحفظ في الملاحظات.', { n: total, g: SIT.length })}</div>
      <div className="flex gap-2">
        <div className="relative flex-1"><Search className="w-4 h-4 absolute top-3 start-3 text-dim" /><Input value={q} onChange={(e) => setQ(e.target.value)} className="ps-9" placeholder={t('دوّر… (مثلًا: مرتجع، طابعة، خصم)')} data-fb="situations:search" /></div>
        <Select value={g} onChange={(e) => setG(e.target.value)} options={[{ value: '', label: t('كل المجالات') }, ...SIT.map((x) => ({ value: x.id, label: x.title }))]} className="max-w-[220px]" />
      </div>
      {groups.map((grp) => {
        const items = grp.items.filter((i) => !q || i.title.includes(q) || i.id.includes(q));
        if (!items.length) return null;
        const expanded = open[grp.id] || !!q || !!g;
        const list = expanded ? items.slice(0, 200) : items.slice(0, 5);
        return (
          <div key={grp.id} className="rounded-xl border line surface-1 p-2.5">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <div className="text-sm font-bold">{grp.title}<Tech><span className="num text-[10px] text-dim font-normal ms-1">{grp.id}</span></Tech></div>
              <Pill tone="neutral">{t('{n} موقف', { n: items.length })}</Pill>
            </div>
            <div className="space-y-1">{list.map((i) => (
              <div key={i.id} className="flex items-center gap-2 text-xs rounded-lg surface-2 px-2 py-1.5">
                <Tech><span className="num text-dim text-[10px]">{i.id}</span></Tech>
                <span className="flex-1">{i.title}</span>
                <button className="text-[11px] text-pink-300 hover:underline flex items-center gap-1 shrink-0" onClick={() => save(grp, i)}><Bookmark className="w-3 h-3" />{t('عاوز أشوف ده')}</button>
              </div>
            ))}</div>
            {!expanded && items.length > 5 && <button className="text-[11px] text-[var(--primary)] mt-1.5 hover:underline" onClick={() => setOpen((o) => ({ ...o, [grp.id]: true }))}>{t('اعرض الـ {n} كلهم', { n: items.length })}</button>}
          </div>
        );
      })}
    </div>
  );
}
