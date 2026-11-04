// شاشة النداء — the call board guests watch: two columns, «جارٍ التحضير» and «جاهز», short order numbers in very
// large type. The newest ready number grows in at the top of «جاهز» with a gentle chime. A number leaves «جاهز» when
// the order is handed off or after CallBoardPolicy.readyMinutes. Only orders collected by number are shown (a table is
// served at the table; delivery per CallBoardPolicy). Reads CallBoard.View through the dispatch screen it follows.
import React, { useEffect, useRef, useState } from 'react';
import { ChefHat, BellRing, WifiOff } from 'lucide-react';
import { useQuery, useStoreVersion } from '../../app/hooks';
import { t } from '../../i18n';
import { cn } from '../../lib/format';
import { cue, useSound } from '../../app/sound';
import { useNow } from '../../ui';
import { clock, localTime } from '../../mock/clock';
import type { DisplaySettings } from './settings';

const MAX_PREP = 15, MAX_READY = 8;

export function CallBoard({ displayId, cfg, online }: { displayId: string; cfg: DisplaySettings; online: boolean }) {
  useNow(15000);
  useStoreVersion();
  const q = useQuery<any>('CallBoard.View'); // ux-12c: timing, call mode and delivery numbers are the venue rule CallBoardPolicy
  const tpl = useQuery<any>(cfg.branding ? 'DocTemplate.Get' : null);
  // a number also leaves «جاهز» when its minutes run out with nothing else changing
  useEffect(() => { const iv = setInterval(() => q.refetch(), 15000); return () => clearInterval(iv); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const snd = useSound(displayId);
  const ready: any[] = q.data?.ready ?? [];
  const prep: any[] = q.data?.preparing ?? [];
  // the newest ready number: chime + grow-in, for a few seconds
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  useEffect(() => {
    if (!q.data) return;
    const ids = new Set(ready.map((x) => `${x.orderId}@${x.calledAt}`));
    if (seen.current) {
      const added = ready.find((x) => !seen.current!.has(`${x.orderId}@${x.calledAt}`));
      if (added) { setFresh(added.orderId); cue('ready', displayId); const tm = setTimeout(() => setFresh((f) => (f === added.orderId ? null : f)), 9000); seen.current = ids; return () => clearTimeout(tm); }
    }
    seen.current = ids;
  }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const top = ready[0];
  const restReady = ready.slice(1, MAX_READY);
  const venue = tpl.data?.business?.nameAr || tpl.data?.business?.name || '';
  return (
    <div className="h-full flex flex-col p-[2.4cqmin] gap-[2cqmin]" data-fb="callboard" data-ready={ready.map((x) => x.no).join(',')} data-preparing={prep.map((x) => x.no).join(',')}>
      {cfg.branding && (
        <header className="h-[10cqh] shrink-0 flex items-center gap-[2.4cqmin] px-[1cqmin]" data-fb="callboard-branding">
          {tpl.data?.logoDataUrl && <span className="h-full aspect-[5/2] rounded-[1.4cqmin] bg-white/95 p-[0.6cqmin] flex items-center justify-center"><img src={tpl.data.logoDataUrl} alt="" className="max-h-full max-w-full" /></span>}
          <div className="min-w-0 flex-1 font-display font-extrabold text-[4.6cqmin] leading-none truncate">{venue}</div>
          {!online && <span className="inline-flex items-center gap-2 text-[2cqmin] text-[var(--warning-text)] font-bold"><WifiOff className="w-[2.6cqmin] h-[2.6cqmin]" />{t('غير متصلة بشاشة التسليم')}</span>}
          {online && !snd.ready && !snd.muted && <span className="text-[1.8cqmin] text-dim">{t('المس الشاشة لتفعيل الصوت')}</span>}
          <span className="num text-[4.2cqmin] font-bold text-soft">{localTime(clock.now())}</span>
        </header>
      )}
      <div className="flex-1 min-h-0 grid grid-cols-[38fr_62fr] gap-[2cqmin]">
        <section className="min-h-0 rounded-[3cqmin] border-[0.3cqmin] border-[var(--glass-border)] bg-[color-mix(in_srgb,var(--foreground)_5%,transparent)] flex flex-col p-[2.4cqmin] gap-[2cqmin]" data-fb="callboard-col:preparing">
          <h2 className="flex items-center gap-[1.4cqmin] text-[5cqmin] font-extrabold leading-none text-soft"><ChefHat className="w-[5cqmin] h-[5cqmin]" />{t('جارٍ التحضير')}</h2>
          <div className="flex-1 min-h-0 grid grid-cols-3 auto-rows-[minmax(0,13cqh)] gap-[1.6cqmin] content-start overflow-hidden">
            {prep.slice(0, MAX_PREP).map((x) => <div key={x.orderId} data-fb={`cb-prep:${x.no}`} className={cn('num font-black rounded-[2cqmin] flex items-center justify-center bg-[color-mix(in_srgb,var(--foreground)_8%,transparent)] text-[var(--foreground)] leading-none', x.short ? 'text-[9cqmin]' : 'text-[5cqmin]')}>{x.no}</div>)}
          </div>
          {prep.length > MAX_PREP && <div className="text-[2.6cqmin] text-dim font-bold">+<span className="num">{prep.length - MAX_PREP}</span></div>}
          {!prep.length && <div className="flex-1 flex items-center justify-center text-[3cqmin] text-dim">—</div>}
        </section>
        <section className="min-h-0 rounded-[3cqmin] border-[0.4cqmin] border-[var(--success)] bg-[color-mix(in_srgb,var(--success)_10%,transparent)] flex flex-col p-[2.4cqmin] gap-[2cqmin]" data-fb="callboard-col:ready">
          <h2 className="flex items-center gap-[1.4cqmin] text-[5.6cqmin] font-extrabold leading-none text-[var(--success)]"><BellRing className="w-[5.6cqmin] h-[5.6cqmin]" />{t('جاهز')}</h2>
          {top ? (
            <div key={top.orderId + top.calledAt} data-fb={`cb-ready:${top.no}`} data-new={fresh === top.orderId || undefined} className={cn('num font-black rounded-[2.4cqmin] flex items-center justify-center bg-[var(--success)] text-[#04130a] leading-none h-[30cqh] shrink-0', top.short ? 'text-[24cqmin]' : 'text-[12cqmin]', fresh === top.orderId && 'cb-in cb-new')}>{top.no}</div>
          ) : <div className="h-[30cqh] shrink-0 rounded-[2.4cqmin] border-[0.3cqmin] border-dashed border-[color-mix(in_srgb,var(--success)_50%,transparent)] flex items-center justify-center text-[3cqmin] text-dim">—</div>}
          <div className="flex-1 min-h-0 grid grid-cols-4 auto-rows-[minmax(0,14cqh)] gap-[1.6cqmin] content-start overflow-hidden">
            {restReady.map((x) => <div key={x.orderId} data-fb={`cb-ready:${x.no}`} className={cn('num font-black rounded-[2cqmin] flex items-center justify-center border-[0.4cqmin] border-[var(--success)] text-[var(--success)] leading-none', x.short ? 'text-[10cqmin]' : 'text-[5.4cqmin]')}>{x.no}</div>)}
          </div>
          {ready.length > MAX_READY && <div className="text-[2.6cqmin] text-dim font-bold">+<span className="num">{ready.length - MAX_READY}</span></div>}
        </section>
      </div>
    </div>
  );
}
