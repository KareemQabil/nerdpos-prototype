// «محرك التقارير» — the layers made visible for an expert: facts → metrics & dimensions → certified reports →
// analysis → evidence → assistant, with counts and status, the full registry (definition, formula, grain, additivity,
// authority, version, availability) and a query builder that shows refusals and NOT_AVAILABLE in action.
import React, { useMemo, useState } from 'react';
import { Database, Ruler, FileBarChart, LineChart, FileSearch, MessageCircleQuestion, ArrowLeft, Play, Layers } from 'lucide-react';
import { useDev, useQuery, errorText } from '../../app/hooks';
import { call } from '../../api/client';
import { PageHeader, Card, Pill, Table, Button, StateBadge, Tabs, SearchInput, FilterChips, Banner, Spinner, Select } from '../../ui';
import { t, L } from '../../i18n';
import { cn } from '../../lib/format';
import { Tech } from '../../app/tech';
import { clock, businessDate } from '../../mock/clock';
import { EvidenceCtx, Val, additivityText, authorityText, type EvidenceSpec } from './parts';
import { EvidencePopup } from './Evidence';
import { CURRENCY } from '../../lib/format';

const FACT_AR: Record<string, string> = { check: 'الشيكات المقفولة', line: 'سطور البيع', payment: 'الدفعات', refund: 'المرتجعات المصروفة', drawer: 'ورديات الدرج', cash_entry: 'حركات الدرج', removal: 'الإلغاءات بالمراحل', discount: 'الخصومات', comp: 'الضيافة', staff_meal: 'وجبات الموظفين', kitchen: 'تذاكر المطبخ', fiscal: 'الإيصالات الإلكترونية', approval: 'موافقات المدير', stock: 'أرصدة المخزن (لقطة)', count: 'الجرد', waste: 'الهالك', po: 'أوامر الشراء', grn: 'الاستلام', visit: 'قعدات الترابيزات', delivery: 'الدليفري', reservation: 'الحجوزات', open_check: 'الشيكات المفتوحة دلوقتي' };
const ICONS = [Database, Ruler, FileBarChart, LineChart, FileSearch, MessageCircleQuestion];

export default function ReportCatalog() {
  const { nav } = useDev();
  const cat = useQuery<any>('Report.Catalog');
  const reg = useQuery<any>('Metric.List');
  const [tab, setTab] = useState<'layers' | 'metrics' | 'dimensions' | 'builder'>('layers');
  const [ev, setEv] = useState<EvidenceSpec | null>(null);
  const c = cat.data;
  return (
    <EvidenceCtx.Provider value={setEv}>
      <div className="space-y-4" data-screen-id="RCAT">
        <PageHeader title={t('محرك التقارير — الطبقات')} icon={<Layers className="w-5 h-5" />} badge={<StateBadge ops={['Report.Catalog', 'Metric.List', 'Report.Query']} />}
          description={t('كل رقم في التقارير بيطلع من نفس الطبقات: الأحداث ← قاموس المقاييس ← التقارير المعتمدة ← التحليل ← الإثبات ← المساعد. هنا بتشوف المحرك نفسه، مش صفحات.')}
          actions={<><Button size="sm" variant="outline" onClick={() => nav('reports')} data-fb="rcat:reports"><FileBarChart className="w-4 h-4" />{t('التقارير')}</Button><Button size="sm" variant="primary" onClick={() => nav('report-assistant')} data-fb="rcat:ask"><MessageCircleQuestion className="w-4 h-4" />{t('اسأل التقارير')}</Button></>} />
        <Tabs variant="underline" value={tab} onChange={setTab} tabs={[{ id: 'layers', label: t('الطبقات'), fb: 'rcat-tab:layers' }, { id: 'metrics', label: t('المقاييس'), count: reg.data?.metrics?.length, fb: 'rcat-tab:metrics' }, { id: 'dimensions', label: t('الأبعاد'), count: reg.data?.dimensions?.length, fb: 'rcat-tab:dimensions' }, { id: 'builder', label: t('جرّب استعلام'), fb: 'rcat-tab:builder' }]} />
        {cat.loading && !c && <Spinner />}
        {cat.error && <Banner tone="error">{errorText(cat.error)}</Banner>}
        {tab === 'layers' && c && <Layers6 c={c} onReport={() => nav('reports')} onAsk={() => nav('report-assistant')} />}
        {tab === 'metrics' && reg.data && <Metrics metrics={reg.data.metrics} />}
        {tab === 'dimensions' && reg.data && <Dimensions dims={reg.data.dimensions} />}
        {tab === 'builder' && reg.data && <Builder metrics={reg.data.metrics} dims={reg.data.dimensions} />}
      </div>
      <EvidencePopup spec={ev} onClose={() => setEv(null)} />
    </EvidenceCtx.Provider>
  );
}

