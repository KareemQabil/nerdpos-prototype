// "?" overlay: the device's key map for the sale screen. Every function key can be changed on this device; taking a
// key that another action uses swaps the two, so there is never a conflict. Reset returns to the profile's keys.
import React, { useEffect, useState } from 'react';
import { Keyboard, RotateCcw } from 'lucide-react';
import { Popup, Kbd, Button } from '../../ui';
import { t } from '../../i18n';
import { cn } from '../../lib/format';
import { keymap, useKeymap, keyLabel, ASSIGNABLE, type KeyAction } from '../../app/keymap';

export function ShortcutsOverlay({ deviceId, labels, profileName, onClose }: { deviceId: string; labels: Partial<Record<KeyAction, string>>; profileName: string; onClose: () => void }) {
  const map = useKeymap(deviceId);
  const [capture, setCapture] = useState<KeyAction | null>(null);
  useEffect(() => {
    if (!capture) return;
    const h = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') { setCapture(null); return; }
      if (ASSIGNABLE.includes(e.key)) { keymap.assign(deviceId, capture, e.key); setCapture(null); }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [capture, deviceId]);
  const rows = (Object.keys(labels) as KeyAction[]).filter((a) => a !== 'primary');
  return (
    <Popup open onClose={() => (capture ? setCapture(null) : onClose())} size="md" fb="shortcuts-overlay"
      title={<span className="flex items-center gap-2"><Keyboard className="w-5 h-5 text-[var(--primary)]" />{t('اختصارات لوحة المفاتيح')}</span>}
      footer={<><span className="me-auto text-xs text-dim">{t('ملف العمل')}: {profileName}</span><Button variant="ghost" onClick={() => keymap.reset(deviceId)} data-fb="shortcuts-reset"><RotateCcw className="w-4 h-4" />{t('استعادة الافتراضي')}</Button><Button variant="primary" onClick={onClose}>{t('تم')}</Button></>}>
      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-0.5">
        {rows.map((a) => (
          <div key={a} className={cn('flex items-center gap-2 h-12 border-b line', capture === a && 'bg-[var(--primary-container)] -mx-2 px-2 rounded-lg')}>
            <span className="flex-1 min-w-0 truncate text-sm">{labels[a]}</span>
            {capture === a ? <span className="text-xs text-[var(--primary)] font-semibold">{t('اضغط مفتاحًا')}</span> : <Kbd className="min-w-[36px] h-7 text-xs">{keyLabel(map[a]) || '—'}</Kbd>}
            <button onClick={() => setCapture(capture === a ? null : a)} className="h-9 w-14 rounded-lg text-xs text-soft hover:bg-[var(--surface-2)]" data-fb={`shortcut-change:${a}`}>{t('تغيير')}</button>
          </div>
        ))}
        <Fixed k="Enter" label={labels.primary ?? t('الزر الرئيسي')} />
        <Fixed k="0–9" label={t('الكمية قبل الصنف')} />
        <Fixed k="?" label={t('عرض الاختصارات')} />
        <Fixed k="Esc" label={t('إغلاق النافذة')} />
        <Fixed k="Ctrl K" label={t('البحث في الشاشات')} />
      </div>
    </Popup>
  );
}

const Fixed = ({ k, label }: { k: string; label: string }) => (
  <div className="flex items-center gap-2 h-12 border-b line"><span className="flex-1 min-w-0 truncate text-sm text-soft">{label}</span><Kbd className="min-w-[36px] h-7 text-xs">{k}</Kbd><span className="w-14" /></div>
);
