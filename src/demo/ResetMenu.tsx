import React from 'react';
import { RotateCcw, Download, Upload, Sparkles, Eraser } from 'lucide-react';
import { Popover } from './Popover';
import { demo } from '../mock/demo';
import { store } from '../mock/store';
import { devices } from '../app/devices';
import { apiLog } from '../mock/kernel';
import { Button, toast, confirmDialog } from '../ui';
import { saveFile } from '../lib/files';
import { t } from '../i18n';

export function ResetMenu() {
  const exportState = () => {
    saveFile('nerdpos-demo-state.json', store.exportJson(), 'application/json').catch(() => toast('error', t('حفظ الملفات مش متاح هنا')));
  };
  return (
    <Popover title={t('البيانات')} width={300} button={() => <button className="h-8 px-2 rounded-lg surface-1 border border-[var(--glass-border)] text-xs flex items-center gap-1"><RotateCcw className="w-4 h-4" /></button>}>
      {(close) => (
        <div className="space-y-2 text-sm">
          <div className="font-bold">{t('بيانات العرض')}</div>
          <Button className="w-full" onClick={async () => { if (await confirmDialog(t('ترجع كل البيانات لبيانات العرض الأصلية؟'))) { demo.reset('DEMO'); devices.resetAll(); apiLog.clear(); toast('success', t('رجعت بيانات العرض')); close(); } }}><Sparkles className="w-4 h-4" />{t('ارجع لبيانات العرض (demo 1.2)')}</Button>
          <Button className="w-full" onClick={async () => { if (await confirmDialog(t('تبدأ تركيب جديد من الصفر؟ كل البيانات هتتمسح.'), { danger: true })) { demo.reset('ZERO'); devices.resetAll(); apiLog.clear(); toast('success', t('تركيب جديد: سجل دخول بـ implementation-engineer على الباك أوفيس')); close(); } }}><Eraser className="w-4 h-4" />{t('ابدأ من الصفر (J-A1)')}</Button>
          <Button className="w-full" variant="ghost" onClick={exportState}><Download className="w-4 h-4" />{t('صدّر الحالة (JSON)')}</Button>
          <label className="w-full h-10 rounded-xl hover:surface-2 text-sm flex items-center justify-center gap-2 cursor-pointer text-soft"><Upload className="w-4 h-4" />{t('استورد حالة')}<input type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0]?.text().then((x) => { try { store.importJson(x); toast('success', t('اتحملت الحالة')); } catch { toast('error', t('ملف مش صالح')); } })} /></label>
        </div>
      )}
    </Popover>
  );
}