function Layers6({ c, onReport, onAsk }: { c: any; onReport: () => void; onAsk: () => void }) {
  const L0 = c.layers[0], L1 = c.layers[1], L2 = c.layers[2];
  return (
    <div className="space-y-4" data-fb="rcat-layers">
      <div className="grid @3xl/main:grid-cols-3 @6xl/main:grid-cols-6 gap-2 items-stretch">
        {c.layers.map((l: any, i: number) => { const Icon = ICONS[i]; return (
          <div key={l.id} className="relative rounded-2xl surface-1 p-3 border line flex flex-col gap-1" data-fb={`layer:${l.id}`}>
            <div className="flex items-center gap-2"><span className="w-8 h-8 rounded-lg bg-[var(--primary-container)] flex items-center justify-center"><Icon className="w-4 h-4" /></span><span className="text-xs text-dim num">{l.id}</span></div>
            <div className="font-bold text-sm">{L(l.title)}</div>
            <div className="text-2xl font-extrabold num">{l.items}</div>
            <div className="text-[11px] text-soft">
              {l.id === 'L0' && t('{a} مصدر فيه أحداث', { a: l.available })}
              {l.id === 'L1' && <>{t('{a} متاح · {n} مش متاح (بالسبب)', { a: l.available, n: l.notAvailable })}<br />{t('{c} معتمد · {m} سوق · {p} مقترح', { c: l.byAuthority.CANONICAL, m: l.byAuthority.MARKET, p: l.byAuthority.PROPOSED })}<br />{t('{d} بُعد', { d: l.dimensions })}</>}
              {l.id === 'L2' && t('{p} من القايمة التجريبية + {x} إضافي (التقريب، الإلغاءات بالمراحل، طابور المراجعة، مصفوفة المنيو) · {g} تقارير قديمة شغالة زي ما هي', { p: l.pilot, x: l.items - l.pilot, g: l.legacy })}
              {l.id === 'L3' && t('مقارنة فترات، اتجاه، «ليه اتغير» (حجم × سعر × تشكيلة + غير مفسَّر)، مصفوفة المنيو')}
              {l.id === 'L4' && t('أي رقم ← الشيكات والسطور والدفعات اللي وراه، ومجموعهم = الرقم')}
              {l.id === 'A' && t('مساعد بقواعد ثابتة، متجرّب على {n} سؤال', { n: l.items })}
            </div>
            {i < c.layers.length - 1 && <ArrowLeft className="hidden @6xl/main:block absolute -start-3 top-1/2 w-4 h-4 text-dim rtl:rotate-0 ltr:rotate-180" />}
          </div>); })}
      </div>
      <div className="grid @4xl/main:grid-cols-2 gap-3">
        <Card title={t('L0 — الأحداث اللي المحرك بيقرا منها')} description={t('كل حقيقة ليها يوم تجاري، ووقت تسجيل (لـ asOf)، والأبعاد اللي بتحملها، ومؤشر للسجل الأصلي.')}>
          <div className="grid grid-cols-2 gap-1.5">{L0.detail.map((f: any) => <div key={f.kind} className={cn('flex items-center justify-between rounded-lg px-2 py-1 text-sm', f.count ? 'surface-1' : 'surface-1 opacity-60')}><span>{t(FACT_AR[f.kind] ?? f.kind)}</span><span className="num font-bold">{f.count}</span></div>)}</div>
          <div className="text-[11px] text-dim mt-2">{t('أول يوم فيه أحداث تفصيلية: {d}. الأيام قبله عندها إجماليات يومية مستوردة بس.', { d: c.launchDate })}</div>
        </Card>
        <Card title={t('L2 — التقارير المعتمدة (manifests)')} description={t('كل تقرير = تركيبة من مقاييس وأبعاد مسجلة + غرض + جمهور + مطابقة + قايمة مراجعة. مفيش حسابات فلوس جوه الشاشة.')} actions={<Button size="sm" variant="ghost" onClick={onReport}>{t('افتح')}</Button>}>
          <div className="space-y-1 max-h-80 overflow-auto">{c.manifests.map((m: any) => (
            <div key={m.id} className="rounded-lg surface-1 px-2 py-1.5 text-sm">
              <div className="flex items-center gap-1.5 flex-wrap"><b>{L(m.title)}</b>{m.pilot ? <Pill size="sm" tone="primary">{t('من الـ15')}</Pill> : <Pill size="sm" tone="info">{t('إضافي')}</Pill>}{!m.allowed && <Pill size="sm" tone="neutral">{t('مش لصلاحيتك')}</Pill>}<span className="text-[10px] text-dim num">{m.researchIds.join(' ')}</span></div>
              <div className="text-[11px] text-dim">{t('{m} مقياس × {d} بُعد', { m: m.metrics.length, d: m.dimensions.length })}<Tech><span className="num ms-1" dir="ltr">{m.metrics.join(', ')}</span></Tech></div>
            </div>))}</div>
        </Card>
      </div>
      <Card title={t('القواعد اللي المحرك بيفرضها')} description={t('دي اللي بتخلي أي شات بوت بعدين يقف على أرض صلبة.')}>
        <div className="grid @3xl/main:grid-cols-2 gap-1.5 text-sm">
          {['اليوم التجاري من 4 الفجر بتوقيت القاهرة، والمرتجع بيتحسب يوم صرفه — اليوم المقفول ما بيتكتبش تاني.', 'النسب من المجاميع (Σ صافي ÷ Σ شيكات) — عمرها ما بتبقى متوسط متوسطات.', 'تقسيم الشيك ما بيكترش الأوردرات ولا الضيوف؛ الإجماليات بتتحسب من جديد مش بتتجمع من الصفوف.', 'الرصيد لقطة في لحظة (asOf) — ما بيتجمعش على الأيام ولا بيتجمع كيلو على لتر.', 'تقاطع مقياس × بُعد مش منطقي بيترفض بالسبب (مثلًا المبيعات حسب طريقة الدفع).', 'مصدر مش موجود = «مش متاح» بالسبب، عمره ما بيطلع صفر.', 'الفروع حسب صلاحيات المستخدم، وأرقام الموظفين والعجز للمدير — والرفض من السيرفر.', 'asOf بيخفي اللي اتسجل بعده، واليوم المفتوح أو الوردية المفتوحة = «مبدئي».'].map((x, i) => <div key={i} className="rounded-lg surface-1 px-2 py-1.5">✓ {t(x)}</div>)}
        </div>
        <div className="flex gap-2 mt-3"><Button size="sm" variant="primary" onClick={onAsk}><MessageCircleQuestion className="w-4 h-4" />{t('جرّب المساعد')}</Button></div>
      </Card>
      {L1 && null}{L2 && null}
    </div>
  );
}

