// G5 Receipt & report templates (round 3, E16 / P1-033 / P1-034 / E08): the venue uploads its logo (data URL,
// size-limited), writes header and footer lines, picks the receipt paper, chooses where the second language prints
// (only items that have a second name — no machine translation) and the short call-out number. The transaction number
// is always printed and cannot be hidden. A live 80 mm receipt and A4 page preview use the same kit as the real
// documents (src/ui/doc).
import React, { useEffect, useRef, useState } from 'react';
import { Receipt, Image as ImageIcon, Trash2, Upload, Save, Languages, Hash, FileText } from 'lucide-react';
import { useCommand, useQuery } from '../../app/hooks';
import { Banner, Button, Card, Field, PageHeader, Pill, SegmentedControl, StateBadge, Switch, Textarea, Input, Skeleton, toast } from '../../ui';
import { Tech } from '../../app/tech';
import { t } from '../../i18n';
import { A4Page, DocFooter, DocHeader, ReceiptPaper, SecondName, ShortNumber, useDocTemplate, type DocTemplateView } from '../../ui/doc';

const MAX_W = 640; // px: the logo is downsized before upload (thermal printers print ~576 dots on 80 mm)

/** Reads an image file, downsizes raster images to MAX_W px and returns a data URL (SVG kept as is). */
async function readLogo(file: File): Promise<string> {
  const raw = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
  if (/^data:image\/svg\+xml/i.test(raw)) return raw;
  const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('image')); i.src = raw; });
  const scale = Math.min(1, MAX_W / img.width);
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  const png = c.toDataURL('image/png');
  return png.length < raw.length || scale < 1 ? (png.length > 280_000 ? c.toDataURL('image/jpeg', 0.85) : png) : raw;
}

