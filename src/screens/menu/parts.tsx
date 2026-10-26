// Shared pieces of the menu & pricing screens: image upload (downsized in the browser, stored as a data URL),
// allergen/calorie tags and plain-language labels. Display only — prices always come from the server.
import React, { useRef, useState } from 'react';
import { ImagePlus, Trash2, Flame, AlertTriangle } from 'lucide-react';
import { Button, toast } from '../../ui';
import { t } from '../../i18n';
import { cn } from '../../lib/format';

export const IMAGE_LIMIT_CHARS = 400_000; // the server refuses bigger data URLs

/** Reads an image file, downsizes it to `max` px on the long side (JPEG/WebP) and returns a data URL. */
export async function fileToDataUrl(file: File, max = 480): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error(t('الملف ده مش صورة'));
  if (file.size > 8 * 1024 * 1024) throw new Error(t('الصورة أكبر من 8 ميجا'));
  const raw: string = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
  if (file.type === 'image/svg+xml') { if (raw.length > IMAGE_LIMIT_CHARS) throw new Error(t('الصورة كبيرة — الحد 300 كيلوبايت')); return raw; }
  const img: HTMLImageElement = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(t('الصورة مش مقروءة'))); i.src = raw; });
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
  for (const q of [0.85, 0.72, 0.6, 0.45]) {
    const out = canvas.toDataURL('image/jpeg', q);
    if (out.length <= IMAGE_LIMIT_CHARS) return out;
  }
  throw new Error(t('الصورة كبيرة — الحد 300 كيلوبايت'));
}

export function ImageInput({ value, onChange, color, fb }: { value: string; onChange: (v: string) => void; color?: string; fb: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try { onChange(await fileToDataUrl(f)); } catch (e) { toast('error', String((e as Error).message ?? e)); }
    setBusy(false);
    if (ref.current) ref.current.value = '';
  };
  const kb = value?.startsWith('data:') ? Math.round((value.length * 3) / 4 / 1024) : null;
  return (
    <div className="space-y-2">
      <div className="aspect-[4/3] rounded-xl border line overflow-hidden flex items-center justify-center relative" style={{ background: (color ?? '#64748b') + '26' }}
        onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files?.[0]); }}>
        {value ? <img src={value} alt="" className="w-full h-full object-cover" onError={(e) => ((e.target as HTMLImageElement).style.opacity = '0.2')} /> : <div className="text-center text-dim text-xs px-3"><ImagePlus className="w-8 h-8 mx-auto mb-1 opacity-60" />{t('اسحب صورة هنا أو اختار ملف')}</div>}
      </div>
      <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" data-fb={`${fb}:image-file`} onChange={(e) => pick(e.target.files?.[0])} />
      <div className="flex gap-2 items-center">
        <Button size="sm" data-fb={`${fb}:image-upload`} loading={busy} onClick={() => ref.current?.click()}><ImagePlus className="w-3.5 h-3.5" />{value ? t('غيّر الصورة') : t('ارفع صورة')}</Button>
        {value && <Button size="sm" variant="ghost" data-fb={`${fb}:image-remove`} onClick={() => onChange('')}><Trash2 className="w-3.5 h-3.5" />{t('شيل')}</Button>}
        {kb !== null && <span className="text-[11px] text-dim num">{kb} KB</span>}
      </div>
      <div className="text-[11px] text-dim">{t('بتتصغر أوتوماتيك لحد 480 بكسل. الحد 300 كيلوبايت.')}</div>
    </div>
  );
}

export const ALLERGEN_LABEL: Record<string, string> = { GLUTEN: 'جلوتين', DAIRY: 'ألبان', NUTS: 'مكسرات', EGGS: 'بيض', EGG: 'بيض', SEAFOOD: 'مأكولات بحرية', FISH: 'سمك', SOY: 'صويا', SESAME: 'سمسم' };
export const allergenText = (a: string) => t(ALLERGEN_LABEL[a] ?? a);

export function AllergenChips({ list, className }: { list?: string[] | null; className?: string }) {
  if (!list?.length) return null;
  return (
    <span className={cn('inline-flex flex-wrap gap-1', className)}>
      {list.map((a) => <span key={a} className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-500 border border-amber-500/30 font-bold"><AlertTriangle className="w-3 h-3" />{allergenText(a)}</span>)}
    </span>
  );
}

export function Calories({ v, className }: { v?: number | null; className?: string }) {
  if (v === undefined || v === null) return null;
  return <span className={cn('inline-flex items-center gap-0.5 text-[10px] text-dim num', className)}><Flame className="w-3 h-3" />{v} {t('سعر حراري')}</span>;
}

export const levelLabel = (l: string) => ({ NO: t('بدون'), LESS: t('خفيف'), NORMAL: t('عادي'), EXTRA: t('زيادة') } as Record<string, string>)[l] ?? l;
export const placementLabel = (p: string) => ({ WHOLE: t('كلها'), LEFT: t('النص الأول'), RIGHT: t('النص التاني') } as Record<string, string>)[p] ?? p;
export const halfModeLabel = (m?: string) => ({ HIGHER_HALF: t('سعر النص الأغلى'), AVERAGE: t('متوسط سعر النصين'), SUM_OF_HALVES: t('مجموع سعر النصين (كل نص بنسبته)') } as Record<string, string>)[m ?? 'HIGHER_HALF'] ?? m ?? '';
export const dayName = (d: number) => [t('الحد'), t('الاتنين'), t('التلات'), t('الأربع'), t('الخميس'), t('الجمعة'), t('السبت')][d] ?? String(d);
export const daysText = (days: number[]) => (days.length === 7 ? t('كل يوم') : days.map(dayName).join('، '));
export const timeText = (iso?: string | null) => {
  if (!iso) return '';
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  return p;
};