function Metrics({ metrics }: { metrics: any[] }) {
  const [q, setQ] = useState('');
  const [st, setSt] = useState<'all' | 'AVAILABLE' | 'NOT_AVAILABLE' | 'CANONICAL' | 'PROPOSED' | 'MARKET'>('all');
  const rows = metrics.filter((m) => (st === 'all' || m.status === st || m.authority === st) && (!q || (L(m.label) + m.id + L(m.definition)).includes(q)));
  return (
    <Card padding="sm" data-fb="rcat-metrics">
      <div className="flex flex-wrap gap-2 mb-2"><SearchInput value={q} onChange={setQ} placeholder={t('دوّر على مقياس')} /><FilterChips value={st} onChange={setSt} options={[{ id: 'all', label: t('الكل'), count: metrics.length }, { id: 'AVAILABLE', label: t('متاح'), count: metrics.filter((m) => m.status === 'AVAILABLE').length, tone: 'success' }, { id: 'NOT_AVAILABLE', label: t('مش متاح'), count: metrics.filter((m) => m.status !== 'AVAILABLE').length, tone: 'warning' }, { id: 'CANONICAL', label: t('معتمد في العقد'), count: metrics.filter((m) => m.authority === 'CANONICAL').length }, { id: 'PROPOSED', label: t('مقترح'), count: metrics.filter((m) => m.authority === 'PROPOSED').length }]} /></div>
      <Table dense maxHeight={620} head={[t('المقياس'), t('التعريف'), t('الوحدة / الجمع'), t('المصدر'), t('الحالة')]} rows={rows.map((m) => [
        <div className="min-w-40"><div className="font-bold">{L(m.label)}</div><div className="text-[10px] text-dim">{t('نسخة {v}', { v: m.version })} · {authorityText(m.authority)}</div><Tech><div className="num text-[10px] text-dim" dir="ltr">{m.id}</div></Tech></div>,
        <div className="text-xs max-w-md"><div>{L(m.definition)}</div>{m.pitfalls?.map((p: any, i: number) => <div key={i} className="text-[var(--warning-text)]">{t('تنبيه')}: {L(p)}</div>)}<Tech><div className="num text-[10px] text-dim mt-0.5" dir="ltr">{m.formula} · grain {m.grain}</div></Tech></div>,
        <div className="text-xs"><div>{m.unit === 'EGP' ? CURRENCY : m.unit === 'count' ? t('عدد') : m.unit === '%' ? '%' : m.unit === 'minutes' ? t('دقايق') : m.unit === 'unit' ? t('وحدة') : m.unit}</div><div className="text-dim">{additivityText(m.additivity)}</div></div>,
        <div className="text-xs"><div>{t(FACT_AR[m.fact] ?? (m.fact === 'composite' ? 'مركب من مقاييس' : m.fact))}</div><div className="text-dim">{m.dimensions.length} {t('بُعد مسموح')}</div></div>,
        m.status === 'AVAILABLE' ? <Pill size="sm" tone="success">{t('متاح')}</Pill> : <div className="max-w-xs"><Pill size="sm" tone="warning">{t('مش متاح')}</Pill><div className="text-[10px] text-dim mt-0.5">{L(m.reason)}</div></div>,
      ])} />
    </Card>
  );
}

