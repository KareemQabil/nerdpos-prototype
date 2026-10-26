// G3 E-receipt queue (manager): fiscal documents by state, issues, chain, deadline alerts, reissue, verify chain.
import React, { useMemo, useState } from 'react';
import { FileCheck2, RefreshCw, Link2, ShieldCheck, Clock, Wrench, Eye, Info } from 'lucide-react';
import { useDev, useQuery, useCommand, errorText } from '../../app/hooks';
import { call, ApiFailure } from '../../api/client';
import { PageHeader, StateBadge, Banner, Button, Pill, Card, Tabs, Modal, Field, Textarea, Spinner, EmptyState, KV, Money, toast, StatGrid, StatCard, SkeletonCard } from '../../ui';
import { t } from '../../i18n';
import { Tech } from '../../app/tech';
import { deviceName } from '../../demo/people';
import { dateTime } from '../../lib/format';
import { FISCAL_STATES, FiscalStatePill, fiscalStateLabel, issueLabel } from './output/labels';

const short = (u: string | null | undefined) => (u ? `${u.slice(0, 10)}…${u.slice(-6)}` : '—');

export default function EReceipts() {
  const { can, nav, auth } = useDev();
  const [tab, setTab] = useState<string>('ATTENTION');
  const all = useQuery<any>('Compliance.Find', { query: { limit: 500 } });
  const submission = tab === 'ALL' ? undefined : tab === 'ATTENTION' ? 'PENDING_DATA,REJECTED' : tab;
  const list = useQuery<any>('Compliance.Find', { query: { submission, limit: 200 } });
  const policyQ = useQuery<any>(can('settings:read') ? 'Settings.Effective' : null, { query: { policyId: 'FiscalDocumentPolicy', scopeType: 'TENANT', scopeId: 'biz' } });
  const [reissue, setReissue] = useState<any | null>(null);
  const [chain, setChain] = useState<{ loading: boolean; server?: any; refused?: string; local?: { deviceId: string; documents: number; ok: boolean; breaks: string[] }[] } | null>(null);

  const docs: any[] = all.data?.items ?? [];
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const d of docs) c[d.state] = (c[d.state] ?? 0) + 1;
    return c;
  }, [docs]);
  const h20 = docs.filter((d) => d.alert === 'H20').length;
  const h12 = docs.filter((d) => d.alert === 'H12').length;
  const policyValue = policyQ.data?.value;

  const verify = async () => {
    setChain({ loading: true });
    // local check from the queue (display only): each built document points at the previous uuid of its device
    const byDev = new Map<string, any[]>();
    for (const d of docs.filter((x) => x.deviceId && x.sequence !== null)) byDev.set(d.deviceId, [...(byDev.get(d.deviceId) ?? []), d]);
    const local = [...byDev.entries()].map(([deviceId, ds]) => {
      ds.sort((a, b) => a.sequence - b.sequence);
      const breaks: string[] = [];
      let prev: string | null = null;
      for (const d of ds) { if (d.previousUUID !== prev) breaks.push(`#${d.sequence} ${d.orderNumber}`); prev = d.uuid; }
      return { deviceId, documents: ds.length, ok: breaks.length === 0, breaks };
    });
    try {
      const r = await call(auth, 'Compliance.VerifyChain');
      setChain({ loading: false, server: r.data, local });
    } catch (e) {
      setChain({ loading: false, refused: `${errorText(e)}`, local });
      void (e as ApiFailure);
    }
  };

  const rows: any[] = list.data?.items ?? [];
  return (
    <div className="space-y-4" data-screen-id="G3">
      <PageHeader icon={<FileCheck2 />} title={t('الإيصال الإلكتروني')} badge={<StateBadge ops={['Compliance.Find', 'Compliance.ReissueDocument']} />}
        description={t('كل شيك بيتقفل بيطلع له إيصال إلكتروني لمصلحة الضرايب. الإرسال بيحصل بعد البيع — عمره ما بيوقف بيع.')}
        actions={<>
          <Button variant="outline" onClick={verify} loading={chain?.loading} data-fb="ereceipts:verify-chain"><Link2 className="w-4 h-4" />{t('افحص تسلسل الإيصالات')}</Button>
          <Button variant="ghost" onClick={() => { all.refetch(); list.refetch(); }} data-fb="ereceipts:refresh"><RefreshCw className="w-4 h-4" />{t('تحديث')}</Button>
        </>} />

      <StatGrid>
        <div data-fb="ereceipts:policy" className="contents">
          <StatCard label={t('وضع الإيصال الإلكتروني')} icon={<ShieldCheck />} loading={policyQ.loading}
            tone={policyValue === 'PRODUCTION' ? 'success' : policyValue === 'SANDBOX' ? 'warning' : 'neutral'}
            value={<span className="text-lg">{!policyValue ? '—' : policyValue === 'OFF' ? t('مقفول') : policyValue === 'SANDBOX' ? t('تجريبي') : t('فعلي')}</span>}
            hint={!policyValue ? t('مش متاح للحساب ده') : policyValue === 'OFF' ? t('مفيش إيصالات بتتعمل') : policyValue === 'SANDBOX' ? t('بيتبعت لبيئة التجربة بس') : t('إيصالات حقيقية للمصلحة')} />
        </div>
        <StatCard label={t('اتقبلت')} value={counts.ACCEPTED ?? 0} icon={<FileCheck2 />} tone="success" loading={all.loading && !all.data} />
        <StatCard label={t('محتاجة تدخل')} value={(counts.PENDING_DATA ?? 0) + (counts.REJECTED ?? 0)} icon={<Wrench />} tone={(counts.PENDING_DATA ?? 0) + (counts.REJECTED ?? 0) ? 'warning' : 'neutral'} hint={t('ناقصها بيانات أو مرفوضة')} loading={all.loading && !all.data} />
        <StatCard label={t('قربت من مهلة الـ 24 ساعة')} value={h12 + h20} icon={<Clock />} tone={h20 ? 'error' : h12 ? 'warning' : 'neutral'} hint={t('تنبيه بعد 12 ساعة وخطر بعد 20')} loading={all.loading && !all.data} />
      </StatGrid>
      <div className="text-xs text-dim flex items-start gap-1.5"><Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />{t('الخدمة بتفضل برة الإيصال الإلكتروني لحد ما المحاسب يحدد نوع الضريبة بتاعها — ودي ملاحظة بس، مش بتوقف الإيصال.')}<Tech> (OD-EG-4 · T9/T17 · SERVICE_CHARGE_UNMAPPED · FiscalDocumentPolicy={String(policyValue)})</Tech></div>

      {(h20 > 0 || h12 > 0) && <Banner tone={h20 ? 'error' : 'warning'}>{t('فيه {n} إيصال قرب على آخر ميعاد (24 ساعة) — صلّح البيانات أو اعمل إعادة إصدار.', { n: h12 + h20 })}</Banner>}

      {chain && !chain.loading && (
        <Card title={<span className="flex items-center gap-2"><Link2 className="w-4 h-4" />{t('فحص تسلسل الإيصالات')}</span>} description={t('كل إيصال مربوط باللي قبله على نفس الجهاز — لو فيه إيصال ناقص أو متغير السلسلة بتتكسر.')} badge={<StateBadge ops={['Compliance.VerifyChain']} />} actions={<Button size="sm" variant="ghost" onClick={() => setChain(null)}>{t('إغلاق')}</Button>}>
          <div className="space-y-2" data-fb="ereceipts:chain-result">
            {chain.server ? <Banner tone={chain.server.ok ? 'success' : 'error'}>{chain.server.ok ? t('السلسلة سليمة على كل الأجهزة (من السيرفر)') : t('فيه كسر في السلسلة (من السيرفر)')}</Banner>
              : <Banner tone="info">{t('الفحص الكامل على السيرفر لسه مش متاح للحساب ده — ده فحص سريع من الإيصالات اللي في الطابور.')}<Tech> {chain.refused} — Compliance.VerifyChain INTERNAL</Tech></Banner>}
            {(chain.server?.devices ?? chain.local ?? []).length === 0 && <div className="text-sm text-dim">{t('لسه مفيش إيصالات مبنية')}</div>}
            {(chain.server?.devices ?? chain.local ?? []).map((d: any) => (
              <div key={d.deviceId} className="flex items-center gap-2 text-sm flex-wrap"><span className="font-bold">{t('جهاز ضريبي')}</span><Tech><span className="num">{d.deviceId}</span></Tech><Pill tone={d.ok ? 'success' : 'error'}>{d.ok ? t('سليمة') : t('مكسورة')}</Pill><span className="text-dim">{t('{n} إيصال', { n: d.documents })}</span>{d.breaks?.length > 0 && <span className="text-[var(--error)] num text-xs">{d.breaks.join(t('، '))}</span>}{d.head && <Tech><span className="num text-[11px] text-dim">head {short(d.head)}</span></Tech>}</div>
            ))}
          </div>
        </Card>
      )}

      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'ATTENTION', label: <span data-fb="ereceipts:tab:attention">{t('محتاجة تدخل')}</span>, count: (counts.PENDING_DATA ?? 0) + (counts.REJECTED ?? 0) },
        { id: 'ALL', label: t('الكل'), count: docs.length },
        ...FISCAL_STATES.map((s) => ({ id: s, label: <span data-fb={`ereceipts:tab:${s}`}>{fiscalStateLabel(s)}</span>, count: counts[s] ?? 0 })),
      ]} />

      {list.loading && !list.data ? <div className="space-y-3"><SkeletonCard /><SkeletonCard /></div> : rows.length === 0 ? <Card><EmptyState icon={<FileCheck2 />} title={tab === 'ATTENTION' ? t('مفيش إيصالات محتاجة تدخل') : t('مفيش إيصالات هنا')} text={tab === 'ATTENTION' ? t('كل الإيصالات ماشية تمام. لو صنف ناقصه كود، الإيصال بتاعه هيظهر هنا.') : t('اقفل شيك على الكاشير وإيصاله هيظهر هنا.')} /></Card> : (
        <div className="space-y-3">
          {rows.map((d) => <DocCard key={d.id} d={d} onReissue={() => setReissue(d)} canIssue={can('compliance:issuedocument')} onOpen={() => nav('receipt', { orderId: d.orderId })} onFix={() => nav('fiscal')} />)}
        </div>
      )}

      {reissue && <ReissueDialog d={reissue} onClose={() => setReissue(null)} />}
    </div>
  );
}

