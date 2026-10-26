// Online orders inbox: orders from the delivery apps, the website and WhatsApp wait here; accept with a prep time
// (items are linked to the menu once) or reject with a reason. Accepted orders go to the kitchen and to delivery.
import React, { useMemo, useState } from 'react';
import { Globe, Inbox as InboxIcon, Check, X, Link2, Clock, AlertTriangle, MapPin, Bike, ShoppingBag, Sparkles, Phone } from 'lucide-react';
import { useDev, useQuery, useCommand } from '../../app/hooks';
import { Section, StateBadge, Button, Card, Pill, Money, Modal, Field, Input, Select, Banner, Empty, Tabs, Spinner, useNow } from '../../ui';
import { Tech } from '../../app/tech';
import { t, L } from '../../i18n';
import { cn, money, qty, time } from '../../lib/format';
import { addressText } from '../customers/common';

export default function Inbox() {
  useNow(20000);
  const { nav, terminal } = useDev();
  const [tab, setTab] = useState<'NEW' | 'ACCEPTED' | 'REJECTED'>('NEW');
  const q = useQuery<any>('ExternalOrder.Find', { query: { state: tab } });
  const all = useQuery<any>('ExternalOrder.Find', { query: { limit: 1 } });
  const { run, busy } = useCommand();
  const [source, setSource] = useState('APP_1');
  const counts = all.data?.counts ?? {};
  const sources = all.data?.sources ?? {};
  const simulate = () => run('Channel.IngestExternalOrder', { params: { channel: source }, body: { simulate: true } }, { success: t('وصل طلب أونلاين جديد') });
  const list: any[] = q.data?.items ?? [];
  return (
    <div data-screen="DL3" className="space-y-4">
      <Section title={t('الطلبات الأونلاين')} badge={<StateBadge ops={['Channel.IngestExternalOrder', 'ExternalOrder.Find', 'ExternalOrder.Accept', 'ExternalOrder.Reject', 'ChannelItemMap.Set']} />}
        sub={t('الطلبات اللي جاية من تطبيقات التوصيل والموقع والواتساب. اقبل الطلب وحدد وقت التحضير — يتبعت للمطبخ ويظهر في لوحة الدليفري.')}
        actions={<>
          <div className="flex items-center gap-1.5 rounded-xl border border-dashed line px-2 py-1">
            <span className="text-[11px] text-dim flex items-center gap-1"><Sparkles className="w-3.5 h-3.5" />{t('تجربة')}</span>
            <div className="w-48"><Select value={source} onChange={(e) => setSource(e.target.value)} options={Object.entries(sources).map(([k, v]: any) => ({ value: k, label: v.ar }))} className="text-sm" /></div>
            <Button size="sm" variant="outline" loading={busy} onClick={simulate} data-fb="simulate-online">{t('محاكاة طلب جديد')}</Button>
          </div>
          <Button variant="ghost" onClick={() => nav('delivery-board')}><Bike className="w-4 h-4" />{t('لوحة الدليفري')}</Button>
        </>} />
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'NEW', label: <span className="flex items-center gap-1.5">{t('مستني قرار')}{counts.NEW ? <span className="px-1.5 rounded-full bg-[var(--warning)] text-black text-[11px] font-bold">{counts.NEW}</span> : null}</span> },
        { id: 'ACCEPTED', label: `${t('اتقبل')} (${counts.ACCEPTED ?? 0})` },
        { id: 'REJECTED', label: `${t('اترفض')} (${counts.REJECTED ?? 0})` },
      ]} />
      {!terminal?.drawer && tab === 'NEW' && <Banner tone="warning">{t('قبول الطلبات بيتعمل من جهاز الكاشير اللي فيه وردية درج مفتوحة.')}</Banner>}
      {q.loading && !list.length && <Spinner />}
      {!q.loading && !list.length && <Empty icon={<InboxIcon className="w-12 h-12" />} text={tab === 'NEW' ? t('مفيش طلبات مستنية — جرّب "محاكاة طلب جديد"') : t('مفيش طلبات هنا')} />}
      <div className="grid lg:grid-cols-2 gap-3">
        {list.map((e) => <ExternalCard key={e.id} e={e} />)}
      </div>
    </div>
  );
}

