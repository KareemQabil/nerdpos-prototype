// System health: everything the system sends after a sale is saved — tickets to the kitchen, printing, e-receipts to the
// tax platform and messages to other programs (accounting, delivery apps). Status, attempts, the last problem in plain
// words, and "send again" (Outbox.Redrive; a delivery that stopped after many tries needs a manager).
import React, { useState } from 'react';
import { Activity, ChefHat, Printer, FileCheck2, Webhook, RefreshCw, CheckCircle2, Clock, AlertTriangle, XCircle, Info, PlugZap } from 'lucide-react';
import { useQuery, useCommand } from '../../app/hooks';
import { Section, StateBadge, Card, Button, Pill, Tabs, Table, Modal, Empty, KV, Switch, Banner } from '../../ui';
import { t, L } from '../../i18n';
import { Tech } from '../../app/tech';
import { cn, dateTime, time } from '../../lib/format';
import { sim } from '../../mock/sim';
import { useSim } from './OfflineBar';

const CONSUMERS: { id: string; title: string; icon: React.ComponentType<{ className?: string }>; help: string }[] = [
  { id: 'kitchen', title: 'المطبخ', icon: ChefHat, help: 'الطلبات اللي بتتبعت لشاشات المطبخ' },
  { id: 'printing', title: 'الطباعة', icon: Printer, help: 'الإيصالات وتذاكر المطبخ والتقارير' },
  { id: 'ereceipt', title: 'الإيصال الإلكتروني', icon: FileCheck2, help: 'الإيصالات اللي رايحة لمنظومة الضرايب' },
  { id: 'webhook', title: 'برامج تانية', icon: Webhook, help: 'برنامج الحسابات وتطبيقات التوصيل والولاء' },
];
const STATE: Record<string, { label: string; tone: any; icon: React.ComponentType<{ className?: string }> }> = {
  DELIVERED: { label: 'وصلت', tone: 'success', icon: CheckCircle2 },
  PENDING: { label: 'في الطريق', tone: 'info', icon: Clock },
  FAILED: { label: 'بتتعاد لوحدها', tone: 'warning', icon: AlertTriangle },
  DEAD: { label: 'وقفت — محتاجة حد', tone: 'error', icon: XCircle },
};
const EVENT: Record<string, string> = { OrderFired: 'طلب للمطبخ', RECEIPT: 'إيصال', KITCHEN_TICKET: 'تذكرة مطبخ', PRE_BILL: 'شيك مبدئي', X_REPORT: 'تقرير X', Z_REPORT: 'تقرير Z', FISCAL_DOCUMENT: 'مستند ضريبي', RETURN_RECEIPT: 'إيصال مرتجع', BusinessDayClosed: 'قفل يوم', MenuAvailabilityChanged: 'تغيير في المنيو', OrderCompleted: 'شيك خلص' };

