// «اسأل التقارير» — the rule-based assistant over the reports engine (Report.Ask). Structured answers with chips
// (definition, period, filters, asOf, provisional, sources, not-available), one clarifying question when ambiguous,
// refusals for what it must not do. Also used as a side panel (AskPanel) from any report page.
import React, { useMemo, useRef, useState } from 'react';
import { Send, MessageCircleQuestion, ShieldX, HelpCircle, Ban, CheckCircle2, Sparkles, BookOpen, Calendar, Filter, Clock, AlertTriangle, FileSearch, Info } from 'lucide-react';
import { useDev, errorText } from '../../app/hooks';
import { call } from '../../api/client';
import { Button, Card, Pill, Table, Spinner, StateBadge, PageHeader, Drawer, Banner } from '../../ui';
import { t, L, getLang } from '../../i18n';
import { cn } from '../../lib/format';
import { Tech } from '../../app/tech';
import bank from '../../reports/assistant/question-bank.json';
import { EvidenceCtx, fmt, type EvidenceSpec, ReconList } from './parts';
import { EvidenceDrawer } from './EvidenceDrawer';
import { Bridge, Matrix } from './ReportView';

const STATUS: Record<string, { label: string; tone: any; icon: any }> = {
  ANSWERED: { label: 'إجابة من المقاييس المعتمدة', tone: 'success', icon: CheckCircle2 }, EXPLAINED: { label: 'شرح من المحرك', tone: 'info', icon: Info },
  CLARIFY: { label: 'سؤال واحد للتوضيح', tone: 'warning', icon: HelpCircle }, NOT_AVAILABLE: { label: 'مش متاح — مش هنقول صفر', tone: 'neutral', icon: Ban },
  REFUSED: { label: 'رفض آمن', tone: 'error', icon: ShieldX }, UNPARSED: { label: 'مش فاهم السؤال', tone: 'neutral', icon: HelpCircle },
};
const CHIP_ICON: Record<string, any> = { definition: BookOpen, period: Calendar, filters: Filter, asOf: Clock, provisional: AlertTriangle, source: FileSearch, not_available: Ban, refusal: ShieldX, assumption: Info, version: BookOpen };
const SUGGEST = ['صافي المبيعات امبارح', 'أنا بعت بكام النهاردة؟', 'إيه الفرق بين مبيعات امبارح والتحصيل؟', 'مبيعات أمس مقارنة بنفس يوم الأسبوع اللي فات؟', 'أكتر 10 أصناف الأسبوع ده بالقيمة', 'عجز الدرج عند مين؟', 'الكاش كام والفيزا كام والمحافظ كام؟', 'وريني النجوم والخيول في المنيو', 'تكلفة العمالة كنسبة من المبيعات؟', 'ينفع نمسح مبيعات قبل إرسالها للضرائب؟', 'في فرق قرش بسبب الـSplit؟', 'إيه الخامات الناقصة النهاردة؟'];

function QueryResult({ r }: { r: any }) {
  const open = React.useContext(EvidenceCtx);
  if (!r?.rows) return null;
  if (!r.dimensions.length) return null;
  const unit = (m: string) => r.meta.metrics.find((x: any) => x.id === m)?.unit;
  return (
    <Table dense maxHeight={300} align={[...r.dimensions.map(() => 'start' as const), ...r.metrics.map(() => 'end' as const)]}
      head={[...r.dimensions.map((d: string) => d), ...r.metrics.map((m: string) => L(r.meta.metrics.find((x: any) => x.id === m)?.label))]}
      rows={r.rows.map((row: any) => [...r.dimensions.map((d: string) => L(row.labels[d])), ...r.metrics.map((m: string) => {
        const v = row.values[m];
        return v?.availability === 'AVAILABLE' ? <button type="button" className="num underline decoration-dotted" onClick={() => open({ metric: m, cell: row.dims, from: r.meta.from, to: r.meta.to, branchIds: r.meta.branchIds })}>{fmt(v.value, unit(m))}</button> : <span className="text-dim" title={L(v?.reason)}>{v?.availability === 'NOT_AVAILABLE' ? t('مش متاح') : '—'}</span>;
      })])} />
  );
}