function ExternalCard({ e }: { e: any }) {
  const { nav } = useDev();
  const [accept, setAccept] = useState(false);
  const [reject, setReject] = useState(false);
  const src = e.sourceLabel;
  return (
    <Card className={cn('border-2', e.waitingTooLong ? 'border-amber-400/60' : 'border-transparent')}>
      <div className="space-y-3" data-fb={`ext:${e.externalRef}`}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold" style={{ background: `${src?.color}26`, color: src?.color, border: `1px solid ${src?.color}66` }}>{L(src)}</span>
              <span className="num text-sm font-bold">{e.externalRef}</span>
              <Pill tone={e.fulfillment === 'DELIVERY' ? 'info' : 'neutral'}>{e.fulfillment === 'DELIVERY' ? <><Bike className="w-3 h-3" />{t('توصيل')}</> : <><ShoppingBag className="w-3 h-3" />{t('استلام من المطعم')}</>}</Pill>
              <Pill tone={e.payment === 'PAID_ONLINE' ? 'success' : 'warning'}>{e.payment === 'PAID_ONLINE' ? t('مدفوع على التطبيق') : t('كاش عند الاستلام')}</Pill>
            </div>
            <div className="text-xs text-dim mt-1 flex items-center gap-1"><Clock className="w-3 h-3" />{t('وصل')} {time(e.receivedAt)} · {t('من {m} دقيقة', { m: e.ageMinutes })}{e.waitingTooLong && <span className="text-[var(--warning)] font-bold"> · {t('العميل مستني — رد بسرعة')}</span>}</div>
          </div>
          <div className="text-end"><div className="text-[10px] text-dim">{t('إجمالي التطبيق')}</div><Money v={e.sourceTotal} /></div>
        </div>
        <div className="rounded-xl surface-1 px-3 py-2 text-sm">
          <div className="font-bold flex items-center gap-2">{e.customer.name}<span className="num text-xs text-dim font-normal" dir="ltr">{e.customer.phone}</span></div>
          {e.customer.address && <div className="text-xs text-soft mt-0.5 flex items-start gap-1"><MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0" />{addressText(e.customer.address)}</div>}
          {e.fulfillment === 'DELIVERY' && (e.zone ? <div className="text-[11px] text-dim mt-0.5">{t('منطقة')} {L(e.zone.name)} · {t('حوالي')} {e.zone.etaMinutes} {t('د')}</div> : <div className="text-[11px] text-[var(--error)] mt-0.5">{t('العنوان برة مناطق التوصيل')}</div>)}
          {e.note && <div className="text-xs text-amber-300 mt-1">✎ {e.note}</div>}
        </div>
        <div className="space-y-1.5">
          {e.items.map((it: any) => <ItemRow key={it.code} e={e} it={it} />)}
        </div>
        {e.state === 'NEW' && (
          <div className="flex gap-2">
            <Button variant="success" className="flex-1" disabled={e.unmapped > 0 || !e.areaCovered} onClick={() => setAccept(true)} data-fb={`accept:${e.externalRef}`}><Check className="w-4 h-4" />{t('اقبل الطلب')}</Button>
            <Button variant="danger" onClick={() => setReject(true)} data-fb={`reject:${e.externalRef}`}><X className="w-4 h-4" />{t('ارفض')}</Button>
          </div>
        )}
        {e.state === 'NEW' && e.unmapped > 0 && <div className="text-[11px] text-[var(--warning)]">{t('اربط الأصناف اللي مش متعرفة الأول — الربط بيتحفظ للمرات الجاية.')}</div>}
        {e.state === 'ACCEPTED' && (
          <div className="flex items-center justify-between gap-2 text-sm rounded-xl px-3 py-2 bg-[color-mix(in_srgb,var(--success)_10%,transparent)] border border-[color-mix(in_srgb,var(--success)_35%,transparent)]">
            <span>{t('اتقبل')} {time(e.acceptedAt)} · {t('تحضير')} {e.prepMinutes} {t('د')} · {t('طلب')} #{e.order?.number}{e.delivery ? ` · ${e.delivery.number}` : ''}</span>
            {e.delivery ? <Button size="sm" onClick={() => nav('delivery-board')}>{t('اللوحة')}</Button> : e.order ? <Button size="sm" onClick={() => nav('counter', { orderId: e.order.id })}>{t('الطلب')}</Button> : null}
          </div>
        )}
        {e.state === 'REJECTED' && <Banner tone="error">{t('اترفض')}: {e.rejectReason}</Banner>}
      </div>
      {accept && <AcceptDialog e={e} onClose={() => setAccept(false)} />}
      {reject && <RejectDialog e={e} onClose={() => setReject(false)} />}
    </Card>
  );
}

function ItemRow({ e, it }: { e: any; it: any }) {
  const products = useQuery<any>(!it.productId && e.state === 'NEW' ? 'Catalog.Search' : null, { query: { active: true, limit: 500 } });
  const { run, busy } = useCommand();
  const [pid, setPid] = useState('');
  const diff = it.ourPrice && Number(it.ourPrice) !== Number(it.unitPrice);
  return (
    <div className={cn('rounded-lg px-3 py-1.5 text-sm border', it.productId ? 'surface-1 border-transparent' : 'border-amber-400/50 bg-amber-400/5')}>
      <div className="flex items-center justify-between gap-2">
        <span><b className="num">{qty(it.quantity)}×</b> {it.name}{it.productId && L(it.productName) !== it.name && <span className="text-xs text-dim"> ← {L(it.productName)}</span>}</span>
        <span className="text-xs num">{money(it.unitPrice)}{diff && <span className="block text-[10px] text-dim">{t('سعرنا')} {money(it.ourPrice)}</span>}</span>
      </div>
      {it.note && <div className="text-[11px] text-amber-300">✎ {it.note}</div>}
      {!it.productId && e.state === 'NEW' && (
        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-[11px] text-[var(--warning)] flex items-center gap-1 shrink-0"><AlertTriangle className="w-3.5 h-3.5" />{t('مش متعرف')}</span>
          <Select value={pid} onChange={(ev) => setPid(ev.target.value)} className="h-8 text-xs" options={[{ value: '', label: t('اختار الصنف اللي عندنا…') }, ...(products.data?.items ?? []).map((p: any) => ({ value: p.id, label: L(p.name) }))]} data-fb={`map-select:${it.code}`} />
          <Button size="sm" variant="primary" disabled={!pid || busy} onClick={() => run('ChannelItemMap.Set', { params: { source: e.source, code: it.code }, body: { productId: pid } }, { success: t('الصنف اتربط') })} data-fb={`map:${it.code}`}><Link2 className="w-3.5 h-3.5" />{t('اربط')}</Button>
        </div>
      )}
      <Tech><div className="text-[10px] text-dim num">{it.code}</div></Tech>
    </div>
  );
}

function AcceptDialog({ e, onClose }: { e: any; onClose: () => void }) {
  const { run, busy } = useCommand();
  const [prep, setPrep] = useState(20);
  const ok = async () => { const r = await run('ExternalOrder.Accept', { params: { externalOrderId: e.id }, body: { prepMinutes: prep, expectedVersion: e.version } }, { success: t('الطلب اتقبل واتبعت للمطبخ') }); if (r) onClose(); };
  return (
    <Modal open onClose={onClose} title={`${t('قبول الطلب')} ${e.externalRef}`} badge={<StateBadge ops={['ExternalOrder.Accept', 'Order.Create', 'Delivery.Create', 'Order.Confirm']} />}
      footer={<><Button variant="ghost" onClick={onClose}>{t('رجوع')}</Button><Button variant="success" loading={busy} onClick={ok} data-fb="accept-confirm"><Check className="w-4 h-4" />{t('اقبل وابعت للمطبخ')}</Button></>}>
      <div className="space-y-3">
        <div className="text-sm">{t('الطلب هيظهر للعميل على')} {L(e.sourceLabel)} {t('بالوقت ده.')}</div>
        <Field label={t('وقت التحضير')}>
          <div className="grid grid-cols-4 gap-1.5">{[15, 20, 30, 45].map((m) => <button key={m} onClick={() => setPrep(m)} data-fb={`prep:${m}`} className={cn('h-12 rounded-xl border text-sm font-bold num', prep === m ? 'border-[var(--primary)] bg-[var(--primary-container)]' : 'surface-1 border-[var(--glass-border)]')}>{m} {t('د')}</button>)}</div>
        </Field>
        <ul className="text-xs text-dim space-y-1 list-disc ps-5">
          <li>{t('هيتعمل شيك بأسعار المنيو بتاعتنا ويتبعت للمطبخ على طول.')}</li>
          {e.fulfillment === 'DELIVERY' ? <li>{t('هيظهر في لوحة الدليفري عشان تسلّمه لطيار.')}</li> : <li>{t('هيظهر في نقطة البيع لحد ما العميل يستلمه.')}</li>}
          {e.payment === 'PAID_ONLINE' ? <li>{t('مدفوع على التطبيق — هيتسجل كدفعة أونلاين.')}</li> : <li>{t('الفلوس هتتحصّل عند الاستلام.')}</li>}
          <li>{t('لو العميل مش متسجل عندنا هيتسجل تلقائي برقم موبايله.')}</li>
        </ul>
      </div>
    </Modal>
  );
}

function RejectDialog({ e, onClose }: { e: any; onClose: () => void }) {
  const { run, busy } = useCommand();
  const [reason, setReason] = useState('');
  const quick = ['صنف خلص', 'المطبخ زحمة جدًا', 'العنوان برة مناطق التوصيل', 'المطعم قافل', 'طلب مكرر'];
  const ok = async () => { const r = await run('ExternalOrder.Reject', { params: { externalOrderId: e.id }, body: { reason, expectedVersion: e.version } }, { success: t('الطلب اترفض') }); if (r) onClose(); };
  return (
    <Modal open onClose={onClose} title={`${t('رفض الطلب')} ${e.externalRef}`} badge={<StateBadge ops={['ExternalOrder.Reject']} />}
      footer={<><Button variant="ghost" onClick={onClose}>{t('رجوع')}</Button><Button variant="danger" loading={busy} disabled={!reason.trim()} onClick={ok} data-fb="reject-confirm">{t('ارفض الطلب')}</Button></>}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">{quick.map((q) => <button key={q} onClick={() => setReason(q)} className={cn('px-2.5 h-8 rounded-lg text-xs border', reason === q ? 'border-[var(--error)] bg-red-500/10 text-[var(--error)]' : 'surface-1 border-[var(--glass-border)]')}>{t(q)}</button>)}</div>
        <Field label={t('السبب (بيوصل للتطبيق)')}><Input value={reason} onChange={(ev) => setReason(ev.target.value)} /></Field>
      </div>
    </Modal>
  );
}
