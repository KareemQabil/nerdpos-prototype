// G2 Print queue: jobs from PrintJob.Find, retry the same job (never a new copy), reprint a receipt as a copy.
import React, { useMemo, useState } from 'react';
import { RefreshCw, Copy, Eye, AlertTriangle } from 'lucide-react';
import { useDev, useQuery, useCommand } from '../../app/hooks';
import { Section, StateBadge, Banner, Button, Pill, Select, Table, Field, Card, Spinner, useNow } from '../../ui';
import { t } from '../../i18n';
import { dateTime, time } from '../../lib/format';
import { PrintStatePill, docTypeLabel, printErrorLabel, inTime } from './output/labels';
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
      <Section title={t('طابور الطباعة')} badge={<StateBadge ops={['PrintJob.Find', 'PrintJob.Retry', 'Print.Reprint']} />}
        sub={t('كل ورقة بتطلع من النظام مهمة في الطابور. الطباعة بتحصل بعد ما البيع يتسجل — فشل الطابعة عمره ما بيوقف بيع.')}
        actions={<Button size="sm" variant="ghost" onClick={() => { all.refetch(); list.refetch(); }} data-fb="prints:refresh"><RefreshCw className="w-4 h-4" />{t('تحديث')}</Button>} />

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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {(['PENDING', 'SUCCEEDED', 'FAILED', 'DEAD'] as const).map((s) => (
          <button key={s} data-fb={`prints:count:${s}`} onClick={() => setState(state === s ? '' : s)} className={`glass rounded-xl p-3 text-start border ${state === s ? 'border-[var(--primary)]' : 'border-transparent'}`}>
            <div className="text-xs text-dim"><PrintStatePill state={s} /></div>
            <div className="text-2xl font-bold num mt-1">{counts[s] ?? 0}</div>
          </button>
        ))}
      </div>

      <Card>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          <Field label={t('الحالة')}>
            <Select data-fb="prints:filter-state" value={state} onChange={(e) => setState(e.target.value)} options={[{ value: '', label: t('الكل') }, { value: 'FAILED,DEAD', label: t('محتاجة تدخل (فشلت أو وقفت)') }, ...['PENDING', 'SUCCEEDED', 'FAILED', 'DEAD'].map((s) => ({ value: s, label: `${s}` }))]} />
          </Field>
          <Field label={t('الجهاز')}>
            <Select data-fb="prints:filter-terminal" value={terminalId} onChange={(e) => setTerminalId(e.target.value)} options={[{ value: '', label: t('كل الأجهزة') }, ...terminals.map(([id, code]) => ({ value: id, label: code + (terminal?.id === id ? ` (${t('الجهاز ده')})` : '') }))]} />
          </Field>
          <Field label={t('نوع المستند')}>
            <Select data-fb="prints:filter-doctype" value={documentType} onChange={(e) => setDocumentType(e.target.value)} options={[{ value: '', label: t('الكل') }, ...['RECEIPT', 'KITCHEN_TICKET', 'PRE_BILL', 'X_REPORT', 'Z_REPORT', 'FISCAL_DOCUMENT'].map((d) => ({ value: d, label: docTypeLabel(d) }))]} />
          </Field>
        </div>
        {list.loading && !list.data ? <Spinner /> : (
          <Table
            head={[t('المستند'), t('النوع'), t('النسخة'), t('الجهاز'), t('الحالة'), t('المحاولات'), t('المحاولة الجاية'), '']}
            empty={t('مفيش مهام طباعة — بيع حاجة على الكاشير وهتظهر هنا')}
            rows={rows.map((j) => {
              const errs = (j.attempts ?? []).filter((a: any) => a.error);
              return [
                <div key="l"><div className="font-bold">{j.label}</div><div className="text-[11px] text-dim">{dateTime(j.createdAt)} <span className="num">· {j.id}</span></div>{j.reason && <div className="text-[11px] text-dim">{t('السبب')}: {j.reason}</div>}</div>,
                docTypeLabel(j.documentType),
                j.copyKind === 'REPRINT' ? <Pill tone="violet" title="REPRINT">{t('نسخة')}</Pill> : <Pill tone="neutral" title="ORIGINAL">{t('أصل')}</Pill>,
                <span className="num">{j.terminalCode ?? j.terminalId}</span>,
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

      <Card title={<span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-[var(--warning)]" />{t('إزاي الطباعة شغالة')}</span>}>
        <ul className="text-sm space-y-1.5 list-disc ps-5 text-soft">
          <li>{t('البيع بيتسجل الأول، وبعدين الطباعة بتتعمل كمهمة لوحدها. لو الطابعة واقعة الكاشير يكمل بيع عادي.')}</li>
          <li>{t('المحاولات أوتوماتيك: بعد 5 ث، 15 ث، 45 ث، 2 د، 5 د. بعد 5 محاولات فاشلة المهمة "بتقف" وتظهر هنا بالأحمر.')}</li>
          <li>{t('"إعادة" بترجع نفس المهمة ونفس النسخة للطابور — عمرها ما بتطلع نسخة زيادة. لو المهمة اتبعتت أو لسه مستنية بيرفض (PRINT_JOB_NOT_RETRYABLE).')}</li>
          <li>{t('"اطبع نسخة" بتعمل مهمة جديدة مكتوب عليها "نسخة" ومش بتطلع إيصال جديد. موافقة المدير عليها حسب السياسة (RECEIPT_REPRINT) — اقتراح docs/30: أول نسخة مجانية وبعدها موافقة.')}</li>
          <li>{t('"اتبعت للطابعة" معناها إن الطابعة استلمت البيانات — الطابعات الحرارية مش بتأكد إن الورقة طلعت فعلًا، فإحنا مش بنقول "اتطبع".')}</li>
          <li>{t('جرّب: من "المحاكاة" فوق خلّي طابعة الكاشير "واقعة" أو "الورق خلص"، وبيع حاجة.')}</li>
        </ul>
      </Card>

      {reprint && <ReprintDialog job={reprint} onClose={() => setReprint(null)} terminalId={terminal?.id ?? reprint.terminalId} />}
    </div>
  );
}