function AnswerCard({ a, onClarify, busy }: { a: any; onClarify: (id: string, label: string) => void; busy: boolean }) {
  const open = React.useContext(EvidenceCtx);
  const st = STATUS[a.status] ?? STATUS.UNPARSED;
  const Icon = st.icon;
  const run = a.data && a.parsed?.period ? { period: { from: a.parsed.period.from, to: a.parsed.period.to }, branchIds: a.data?.meta?.branchIds ?? a.data?.scope?.branchIds } : null;
  return (
    <div className="space-y-2" data-fb={`ask-answer:${a.status}`}>
      <div className="flex items-center gap-2"><Pill tone={st.tone} size="sm"><Icon className="w-3.5 h-3.5 inline me-1" />{t(st.label)}</Pill><Tech><span className="num text-[10px] text-dim" dir="ltr">{a.parsed?.intent} · {a.parsed?.rules?.join(' | ')}</span></Tech></div>
      <div className="text-[15px] leading-relaxed">{L(a.text)}</div>
      {a.clarify && <div className="flex flex-wrap gap-1.5">{a.clarify.options.map((o: any) => <Button key={o.id} size="sm" variant="outline" disabled={busy} onClick={() => onClarify(o.id, L(o.label))} data-fb={`ask-clarify:${o.id}`}>{L(o.label)}</Button>)}</div>}
      {a.shape === 'table' || a.shape === 'chart' ? <QueryResult r={a.data} /> : null}
      {a.shape === 'bridge' && a.data?.sales && <Bridge run={{ period: { from: a.data.scope.from, to: a.data.scope.to }, branchIds: a.data.scope.branchIds }} br={a.data} />}
      {a.shape === 'matrix' && run && <Matrix run={run} mm={a.data} />}
      {a.shape === 'recon' && <ReconList checks={a.data.checks} />}
      {a.shape === 'compare' && <Table dense head={[t('المقياس'), t('الفترة'), t('المقارنة'), t('الفرق')]} align={['start', 'end', 'end', 'end']} rows={a.data.rows.map((r: any) => [L(r.label), fmt(r.current.value), fmt(r.base.value), r.delta !== null ? `${fmt(r.delta)}${r.pct ? ` (${Number(r.pct).toFixed(1)}%)` : ''}` : '—'])} />}
      {a.shape === 'decompose' && <div className="space-y-1">{a.data.effects.map((e: any) => <div key={e.id} className="flex items-center gap-2 text-sm rounded-md surface-1 px-2 py-1"><span className="flex-1">{L(e.label)}<span className="block text-[10px] text-dim">{L(e.note)}</span></span><span className={cn('num font-bold', Number(e.amount) < 0 && 'text-[var(--error)]')}>{fmt(e.amount)}</span></div>)}</div>}
      {a.shape === 'evidence' && <Table dense maxHeight={260} head={[t('السجل'), t('اليوم'), t('المبلغ')]} align={['start', 'start', 'end']} rows={a.data.parts.flatMap((p: any) => p.evidence).map((e: any) => [e.label, <span className="num text-xs">{e.businessDate}</span>, <span className="num">{fmt(e.amount)}</span>])} />}
      {a.data?.items && Array.isArray(a.data.items) && a.shape === 'table' && !a.data.rows && <Table dense head={Object.keys(a.data.items[0] ?? {}).filter((k) => !['item', 'id'].includes(k))} rows={a.data.items.map((x: any) => Object.entries(x).filter(([k]) => !['item', 'id'].includes(k)).map(([, v]: any) => (typeof v === 'object' ? L(v) : String(v))))} />}
      {a.chips?.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {a.chips.map((c: any, i: number) => { const CI = CHIP_ICON[c.kind] ?? Info; const clickable = c.kind === 'source' && c.explain; return (
            <button key={i} type="button" disabled={!clickable} onClick={() => clickable && open(c.explain)} title={L(c.detail)} data-fb={`ask-chip:${c.kind}`}
              className={cn('inline-flex items-center gap-1 rounded-full px-2.5 h-7 text-xs border', c.kind === 'not_available' || c.kind === 'refusal' ? 'border-[var(--warning)]/60 text-[var(--warning-text)]' : 'border-[var(--glass-border)] text-soft', clickable && 'hover:surface-2 cursor-pointer text-[var(--primary)] border-[var(--primary)]/50')}>
              <CI className="w-3.5 h-3.5" />{L(c.label)}
            </button>); })}
        </div>
      )}
    </div>
  );
}