export default function DocTemplates() {
  const { template: tpl, loading, refetch } = useDocTemplate();
  const { run, busy } = useCommand();
  const [d, setD] = useState<DocTemplateView | null>(null);
  const [header, setHeader] = useState('');
  const [footer, setFooter] = useState('');
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { if (tpl && (!d || d.version !== tpl.version)) { setD(tpl); setHeader(tpl.headerLines.join('\n')); setFooter(tpl.footerLines.join('\n')); } }, [tpl?.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const max = (tpl as any)?.logoMaxChars ?? 280_000;
  const draft: DocTemplateView | null = d ? { ...d, headerLines: header.split('\n').map((x) => x.trim()).filter(Boolean), footerLines: footer.split('\n').map((x) => x.trim()).filter(Boolean) } : null;
  const dirty = !!(tpl && draft && (draft.logoDataUrl !== tpl.logoDataUrl || draft.logoWidthPct !== tpl.logoWidthPct || draft.paper !== tpl.paper || draft.logoOnReceipt !== tpl.logoOnReceipt || draft.logoOnReports !== tpl.logoOnReports || draft.headerLines.join('\n') !== tpl.headerLines.join('\n') || draft.footerLines.join('\n') !== tpl.footerLines.join('\n')));
  const pick = async (f: File | undefined) => {
    if (!f || !d) return;
    if (!/^image\//.test(f.type)) { toast('error', t('اختار صورة (PNG أو JPG أو SVG).')); return; }
    try {
      const url = await readLogo(f);
      if (url.length > max) { toast('error', t('اللوجو كبير — أقصى حاجة حوالي 200 كيلوبايت. صغّر الصورة وجرب تاني.')); return; }
      setD({ ...d, logoDataUrl: url, logoName: f.name });
    } catch { toast('error', t('الصورة دي ما اتقريتش. جرّب ملف تاني.')); }
  };
  const save = async () => {
    if (!draft || !tpl) return;
    const r = await run('DocTemplate.Update', { body: { logoDataUrl: draft.logoDataUrl === tpl.logoDataUrl ? undefined : draft.logoDataUrl ?? null, logoName: draft.logoName, logoWidthPct: draft.logoWidthPct, logoOnReceipt: draft.logoOnReceipt, logoOnReports: draft.logoOnReports, headerLines: draft.headerLines, footerLines: draft.footerLines, paper: draft.paper, expectedVersion: tpl.version || undefined } }, { success: t('القالب اتحفظ — الإيصالات والتقارير الجاية هتطلع بيه') });
    if (r) refetch();
  };
  return (
    <div className="space-y-4" data-fb="screen:G5">
      <PageHeader icon={<Receipt />} title={t('قوالب الإيصال والتقارير')} ops={['DocTemplate.Get', 'DocTemplate.Update', 'Settings.UpdatePolicy']}
        description={t('اللوجو وسطور الإيصال من فوق ومن تحت، ومقاس الورق، واللغة التانية، ورقم النداء. السيستم هو اللي بيطبع اللوجو — مش محتاج تبرمجه على الطابعة.')}
        actions={<Button variant="primary" disabled={!dirty || busy} loading={busy} onClick={save} data-fb="tpl:save"><Save className="w-4 h-4" />{t('احفظ القالب')}</Button>} />
      {loading && !d && <Skeleton className="h-64 rounded-2xl" />}
      {d && draft && (
        <div className="grid @5xl/main:grid-cols-[minmax(0,1fr)_auto] gap-4 items-start">
          <div className="space-y-4 min-w-0">
            <Card title={<span className="flex items-center gap-2"><ImageIcon className="w-4 h-4 text-[var(--primary)]" />{t('لوجو المطعم')}</span>} description={t('PNG أو JPG أو SVG — بيتصغّر لوحده، وأقصى حجم حوالي 200 كيلوبايت.')}>
              <div className="flex items-center gap-4 flex-wrap">
                <div className="w-48 h-24 rounded-xl border border-dashed line flex items-center justify-center bg-white overflow-hidden">{d.logoDataUrl ? <img src={d.logoDataUrl} alt={t('لوجو المطعم')} className="max-w-full max-h-full object-contain" data-fb="tpl:logo-preview" /> : <span className="text-xs text-dim">{t('مفيش لوجو')}</span>}</div>
                <div className="space-y-2">
                  <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" data-fb="tpl:logo-file" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => file.current?.click()} data-fb="tpl:logo-upload"><Upload className="w-3.5 h-3.5" />{d.logoDataUrl ? t('غيّر اللوجو') : t('ارفع لوجو')}</Button>
                    {d.logoDataUrl && <Button size="sm" variant="ghost" onClick={() => setD({ ...d, logoDataUrl: null, logoName: null })} data-fb="tpl:logo-remove"><Trash2 className="w-3.5 h-3.5" />{t('شيل اللوجو')}</Button>}
                  </div>
                  {d.logoName && <div className="text-[11px] text-dim">{d.logoName} · <span className="num">{Math.round((d.logoDataUrl?.length ?? 0) / 1024)}</span> {t('كيلوبايت تقريبًا')}</div>}
                </div>
              </div>
              <div className="grid sm:grid-cols-3 gap-3 mt-4">
                <Field label={t('عرض اللوجو')} hint={t('{n}% من عرض الورقة', { n: d.logoWidthPct })}><input type="range" min={20} max={100} step={5} value={d.logoWidthPct} onChange={(e) => setD({ ...d, logoWidthPct: Number(e.target.value) })} className="w-full" data-fb="tpl:logo-width" /></Field>
                <Field label={t('على إيصال الزبون')}><Switch checked={d.logoOnReceipt !== false} onChange={(v) => setD({ ...d, logoOnReceipt: v })} label={d.logoOnReceipt !== false ? t('أيوه') : t('لأ')} /></Field>
                <Field label={t('على تقارير A4')}><Switch checked={d.logoOnReports !== false} onChange={(v) => setD({ ...d, logoOnReports: v })} label={d.logoOnReports !== false ? t('أيوه') : t('لأ')} /></Field>
              </div>
              <div className="text-[11px] text-dim mt-2">{t('تذكرة المطبخ مش بيتطبع عليها لوجو.')}</div>
            </Card>
            <Card title={<span className="flex items-center gap-2"><FileText className="w-4 h-4 text-[var(--primary)]" />{t('سطور الإيصال')}</span>} description={t('كل سطر في سطر لوحده — لحد 6 سطور، كل سطر لحد 64 حرف.')}>
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label={t('فوق (تحت اسم المطعم)')}><Textarea rows={4} value={header} onChange={(e) => setHeader(e.target.value)} placeholder={t('العنوان، التليفون، الواتساب…')} data-fb="tpl:header" /></Field>
                <Field label={t('تحت (آخر الإيصال)')}><Textarea rows={4} value={footer} onChange={(e) => setFooter(e.target.value)} placeholder={t('شكرًا لزيارتكم…')} data-fb="tpl:footer" /></Field>
              </div>
              <Field label={t('مقاس ورق الإيصال')} className="mt-3"><SegmentedControl value={d.paper} onChange={(v) => setD({ ...d, paper: v })} options={[{ id: '80MM', label: t('80 مم'), fb: 'tpl:paper:80' }, { id: '58MM', label: t('58 مم'), fb: 'tpl:paper:58' }]} /></Field>
            </Card>
            <PolicyCards />
          </div>
          <div className="space-y-3">
            <div className="text-sm font-bold text-soft">{t('معاينة على الهوا (بالقالب اللي بتعدّله)')}</div>
            <SampleReceipt tpl={draft} />
          </div>
          <div className="@5xl/main:col-span-2 space-y-2">
            <div className="text-sm font-bold text-soft">{t('صفحة A4 (نفس القالب على التقارير والفواتير)')}</div>
            <div className="overflow-x-auto pb-2"><div style={{ transform: 'scale(0.7)', transformOrigin: 'top right', width: '210mm', height: 'calc(297mm * 0.7)' }}><SampleA4 tpl={draft} /></div></div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Second language and short number: venue policies (Settings.UpdatePolicy — a sensitive change may need a manager). */
function PolicyCards() {
  const { run, busy } = useCommand();
  const lang = useQuery<any>('Settings.Effective', { query: { policyId: 'SecondLanguagePolicy', scopeType: 'TENANT', scopeId: 'biz' } });
  const num = useQuery<any>('Settings.Effective', { query: { policyId: 'ShortOrderNumberPolicy', scopeType: 'TENANT', scopeId: 'biz' } });
  const lv = lang.data?.value ?? { receipt: false, kitchen: false, menu: false };
  const nv = num.data?.value ?? { mode: 'OFF', every: 100 };
  const [every, setEvery] = useState<string>('');
  const setPol = async (policyId: string, value: any, msg: string) => { const r = await run('Settings.UpdatePolicy', { params: { policyId }, body: { scopeType: 'TENANT', scopeId: 'biz', state: 'SET', value } }, { success: msg }); if (r) { lang.refetch(); num.refetch(); } };
  return (
    <>
      <Card title={<span className="flex items-center gap-2"><Languages className="w-4 h-4 text-[var(--primary)]" />{t('اللغة التانية')}</span>} badge={<StateBadge state="PROPOSED" />}
        description={t('الاسم الإنجليزي بيتطبع تحت العربي — بس للأصناف اللي ليها اسم تاني متسجل. مفيش ترجمة أوتوماتيك.')}>
        <div className="grid sm:grid-cols-3 gap-3">
          {([['receipt', t('على إيصال الزبون')], ['kitchen', t('على تذكرة المطبخ')], ['menu', t('في أزرار المنيو')]] as const).map(([k, label]) => (
            <div key={k} className="rounded-xl surface-1 px-3 py-2.5 flex items-center justify-between gap-2" data-fb={`tpl:lang2:${k}`}><span className="text-sm font-bold">{label}</span><Switch checked={!!lv[k]} disabled={busy || !lang.data} onChange={(v) => setPol('SecondLanguagePolicy', { ...lv, [k]: v }, t('اتحفظ — هيطبق على اللي جاي'))} /></div>
          ))}
        </div>
      </Card>
      <Card title={<span className="flex items-center gap-2"><Hash className="w-4 h-4 text-[var(--primary)]" />{t('رقم النداء القصير')}</span>} badge={<StateBadge state="PROPOSED" />}
        description={t('رقم صغير للنداء على الزبون والمطبخ (1، 2، 3…) بيظهر كبير على الإيصال وتذكرة المطبخ. رقم العملية الأصلي ثابت، ومستحيل يتغير، وبيتطبع دايمًا.')}>
        <div className="flex items-end gap-3 flex-wrap">
          <SegmentedControl value={nv.mode} onChange={(m) => setPol('ShortOrderNumberPolicy', { ...nv, mode: m }, t('رقم النداء اتحفظ — هيطبق على الطلبات الجديدة'))}
            options={[{ id: 'OFF', label: t('مقفول'), fb: 'tpl:shortno:OFF' }, { id: 'DAILY', label: t('من 1 كل يوم'), fb: 'tpl:shortno:DAILY' }, { id: 'EVERY_N', label: t('يرجع لـ 1 كل كام طلب'), fb: 'tpl:shortno:EVERY_N' }]} />
          {nv.mode === 'EVERY_N' && (
            <div className="flex items-end gap-2">
              <Field label={t('كل كام طلب')}><Input className="!w-24 num" inputMode="numeric" value={every || String(nv.every ?? 100)} onChange={(e) => setEvery(e.target.value.replace(/[^0-9]/g, ''))} /></Field>
              <Button size="sm" disabled={busy || !every || Number(every) < 10} onClick={() => setPol('ShortOrderNumberPolicy', { ...nv, every: Number(every) }, t('اتحفظ'))}>{t('احفظ')}</Button>
            </div>
          )}
        </div>
        <Banner tone="info" className="mt-3">{t('رقم العملية بيفضل مطبوع على الإيصال دايمًا — ده اللي بيتبعت لمنظومة الضرايب وبيربط كل حاجة ببعض.')}</Banner>
      </Card>
    </>
  );
}

const SAMPLE = [
  { q: '2', ar: 'شاي', en: 'Tea', price: '30.00' },
  { q: '1', ar: 'كفتة مشوية', en: 'Grilled kofta', price: '185.00' },
  { q: '1', ar: 'سلطة بلدي', en: null, price: '35.00' },
];
function SampleReceipt({ tpl }: { tpl: DocTemplateView }) {
  const lang = useQuery<any>('Settings.Effective', { query: { policyId: 'SecondLanguagePolicy', scopeType: 'TENANT', scopeId: 'biz' } });
  const num = useQuery<any>('Settings.Effective', { query: { policyId: 'ShortOrderNumberPolicy', scopeType: 'TENANT', scopeId: 'biz' } });
  const l2 = !!lang.data?.value?.receipt;
  const shortOn = num.data?.value?.mode && num.data.value.mode !== 'OFF';
  return (
    <ReceiptPaper paper={tpl.paper} fb="tpl:preview">
      <DocHeader template={{ ...tpl, logoDataUrl: tpl.logoOnReceipt !== false ? tpl.logoDataUrl : null }} title={tpl.business?.nameAr || tpl.business?.name || t('اسم المطعم')} sub={tpl.branch?.name} />
      <div className="my-2 border-t border-dashed border-black/60" />
      {shortOn && <ShortNumber value="17" />}
      <div className="flex justify-between"><span>{t('رقم العملية')}</span><span className="num">0342</span></div>
      <div className="my-2 border-t border-dashed border-black/60" />
      {SAMPLE.map((x, i) => <div key={i} className="flex justify-between gap-2"><span><span className="num">{x.q}×</span> {x.ar}{l2 && <SecondName text={x.en} className="ps-5" />}</span><span className="num">{x.price}</span></div>)}
      <div className="my-2 border-t border-black/60" />
      <div className="flex justify-between font-bold text-base"><span>{t('الإجمالي')}</span><span className="num">250.00</span></div>
      <div className="my-2 border-t border-dashed border-black/60" />
      <DocFooter lines={tpl.footerLines} />
      <Tech><div className="num text-[9px] text-center mt-1">template v{tpl.version}</div></Tech>
    </ReceiptPaper>
  );
}
function SampleA4({ tpl }: { tpl: DocTemplateView }) {
  return (
    <A4Page template={tpl} venueName={tpl.business?.nameAr || tpl.business?.name || t('اسم المطعم')} branchName={tpl.branch?.name} title={t('تقرير مبيعات اليوم (مثال)')}
      meta={<><div>{t('من')} <span className="num">2026-10-31</span> {t('لحد')} <span className="num">2026-11-01</span></div><div><Pill tone="warning">{t('مبدئي')}</Pill></div></>}>
      <table className="w-full text-[13px] border-collapse"><tbody>
        {[[t('عدد الطلبات'), '128'], [t('صافي المبيعات'), '41,250.00'], [t('الخدمة'), '3,980.00'], [t('ضريبة القيمة المضافة'), '6,332.50']].map(([k, v]) => <tr key={k} className="border-b border-black/15"><td className="py-1.5">{k}</td><td className="py-1.5 text-end num">{v}</td></tr>)}
      </tbody></table>
    </A4Page>
  );
}
