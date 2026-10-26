// Demo clock: the mock server has its own clock (business-day cutoff, scheduled prices, happy hour, e-receipt alerts).
import React from 'react';
import { Clock } from 'lucide-react';
import { Popover } from './Popover';
import { clock, businessDate, localTime } from '../mock/clock';
import { Button, useNow } from '../ui';
import { t } from '../i18n';
import { cn } from '../lib/format';
import { demo } from '../mock/demo';

export function ClockControl() {
  useNow(1000);
  const now = clock.now();
  const off = clock.offset();
  const go = (fn: () => void) => { fn(); demo.tick(); };
  return (
    <Popover title={t('ساعة السيرفر التجريبية')} width={340} button={(o) => (
      <button className={cn('h-8 px-2 rounded-lg border flex items-center gap-1.5 text-xs', off ? 'border-[var(--warning)] text-[var(--warning)]' : 'border-[var(--glass-border)] surface-1 text-soft', o && 'bg-[var(--primary-container)]')}>
        <Clock className="w-4 h-4" /><span className="num">{localTime(now)}</span><span className="num text-dim hidden lg:inline">{businessDate(now)}</span>
      </button>
    )}>
      <div className="space-y-3 text-sm">
        <div className="font-bold">{t('ساعة السيرفر التجريبية')}</div>
        <div className="text-xs text-dim">{t('اليوم التجاري بيتحسب من السيرفر حسب الفرع (Africa/Cairo، بداية اليوم 04:00) — مش من ساعة الجهاز. البيع الساعة 2 بالليل تبع اليوم اللي قبله.')}</div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="surface-1 rounded-lg p-2"><div className="text-dim">{t('القاهرة')}</div><div className="num font-bold text-lg">{localTime(now)}</div></div>
          <div className="surface-1 rounded-lg p-2"><div className="text-dim">{t('اليوم التجاري')}</div><div className="num font-bold text-lg">{businessDate(now)}</div></div>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          <Button size="sm" onClick={() => go(() => clock.advance(15 * 60_000))}>+15 {t('دقيقة')}</Button>
          <Button size="sm" onClick={() => go(() => clock.advance(60 * 60_000))}>+1 {t('ساعة')}</Button>
          <Button size="sm" onClick={() => go(() => clock.advance(12 * 3_600_000))}>+12 {t('ساعة')}</Button>
          <Button size="sm" onClick={() => go(() => clock.setCairoTime(3, 55))}>03:55</Button>
          <Button size="sm" onClick={() => go(() => clock.setCairoTime(4, 5))}>04:05</Button>
          <Button size="sm" onClick={() => go(() => clock.setCairoTime(2, 0))}>02:00</Button>
          <Button size="sm" onClick={() => go(() => clock.setCairoTime(16, 0))}>{t('هابي أور')} 16:00</Button>
          <Button size="sm" onClick={() => go(() => clock.setCairoTime(13, 0))}>13:00</Button>
          <Button size="sm" onClick={() => go(() => clock.advance(86_400_000))}>+1 {t('يوم')}</Button>
        </div>
        <Button size="sm" variant="ghost" onClick={() => go(() => clock.reset())}>{t('رجّع الساعة للوقت الحقيقي')}</Button>
      </div>
    </Popover>
  );
}
