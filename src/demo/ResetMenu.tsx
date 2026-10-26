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
    <Popover title={t('البيانات: رجّع بيانات التجربة، ابدأ بمطعم فاضي، أو احفظ نسخة')} width={300} button={() => <button data-fb="chrome:data" className="h-8 px-2 rounded-lg surface-1 border border-[var(--glass-border)] text-xs flex items-center gap-1 text-soft"><RotateCcw className="w-4 h-4" /><span className="hidden min-[2000px]:inline">{t('البيانات')}</span></button>}>
      {(close) => (
        <div className="space-y-2 text-sm">
          <div className="font-bold">{t('بيانات التجربة')}</div>
          <div className="text-[11px] text-dim">{t('كل اللي بتعمله محفوظ في المتصفح ده بس.')}</div>
          <Button className="w-full" onClick={async () => { if (await confirmDialog(t('نرجّع كل حاجة زي ما كانت أول ما فتحت التجربة؟'))) { demo.reset('DEMO'); devices.resetAll(); apiLog.clear(); toast('success', t('رجعت بيانات التجربة زي الأول')); close(); } }}><Sparkles className="w-4 h-4" />{t('رجّع بيانات التجربة زي الأول')}</Button>
          <Button className="w-full" onClick={async () => { if (await confirmDialog(t('نبدأ بمطعم فاضي خالص؟ كل بيانات التجربة هتتمسح (وتقدر ترجعها من هنا).'), { danger: true })) { demo.reset('ZERO'); devices.resetAll(); apiLog.clear(); toast('success', t('مطعم فاضي: ادخل من «الإدارة» باسم كريم (مهندس التركيب)، أو امشي مع رحلة «تركيب مطعم من الصفر»')); close(); } }}><Eraser className="w-4 h-4" />{t('ابدأ بمطعم فاضي (تركيب من الصفر)')}</Button>
          <Button className="w-full" variant="ghost" onClick={exportState}><Download className="w-4 h-4" />{t('احفظ نسخة من البيانات (ملف)')}</Button>
          <label className="w-full h-10 rounded-xl hover:surface-2 text-sm flex items-center justify-center gap-2 cursor-pointer text-soft"><Upload className="w-4 h-4" />{t('رجّع نسخة محفوظة')}<input type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0]?.text().then((x) => { try { store.importJson(x); toast('success', t('النسخة رجعت')); } catch { toast('error', t('ملف مش صالح')); } })} /></label>
        </div>
      )}
    </Popover>
  );
}
