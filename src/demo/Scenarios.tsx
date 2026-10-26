// Negative controls N1..N12 runner + the 1000 situation titles (for extra demo scripts).
import React, { useState } from 'react';
import { FlaskConical, Play, CheckCircle2, XCircle, Circle, Search, PlayCircle } from 'lucide-react';
import negativesJson from '../contracts/negatives.json';
import situationsJson from '../contracts/situations.json';
import { NEGATIVE_RUNS } from './negatives';
import type { LogLine } from './runner';
import { Button, Pill, Tabs, Input, Select, toast } from '../ui';
import { t } from '../i18n';
import { cn } from '../lib/format';
import { refreshAll, errorText } from '../app/hooks';
import { feedback, policySnapshot } from './Feedback';

const NEG = negativesJson as { id: string; title: string; operation: string; precondition: string; steps: string; expected: string; codes: string }[];
const SIT = situationsJson as { id: string; title: string; items: { id: string; title: string }[] }[];
const TITLE_AR: Record<string, string> = {
  N1: 'فتح نفس الترابيزة مرتين', N2: 'إعادة "ابعت للمطبخ" بنفس الأمر = جولة واحدة', N3: 'جهازين بيبعتوا نفس الشيك في نفس اللحظة', N4: 'إلغاء صنف من غير موافقة', N5: 'المدير يوافق على طلبه هو',
  N6: 'كارت من غير رقم عملية', N7: 'دفع زيادة ودفعتين في نفس الوقت', N8: 'سحب الصلاحية أثناء الشغل', N9: 'ترابيزة وقعدة من فرع تاني', N10: 'أحداث مطبخ مكررة أو مش بالترتيب', N11: 'إعادة تشغيل عامل المطبخ في نص الشغل', N12: 'رد ضايع وبعدين إعادة نفس الأمر',
};

export function Scenarios() {
  const [tab, setTab] = useState<'neg' | 'sit'>('neg');
  return (
    <div className="flex flex-col h-full" data-screen="SCENARIOS">
      <div className="px-4 py-3 border-b line space-y-2">
        <div className="font-bold flex items-center gap-2"><FlaskConical className="w-5 h-5" />{t('سيناريوهات الفشل')}</div>
        <Tabs value={tab} onChange={setTab} tabs={[{ id: 'neg', label: t('الضوابط السلبية N1–N12') }, { id: 'sit', label: t('1000 موقف (عناوين)') }]} />
      </div>
      {tab === 'neg' ? <Negatives /> : <Situations />}
    </div>
  );
}