function Dimensions({ dims }: { dims: any[] }) {
  return (
    <Card padding="sm" data-fb="rcat-dimensions">
      <Table dense maxHeight={620} head={[t('البُعد'), t('الوصف'), t('تحذير'), t('الحالة')]} rows={dims.map((d) => [
        <div><div className="font-bold">{L(d.label)}</div><div className="text-[10px] text-dim">{d.priority}{d.permission ? ` · ${t('للمدير')}` : ''}</div><Tech><span className="num text-[10px] text-dim">{d.id} · {d.source}</span></Tech></div>,
        <span className="text-xs">{L(d.description)}</span>, <span className="text-xs text-[var(--warning-text)]">{L(d.warning)}</span>,
        d.status === 'AVAILABLE' ? <Pill size="sm" tone="success">{t('متاح')}</Pill> : <div><Pill size="sm" tone="warning">{t('مش متاح')}</Pill><div className="text-[10px] text-dim">{L(d.reason)}</div></div>,
      ])} />
    </Card>
  );
}

/** The L3 builder: pick registered metrics × dimensions × period → the engine answers, refuses or says not available. */
function Builder({ metrics, dims }: { metrics: any[]; dims: any[] }) {
  const { auth } = useDev();
  const today = businessDate(clock.now());
  const y = new Date(Date.parse(today + 'T12:00:00Z') - 86_400_000).toISOString().slice(0, 10);
  const [sel, setSel] = useState<string[]>(['net_item_sales', 'check_count', 'avg_check']);
  const [dim, setDim] = useState<string>('channel');
  const [from, setFrom] = useState(y);
  const [to, setTo] = useState(y);
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => { setBusy(true); setErr(null); try { setRes((await call<any>(auth, 'Report.Query', { query: { q: JSON.stringify({ metrics: sel, dimensions: dim ? [dim] : [], from, to }) } })).data); } catch (e) { setErr(errorText(e)); setRes(null); } finally { setBusy(false); } };
  const presets: [string, string[], string][] = [['المبيعات حسب طريقة الدفع (هيترفض)', ['net_item_sales'], 'payment_method'], ['الرصيد على الأيام (هيترفض)', ['stock_on_hand'], 'business_date'], ['تكلفة العمالة (مش متاح)', ['labor_cost', 'net_item_sales'], ''], ['الأوردرات بالساعة (مش بتتجمع)', ['order_count', 'check_count'], 'hour'], ['الإلغاءات بالمرحلة', ['void_line_count', 'void_value', 'refund_count'], 'stage']];
  const avail = useMemo(() => metrics.filter((m) => m.allowed), [metrics]);
  return (
    <div className="space-y-3" data-fb="rcat-builder">
      <Card title={t('جرّب استعلام على القاموس')} description={t('اختار مقاييس وبُعد وفترة — المحرك هيجاوب، أو يرفض التقاطع بالسبب، أو يقول «مش متاح». كل رقم بيفتح الشيكات اللي وراه.')}>
        <div className="flex flex-wrap gap-1.5 mb-2">{presets.map(([label, ms, d]) => <Button key={label} size="sm" variant="ghost" className="border border-[var(--glass-border)]" onClick={() => { setSel(ms); setDim(d); }} data-fb={`builder-preset:${label}`}>{t(label)}</Button>)}</div>
        <div className="flex flex-wrap gap-1 max-h-32 overflow-auto mb-2">{avail.map((m) => <button key={m.id} type="button" onClick={() => setSel(sel.includes(m.id) ? sel.filter((x) => x !== m.id) : [...sel, m.id])} className={cn('px-2 h-7 rounded-md text-xs border', sel.includes(m.id) ? 'border-[var(--primary)] bg-[var(--primary-container)] font-bold' : 'border-[var(--glass-border)] surface-1', m.status !== 'AVAILABLE' && 'opacity-70')}>{L(m.label)}</button>)}</div>
        <div className="flex flex-wrap gap-2 items-end">
          <Select value={dim} onChange={(e) => setDim(e.target.value)} options={[{ value: '', label: t('من غير تقسيم') }, ...dims.map((d) => ({ value: d.id, label: L(d.label) }))]} />
          <input type="date" className="glass-input h-9 px-2 rounded-lg" value={from} onChange={(e) => setFrom(e.target.value)} max={today} />
          <input type="date" className="glass-input h-9 px-2 rounded-lg" value={to} onChange={(e) => setTo(e.target.value)} min={from} max={today} />
          <Button variant="primary" size="sm" loading={busy} onClick={run} disabled={!sel.length} data-fb="builder-run"><Play className="w-4 h-4" />{t('شغّل')}</Button>
        </div>
      </Card>
      {err && <Banner tone="error">{err}</Banner>}
      {res && (
        <Card>
          {res.meta.refused.map((x: any, i: number) => <Banner key={i} tone="warning" title={t('اترفض')}>{L(metrics.find((m) => m.id === x.metric)?.label)}: {L(x.reason)}</Banner>)}
          {res.meta.notAvailable.map((x: any, i: number) => <Banner key={i} tone="info" title={t('مش متاح')}>{L(metrics.find((m) => m.id === x.metric)?.label)}: {L(x.reason)}</Banner>)}
          <Table dense maxHeight={460} align={[...res.dimensions.map(() => 'start' as const), ...res.metrics.map(() => 'end' as const)]}
            head={[...res.dimensions.map((d: string) => L(dims.find((x: any) => x.id === d)?.label)), ...res.metrics.map((m: string) => L(metrics.find((x) => x.id === m)?.label))]}
            rows={[...res.rows.map((r: any) => [...res.dimensions.map((d: string) => L(r.labels[d])), ...res.metrics.map((m: string) => <Val v={r.values[m]} unit={metrics.find((x) => x.id === m)?.unit} spec={{ metric: m, cell: r.dims, from, to }} />)]), [<b>{t('الإجمالي (محسوب من جديد)')}</b>, ...res.dimensions.slice(1).map(() => ''), ...res.metrics.map((m: string) => <Val v={res.totals[m]} unit={metrics.find((x) => x.id === m)?.unit} spec={{ metric: m, from, to }} />)]]} />
          <div className="text-[11px] text-dim mt-2">{res.meta.provisional ? t('مبدئي') + ': ' + res.meta.provisionalReasons.map((x: any) => L(x)).join(' ') : t('نهائي — الأيام مقفولة')}</div>
        </Card>
      )}
    </div>
  );
}
