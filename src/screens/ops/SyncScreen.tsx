// Offline & sync: this device's network (simulator), what it recorded while offline (queued with their command ids),
// the local copy of menu / prices / tables it works from, and offline items the server could not apply (conflicts)
// with a decision for each: drop it, apply it on the latest version, skip sold-out items, or try again.
import React, { useMemo, useState } from 'react';
import { Wifi, WifiOff, RefreshCw, Trash2, Database, ListChecks, AlertTriangle, CheckCircle2, XCircle, Ban, History, Download } from 'lucide-react';
import { useDev, useQuery, useCommand, useOfflineQueue, replayOffline, dropQueued } from '../../app/hooks';
import { Section, StateBadge, Card, Button, Pill, Banner, Empty, Tabs, KV, Table, confirmDialog } from '../../ui';
import { t, L } from '../../i18n';
import { Tech } from '../../app/tech';
import { cn, dateTime, time } from '../../lib/format';
import { sim } from '../../mock/sim';
import { OFFLINE_ALLOWLIST } from '../../mock/ops-registry';
import { useSim } from './OfflineBar';
import { deviceName } from '../../demo/people';

const KIND: Record<string, { ar: string; help: string; actions: string[] }> = {
  SOLD_OUT: { ar: 'صنف خلص وانت أوفلاين', help: 'وانت من غير نت، الصنف ده اتعلم "خلص" من جهاز تاني. تقدر تكمّل باقي الأصناف من غيره.', actions: ['SKIP_UNAVAILABLE', 'RETRY', 'DISCARD'] },
  CHANGED_ELSEWHERE: { ar: 'اتعدل من جهاز تاني', help: 'حد عدّل نفس الحاجة وانت أوفلاين. تقدر تطبق عمليتك على آخر نسخة أو تلغيها.', actions: ['APPLY_ON_LATEST', 'DISCARD'] },
  CHECK_CLOSED: { ar: 'الشيك اتقفل أو اتلغى', help: 'الشيك اتدفع أو اتلغى أو الترابيزة اتقفلت قبل ما عمليتك توصل. افتح شيك جديد لو لسه محتاجها.', actions: ['DISCARD', 'RETRY'] },
  TABLE_TAKEN: { ar: 'الترابيزة اتفتحت من جهاز تاني', help: 'حد فتح الترابيزة دي وانت أوفلاين.', actions: ['DISCARD', 'RETRY'] },
  SHIFT_CLOSED: { ar: 'الوردية اتقفلت', help: 'الدرج اتقفل قبل ما العملية توصل.', actions: ['DISCARD', 'RETRY'] },
  NEEDS_MANAGER: { ar: 'محتاجة موافقة مدير', help: 'العملية دي محتاجة مدير ومينفعش تتعمل أوفلاين. اعملها تاني من الشاشة بموافقة.', actions: ['DISCARD', 'RETRY'] },
  NO_PRICE: { ar: 'الصنف مالوش سعر', help: 'السعر اتشال وانت أوفلاين.', actions: ['DISCARD', 'RETRY'] },
  ALREADY_PAID: { ar: 'الشيك اتدفع خلاص', help: 'الدفعة دي اتحصلت من جهاز تاني.', actions: ['DISCARD'] },
  REFUSED: { ar: 'السيرفر رفضها', help: 'السيرفر ما قبلش العملية. شوف السبب وقرر.', actions: ['DISCARD', 'RETRY'] },
};
const ACTION: Record<string, { ar: string; variant: any }> = {
  SKIP_UNAVAILABLE: { ar: 'كمّل من غير الصنف اللي خلص', variant: 'primary' },
  APPLY_ON_LATEST: { ar: 'طبّقها على آخر نسخة', variant: 'primary' },
  RETRY: { ar: 'جرّب تاني', variant: 'secondary' },
  DISCARD: { ar: 'إلغيها', variant: 'danger' },
};
const STATE: Record<string, [string, any]> = { APPLIED: ['اتطبقت', 'success'], DUPLICATE: ['كانت اتطبقت قبل كده', 'success'], RESOLVED: ['اتحلت', 'success'], CONFLICT: ['محتاجة قرار', 'warning'], REJECTED: ['مرفوضة', 'error'], DISCARDED: ['اتلغت', 'neutral'] };