export default function SystemHealth() {
  const [tab, setTab] = useState<'attention' | 'pending' | 'done' | 'all'>('attention');
  const [consumer, setConsumer] = useState<string>('');
  const [open, setOpen] = useState<string | null>(null);
  const state = tab === 'attention' ? 'FAILED,DEAD' : tab === 'pending' ? 'PENDING' : tab === 'done' ? 'DELIVERED' : undefined;
  const q = useQuery<any>('OutboxDelivery.Find', { query: { state, consumerId: consumer || undefined, limit: 150 } });
  const all = useQuery<any>('OutboxDelivery.Find', { query: { limit: 1 } });
  const s = useSim();
  const by = all.data?.countsByConsumer ?? {};
  const counts = all.data?.countsByState ?? {};
  const items: any[] = q.data?.items ?? [];
  return (
    <div className="space-y-4" data-screen="OBX">
      <Section title={t('صحة النظام')} badge={<StateBadge ops={['OutboxDelivery.Find', 'OutboxDelivery.Get', 'Outbox.Redrive']} />}
        sub={t('كل حاجة السيستم بيبعتها بعد ما البيع يتحفظ: للمطبخ والطابعة ومنظومة الضرايب والبرامج التانية. البيع نفسه عمره ما بيقف على دول — لو حاجة فشلت بتتعاد لوحدها، ولو وقفت تقدر تبعتها تاني من هنا.')} />
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3" data-fb="health-tiles">
        {CONSUMERS.map((c) => {
          const n = by[c.id] ?? { PENDING: 0, DELIVERED: 0, FAILED: 0, DEAD: 0 };
          const bad = n.DEAD > 0 ? 'error' : n.FAILED > 0 ? 'warning' : 'success';
          return (
            <button key={c.id} onClick={() => { setConsumer(consumer === c.id ? '' : c.id); setTab('all'); }} className={cn('glass rounded-xl p-4 text-start border-2 transition-colors', consumer === c.id ? 'border-[var(--primary)]' : 'border-transparent hover:border-[var(--glass-border)]')} data-fb={`health-tile:${c.id}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold"><c.icon className="w-5 h-5 text-[var(--primary)]" />{t(c.title)}</div>
                <span className={cn('w-3 h-3 rounded-full', bad === 'error' ? 'bg-red-500 animate-pulse' : bad === 'warning' ? 'bg-amber-400' : 'bg-emerald-500')} />
              </div>
              <div className="text-[11px] text-dim mt-0.5">{t(c.help)}</div>
              <div className="flex gap-3 mt-3 text-xs">
                <span><span className="num font-extrabold text-base text-[var(--success)]">{n.DELIVERED}</span> {t('وصلت')}</span>
                <span><span className="num font-extrabold text-base text-[var(--info)]">{n.PENDING}</span> {t('في الطريق')}</span>
                <span><span className="num font-extrabold text-base text-[var(--warning)]">{n.FAILED}</span> {t('بتتعاد')}</span>
                <span><span className="num font-extrabold text-base text-[var(--error)]">{n.DEAD}</span> {t('وقفت')}</span>
              </div>
            </button>
          );
        })}
      </div>
      <Card title={<span className="flex items-center gap-2"><PlugZap className="w-4 h-4" />{t('الأنظمة اللي برة')}</span>}>
        <div className="flex flex-wrap gap-4 items-center text-sm">
          <span>{t('شاشة المطبخ')}: <Pill tone={s.kds === 'UP' ? 'success' : 'error'}>{s.kds === 'UP' ? t('شغالة') : s.kds === 'SLOW' ? t('بطيئة') : t('واقعة')}</Pill></span>
          <span>{t('منظومة الضرايب')}: <Pill tone={s.eta === 'UP' ? 'success' : 'error'}>{s.eta === 'UP' ? t('شغالة') : s.eta === 'REJECT' ? t('بترفض') : t('مش بترد')}</Pill></span>
          <Switch checked={(s as any).webhooks === 'DOWN'} onChange={(v) => sim.set({ webhooks: v ? 'DOWN' : 'UP' } as any)} label={t('محاكاة: البرامج التانية واقعة')} />
          <span className="text-[11px] text-dim">{t('باقي الأعطال (الطابعة، المطبخ، الضرايب) من "محاكاة الأعطال" فوق.')}</span>
        </div>
      </Card>
      <Card title={<span className="flex items-center gap-2"><Activity className="w-4 h-4" />{t('العمليات')}</span>}
        actions={<Tabs value={tab} onChange={setTab} tabs={[{ id: 'attention', label: <span>{t('محتاجة نظرة')} {(counts.FAILED ?? 0) + (counts.DEAD ?? 0) > 0 && <Pill tone="error">{(counts.FAILED ?? 0) + (counts.DEAD ?? 0)}</Pill>}</span> }, { id: 'pending', label: t('في الطريق') }, { id: 'done', label: t('وصلت') }, { id: 'all', label: t('الكل') }]} />}>
        {consumer && <div className="mb-2"><Pill tone="primary">{t(CONSUMERS.find((c) => c.id === consumer)?.title ?? '')}</Pill> <Button size="sm" variant="ghost" onClick={() => setConsumer('')}>{t('كل الأنواع')}</Button></div>}
        {items.length === 0 ? <Empty icon={<CheckCircle2 className="w-10 h-10 text-[var(--success)] opacity-60" />} text={tab === 'attention' ? t('كله تمام — مفيش حاجة واقفة') : t('مفيش عمليات')} /> : (
          <Table head={[t('إيه'), t('رايحة لـ'), t('الحالة'), t('المحاولات'), t('آخر مشكلة'), t('إمتى'), '']} rows={items.map((d) => [
            <div><div className="font-bold text-sm">{d.event.label}</div><div className="text-[11px] text-dim">{t(EVENT[d.event.type] ?? '')}<Tech> <span className="num">{d.event.type}</span></Tech></div></div>,
            L(d.consumerName),
            <StatePill s={d.state} />,
            <span className="num">{d.attempts}</span>,
            d.lastErrorText ? <span className="text-xs">{L(d.lastErrorText)}<Tech><span className="num text-dim"> {d.lastError}</span></Tech></span> : <span className="text-dim">—</span>,
            <div className="text-xs num">{dateTime(d.createdAt)}{d.nextAttemptAt && d.state === 'FAILED' ? <div className="text-dim">{t('المحاولة الجاية')} {time(d.nextAttemptAt)}</div> : null}</div>,
            <div className="flex gap-1"><Redrive d={d} /><Button size="sm" variant="ghost" onClick={() => setOpen(d.id)} title={t('التفاصيل')}><Info className="w-3.5 h-3.5" /></Button></div>,
          ])} />
        )}
      </Card>
      {open && <DeliveryDialog id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function StatePill({ s }: { s: string }) {
  const x = STATE[s] ?? STATE.PENDING;
  return <Pill tone={x.tone}><x.icon className="w-3 h-3" />{t(x.label)}</Pill>;
}

function Redrive({ d }: { d: any }) {
  const { run, busy } = useCommand();
  if (d.state === 'DELIVERED') return null;
  return <Button size="sm" variant={d.state === 'DEAD' ? 'warning' : 'secondary'} loading={busy} onClick={() => run('Outbox.Redrive', { params: { deliveryId: d.id }, body: { expectedVersion: d.version } }, { success: t('اتبعتت تاني') })} data-fb={`redrive:${d.id}`}><RefreshCw className="w-3.5 h-3.5" />{t('ابعت تاني')}</Button>;
}

function DeliveryDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery<any>('OutboxDelivery.Get', { params: { deliveryId: id } });
  const d = q.data;
  return (
    <Modal open onClose={onClose} title={d ? d.event.label : t('التفاصيل')} badge={<StateBadge ops={['OutboxDelivery.Get']} />} footer={d && <Redrive d={d} />}>
      {d && (
        <div className="space-y-3">
          <KV rows={[[t('رايحة لـ'), L(d.consumerName)], [t('الحالة'), <StatePill s={d.state} />], [t('المحاولات'), d.attempts], [t('اتعملت'), dateTime(d.createdAt)], ...(d.lastErrorText ? [[t('آخر مشكلة'), L(d.lastErrorText)] as [string, string]] : [])]} />
          {d.state === 'DEAD' && <Banner tone="warning">{t('وقفت بعد محاولات كتير. صلّح السبب (مثلاً شغّل الطابعة أو جدّد مفتاح الربط) وبعدين "ابعت تاني" — محتاجة موافقة مدير.')}</Banner>}
          {d.history?.length > 0 && <div className="space-y-1"><div className="text-xs font-bold text-soft">{t('المحاولات')}</div>{d.history.map((h: any, i: number) => <div key={i} className="flex justify-between text-xs px-2 py-1 rounded surface-1"><span>{h.error ? (L(ERR(h.error)) || h.error) : t('وصلت')}</span><span className="num text-dim">{time(h.at)}</span></div>)}</div>}
          <Tech><div className="num text-[10px] text-dim">{d.id} · {d.consumerId} · v{d.version}</div></Tech>
        </div>
      )}
    </Modal>
  );
}
const ERR = (code: string) => ({ PRINTER_UNREACHABLE: { ar: 'الطابعة مش بترد' }, PAPER_OUT: { ar: 'الورق خلص' }, WEBHOOK_401: { ar: 'البرنامج رفض مفتاح الربط' }, WEBHOOK_TIMEOUT: { ar: 'ما ردش في الوقت' }, WEBHOOK_DOWN: { ar: 'البرنامج واقع' } } as Record<string, { ar: string }>)[code] ?? (/[A-Z_]{4,}/.test(code) ? { ar: 'محاولة فشلت' } : { ar: code });
