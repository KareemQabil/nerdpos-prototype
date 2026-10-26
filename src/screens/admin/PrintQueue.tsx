// G2 Print queue: jobs from PrintJob.Find, retry the same job (never a new copy), reprint a receipt as a copy.
import React, { useMemo, useState } from 'react';
import { RefreshCw, Copy, Eye, AlertTriangle, Printer, Clock3, CheckCircle2, XCircle, Ban } from 'lucide-react';
import { useDev, useQuery, useCommand } from '../../app/hooks';
import { PageHeader, StateBadge, Banner, Button, Pill, Select, Table, Card, useNow, StatGrid, StatCard, Toolbar, EmptyState } from '../../ui';
import { t } from '../../i18n';
import { Tech } from '../../app/tech';
import { deviceName } from '../../demo/people';
import { dateTime, time } from '../../lib/format';
import { PrintStatePill, printStateLabel, docTypeLabel, printErrorLabel, inTime } from './output/labels';
import { ReprintDialog } from './output/ReprintDialog';

const REPRINTABLE = ['RECEIPT', 'FISCAL_DOCUMENT'];

export default function PrintQueue() {
  const { terminal, can, nav } = useDev();
  useNow(1000);
  const [state, setState] = useState('');
  const [terminalId, setTerminalId] = useState('');
  const [documentType, setDocumentType] = useState('');
  const all = useQuery<any>('PrintJob.Find', { query: { limit: 500 } });
  const list = useQuery<any>('PrintJob.Find', { query: { state: state || undefined, terminalId: terminalId || undefined, documentType: documentType || undefined, limit: 200 } });
  const { run, busy } = useCommand();
  const [reprint, setReprint] = useState<any | null>(null);

  const jobs: any[] = all.data?.items ?? [];
  const counts = useMemo(() => {
    const c: Record<string, number> = { PENDING: 0, SUCCEEDED: 0, FAILED: 0, DEAD: 0 };
    for (const j of jobs) c[j.state] = (c[j.state] ?? 0) + 1;
    return c;
  }, [jobs]);
  const terminals = useMemo(() => {
    const m = new Map<string, string>();
    for (const j of jobs) m.set(j.terminalId, j.terminalCode ?? j.terminalId);
    return [...m.entries()];
  }, [jobs]);
  const rows: any[] = list.data?.items ?? [];
  const dead = jobs.filter((j) => j.state === 'DEAD');
  const failed = jobs.filter((j) => j.state === 'FAILED');

  const retry = async (j: any) => {
    await run('PrintJob.Retry', { params: { printJobId: j.id } }, { success: t('رجعت للطابور — نفس المهمة ونفس النسخة، مش نسخة جديدة') });
  };

  return (
    <div className="space-y-4" data-screen-id="G2">
      <PageHeader icon={<Printer />} title={t('طابور الطباعة')} badge={<StateBadge ops={['PrintJob.Find', 'PrintJob.Retry', 'Print.Reprint']} />}
        description={t('كل ورقة بتطلع من السيستم بتستنى هنا لحد ما الطابعة تستلمها. البيع بيتسجل الأول — عطل الطابعة عمره ما بيوقف بيع.')}
        actions={<Button variant="ghost" onClick={() => { all.refetch(); list.refetch(); }} data-fb="prints:refresh"><RefreshCw className="w-4 h-4" />{t('تحديث')}</Button>} />

      {(dead.length > 0 || failed.length > 0) && (
        <Banner tone={dead.length ? 'error' : 'warning'} action={dead.length > 0 && can('print:retry') ? <Button size="sm" variant="danger" loading={busy} data-fb="prints:retry-all-dead" onClick={async () => { for (const j of dead) await retry(j); }}>{t('إعادة كل الواقفة')}</Button> : undefined}>
          <div className="font-bold" data-fb="prints:failed-banner">
            {dead.length > 0 && t('{n} مهمة طباعة وقفت بعد 5 محاولات — محتاجة "إعادة"', { n: dead.length })}
            {dead.length > 0 && failed.length > 0 && ' · '}
            {failed.length > 0 && t('{n} مهمة فشلت وهتتعاد أوتوماتيك', { n: failed.length })}
          </div>
          <div className="text-xs text-dim mt-0.5">{t('البيع اتسجل خلاص ومش هيتلغي. صلّح الطابعة (ورق / كهربا / شبكة) وبعدين اعمل إعادة.')}</div>
        </Banner>
      )}

      <StatGrid>
        {([['PENDING', <Clock3 />, 'info'], ['SUCCEEDED', <CheckCircle2 />, 'success'], ['FAILED', <XCircle />, 'warning'], ['DEAD', <Ban />, 'error']] as const).map(([s, icon, tone]) => (
          <StatCard key={s} fb={`prints:count:${s}`} onClick={() => setState(state === s ? '' : s)} label={printStateLabel(s)} value={counts[s] ?? 0} icon={icon} tone={(counts[s] ?? 0) > 0 && s !== 'SUCCEEDED' && s !== 'PENDING' ? tone : 'neutral'} hint={state === s ? t('الفلتر شغال — اضغط تاني للكل') : undefined} className={state === s ? 'ring-2 ring-[var(--primary)]' : undefined} />
        ))}
      </StatGrid>

      <Card padding="sm">
        <Toolbar>
          <Select data-fb="prints:filter-state" className="!w-auto min-w-[190px]" value={state} onChange={(e) => setState(e.target.value)} options={[{ value: '', label: t('كل الحالات') }, { value: 'FAILED,DEAD', label: t('محتاجة تدخل (فشلت أو وقفت)') }, ...['PENDING', 'SUCCEEDED', 'FAILED', 'DEAD'].map((s) => ({ value: s, label: printStateLabel(s) }))]} />
          <Select data-fb="prints:filter-terminal" className="!w-auto min-w-[170px]" value={terminalId} onChange={(e) => setTerminalId(e.target.value)} options={[{ value: '', label: t('كل الأجهزة') }, ...terminals.map(([id, code]) => ({ value: id, label: deviceName(code) + (terminal?.id === id ? ` (${t('الجهاز ده')})` : '') }))]} />
          <Select data-fb="prints:filter-doctype" className="!w-auto min-w-[160px]" value={documentType} onChange={(e) => setDocumentType(e.target.value)} options={[{ value: '', label: t('كل الأوراق') }, ...['RECEIPT', 'KITCHEN_TICKET', 'PRE_BILL', 'X_REPORT', 'Z_REPORT', 'FISCAL_DOCUMENT'].map((d) => ({ value: d, label: docTypeLabel(d) }))]} />
        </Toolbar>
        {(
          <Table loading={list.loading && !list.data} maxHeight={620}
            align={[undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'end']}
            head={[t('الورقة'), t('النوع'), t('أصل / نسخة'), t('الجهاز'), t('الحالة'), t('المحاولات'), t('المحاولة الجاية'), '']}
            empty={<EmptyState compact icon={<Printer />} title={t('مفيش أوراق في الطابور')} text={t('بيع حاجة على الكاشير وهتظهر هنا.')} />}
            rows={rows.map((j) => {
              const errs = (j.attempts ?? []).filter((a: any) => a.error);
              return [
                <div key="l"><div className="font-bold">{j.label}</div><div className="text-[11px] text-dim">{dateTime(j.createdAt)}<Tech> <span className="num">· {j.id}</span></Tech></div>{j.reason && <div className="text-[11px] text-dim">{t('السبب')}: {j.reason}</div>}</div>,
                docTypeLabel(j.documentType),
                j.copyKind === 'REPRINT' ? <Pill tone="violet" title="REPRINT">{t('نسخة')}</Pill> : <Pill tone="neutral" title="ORIGINAL">{t('أصل')}</Pill>,
                <span>{deviceName(j.terminalCode ?? j.terminalId)}<Tech><span className="num text-[10px] text-dim block">{j.terminalCode}</span></Tech></span>,
                <PrintStatePill state={j.state} />,
                <div className="text-xs space-y-0.5">
                  <div><span className="num font-bold">{(j.attempts ?? []).length}</span> {t('محاولة')}{errs.length > 0 && <span className="text-dim"> · <span className="num">{errs.length}</span> {t('فشلت')}</span>}</div>
                  {errs.slice(-3).map((a: any, i: number) => <div key={i} className="text-[var(--error)]"><span className="num">{time(a.at)}</span> · {printErrorLabel(a.error)}</div>)}
                </div>,
                <span className="text-xs">{j.state === 'FAILED' ? inTime(j.nextAtMs) : j.state === 'PENDING' ? t('دلوقتي') : j.state === 'DEAD' ? <span className="text-[var(--error)]">{t('خلصت المحاولات')}</span> : '—'}</span>,
                <div className="flex gap-1.5 flex-wrap justify-end">
                  {(j.state === 'FAILED' || j.state === 'DEAD') && can('print:retry') && <Button size="sm" variant={j.state === 'DEAD' ? 'danger' : 'secondary'} loading={busy} data-fb={`prints:retry:${j.id}`} onClick={() => retry(j)} title={t('نفس المهمة ونفس النسخة')}><RefreshCw className="w-3.5 h-3.5" />{t('إعادة')}</Button>}
                  {REPRINTABLE.includes(j.documentType) && can('print:reprint') && <Button size="sm" variant="outline" data-fb={`prints:reprint:${j.id}`} onClick={() => setReprint(j)}><Copy className="w-3.5 h-3.5" />{t('اطبع نسخة')}</Button>}
                  {(j.documentType === 'RECEIPT' || j.documentType === 'PRE_BILL') && String(j.documentId).startsWith('ord') && <Button size="sm" variant="ghost" data-fb={`prints:view:${j.id}`} onClick={() => nav('receipt', { orderId: j.documentId, copy: j.copyKind === 'REPRINT', prebill: j.documentType === 'PRE_BILL' })}><Eye className="w-3.5 h-3.5" /></Button>}
                </div>,
              ];
            })}
          />
        )}
      </Card>

      <Card title={<span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-[var(--warning)]" />{t('إزاي الطباعة شغالة')}</span>} description={t('خمس حاجات تعرفها عن الطابعة والطابور.')}>
        <ul className="text-sm space-y-1.5 list-disc ps-5 text-soft">
          <li>{t('البيع بيتسجل الأول، وبعدين الطباعة بتتعمل كمهمة لوحدها. لو الطابعة واقعة الكاشير يكمل بيع عادي.')}</li>
          <li>{t('المحاولات أوتوماتيك: بعد 5 ث، 15 ث، 45 ث، 2 د، 5 د. بعد 5 محاولات فاشلة المهمة "بتقف" وتظهر هنا بالأحمر.')}</li>
          <li>{t('«إعادة» بترجّع نفس الورقة للطابور — عمرها ما بتطلع نسخة زيادة. الورقة اللي اتبعتت أو لسه مستنية مينفعش تتعاد.')}<Tech> (PRINT_JOB_NOT_RETRYABLE)</Tech></li>
          <li>{t('«اطبع نسخة» بتطبع ورقة جديدة مكتوب عليها «نسخة»، مش إيصال جديد. ممكن تحتاج موافقة مدير حسب الإعدادات (أول نسخة من غير موافقة وبعدها موافقة).')}<Tech> (RECEIPT_REPRINT · docs/30)</Tech></li>
          <li>{t('"اتبعت للطابعة" معناها إن الطابعة استلمت البيانات — الطابعات الحرارية مش بتأكد إن الورقة طلعت فعلًا، فإحنا مش بنقول "اتطبع".')}</li>
          <li>{t('جرّب: من "المحاكاة" فوق خلّي طابعة الكاشير "واقعة" أو "الورق خلص"، وبيع حاجة.')}</li>
        </ul>
      </Card>

      {reprint && <ReprintDialog job={reprint} onClose={() => setReprint(null)} terminalId={terminal?.id ?? reprint.terminalId} />}
    </div>
  );
}