export default function SyncScreen() {
  const { id, can, terminal } = useDev();
  const s = useSim();
  const offline = (s.offlineDevices ?? []).includes(id);
  const queued = useOfflineQueue(id);
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const status = useQuery<any>('Sync.Status', { query: { terminalId: scope === 'mine' ? terminal?.id : undefined } });
  const [busy, setBusy] = useState(false);
  const items: any[] = status.data?.items ?? [];
  const conflicts = items.filter((x) => x.state === 'CONFLICT');
  return (
    <div className="space-y-4" data-screen="SYN">
      <Section title={t('المزامنة والشغل من غير نت')} badge={<StateBadge ops={['Sync.Status', 'Sync.Replay', 'Sync.ResolveConflict', 'Sync.Bootstrap', 'Sync.Changes']} />}
        sub={t('لو النت قطع، الجهاز بيكمّل شغل على آخر بيانات عنده ويسجل العمليات المسموحة برقمها. أول ما النت يرجع بتتبعت بنفس الترتيب، ولو حاجة اتغيرت في النص بتظهر هنا تقرر فيها.')} />
      <div className="grid xl:grid-cols-[1fr_1fr] gap-4 items-start">
        <Card title={<span className="flex items-center gap-2">{offline ? <WifiOff className="w-4 h-4 text-[var(--error)]" /> : <Wifi className="w-4 h-4 text-[var(--success)]" />}{t('الجهاز ده')}</span>}
          actions={offline ? <Pill tone="error">{t('أوفلاين')}</Pill> : <Pill tone="success">{t('متصل')}</Pill>}>
          <div className="space-y-3">
            <div className="flex gap-2 flex-wrap">
              {offline ? <Button variant="success" onClick={() => sim.setOffline(id, false)} data-fb="sync-reconnect"><Wifi className="w-4 h-4" />{t('رجّع النت (محاكاة)')}</Button>
                : <Button variant="danger" onClick={() => sim.setOffline(id, true)} data-fb="sync-go-offline"><WifiOff className="w-4 h-4" />{t('اقطع النت عن الجهاز ده (محاكاة)')}</Button>}
              {!offline && queued.length > 0 && <Button variant="warning" loading={busy} onClick={async () => { setBusy(true); await replayOffline(id); setBusy(false); }} data-fb="sync-replay"><RefreshCw className="w-4 h-4" />{t('ابعت المستني دلوقتي')}</Button>}
            </div>
            <div className="text-xs font-bold text-soft">{t('مستني يتبعت ({n})', { n: queued.length })}</div>
            {queued.length === 0 ? <div className="text-sm text-dim">{t('مفيش عمليات مستنية على الجهاز ده')}</div> : (
              <div className="space-y-1.5" data-fb="sync-queue">
                {queued.map((q, i) => (
                  <div key={q.id} className="flex items-center gap-2 px-3 py-2 rounded-xl surface-1 border line text-sm">
                    <span className="num text-xs text-dim w-5">{i + 1}</span>
                    <div className="flex-1 min-w-0"><div className="font-bold truncate">{q.label}</div><div className="text-[11px] text-dim">{t('اتسجلت')} {time(q.queuedAt)}<Tech> · <span className="num">{q.opId} · {q.id.slice(0, 8)}</span></Tech></div></div>
                    <Button size="sm" variant="ghost" onClick={async () => { if (await confirmDialog(t('تمسح العملية دي من الجهاز؟ مش هتتبعت خالص.'), { danger: true })) dropQueued(q.id); }} title={t('امسحها')}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </div>
                ))}
              </div>
            )}
            <div className="rounded-xl surface-1 p-3 text-xs space-y-1">
              <div className="font-bold text-soft">{t('اللي بيشتغل من غير نت')}</div>
              <div className="flex flex-wrap gap-1">{Object.values(OFFLINE_ALLOWLIST).map((x) => <Pill key={x.ar} tone="neutral">{L(x)}</Pill>)}</div>
              <div className="text-dim">{t('أي حاجة تانية (خصم، إلغاء بعد الإرسال، دفع بكارت، قفل وردية) لازم نت.')}</div>
            </div>
          </div>
        </Card>
        <LocalCopy />
      </div>
      <Card title={<span className="flex items-center gap-2"><ListChecks className="w-4 h-4" />{t('اللي اتبعت بعد ما النت رجع')}</span>}
        actions={<div className="flex items-center gap-2">{conflicts.length > 0 && <Pill tone="warning"><AlertTriangle className="w-3 h-3" />{conflicts.length} {t('محتاجة قرار')}</Pill>}{can('session:zreport') && <Tabs value={scope} onChange={setScope} tabs={[{ id: 'mine', label: t('الجهاز ده') }, { id: 'all', label: t('كل أجهزة الفرع') }]} />}</div>}>
        {items.length === 0 ? <Empty text={t('لسه مفيش عمليات أوفلاين اتبعتت')} /> : (
          <div className="space-y-2" data-fb="sync-items">
            {items.map((x) => <OfflineItem key={x.offlineCommandId} x={x} />)}
          </div>
        )}
        {status.data?.lastReplayAt && <div className="text-[11px] text-dim mt-2">{t('آخر إرسال')}: {dateTime(status.data.lastReplayAt)}</div>}
      </Card>
    </div>
  );
}

