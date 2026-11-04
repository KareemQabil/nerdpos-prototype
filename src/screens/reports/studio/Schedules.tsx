// «بتتبعت لوحدها»: a schedule sends a report (certified or one of «تقاريري») in a print template and format to people
// or roles. With «ملف لكل فرع» each person gets one file per branch they are allowed to see. Every run is kept: open
// any output to preview / print / download it. In the prototype sending is recorded, not emailed.
import React, { useMemo, useState } from 'react';
import { CalendarClock, Plus, Play, Pause, Trash2, ChevronDown, Send, FileText, Users, User, Eye, CheckCircle2, XCircle } from 'lucide-react';
import { useDev, useQuery, useCommand, errorText } from '../../../app/hooks';
import { call } from '../../../api/client';
import { Button, Card, Pill, Modal, Field, Input, Select, SegmentedControl, Switch, EmptyState, Spinner, Banner, toast, StateBadge, SkeletonCard, DateTime } from '../../../ui';
import { t, L } from '../../../i18n';
import { cn } from '../../../lib/format';
import { personText } from '../../../demo/people';
import { PrintStudio, type PrintSource } from './PrintStudio';

const WEEKDAYS = [6, 0, 1, 2, 3, 4, 5];
const wd = (d: number) => [t('الحد'), t('الاتنين'), t('التلات'), t('الأربع'), t('الخميس'), t('الجمعة'), t('السبت')][d];
const fmtLabel = (f: string) => (f === 'XLSX' ? t('إكسل') : f === 'PDF' ? 'PDF' : 'CSV');