export function AskPanel({ compact }: { compact?: boolean }) {
  const { auth } = useDev();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<{ q: string; a?: any; err?: string; clarify?: string; choice?: string }[]>([]);
  const [ev, setEv] = useState<EvidenceSpec | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const ask = async (question: string, clarify?: string, choice?: string) => {
    if (!question.trim()) return;
    setBusy(true);
    try {
      const r = await call<any>(auth, 'Report.Ask', { query: { question, clarify, lang: getLang() } });
      setItems((xs) => [...xs, { q: question, a: r.data, clarify, choice }]);
    } catch (e) { setItems((xs) => [...xs, { q: question, err: errorText(e) }]); } finally { setBusy(false); setQ(''); setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 50); }
  };
  const families = useMemo(() => { const m = new Map<string, any[]>(); for (const b of bank as any[]) m.set(b.family, [...(m.get(b.family) ?? []), b]); return [...m.entries()]; }, []);
  const [fam, setFam] = useState<string | null>(null);
  return (
    <EvidenceCtx.Provider value={setEv}>
      <div className="space-y-3" data-fb="ask-panel">
        {items.length === 0 && (
          <div className="space-y-2">
            <div className="text-sm text-soft">{t('اسأل بالعامية أو بالإنجليزي. الإجابة من نفس المقاييس المعتمدة اللي في التقارير، ومعاها التعريف والفترة ولحد إمتى والشيكات اللي ورا الرقم. لو السؤال مش واضح هسألك سؤال واحد، ولو المصدر مش موجود هقول «مش متاح» مش صفر.')}</div>
            <div className="flex flex-wrap gap-1.5">{SUGGEST.slice(0, compact ? 6 : 12).map((s) => <Button key={s} size="sm" variant="ghost" className="border border-[var(--glass-border)]" onClick={() => ask(s)} data-fb={`ask-suggest:${s}`}><Sparkles className="w-3.5 h-3.5" />{s}</Button>)}</div>
          </div>
        )}
        {items.map((it, i) => (
          <div key={i} className="space-y-2">
            <div className="flex justify-end"><div className="max-w-[85%] rounded-2xl rounded-be-sm bg-[var(--primary-container)] px-3 py-2 text-sm">{it.q}{it.choice && <span className="block text-[11px] text-dim">{t('اختيارك')}: {it.choice}</span>}</div></div>
            <Card padding="sm">{it.err ? <Banner tone="error">{it.err}</Banner> : <AnswerCard a={it.a} busy={busy} onClarify={(id, label) => ask(it.q, id, label)} />}</Card>
          </div>
        ))}
        {busy && <Spinner />}
        <div ref={endRef} />
        <form className="flex gap-2 sticky bottom-0 surface-1 p-2 rounded-xl border line" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('مثلًا: صافي المبيعات امبارح، مين أكتر ويتر بيلغي، الخامات الناقصة…')} className="flex-1 bg-transparent outline-none px-2 text-sm" data-fb="ask-input" />
          <Button variant="primary" size="sm" loading={busy} type="submit" data-fb="ask-send"><Send className="w-4 h-4" />{t('اسأل')}</Button>
        </form>
        {!compact && (
          <Card title={t('بنك الأسئلة (198 سؤال من البحث)')} description={t('الأسئلة اللي المساعد اتجرب عليها — دوس على أي سؤال يتسأل. النتيجة لكل عائلة في تقرير التقييم.')}>
            <div className="flex flex-wrap gap-1 mb-2">{families.map(([f, xs]) => <Button key={f} size="sm" variant={fam === f ? 'primary' : 'ghost'} onClick={() => setFam(fam === f ? null : f)}>{f} <span className="num text-[10px] opacity-70">{xs.length}</span></Button>)}</div>
            {fam && <div className="flex flex-wrap gap-1.5">{families.find(([f]) => f === fam)![1].map((b: any) => <Button key={b.id} size="sm" variant="ghost" className="border border-[var(--glass-border)] text-start" onClick={() => ask(getLang() === 'ar' ? b.ar : b.en)} title={b.id}>{getLang() === 'ar' ? b.ar : b.en}</Button>)}</div>}
          </Card>
        )}
      </div>
      <EvidenceDrawer spec={ev} onClose={() => setEv(null)} />
    </EvidenceCtx.Provider>
  );
}

export default function AssistantScreen() {
  return (
    <div className="space-y-4 max-w-[1100px] mx-auto" data-screen-id="ASK">
      <PageHeader title={t('اسأل التقارير')} icon={<MessageCircleQuestion className="w-5 h-5" />} badge={<StateBadge ops={['Report.Ask', 'Report.Explain']} />}
        description={t('مساعد بقواعد ثابتة (من غير ذكاء اصطناعي) — بيترجم سؤالك لاستعلام على قاموس المقاييس ويجاوب بالأرقام المعتمدة ومصدرها.')} />
      <AskPanel />
    </div>
  );
}

/** Floating entry on report pages: opens the assistant in a side panel. */
export function AskFab() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} data-fb="ask-fab" className="fixed bottom-6 end-6 z-40 rounded-full shadow-lg bg-[var(--primary)] text-[var(--primary-foreground)] h-12 px-4 flex items-center gap-2 font-bold hover:opacity-90"><MessageCircleQuestion className="w-5 h-5" />{t('اسأل التقارير')}</button>
      <Drawer open={open} onClose={() => setOpen(false)} width="lg" title={t('اسأل التقارير')} icon={<MessageCircleQuestion className="w-5 h-5" />} badge={<StateBadge ops={['Report.Ask']} />}><AskPanel compact /></Drawer>
    </>
  );
}