function Negatives() {
  const [logs, setLogs] = useState<Record<string, LogLine[]>>({});
  const [res, setRes] = useState<Record<string, boolean | null>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (id: string) => {
    setBusy(id);
    const lines: LogLine[] = [];
    const log = (l: LogLine) => { lines.push(l); setLogs((m) => ({ ...m, [id]: [...lines] })); };
    try { const ok = await NEGATIVE_RUNS[id](log); setRes((r) => ({ ...r, [id]: ok })); }
    catch (e) { log({ ok: false, text: `${(e as any).code ?? ''} ${errorText(e)}` }); setRes((r) => ({ ...r, [id]: false })); }
    setBusy(null);
    refreshAll();
  };
  const runAll = async () => { for (const n of NEG) await run(n.id); toast('info', t('خلصت الضوابط')); };
  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-2">
      <div className="flex items-center justify-between"><div className="text-[11px] text-dim">{t('كل ضابط بيتأكد من النتيجة المتوقعة وإن مفيش حاجة زيادة اتكتبت. بيشتغل على بيانات العرض الحالية.')}</div><Button size="sm" onClick={runAll} disabled={!!busy}><PlayCircle className="w-4 h-4" />{t('شغّل الكل')}</Button></div>
      {NEG.map((n) => (
        <div key={n.id} className="rounded-xl surface-1 border line p-3 space-y-1.5" data-fb={`neg:${n.id}`}>
          <div className="flex items-start justify-between gap-2">
            <div><div className="font-bold text-sm">{n.id} · {TITLE_AR[n.id] ?? n.title}</div><div className="text-[11px] text-dim">{n.title}</div></div>
            <div className="flex items-center gap-2">{res[n.id] === true && <Pill tone="success">PASS</Pill>}{res[n.id] === false && <Pill tone="error">FAIL</Pill>}<Button size="sm" variant="primary" loading={busy === n.id} onClick={() => run(n.id)}><Play className="w-3.5 h-3.5" /></Button></div>
          </div>
          <div className="text-[11px] num text-[var(--primary)]">{n.codes || t('سلوكي (من غير كود)')}</div>
          <details className="text-[11px] text-dim"><summary className="cursor-pointer">{t('التفاصيل')}</summary><div className="mt-1 space-y-1" dir="ltr" style={{ textAlign: 'left' }}><div><b>Operation:</b> {n.operation}</div><div><b>Precondition:</b> {n.precondition}</div><div className="whitespace-pre-wrap"><b>Steps:</b> {n.steps}</div><div><b>Expected:</b> {n.expected}</div></div></details>
          {logs[n.id] && <div className="rounded-lg bg-black/20 p-2 space-y-0.5 text-[11px] num" dir="ltr">{logs[n.id].map((l, i) => <div key={i} className="flex gap-1.5 items-start" style={{ textAlign: 'left' }}>{l.ok === true ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> : l.ok === false ? <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" /> : <Circle className="w-3.5 h-3.5 text-dim shrink-0" />}<span className="break-words">{l.text}</span></div>)}</div>}
        </div>
      ))}
    </div>
  );
}

function Situations() {
  const [q, setQ] = useState('');
  const [g, setG] = useState('');
  const groups = SIT.filter((x) => !g || x.id === g);
  const total = SIT.reduce((a, x) => a + x.items.length, 0);
  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3">
      <div className="text-[11px] text-dim">{total} {t('عنوان موقف من الملف — للخبرا يختاروا منها سيناريوهات عرض إضافية. "سجّل كملاحظة" بيحفظ العنوان في الملاحظات عشان يتصمم له سكريبت.')}</div>
      <div className="flex gap-2"><div className="relative flex-1"><Search className="w-4 h-4 absolute top-3 start-3 text-dim" /><Input value={q} onChange={(e) => setQ(e.target.value)} className="ps-9" placeholder={t('دوّر…')} /></div><Select value={g} onChange={(e) => setG(e.target.value)} options={[{ value: '', label: t('كل المجموعات') }, ...SIT.map((x) => ({ value: x.id, label: `${x.id} ${x.title.slice(0, 30)}` }))]} className="max-w-[200px]" /></div>
      {groups.map((grp) => {
        const items = grp.items.filter((i) => !q || i.title.includes(q) || i.id.includes(q));
        if (!items.length) return null;
        return (
          <div key={grp.id}>
            <div className="text-xs font-bold text-soft mb-1">{grp.id} · {grp.title} <span className="text-dim">({items.length})</span></div>
            <div className="space-y-1">{items.slice(0, q ? 200 : 25).map((i) => <div key={i.id} className="flex items-center gap-2 text-xs rounded-lg surface-1 px-2 py-1.5"><span className="num text-dim">{i.id}</span><span className="flex-1">{i.title}</span><button className="text-[10px] text-pink-300 hover:underline" onClick={() => { feedback.add({ id: `fb_${Date.now()}`, screen: 'SITUATIONS', element: `${grp.id} ${i.id}`, type: 'missing', text: `سيناريو مطلوب: ${i.title}`, expert: '', role: '', policy_snapshot: policySnapshot(), at: new Date().toISOString() }); toast('success', t('اتسجل في الملاحظات')); }}>{t('سجّل كملاحظة')}</button></div>)}</div>
          </div>
        );
      })}
    </div>
  );
}