export function SchedulesPanel({ certified, prefill }: { certified: any[]; prefill?: { kind: 'saved' | 'certified'; id: string } | null }) {
  const { auth } = useDev();
  const q = useQuery<any>('Report.ScheduleFind');
  const tq = useQuery<any>('ReportTemplate.Find');
  const { run, busy } = useCommand();
  const [form, setForm] = useState(!!prefill);
  const [openId, setOpenId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PrintSource | null>(null);
  const [loadingOut, setLoadingOut] = useState<string | null>(null);
  const items: any[] = q.data?.items ?? [];
  const tplName = (id?: string | null) => L((tq.data?.items ?? []).find((x: any) => x.id === id)?.name) || null;
  const openOutput = async (id: string) => {
    setLoadingOut(id);
    try {
      const o = (await call<any>(auth, 'Report.ScheduleOutput', { params: { outputId: id } })).data;
      setPreview(o.kind === 'PIVOT' ? { kind: 'pivot', result: o.result, title: `${o.title} — ${o.branchName}`, view: o.result.saved?.design?.view?.columns, chart: o.result.saved?.design?.view?.chart, savedId: o.result.saved?.id, templateId: o.templateId, generatedAt: o.runAt } : { kind: 'certified', run: o.result, templateId: o.templateId, generatedAt: o.runAt });
    } catch (e) { toast('error', errorText(e), (e as any)?.code, auth.label); } finally { setLoadingOut(null); }
  };
  const runNow = async (s: any) => { const r = await run('Report.ScheduleRunNow', { params: { scheduleId: s.id } }, { success: t('اتبعت دلوقتي') }); if (r) { setOpenId(s.id); q.refetch(); } };
  return (
    <div className="space-y-3" data-fb="schedules">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="min-w-0 flex-1"><div className="font-bold flex items-center gap-2"><CalendarClock className="w-4 h-4 text-[var(--primary)]" />{t('تقارير بتتبعت لوحدها')}<StateBadge ops={['Report.Schedule', 'Report.ScheduleRunNow', 'Report.ScheduleOutput']} /></div><div className="text-xs text-dim">{t('اختار التقرير والقالب والشكل ولمين. كل مرة بتتسجل وتقدر تفتح الملف اللي اتبعت.')}</div></div>
        <Button variant="primary" size="sm" onClick={() => setForm(true)} data-fb="schedule:new"><Plus className="w-4 h-4" />{t('جدولة جديدة')}</Button>
      </div>
      {q.loading && !q.data ? <SkeletonCard /> : !items.length ? <EmptyState icon={<CalendarClock className="w-6 h-6" />} title={t('مفيش تقارير متجدولة')} text={t('مثلاً: ابعت «ملخص المالك الأسبوعي» لصاحب المطعم كل سبت الصبح.')} action={<Button variant="primary" onClick={() => setForm(true)}><Plus className="w-4 h-4" />{t('جدولة جديدة')}</Button>} /> : (
        <div className="space-y-2.5">
          {items.map((s) => {
            const open = openId === s.id;
            return (
              <Card key={s.id} padding="none" className="overflow-hidden" data-fb={`schedule:${s.id}`}>
                <div className="p-4 flex items-start gap-3 flex-wrap">
                  <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', s.active ? 'bg-[var(--primary)]/15 text-[var(--primary)]' : 'surface-2 text-dim')}><Send className="w-5 h-5" /></div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="font-bold flex items-center gap-2 flex-wrap">{L(s.reportTitle)}{s.savedReportId ? <Pill size="sm" tone="violet">{t('من تقاريري')}</Pill> : <Pill size="sm" tone="success">{t('معتمد')}</Pill>}{!s.active && <Pill size="sm" tone="neutral">{t('متوقف')}</Pill>}</div>
                    <div className="text-sm text-soft">{s.frequency === 'DAILY' ? t('كل يوم') : t('كل {d}', { d: wd(s.weekday) })} {t('الساعة')} <span className="num">{s.time}</span> · {fmtLabel(s.format)}{tplName(s.templateId) ? ` · ${tplName(s.templateId)}` : ''}{s.burst ? ` · ${t('ملف لكل فرع')}` : ''}</div>
                    <div className="flex flex-wrap gap-1">{(s.recipientsV2 ?? s.recipients.map((x: string) => ({ kind: 'TEXT', label: x }))).map((r: any, i: number) => <Pill key={i} size="sm" tone="neutral">{r.kind === 'ROLE' ? <Users className="w-3 h-3 inline me-1" /> : <User className="w-3 h-3 inline me-1" />}{r.kind === 'TEXT' ? personText(r.label) : r.label}</Pill>)}</div>
                    <div className="text-xs text-dim">{s.active ? <>{t('المرة الجاية')}: <DateTime v={s.nextRunAt} /></> : t('مش هيتبعت لحد ما تشغّله')}{s.runs?.[0] ? <> · {t('آخر مرة')}: <DateTime v={s.runs[0].at} /></> : null}</div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => runNow(s)} data-fb={`schedule:run:${s.id}`}><Play className="w-4 h-4" />{t('ابعته دلوقتي')}</Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => run('Report.ScheduleUpdate', { params: { scheduleId: s.id }, body: { active: !s.active, expectedVersion: s.version } }, { success: s.active ? t('اتوقف') : t('اشتغل تاني') }).then(() => q.refetch())} aria-label={s.active ? t('وقّف') : t('شغّل')}>{s.active ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}</Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => run('Report.ScheduleUpdate', { params: { scheduleId: s.id }, body: { active: false, delete: true, expectedVersion: s.version } }, { success: t('اتشالت') }).then(() => q.refetch())} aria-label={t('امسح')}><Trash2 className="w-4 h-4" /></Button>
                  </div>
                </div>
                <button type="button" onClick={() => setOpenId(open ? null : s.id)} className="w-full flex items-center gap-2 px-4 py-2 border-t line text-sm hover:surface-1" aria-expanded={open} data-fb={`schedule:history:${s.id}`}>
                  <span className="font-medium">{t('اللي اتبعت قبل كده')}</span><span className="text-dim num">({s.runs?.length ?? 0})</span><span className="flex-1" /><ChevronDown className={cn('w-4 h-4 transition-transform', open && 'rotate-180')} />
                </button>
                {open && (
                  <div className="px-4 pb-4 space-y-2" data-fb="schedule:runs">
                    {!s.runs?.length && <div className="text-sm text-dim">{t('لسه ما اتبعتش ولا مرة. دوس «ابعته دلوقتي» تشوف شكله.')}</div>}
                    {s.runs?.map((r: any, i: number) => (
                      <div key={i} className="rounded-xl surface-1 p-2.5 space-y-1.5">
                        <div className="flex items-center gap-2 text-sm flex-wrap">{r.status === 'SENT' ? <CheckCircle2 className="w-4 h-4 text-[var(--success)]" /> : <XCircle className="w-4 h-4 text-[var(--error)]" />}<DateTime v={r.at} /><span className="text-dim">{r.status === 'SENT' ? t('اتبعت') : t('ما اتبعتش')}</span></div>
                        {r.outputs?.length ? (
                          <div className="flex flex-wrap gap-1.5">{r.outputs.map((o: any) => <Button key={o.id} size="sm" variant="outline" loading={loadingOut === o.id} onClick={() => openOutput(o.id)} data-fb={`schedule:output:${o.id}`}><Eye className="w-4 h-4" />{o.branchName}<span className="text-dim text-[11px]">→ {o.recipients.map((x: string) => personText(x)).join('، ')}</span></Button>)}</div>
                        ) : <div className="text-xs text-dim">{personText(r.note)}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
      <div className="text-[11px] text-dim">{t('في البروتوتايب الإرسال بيتسجل بس (مفيش إيميل بيتبعت فعلاً) — والملفات بتتعمل وتقدر تفتحها من هنا.')}</div>
      {form && <ScheduleDialog certified={certified} prefill={prefill ?? null} onClose={() => setForm(false)} onDone={() => q.refetch()} />}
      {preview && <PrintStudio source={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

export function ScheduleDialog({ certified, prefill, onClose, onDone }: { certified: any[]; prefill: { kind: 'saved' | 'certified'; id: string } | null; onClose: () => void; onDone?: () => void }) {
  const { run, busy } = useCommand();
  const sq = useQuery<any>('SavedReport.Find');
  const tq = useQuery<any>('ReportTemplate.Find');
  const saved: any[] = sq.data?.items ?? [];
  const [report, setReport] = useState<string>(prefill ? `${prefill.kind}:${prefill.id}` : '');
  const [templateId, setTemplateId] = useState('');
  const [format, setFormat] = useState<'PDF' | 'XLSX' | 'CSV'>('PDF');
  const [frequency, setFrequency] = useState<'DAILY' | 'WEEKLY'>('DAILY');
  const [weekday, setWeekday] = useState(6);
  const [time, setTime] = useState('04:30');
  const [burst, setBurst] = useState(true);
  const [recips, setRecips] = useState<{ kind: 'USER' | 'ROLE'; id: string; label: string }[]>([]);
  const people: any[] = sq.data?.people ?? []; const roles: any[] = sq.data?.roles ?? [];
  const sel = report || (saved[0] ? `saved:${saved[0].id}` : certified[0] ? `certified:${certified[0].id}` : '');
  const [kind, id] = sel.split(':');
  const savedRep = kind === 'saved' ? saved.find((x) => x.id === id) : null;
  const tpl = templateId || savedRep?.templateId || 'tpl_accountant_a4';
  const toggle = (r: { kind: 'USER' | 'ROLE'; id: string; label: string }) => setRecips(recips.some((x) => x.kind === r.kind && x.id === r.id) ? recips.filter((x) => !(x.kind === r.kind && x.id === r.id)) : [...recips, r]);
  const submit = async () => {
    const body: any = { frequency, weekday: frequency === 'WEEKLY' ? weekday : undefined, time, format, templateId: tpl, burst, recipientsV2: recips };
    if (kind === 'saved') body.savedReportId = id; else body.reportId = id;
    if (await run('Report.Schedule', { body }, { success: t('اتجدول — هيتبعت لوحده') })) { onDone?.(); onClose(); }
  };
  return (
    <Modal open onClose={onClose} size="lg" title={t('جدولة تقرير يتبعت لوحده')} badge={<StateBadge ops={['Report.Schedule']} />}
      footer={<><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" loading={busy} disabled={!recips.length || !sel} onClick={submit} data-fb="schedule:save"><CalendarClock className="w-4 h-4" />{t('جدول')}</Button></>}>
      <div className="space-y-3.5" data-fb="schedule-dialog">
        <Field label={t('التقرير')}><Select value={sel} onChange={(e) => setReport(e.target.value)} data-fb="schedule:report" options={[...saved.map((r) => ({ value: `saved:${r.id}`, label: `${r.name} — ${t('من تقاريري')}` })), ...certified.map((r) => ({ value: `certified:${r.id}`, label: `${L(r.title)} — ${t('معتمد')}` }))]} /></Field>
        <div className="grid @2xl/main:grid-cols-2 gap-3">
          <Field label={t('قالب الطباعة')}><Select value={tpl} onChange={(e) => setTemplateId(e.target.value)} options={(tq.data?.items ?? []).map((x: any) => ({ value: x.id, label: L(x.name) }))} data-fb="schedule:template" /></Field>
          <Field label={t('الشكل')}><SegmentedControl full size="sm" value={format} onChange={setFormat} options={[{ id: 'PDF', label: 'PDF' }, { id: 'XLSX', label: t('إكسل') }, { id: 'CSV', label: 'CSV' }]} /></Field>
        </div>
        <div className="grid @2xl/main:grid-cols-2 gap-3">
          <Field label={t('كل قد إيه')}><SegmentedControl full size="sm" value={frequency} onChange={setFrequency} options={[{ id: 'DAILY', label: t('كل يوم') }, { id: 'WEEKLY', label: t('كل أسبوع') }]} /></Field>
          <Field label={t('الساعة (بتوقيت القاهرة)')}><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} dir="ltr" /></Field>
        </div>
        {frequency === 'WEEKLY' && <div className="flex flex-wrap gap-1">{WEEKDAYS.map((d) => <button key={d} type="button" onClick={() => setWeekday(d)} className={cn('px-3 h-8 rounded-lg text-sm border', weekday === d ? 'bg-[var(--primary)] text-[var(--primary-foreground)] border-transparent font-bold' : 'border-[var(--glass-border)]')}>{wd(d)}</button>)}</div>}
        <Field label={t('يتبعت لمين')} hint={t('اختار وظيفة (كل اللي بيشتغلوا بيها) أو أشخاص بالاسم.')}>
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">{roles.map((r) => <RecipChip key={r.id} on={recips.some((x) => x.kind === 'ROLE' && x.id === r.id)} onClick={() => toggle({ kind: 'ROLE', id: r.id, label: r.name })} icon={<Users className="w-3.5 h-3.5" />} label={r.name} fb={`schedule:role:${r.id}`} />)}</div>
            <div className="flex flex-wrap gap-1.5">{people.map((p) => <RecipChip key={p.id} on={recips.some((x) => x.kind === 'USER' && x.id === p.id)} onClick={() => toggle({ kind: 'USER', id: p.id, label: p.name })} icon={<User className="w-3.5 h-3.5" />} label={p.name} fb={`schedule:user:${p.id}`} />)}</div>
          </div>
        </Field>
        <Switch checked={burst} onChange={setBurst} label={t('ملف لكل فرع — وكل واحد يوصله بس الفروع المسموح له بيها')} />
        {time < '04:00' && frequency === 'DAILY' && <Banner tone="info">{t('قبل 4 الفجر اليوم التجاري لسه ما خلصش — التقرير هيطلع بأرقام اليوم اللي فات لحد اللحظة دي (مبدئي).')}</Banner>}
      </div>
    </Modal>
  );
}
function RecipChip({ on, onClick, icon, label, fb }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string; fb?: string }) {
  return <button type="button" onClick={onClick} data-fb={fb} className={cn('px-2.5 h-8 rounded-lg border text-xs inline-flex items-center gap-1.5', on ? 'bg-[var(--primary)] text-[var(--primary-foreground)] border-transparent font-bold' : 'border-[var(--glass-border)] hover:surface-2')}>{icon}{label}</button>;
}
