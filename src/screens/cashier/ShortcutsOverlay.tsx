// "?" overlay: the effective key map (defaults ← work profile ← this device). Every key can be changed on this device;
// taking a key that another action uses swaps the two, so there is never a conflict. Reset returns to the profile's keys.
import React, { useEffect, useState } from 'react';
import { Keyboard, RotateCcw } from 'lucide-react';
import { Popup, Kbd, Button } from '../../ui';
import { t } from '../../i18n';
import { cn } from '../../lib/format';
import { keymap, useKeymap, keyLabel, keyName, assignableOf, type KeyAction, type KeyScope } from '../../app/keymap';

/** Fixed rows of the sale screen (not remappable). Other scopes pass their own. */
const SALE_FIXED = (primary?: string): [string, string][] => [['Enter', primary ?? t('الزر الرئيسي')], ['0–9', t('الكمية قبل الصنف')], ['?', t('عرض الاختصارات')], ['Esc', t('إغلاق النافذة')], ['Ctrl K', t('البحث في الشاشات')]];

export function ShortcutsOverlay({ deviceId, labels, profileName, profileKeys, onClose, scope = 'sale', fixed, title, fb = 'shortcuts-overlay' }: { deviceId: string; labels: Partial<Record<KeyAction, string>>; profileName: string; profileKeys?: Partial<Record<KeyAction, string>>; onClose: () => void; scope?: KeyScope; fixed?: [string, string][]; title?: string; fb?: string }) {
  const map = useKeymap(deviceId, scope, profileKeys);
  const base = keymap.base(scope, profileKeys);
  const [capture, setCapture] = useState<KeyAction | null>(null);
  useEffect(() => {
    if (!capture) return;
    const h = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') { setCapture(null); return; }
      const k = scope === 'kds' && e.key.length === 1 ? e.key.toLowerCase() : keyName(e);
      if (assignableOf(scope).includes(k)) { keymap.assign(deviceId, capture, k, scope, profileKeys); setCapture(null); }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [capture, deviceId, scope, profileKeys]);
  const rows = (Object.keys(labels) as KeyAction[]).filter((a) => scope !== 'sale' || a !== 'primary');
  const fixedRows = fixed ?? SALE_FIXED(labels.primary);
  return (
    <Popup open onClose={() => (capture ? setCapture(null) : onClose())} size={scope === 'kds' ? 'lg' : 'md'} fb={fb}
      title={<span className="flex items-center gap-2"><Keyboard className="w-5 h-5 text-[var(--primary)]" />{title ?? t('اختصارات لوحة المفاتيح')}</span>}
      footer={<><span className="me-auto text-xs text-dim">{t('ملف العمل')}: {profileName}</span><Button variant="ghost" onClick={() => keymap.reset(deviceId, scope)} data-fb="shortcuts-reset"><RotateCcw className="w-4 h-4" />{t('استعادة الافتراضي')}</Button><Button variant="primary" onClick={onClose}>{t('تم')}</Button></>}>
      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-0.5">
        {rows.map((a) => (
          <div key={a} className={cn('flex items-center gap-2 h-12 border-b line', capture === a && 'bg-[var(--primary-container)] -mx-2 px-2 rounded-lg')} data-fb={`shortcut-row:${a}`} data-key={map[a] ?? ''} data-device-key={map[a] !== base[a] ? '1' : undefined}>
            <span className="flex-1 min-w-0 truncate text-sm">{labels[a]}</span>
            {capture === a ? <span className="text-xs text-[var(--primary)] font-semibold">{t('اضغط مفتاحًا')}</span> : <Kbd className="min-w-[36px] h-7 text-xs">{keyLabel(map[a]) || '—'}</Kbd>}
            <button onClick={() => setCapture(capture === a ? null : a)} className="h-9 w-14 rounded-lg text-xs text-soft hover:bg-[var(--surface-2)]" data-fb={`shortcut-change:${a}`}>{t('تغيير')}</button>
          </div>
        ))}
        {fixedRows.map(([k, label]) => <Fixed key={k} k={k} label={label} />)}
      </div>
    </Popup>
  );
}

const Fixed = ({ k, label }: { k: string; label: string }) => (
  <div className="flex items-center gap-2 h-12 border-b line"><span className="flex-1 min-w-0 truncate text-sm text-soft">{label}</span><Kbd className="min-w-[36px] h-7 text-xs">{k}</Kbd><span className="w-14" /></div>
);
