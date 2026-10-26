// G3 E-receipt queue (manager): fiscal documents by state, issues, chain, deadline alerts, reissue, verify chain.
import React, { useMemo, useState } from 'react';
import { FileCheck2, RefreshCw, Link2, ShieldCheck, Clock, Wrench, Eye, Info } from 'lucide-react';
import { useDev, useQuery, useCommand, errorText } from '../../app/hooks';
import { call, ApiFailure } from '../../api/client';
import { Section, StateBadge, Banner, Button, Pill, Card, Tabs, Modal, Field, Textarea, Spinner, Empty, KV, Money, toast } from '../../ui';
import { t } from '../../i18n';
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
      setChain({ loading: false, refused: `${errorText(e)} (${(e as ApiFailure).code ?? ''})`, local });
    }
  };

  const rows: any[] = list.data?.items ?? [];
  return (
    <div className="space-y-4" data-screen-id="G3">
      <Section title={t('الإيصال الإلكتروني')} badge={<StateBadge ops={['Compliance.Find', 'Compliance.ReissueDocument']} />}
        sub={t('كل شيك بيخلص بيطلع له إيصال إلكتروني من البيانات المتجمدة وقت الإقفال. الإرسال للمنصة بيحصل بعد البيع — عمره ما بيوقف بيع.')}
        actions={<>
          <Button size="sm" variant="outline" onClick={verify} loading={chain?.loading} data-fb="ereceipts:verify-chain"><Link2 className="w-4 h-4" />{t('افحص السلسلة')}</Button>
          <Button size="sm" variant="ghost" onClick={() => { all.refetch(); list.refetch(); }} data-fb="ereceipts:refresh"><RefreshCw className="w-4 h-4" />{t('تحديث')}</Button>
        </>} />

      <div className="grid md:grid-cols-3 gap-3">
        <Card title={<span className="flex items-center gap-2"><ShieldCheck className="w-4 h-4" />{t('وضع الإيصال الإلكتروني')}</span>} badge={<StateBadge ops={['Settings.Effective']} />}>
          {policyQ.loading ? <Spinner /> : policyValue ? (
            <div className="space-y-2" data-fb="ereceipts:policy">
              <div className="flex items-center gap-2"><Pill tone={policyValue === 'PRODUCTION' ? 'success' : policyValue === 'SANDBOX' ? 'warning' : 'neutral'}><span className="num">{String(policyValue)}</span></Pill><span className="text-sm">{policyValue === 'OFF' ? t('مقفول — مفيش إيصالات بتتعمل') : policyValue === 'SANDBOX' ? t('تجريبي — بيتبعت لبيئة التجربة') : t('إنتاج — إيصالات حقيقية')}</span></div>
              <div className="text-[11px] text-dim">FiscalDocumentPolicy · TENANT/biz · {t('بيتغير من لوحة السياسات، وممكن يختلف لكل فرع. الإنتاج بس بعد ملف ضريبي وأجهزة نشطة.')}</div>
            </div>
          ) : <div className="text-sm text-dim">{t('مش متاح للمستخدم ده (settings:read)')}</div>}
        </Card>
        <Card title={<span className="flex items-center gap-2"><Clock className="w-4 h-4" />{t('المهلة 24 ساعة')}</span>}>
          <div className="flex gap-2 flex-wrap mb-2">
            <Pill tone={h12 ? 'warning' : 'neutral'}>{t('عدّى 12 ساعة')}: <span className="num">{h12}</span></Pill>
            <Pill tone={h20 ? 'error' : 'neutral'}>{t('عدّى 20 ساعة')}: <span className="num">{h20}</span></Pill>
          </div>
          <div className="text-[11px] text-dim">{t('أي إيصال ما اتقبلش بيطلع تنبيه عند 12 ساعة (تحذير) و20 ساعة (خطر) قبل آخر ميعاد 24 ساعة. جرّب تقدّم الساعة من أدوات العرض.')}</div>
        </Card>
        <Card title={<span className="flex items-center gap-2"><Info className="w-4 h-4" />{t('الخدمة والإيصال')}</span>}>
          <div className="text-sm text-soft">{t('الخدمة بتفضل برة الإيصال الإلكتروني لحد ما المحاسب يحدد هي T9 ولا T17 (OD-EG-4). عشان كده المشكلة SERVICE_CHARGE_UNMAPPED معلومة بس — مش بتوقف بناء الإيصال.')}</div>
        </Card>
      </div>

      {(h20 > 0 || h12 > 0) && <Banner tone={h20 ? 'error' : 'warning'}>{t('فيه {n} إيصال قرب على آخر ميعاد (24 ساعة) — صلّح البيانات أو اعمل إعادة إصدار.', { n: h12 + h20 })}</Banner>}

      {chain && !chain.loading && (
        <Card title={<span className="flex items-center gap-2"><Link2 className="w-4 h-4" />{t('فحص سلسلة الإيصالات')}</span>} badge={<StateBadge ops={['Compliance.VerifyChain']} />} actions={<Button size="sm" variant="ghost" onClick={() => setChain(null)}>{t('إغلاق')}</Button>}>
          <div className="space-y-2" data-fb="ereceipts:chain-result">
            {chain.server ? <Banner tone={chain.server.ok ? 'success' : 'error'}>{chain.server.ok ? t('السلسلة سليمة على كل الأجهزة (من السيرفر)') : t('فيه كسر في السلسلة (من السيرفر)')}</Banner>
              : <Banner tone="warning">{t('السيرفر رفض Compliance.VerifyChain')}: {chain.refused} — {t('العملية دي صلاحيتها INTERNAL (مستنية رأي قانوني). ده فحص على الشاشة من بيانات الطابور.')}</Banner>}
            {(chain.server?.devices ?? chain.local ?? []).length === 0 && <div className="text-sm text-dim">{t('لسه مفيش إيصالات مبنية')}</div>}
            {(chain.server?.devices ?? chain.local ?? []).map((d: any) => (
              <div key={d.deviceId} className="flex items-center gap-2 text-sm flex-wrap"><span className="num">{d.deviceId}</span><Pill tone={d.ok ? 'success' : 'error'}>{d.ok ? t('سليمة') : t('مكسورة')}</Pill><span className="text-dim">{t('{n} إيصال', { n: d.documents })}</span>{d.breaks?.length > 0 && <span className="text-[var(--error)] num text-xs">{d.breaks.join('، ')}</span>}{d.head && <span className="num text-[11px] text-dim">head {short(d.head)}</span>}</div>
            ))}
          </div>
        </Card>
      )}

      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'ATTENTION', label: <span data-fb="ereceipts:tab:attention">{t('محتاجة تدخل')} <span className="num">({(counts.PENDING_DATA ?? 0) + (counts.REJECTED ?? 0)})</span></span> },
        { id: 'ALL', label: <span>{t('الكل')} <span className="num">({docs.length})</span></span> },
        ...FISCAL_STATES.map((s) => ({ id: s, label: <span data-fb={`ereceipts:tab:${s}`}>{fiscalStateLabel(s)} <span className="num">({counts[s] ?? 0})</span></span> })),
      ]} />

      {list.loading && !list.data ? <Spinner /> : rows.length === 0 ? <Empty icon={<FileCheck2 className="w-8 h-8" />} text={tab === 'ATTENTION' ? t('مفيش إيصالات محتاجة تدخل') : t('مفيش إيصالات هنا')} /> : (
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
            <Pill tone={d.mode === 'PRODUCTION' ? 'success' : 'warning'}><span className="num">{d.mode}</span></Pill>
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
              <Pill tone={i.code === 'SERVICE_CHARGE_UNMAPPED' ? 'info' : 'warning'} title={i.code}>{issueLabel(i.code)}</Pill>
              <span>{i.detail}</span>
            </li>
          ))}
        </ul>
      )}
      {d.rejectedReason && <Banner tone="error">{t('سبب الرفض')}: <span className="num">{d.rejectedReason}</span></Banner>}

      <KV className="mt-3 text-xs" rows={[
        ['uuid', <span className="num break-all" title={d.uuid ?? ''}>{d.uuid ?? (d.state === 'PENDING_DATA' ? t('مستني بيانات — لسه ما اتحسبش') : '—')}</span>],
        [t('السلسلة'), <span className="num">{d.sequence !== null ? `#${d.sequence}` : '—'} · {d.deviceId ?? '—'} · previousUUID {short(d.previousUUID)}{d.sequence === 1 && !d.previousUUID ? ` (${t('أول إيصال على الجهاز')})` : ''}</span>],
        ...(d.referenceOldUUID ? [[ 'referenceOldUUID', <span className="num break-all">{d.referenceOldUUID}</span> ] as [React.ReactNode, React.ReactNode]] : []),
        [t('المنصة'), <span>{d.submittedAt ? `${t('اتبعت')} ${dateTime(d.submittedAt)}` : t('لسه ما اتبعتش')}{d.acceptedAt ? ` · ${t('اتقبل')} ${dateTime(d.acceptedAt)}` : ''} · {t('محاولات')} <span className="num">{d.attempts}</span></span>],
      ]} />
      {(d.history ?? []).length > 0 && (
        <details className="mt-2 text-xs"><summary className="cursor-pointer text-dim">{t('السجل')} ({d.history.length})</summary>
          <ul className="mt-1 space-y-0.5">{d.history.map((h: any, k: number) => <li key={k}><span className="num text-dim">{dateTime(h.at)}</span> · <span className="num">{h.kind}</span> · {typeof h.text === 'string' ? h.text : h.text?.ar}</li>)}</ul>
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
    if (r.result === 'STILL_PENDING_DATA') toast('warning', t('لسه فيه بيانات ناقصة — الإيصال فاضل "مستني بيانات"'), (r.document?.issues ?? []).map((i: any) => i.code).join(', '));
    else if (r.result === 'BUILT') toast('success', t('الإيصال اتبنى واتربط بالسلسلة — هيتبعت للمنصة أوتوماتيك'));
    else toast('success', t('اتعمل إيصال مصحح بيشاور على الإيصال المرفوض (referenceOldUUID)'), r.referenceOldUUID ?? undefined);
    onClose();
  };
  return (
    <Modal open onClose={onClose} title={d.state === 'PENDING_DATA' ? t('إعادة بناء الإيصال') : t('إصدار إيصال مصحح')} badge={<StateBadge ops={['Compliance.ReissueDocument']} />}
      footer={<><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" loading={busy} disabled={!reason.trim()} onClick={go} data-fb="reissue:confirm">{t('تنفيذ')}</Button></>}>
      <div className="space-y-3">
        <div className="font-bold num">{d.orderNumber} · <FiscalStatePill state={d.state} /></div>
        {d.state === 'PENDING_DATA'
          ? <Banner tone="info">{t('الإيصال هيتبني تاني من نفس البيانات المتجمدة بعد ما صلّحت البيانات الناقصة (مثلًا أكواد الأصناف من شاشة التسجيل الضريبي). لو لسه فيه حاجة ناقصة هيفضل "مستني بيانات".')}</Banner>
          : <Banner tone="warning">{t('الإيصال المرفوض هيبقى "اتستبدل"، وهيتعمل إيصال جديد بيشاور عليه (referenceOldUUID). الشيك نفسه مش بيتغير.')}</Banner>}
        <Field label={t('السبب (مطلوب)')}><Textarea data-fb="reissue:reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
