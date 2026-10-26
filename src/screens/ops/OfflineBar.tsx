// Per-device network strip: "أوفلاين — N عمليات مستنية" while the network is cut, the commands still waiting after
// it returns, and offline items that came back as conflicts needing a decision.
import React, { useSyncExternalStore, useState } from 'react';
import { WifiOff, Wifi, RefreshCw, AlertTriangle, ListChecks } from 'lucide-react';
import { useDev, useOfflineQueue, replayOffline, useQuery } from '../../app/hooks';
import { sim } from '../../mock/sim';
import { Button } from '../../ui';
import { t } from '../../i18n';
import { cn } from '../../lib/format';

export const useSim = () => useSyncExternalStore(sim.subscribe, sim.get);

export function OfflineBar() {
  const { id, nav, can, terminal } = useDev();
  const s = useSim();
  const offline = (s.offlineDevices ?? []).includes(id);
  const queued = useOfflineQueue(id);
  const status = useQuery<any>(can('sync:read') && !offline ? 'Sync.Status' : null, { query: { terminalId: terminal?.id } });
  const conflicts = status.data?.conflicts ?? 0;
  const [busy, setBusy] = useState(false);
  if (!offline && !queued.length && !conflicts) return null;
  return (
    <div data-fb="offline-bar" data-offline={offline ? '1' : '0'} className={cn('shrink-0 flex items-center gap-3 px-4 py-2 text-sm border-b flex-wrap', offline ? 'bg-[color-mix(in_srgb,var(--error)_14%,transparent)] border-[color-mix(in_srgb,var(--error)_40%,transparent)]' : 'bg-[color-mix(in_srgb,var(--warning)_12%,transparent)] border-[color-mix(in_srgb,var(--warning)_40%,transparent)]')}>
      {offline ? <WifiOff className="w-4 h-4 text-[var(--error)]" /> : queued.length ? <RefreshCw className="w-4 h-4 text-[var(--warning)]" /> : <AlertTriangle className="w-4 h-4 text-[var(--warning)]" />}
      <div className="flex-1 min-w-0">
        {offline ? (
          <><b>{t('أوفلاين')}</b> — {queued.length ? t('{n} عمليات مستنية تتبعت', { n: queued.length }) : t('مفيش عمليات مستنية')} <span className="text-dim text-xs">· {t('الجهاز شغال على آخر بيانات عنده؛ إضافة الأصناف والإرسال للمطبخ والتحصيل الكاش بتتسجل وتتبعت لما النت يرجع.')}</span></>
        ) : queued.length ? (
          <><b>{t('{n} عمليات لسه ما اتبعتتش', { n: queued.length })}</b> <span className="text-dim text-xs">· {t('النت رجع بس الإرسال ما خلصش')}</span></>
        ) : (
          <><b>{t('{n} عمليات أوفلاين محتاجة قرار', { n: conflicts })}</b> <span className="text-dim text-xs">· {t('حاجة اتغيرت وانت من غير نت (صنف خلص أو الشيك اتعدل)')}</span></>
        )}
      </div>
      {offline && <Button size="sm" variant="ghost" onClick={() => sim.setOffline(id, false)} data-fb="offline-reconnect"><Wifi className="w-4 h-4" />{t('رجّع النت (محاكاة)')}</Button>}
      {!offline && queued.length > 0 && <Button size="sm" variant="warning" loading={busy} onClick={async () => { setBusy(true); await replayOffline(id); setBusy(false); }} data-fb="offline-replay"><RefreshCw className="w-4 h-4" />{t('ابعت دلوقتي')}</Button>}
      {can('sync:read') && <Button size="sm" variant="outline" onClick={() => nav('sync')} data-fb="offline-open-sync"><ListChecks className="w-4 h-4" />{t('شاشة المزامنة')}</Button>}
    </div>
  );
}