function OfflineItem({ x }: { x: any }) {
  const { run, busy } = useCommand();
  const k = KIND[x.conflictKind] ?? KIND.REFUSED;
  const [label, tone] = STATE[x.state] ?? [x.state, 'neutral'];
  const resolve = (resolution: string) => run('Sync.ResolveConflict', { params: { offlineCommandId: x.offlineCommandId }, body: { resolution, expectedVersion: x.version } }, { success: resolution === 'DISCARD' ? t('اتلغت') : t('اتبعتت تاني') });
  return (
    <div className={cn('rounded-xl border px-3 py-2', x.state === 'CONFLICT' ? 'border-[color-mix(in_srgb,var(--warning)_45%,transparent)] bg-[color-mix(in_srgb,var(--warning)_7%,transparent)]' : 'border-[var(--glass-border)] surface-1')} data-fb={`sync-item:${x.state}`}>
      <div className="flex items-center gap-2 flex-wrap">
        {x.state === 'CONFLICT' ? <AlertTriangle className="w-4 h-4 text-[var(--warning)]" /> : x.state === 'REJECTED' ? <XCircle className="w-4 h-4 text-[var(--error)]" /> : x.state === 'DISCARDED' ? <Ban className="w-4 h-4 text-dim" /> : <CheckCircle2 className="w-4 h-4 text-[var(--success)]" />}
        <div className="flex-1 min-w-0"><div className="text-sm font-bold">{x.label}</div><div className="text-[11px] text-dim">{deviceName(x.terminalId ?? x.deviceLabel)} · {x.userName} · {t('اتسجلت')} {time(x.queuedAt)} · {t('وصلت')} {time(x.replayedAt)}</div></div>
        <Pill tone={tone}>{t(label)}</Pill>
      </div>
      {(x.state === 'CONFLICT' || x.state === 'REJECTED') && (
        <div className="mt-2 space-y-2 ps-6">
          <div className="text-sm"><b>{t(k.ar)}</b> — <span className="text-soft">{t(k.help)}</span></div>
          {x.problemItem && <div className="text-xs"><span className="text-dim">{t('الصنف')}:</span> <b>{L(x.problemItem)}</b>{x.errorDetails?.reason ? <span className="text-dim"> — {x.errorDetails.reason}</span> : null}</div>}
          {x.state === 'CONFLICT' && <div className="flex gap-1.5 flex-wrap">{k.actions.map((a) => <Button key={a} size="sm" variant={ACTION[a].variant} disabled={busy} onClick={() => resolve(a)} data-fb={`sync-resolve:${a}`}>{t(ACTION[a].ar)}</Button>)}</div>}
          <Tech><div className="num text-[10px] text-dim">{x.operation} · {x.errorCode} · {x.offlineCommandId}</div></Tech>
        </div>
      )}
      {x.resolution && x.state !== 'CONFLICT' && <div className="text-[11px] text-dim ps-6 mt-1">{t('القرار')}: {t(ACTION[x.resolution]?.ar ?? x.resolution)}</div>}
    </div>
  );
}

function LocalCopy() {
  const boot = useQuery<any>('Sync.Bootstrap');
  const [cursor, setCursor] = useState<number | null>(null);
  const cur = cursor ?? boot.data?.cursor ?? null;
  const changes = useQuery<any>(cur !== null ? 'Sync.Changes' : null, { query: { cursor: cur } });
  const list: any[] = changes.data?.changes ?? [];
  const c = boot.data?.counts;
  return (
    <Card title={<span className="flex items-center gap-2"><Database className="w-4 h-4" />{t('نسخة البيانات اللي على الجهاز')}</span>}
      actions={<Button size="sm" variant="ghost" onClick={() => { setCursor(null); boot.refetch(); }} data-fb="sync-bootstrap"><Download className="w-4 h-4" />{t('حمّل نسخة جديدة')}</Button>}>
      <div className="space-y-3">
        {c ? <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[[t('صنف'), c.products], [t('سعر'), c.prices], [t('ترابيزة'), c.tables], [t('سبب'), c.reasonCodes]].map(([l, v]) => <div key={String(l)} className="rounded-xl surface-1 p-2 text-center"><div className="text-xl font-extrabold num">{v}</div><div className="text-[11px] text-dim">{l}</div></div>)}
        </div> : <div className="text-sm text-dim">…</div>}
        <div className="text-xs text-dim">{boot.data ? <>{t('اتحملت')} {dateTime(boot.data.at)}{boot.stale ? ` · ${t('من غير نت — دي آخر نسخة')}` : ''}</> : null}</div>
        <div className="text-xs font-bold text-soft flex items-center gap-1"><History className="w-3.5 h-3.5" />{t('اتغير إيه من ساعة النسخة دي')} {list.length > 0 && <Pill tone="info">{list.length}</Pill>}</div>
        {list.length === 0 ? <div className="text-sm text-dim">{t('مفيش تغييرات — النسخة اللي على الجهاز محدثة')}</div> : (
          <div className="space-y-1 max-h-64 overflow-y-auto" data-fb="sync-changes">
            {list.slice().reverse().map((x) => <div key={x.seq} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg surface-1"><Pill tone="neutral">{L(x.kind)}</Pill><span className="flex-1 truncate">{x.byName}<Tech> · <span className="num">{x.op} {x.target}</span></Tech></span><span className="num text-dim">{time(x.at)}</span></div>)}
            <Button size="sm" variant="outline" onClick={() => setCursor(changes.data?.nextCursor ?? cur)}>{t('حدّث الجهاز بالتغييرات دي')}</Button>
          </div>
        )}
      </div>
    </Card>
  );
}
