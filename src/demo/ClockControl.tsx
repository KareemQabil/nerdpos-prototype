// Server time, read-only (round 3 — trusted time, F2-03 / E09). The clock and the business date are shown; nothing
// here (or anywhere in the UI) can move them. Transaction time and the business date come from the server; the
// terminal's own clock is irrelevant. Anything that needs "another time" is a read-only preview (e.g. the menu admin
// "what the cashier sees at 20:00") or seeded history — never a change of ledger time.
import React from 'react';
import { Clock, Lock } from 'lucide-react';
import { Popover } from './Popover';
import { clock, businessDate, localTime } from '../mock/clock';
import { useNow } from '../ui';
import { t } from '../i18n';
import { dayLong } from '../lib/format';

export function ServerClock() {
  useNow(15000);
  const now = clock.now();
  const bd = businessDate(now);
  return (
    <Popover title={t('وقت السيرفر — مش قابل للتعديل')} width={320} button={(o) => (
      <button data-fb="chrome:server-clock" data-on={o} className="chrome-btn" aria-label={t('وقت السيرفر — مش قابل للتعديل')}>
        <Clock className="w-4 h-4" /><span className="num font-bold">{localTime(now)}</span><Lock className="w-3 h-3 opacity-60" aria-hidden />
      </button>
    )}>
      <div className="space-y-3 text-sm" data-fb="server-clock">
        <div className="font-bold text-base flex items-center gap-1.5"><Lock className="w-4 h-4" />{t('وقت السيرفر — مش قابل للتعديل')}</div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="surface-1 rounded-xl p-2.5"><div className="text-dim">{t('الساعة (القاهرة)')}</div><div className="num font-bold text-lg">{localTime(now)}</div></div>
          <div className="surface-1 rounded-xl p-2.5"><div className="text-dim">{t('اليوم التجاري')}</div><div className="font-bold">{dayLong(bd)}</div></div>
        </div>
        <div className="text-xs text-dim leading-relaxed">{t('وقت كل حركة واليوم التجاري بييجوا من السيرفر بس. محدش يقدر يغيّرهم — ولا حتى صاحب المطعم — وساعة الجهاز نفسه مالهاش دعوة. اليوم التجاري بيبدأ الساعة 4 الفجر: البيع الساعة 2 بالليل بيتحسب على اليوم اللي قبله.')}</div>
        <div className="text-xs text-dim leading-relaxed">{t('عايز تشوف المنيو هيبقى شكله إيه الساعة 8 بالليل؟ استخدم «معاينة» في شاشة المنيوهات — بتوريك من غير ما تغيّر الوقت.')}</div>
      </div>
    </Popover>
  );
}