function DocCard({ d, onReissue, canIssue, onOpen, onFix }: { d: any; onReissue: () => void; canIssue: boolean; onOpen: () => void; onFix: () => void }) {
  const blocking = (d.issues ?? []).filter((i: any) => i.code !== 'SERVICE_CHARGE_UNMAPPED');
  const remaining = Math.max(0, d.deadlineHours - d.ageHours);
  const closed = d.state === 'ACCEPTED' || d.state === 'SUPERSEDED';
  return (
    <div className={`glass rounded-xl p-4 border ${d.alert === 'H20' ? 'border-[var(--error)]' : d.alert === 'H12' ? 'border-[var(--warning)]' : 'border-transparent'}`} data-fb={`ereceipt:${d.id}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-lg font-bold num">{d.orderNumber}</span>
            <FiscalStatePill state={d.state} />
            <Pill tone={d.mode === 'PRODUCTION' ? 'success' : 'warning'}>{d.mode === 'PRODUCTION' ? t('فعلي') : d.mode === 'SANDBOX' ? t('تجريبي') : d.mode}</Pill>
            {d.alert === 'H20' && <Pill tone="error">{t('عدّى 20 ساعة')}</Pill>}
            {d.alert === 'H12' && <Pill tone="warning">{t('عدّى 12 ساعة')}</Pill>}
            {d.referenceOldUUID && <Pill tone="violet">{t('تصحيح لإيصال مرفوض')}</Pill>}
          </div>
          <div className="text-xs text-dim">
            {dateTime(d.createdAt)} · {t('العمر')} <span className="num">{d.ageHours}</span> {t('ساعة')}{!closed && <> · {t('باقي')} <span className="num">{remaining.toFixed(1)}</span> {t('ساعة على آخر ميعاد')}</>} · <Money v={d.total} />
          </div>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <Button size="sm" variant="ghost" onClick={onOpen} data-fb={`ereceipt:open:${d.id}`}><Eye className="w-3.5 h-3.5" />{t('الإيصال')}</Button>
          {d.state === 'PENDING_DATA' && blocking.some((i: any) => i.code === 'ITEM_CODE_MISSING' || i.code === 'NO_ACTIVE_DEVICE' || i.code === 'NO_FISCAL_PROFILE') && <Button size="sm" variant="outline" onClick={onFix} data-fb={`ereceipt:fix:${d.id}`}><Wrench className="w-3.5 h-3.5" />{t('صلّح البيانات')}</Button>}
          {(d.state === 'PENDING_DATA' || d.state === 'REJECTED') && canIssue && <Button size="sm" variant="primary" onClick={onReissue} data-fb={`ereceipt:reissue:${d.id}`}><RefreshCw className="w-3.5 h-3.5" />{d.state === 'PENDING_DATA' ? t('إعادة بناء') : t('إصدار إيصال مصحح')}</Button>}
        </div>
      </div>

      {(d.issues ?? []).length > 0 && (
        <ul className="mt-3 space-y-1">
          {d.issues.map((i: any, k: number) => (
            <li key={k} className={`text-sm flex items-start gap-2 ${i.code === 'SERVICE_CHARGE_UNMAPPED' ? 'text-soft' : 'text-[var(--warning)]'}`}>
              <Pill tone={i.code === 'SERVICE_CHARGE_UNMAPPED' ? 'info' : 'warning'}>{issueLabel(i.code)}</Pill>
              <Tech><span className="num text-xs">{i.code} · {i.detail}</span></Tech>
            </li>
          ))}
        </ul>
      )}
      {d.rejectedReason && <Banner tone="error">{t('المنظومة رفضت الإيصال — صلّح البيانات واعمل إيصال مصحح.')}<Tech> <span className="num">{d.rejectedReason}</span></Tech></Banner>}

      <KV className="mt-3 text-xs" rows={[
        [t('رقم الإيصال'), d.uuid ? <span className="num">{short(d.uuid)}</span> : <span className="text-dim">{d.state === 'PENDING_DATA' ? t('لسه ما اتعملش — مستني البيانات') : '—'}</span>],
        [t('الترتيب'), <span>{d.sequence !== null ? t('رقم {n} على الجهاز', { n: d.sequence }) : '—'}{d.sequence === 1 && !d.previousUUID ? ` (${t('أول إيصال على الجهاز')})` : ''}<Tech><span className="num"> · {d.deviceId ?? '—'} · previousUUID {short(d.previousUUID)}{d.referenceOldUUID ? ` · referenceOldUUID ${d.referenceOldUUID}` : ''} · uuid {d.uuid ?? '—'}</span></Tech></span>],
        [t('المنظومة'), <span>{d.submittedAt ? `${t('اتبعت')} ${dateTime(d.submittedAt)}` : t('لسه ما اتبعتش')}{d.acceptedAt ? ` · ${t('اتقبل')} ${dateTime(d.acceptedAt)}` : ''} · {t('محاولات')} <span className="num">{d.attempts}</span></span>],
      ]} />
      {(d.history ?? []).length > 0 && (
        <details className="mt-2 text-xs"><summary className="cursor-pointer text-dim">{t('السجل')} ({d.history.length})</summary>
          <ul className="mt-1 space-y-0.5">{d.history.map((h: any, k: number) => <li key={k}><span className="num text-dim">{dateTime(h.at)}</span><Tech> · <span className="num">{h.kind}</span></Tech> · {typeof h.text === 'string' ? h.text : h.text?.ar}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

function ReissueDialog({ d, onClose }: { d: any; onClose: () => void }) {
  const { run, busy } = useCommand();
  const [reason, setReason] = useState(d.state === 'PENDING_DATA' ? 'اتضافت أكواد الأصناف الناقصة' : 'تصحيح كود الصنف بعد رفض المنصة');
  const go = async () => {
    const r = await run<any>('Compliance.ReissueDocument', { params: { documentId: d.id }, body: { reason } });
    if (!r) return;
    if (r.result === 'STILL_PENDING_DATA') toast('warning', t('لسه فيه بيانات ناقصة — الإيصال فاضل مستني'), (r.document?.issues ?? []).map((i: any) => issueLabel(i.code)).join(t('، ')));
    else if (r.result === 'BUILT') toast('success', t('الإيصال اتبنى واتربط بالسلسلة — هيتبعت للمنصة أوتوماتيك'));
    else toast('success', t('اتعمل إيصال مصحح بيشاور على الإيصال المرفوض'), r.referenceOldUUID ?? undefined);
    onClose();
  };
  return (
    <Modal open onClose={onClose} title={d.state === 'PENDING_DATA' ? t('إعادة بناء الإيصال') : t('إصدار إيصال مصحح')} badge={<StateBadge ops={['Compliance.ReissueDocument']} />}
      footer={<><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" loading={busy} disabled={!reason.trim()} onClick={go} data-fb="reissue:confirm">{t('تنفيذ')}</Button></>}>
      <div className="space-y-3">
        <div className="font-bold"><span className="num">{d.orderNumber}</span> · <FiscalStatePill state={d.state} /></div>
        {d.state === 'PENDING_DATA'
          ? <Banner tone="info">{t('الإيصال هيتبني تاني من نفس بيانات الشيك بعد ما صلّحت الناقص (مثلًا أكواد الأصناف من شاشة التسجيل الضريبي). لو لسه فيه حاجة ناقصة هيفضل مستني.')}</Banner>
          : <Banner tone="warning">{t('الإيصال المرفوض هيتعلم «اتستبدل»، وهيتعمل إيصال جديد بيشاور عليه. الشيك نفسه مش بيتغير.')}</Banner>}
        <Field label={t('السبب (مطلوب)')}><Textarea data-fb="reissue:reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
