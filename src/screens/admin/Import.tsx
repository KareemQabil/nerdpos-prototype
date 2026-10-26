// B5 Menu import: upload a sheet (parsed in the browser with SheetJS) → dry-run report per sheet/row/field → apply all-or-nothing.
import { saveFile } from '../../lib/files';
import React, { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { Download, FileSpreadsheet, FlaskConical, Upload, CheckCircle2, XCircle, PlayCircle, Bug, Trash2 } from 'lucide-react';
import { useCommand, useDev, errorText } from '../../app/hooks';
import { ApiFailure } from '../../api/client';
import { Banner, Button, Card, Empty, Pill, Section, StateBadge, Table, Tabs, toast } from '../../ui';
import { t } from '../../i18n';
import { cn } from '../../lib/format';
import { useItems } from './catalog/common';
import { Tech } from '../../app/tech';

// Columns exactly as importCatalog (mock/handlers/catalog.ts) reads them.
const SHEETS = {
  units: ['code', 'precision'],
  categories: ['key', 'name_ar', 'name_en', 'color'],
  modifierGroups: ['key', 'name_ar', 'name_en', 'min', 'max', 'selection'],
  modifierOptions: ['group', 'name_ar', 'name_en', 'priceDelta'],
  products: ['key', 'name_ar', 'name_en', 'category', 'unit', 'sku', 'tax', 'modifier_groups', 'color', 'image'],
  prices: ['product', 'branch', 'channel', 'amount', 'variant'],
  availability: ['product', 'branch', 'state', 'reason'],
  // menu area (proposed sheets)
  variants: ['product', 'key', 'name_ar', 'name_en', 'price_delta', 'multiplier', 'sku', 'barcode', 'default'],
  comboSlots: ['product', 'slot', 'name_ar', 'name_en', 'required'],
  comboOptions: ['product', 'slot', 'option_product', 'variant', 'upcharge', 'default', 'sub_group'],
  dayparts: ['key', 'name_ar', 'name_en', 'start', 'end', 'days'],
  menus: ['key', 'name_ar', 'name_en', 'channels', 'dayparts', 'all_categories', 'categories', 'exclude_categories'],
} as const;
type SheetId = keyof typeof SHEETS;
const SHEET_IDS = Object.keys(SHEETS) as SheetId[];
const sheetLabel = (s: string) => ({ units: t('الوحدات'), categories: t('الأقسام'), modifierGroups: t('مجموعات الإضافات'), modifierOptions: t('اختيارات الإضافات'), products: t('الأصناف'), prices: t('الأسعار'), availability: t('التوفر'), variants: t('الأحجام'), comboSlots: t('اختيارات الوجبات'), comboOptions: t('أصناف الوجبات'), dayparts: t('فترات اليوم'), menus: t('المنيوهات') } as Record<string, string>)[s] ?? s;

type Row = Record<string, string>;
type Data = Partial<Record<SheetId, Row[]>>;
interface Issue { sheet: string; row: number; field: string; code: string; message: string }
interface Report { kind: 'DRY_RUN' | 'APPLIED' | 'REFUSED'; ok: boolean; issues: Issue[]; summary: Record<string, number>; keyMap?: Record<string, string>; at: number }

const EXAMPLE: Record<SheetId, Row> = {
  units: { code: 'KG', precision: '3' },
  categories: { key: 'grill', name_ar: 'مشويات', name_en: 'Grill', color: '#f97316' },
  modifierGroups: { key: 'spice', name_ar: 'درجة الحرارة', name_en: 'Spice level', min: '1', max: '1', selection: 'SINGLE' },
  modifierOptions: { group: 'spice', name_ar: 'حار', name_en: 'Hot', priceDelta: '0' },
  products: { key: 'kofta', name_ar: 'كفتة حاتي', name_en: 'Hati kofta', category: 'grill', unit: 'DEMO_EA', sku: 'GRL-001', tax: 'tax_demo', modifier_groups: 'spice', color: '#f97316', image: '' },
  prices: { product: 'kofta', branch: 'DEMO-MAIN', channel: 'DINE_IN', amount: '185.00' },
  availability: { product: 'kofta', branch: 'DEMO-MAIN', state: 'AVAILABLE', reason: '' },
  variants: { product: 'mango', key: 'v_l', name_ar: 'كبير', name_en: 'Large', price_delta: '15', multiplier: '1', sku: 'MANGO-L', barcode: '', default: '' },
  comboSlots: { product: 'kofta_meal', slot: 'drink', name_ar: 'المشروب', name_en: 'Drink', required: 'yes' },
  comboOptions: { product: 'kofta_meal', slot: 'drink', option_product: 'mango', variant: '', upcharge: '0', default: 'yes', sub_group: '' },
  dayparts: { key: 'dp_late', name_ar: 'سهرة', name_en: 'Late night', start: '22:00', end: '03:00', days: '4;5' },
  menus: { key: 'menu_late', name_ar: 'منيو السهرة', name_en: 'Late menu', channels: 'DINE_IN;TAKEAWAY', dayparts: 'dp_late', all_categories: '', categories: 'juices', exclude_categories: '' },
};

function sampleValid(n: number): Data {
  const sfx = n > 1 ? ` ${n}` : '';
  const k = n > 1 ? `-${n}` : '';
  return {
    units: [{ code: 'KG', precision: '3' }],
    categories: [{ key: 'grill', name_ar: 'مشويات' + sfx, name_en: 'Grill' + sfx, color: '#f97316' }, { key: 'juices', name_ar: 'عصاير فريش' + sfx, name_en: 'Fresh juices' + sfx, color: '#84cc16' }],
    modifierGroups: [{ key: 'spice', name_ar: 'درجة الحرارة', name_en: 'Spice level', min: '1', max: '1', selection: 'SINGLE' }, { key: 'sides', name_ar: 'إضافات جانبية', name_en: 'Sides', min: '0', max: '3', selection: 'MULTIPLE' }],
    modifierOptions: [
      { group: 'spice', name_ar: 'عادي', name_en: 'Mild', priceDelta: '0' }, { group: 'spice', name_ar: 'حار', name_en: 'Hot', priceDelta: '0' },
      { group: 'sides', name_ar: 'رز بسمتي', name_en: 'Basmati rice', priceDelta: '15' }, { group: 'sides', name_ar: 'بطاطس', name_en: 'Fries', priceDelta: '20' }, { group: 'sides', name_ar: 'سلطة طحينة', name_en: 'Tahini salad', priceDelta: '10' },
    ],
    products: [
      { key: 'kofta', name_ar: 'كفتة حاتي' + sfx, name_en: 'Hati kofta' + sfx, category: 'grill', unit: 'DEMO_EA', sku: 'IMP-KOFTA' + k, tax: 'tax_demo', modifier_groups: 'spice;sides', color: '#f97316' },
      { key: 'tawook', name_ar: 'شيش طاووق' + sfx, name_en: 'Shish tawook' + sfx, category: 'grill', unit: 'DEMO_EA', sku: 'IMP-TAWOOK' + k, tax: 'tax_demo', modifier_groups: 'spice;sides', color: '#fb923c' },
      { key: 'lamb', name_ar: 'ريش ضاني بالكيلو' + sfx, name_en: 'Lamb chops per kg' + sfx, category: 'grill', unit: 'KG', sku: 'IMP-LAMB' + k, tax: 'tax_demo', modifier_groups: 'sides', color: '#dc2626' },
      { key: 'mango', name_ar: 'عصير مانجا' + sfx, name_en: 'Mango juice' + sfx, category: 'juices', unit: 'DEMO_EA', sku: 'IMP-MANGO' + k, tax: 'tax_demo', color: '#facc15' },
      { key: 'cane', name_ar: 'عصير قصب' + sfx, name_en: 'Sugarcane juice' + sfx, category: 'juices', unit: 'DEMO_EA', sku: 'IMP-CANE' + k, tax: 'tax_demo', color: '#a3e635' },
      { key: 'kofta_meal', name_ar: 'وجبة كفتة' + sfx, name_en: 'Kofta meal' + sfx, category: 'grill', unit: 'DEMO_EA', sku: 'IMP-KMEAL' + k, tax: 'tax_demo', color: '#ea580c' },
    ],
    prices: [
      { product: 'kofta', branch: 'DEMO-MAIN', channel: 'DINE_IN', amount: '185' }, { product: 'kofta', branch: 'DEMO-MAIN', channel: 'TAKEAWAY', amount: '175' },
      { product: 'tawook', branch: 'DEMO-MAIN', channel: 'DINE_IN', amount: '165' }, { product: 'tawook', branch: 'DEMO-MAIN', channel: 'TAKEAWAY', amount: '155' },
      { product: 'lamb', branch: 'DEMO-MAIN', channel: 'DINE_IN', amount: '950.50' },
      { product: 'mango', branch: 'DEMO-MAIN', channel: 'DINE_IN', amount: '55' }, { product: 'mango', branch: 'DEMO-MAIN', channel: 'TAKEAWAY', amount: '50' },
      { product: 'cane', branch: 'DEMO-MAIN', channel: 'DINE_IN', amount: '25' },
      { product: 'mango', branch: 'DEMO-MAIN', channel: 'DINE_IN', amount: '75', variant: 'v_l' },
      { product: 'kofta_meal', branch: 'DEMO-MAIN', channel: 'DINE_IN', amount: '230' }, { product: 'kofta_meal', branch: 'DEMO-MAIN', channel: 'TAKEAWAY', amount: '220' },
    ],
    availability: [{ product: 'mango', branch: 'DEMO-MAIN', state: 'SOLD_OUT', reason: 'المانجا خلصت النهارده' }, { product: 'cane', branch: 'DEMO-MAIN', state: 'BLOCKED', reason: 'المكنة في الصيانة' }],
    variants: [
      { product: 'mango', key: 'v_m', name_ar: 'وسط', name_en: 'Medium', price_delta: '0', multiplier: '1', sku: 'IMP-MANGO-M' + k, default: 'yes' },
      { product: 'mango', key: 'v_l', name_ar: 'كبير', name_en: 'Large', price_delta: '15', multiplier: '1', sku: 'IMP-MANGO-L' + k },
    ],
    comboSlots: [
      { product: 'kofta_meal', slot: 'main', name_ar: 'الطبق', name_en: 'Main', required: 'yes' },
      { product: 'kofta_meal', slot: 'drink', name_ar: 'المشروب', name_en: 'Drink', required: 'yes' },
    ],
    comboOptions: [
      { product: 'kofta_meal', slot: 'main', option_product: 'kofta', upcharge: '0', default: 'yes', sub_group: 'spice' },
      { product: 'kofta_meal', slot: 'main', option_product: 'tawook', upcharge: '0' },
      { product: 'kofta_meal', slot: 'drink', option_product: 'cane', upcharge: '0', default: 'yes' },
      { product: 'kofta_meal', slot: 'drink', option_product: 'mango', variant: 'v_l', upcharge: '25' },
    ],
    dayparts: [{ key: 'dp_late', name_ar: 'سهرة', name_en: 'Late night', start: '22:00', end: '03:00', days: '4;5' }],
    menus: [{ key: 'menu_late', name_ar: 'منيو السهرة', name_en: 'Late menu', channels: 'DINE_IN;TAKEAWAY', dayparts: 'dp_late', categories: 'juices' }],
  };
}

const SAMPLE_ERRORS: Data = {
  units: [{ code: '', precision: '2' }],
  categories: [{ key: 'bakery', name_ar: 'مخبوزات', name_en: '' }],
  modifierGroups: [{ key: 'extras', name_ar: 'إضافات', name_en: 'Extras', min: '3', max: '1', selection: 'MULTIPLE' }],
  modifierOptions: [{ group: 'ghost_group', name_ar: 'جبنة', name_en: 'Cheese', priceDelta: 'عشرة' }],
  products: [
    { key: 'croissant', name_ar: 'كرواسون', name_en: 'Croissant', category: 'pastry', unit: 'BOX', sku: 'DEMO-TEA', tax: 'tax_missing', modifier_groups: 'extras;ghost' },
    { key: 'tea2', name_ar: 'شاي', name_en: 'Tea', category: 'bakery', unit: 'DEMO_EA', tax: 'tax_demo' },
  ],
  prices: [
    { product: 'croissant', branch: 'DEMO-MAIN', channel: 'DRIVE_THRU', amount: '45' },
    { product: 'tea2', branch: 'NOPE', channel: 'DINE_IN', amount: '12.34567' },
    { product: 'ghost', branch: 'DEMO-MAIN', channel: 'TAKEAWAY', amount: '30' },
  ],
  availability: [{ product: 'tea2', branch: 'DEMO-MAIN', state: 'BLOCKED', reason: '' }, { product: 'croissant', branch: 'DEMO-MAIN', state: 'GONE', reason: '' }],
};

function downloadTemplate() {
  const wb = XLSX.utils.book_new();
  const readme = [
    ['NerdPOS — قالب استيراد المنيو / Menu import template'],
    [''],
    ['الشيت', 'الأعمدة', 'ملاحظات'],
    ['units', SHEETS.units.join(', '), 'precision = عدد الخانات العشرية للكمية (0 للقطعة، 3 للكيلو)'],
    ['categories', SHEETS.categories.join(', '), 'key = مفتاح بتستخدمه في شيت الأصناف'],
    ['modifierGroups', SHEETS.modifierGroups.join(', '), 'selection = SINGLE أو MULTIPLE؛ min <= max'],
    ['modifierOptions', SHEETS.modifierOptions.join(', '), 'group = مفتاح المجموعة؛ priceDelta ممكن بالسالب'],
    ['products', SHEETS.products.join(', '), 'sku فاضي = أوتوماتيك لو SkuGenerationPolicy = AUTO_IF_EMPTY؛ modifier_groups مفصولة بـ ;'],
    ['prices', SHEETS.prices.join(', '), 'branch = كود الفرع (DEMO-MAIN)؛ channel = DINE_IN / TAKEAWAY / DELIVERY؛ amount لحد 4 خانات عشرية'],
    ['availability', SHEETS.availability.join(', '), 'state = AVAILABLE / SOLD_OUT / BLOCKED؛ السبب مطلوب حسب AvailabilityReasonPolicy'],
    ['variants', SHEETS.variants.join(', '), 'أحجام الصنف: key كود الحجم (v_l)، price_delta فرق السعر، multiplier مضاعف الإضافات، default = yes للحجم الافتراضي. سعر خاص للحجم: عمود variant في شيت prices'],
    ['comboSlots', SHEETS.comboSlots.join(', '), 'اختيارات الوجبة (الساندوتش، المشروب…): product مفتاح الوجبة، slot كود الاختيار'],
    ['comboOptions', SHEETS.comboOptions.join(', '), 'أصناف كل اختيار: option_product الصنف، variant حجمه (اختياري)، upcharge فرق الترقية، default = yes، sub_group مجموعة إضافات تتسأل'],
    ['dayparts', SHEETS.dayparts.join(', '), 'فترات اليوم بتوقيت القاهرة 07:00؛ النهاية قبل البداية = بتعدي نص الليل؛ days أرقام 0 (الحد) لـ 6 مفصولة بـ ;'],
    ['menus', SHEETS.menus.join(', '), 'المنيوهات: channels و dayparts و categories مفصولة بـ ;؛ all_categories = yes لكل الأقسام'],
    [''],
    ['الاستيراد كله أو لا شيء: لو فيه أي غلطة مفيش حاجة بتتكتب. جرّب الأول (Dry run).'],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(readme), 'README');
  for (const s of SHEET_IDS) {
    const cols = SHEETS[s] as readonly string[];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([cols as string[], cols.map((c) => EXAMPLE[s][c] ?? '')]), s);
  }
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  saveFile('nerdpos-menu-template.xlsx', buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').catch(() => toast('error', t('حفظ الملفات مش متاح هنا')));
}

/** Workbook → known sheets. A CSV has one sheet: its name comes from the file name (e.g. products.csv). */
function readWorkbook(wb: XLSX.WorkBook, fileName: string, warnings: string[]): Data {
  const out: Data = {};
  const base = fileName.replace(/\.[^.]+$/, '').toLowerCase();
  const isCsv = /\.csv$/i.test(fileName);
  for (const name of wb.SheetNames) {
    const target = isCsv ? base : name.toLowerCase();
    const id = SHEET_IDS.find((s) => s.toLowerCase() === target || target.endsWith(s.toLowerCase()));
    if (!id) { if (name !== 'README') warnings.push(t('الشيت "{s}" مش معروف — اتجاهل (الأسماء المعروفة: {list})', { s: isCsv ? fileName : name, list: SHEET_IDS.join(', ') })); continue; }
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name], { defval: '', raw: true });
    const known = SHEETS[id] as readonly string[];
    const headers = Object.keys(raw[0] ?? {});
    const unknown = headers.filter((h) => !known.includes(h.trim()));
    if (unknown.length) warnings.push(t('شيت {s}: أعمدة مش معروفة هتتجاهل: {c}', { s: id, c: unknown.join(', ') }));
    const rows = raw.map((r) => {
      const o: Row = {};
      for (const [k, v] of Object.entries(r)) { const key = k.trim(); const val = String(v ?? '').trim(); if (known.includes(key) && val !== '') o[key] = val; }
      return o;
    }).filter((r) => Object.keys(r).length > 0);
    out[id] = [...(out[id] ?? []), ...rows];
  }
  return out;
}

export default function Import() {
  const { nav } = useDev();
  const { run, busy } = useCommand();
  const existing = useItems<any>('Catalog.Search');
  const [data, setData] = useState<Data | null>(null);
  const [source, setSource] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [view, setView] = useState<SheetId>('products');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = (d: Data, label: string, w: string[] = []) => { setData(d); setSource(label); setWarnings(w); setReport(null); const first = SHEET_IDS.find((s) => d[s]?.length); if (first) setView(first); };
  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const w: string[] = [];
    let merged: Data = {};
    for (const f of Array.from(files)) {
      try {
        const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
        const d = readWorkbook(wb, f.name, w);
        for (const s of SHEET_IDS) if (d[s]) merged = { ...merged, [s]: [...(merged[s] ?? []), ...d[s]!] };
      } catch (e) {
        w.push(t('الملف {f} مش مقروء: {e}', { f: f.name, e: String((e as Error).message ?? e) }));
      }
    }
    load(merged, Array.from(files).map((f) => f.name).join('، '), w);
    if (fileRef.current) fileRef.current.value = '';
  };
  const loadValidSample = () => {
    const n = 1 + existing.items.filter((p) => /^IMP-KOFTA(-\d+)?$/.test(p.sku)).length;
    load(sampleValid(n), t('عينة منيو سليمة'));
  };

  const body = (dryRun: boolean) => ({ dryRun, ...Object.fromEntries(SHEET_IDS.filter((s) => data?.[s]?.length).map((s) => [s, data![s]])) });
  const dryRun = async () => {
    // every dry run / apply carries a fresh X-Command-Id (useCommand default)
    try {
      const r = await run<any>('Catalog.Import', { body: body(true) }, { quiet: true });
      if (r) { setReport({ kind: 'DRY_RUN', ok: r.ok, issues: r.issues, summary: r.summary, at: Date.now() }); toast(r.ok ? 'success' : 'warning', r.ok ? t('التجربة نجحت — مفيش غلطات') : t('التجربة لقت {n} غلطة', { n: r.issues.length }), 'Catalog.Import dryRun:true'); }
    } catch (e) { toast('error', errorText(e), (e as any).code); }
  };
  const apply = async () => {
    try {
      const r = await run<any>('Catalog.Import', { body: body(false) }, { quiet: true });
      if (r) { setReport({ kind: 'APPLIED', ok: true, issues: [], summary: r.summary, keyMap: r.keyMap, at: Date.now() }); toast('success', t('المنيو اتستورد كله'), 'Catalog.Import dryRun:false'); }
    } catch (e) {
      if (e instanceof ApiFailure && e.code === 'VALIDATION_FAILED' && e.details?.issues) {
        setReport({ kind: 'REFUSED', ok: false, issues: e.details.issues, summary: e.details.summary ?? {}, at: Date.now() });
        toast('error', t('الاستيراد اترفض — مفيش حاجة اتكتبت (كله أو لا شيء)'), `VALIDATION_FAILED · ${e.status}`);
      } else toast('error', errorText(e), (e as any).code);
    }
  };

  const issuesBySheet = useMemo(() => {
    const m = new Map<string, Issue[]>();
    for (const i of report?.issues ?? []) m.set(i.sheet, [...(m.get(i.sheet) ?? []), i]);
    return m;
  }, [report]);
  const total = SHEET_IDS.reduce((a, s) => a + (data?.[s]?.length ?? 0), 0);

  return (
    <div>
      <Section title={t('استيراد المنيو')} badge={<StateBadge ops={['Catalog.Import']} />} sub={t('ارفع شيت المنيو (Excel أو CSV) — بيتقري في المتصفح، تجرّبه الأول وتشوف الغلطات صف صف، وبعدين تطبقه كله أو لا شيء')} />
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 mb-4">
        <Card><div className="flex flex-col gap-2 h-full">
          <div className="font-bold flex items-center gap-2"><Upload className="w-4 h-4" />{t('ارفع ملف')}</div>
          <div className="text-xs text-dim flex-1">{t('xlsx فيه شيتات بالأسماء المعروفة، أو ملفات CSV اسم كل ملف هو اسم الشيت (products.csv، prices.csv…)')}</div>
          <input ref={fileRef} type="file" multiple accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => onFiles(e.target.files)} />
          <Button data-fb="import:upload" variant="primary" onClick={() => fileRef.current?.click()}><FileSpreadsheet className="w-4 h-4" />{t('اختار ملف')}</Button>
        </div></Card>
        <Card><div className="flex flex-col gap-2 h-full">
          <div className="font-bold flex items-center gap-2"><Download className="w-4 h-4" />{t('القالب')}</div>
          <div className="text-xs text-dim flex-1">{t('ملف Excel فيه الشيتات والأعمدة بالظبط زي ما السيرفر بيقراها، وصف مثال في كل شيت')}</div>
          <Button data-fb="import:template" onClick={downloadTemplate}><Download className="w-4 h-4" />{t('نزّل القالب')}</Button>
        </div></Card>
        <Card><div className="flex flex-col gap-2 h-full">
          <div className="font-bold flex items-center gap-2"><FlaskConical className="w-4 h-4" />{t('عينة سليمة')}</div>
          <div className="text-xs text-dim flex-1">{t('منيو صغير: مشويات وعصاير، وحدة بالكيلو، إضافات، أسعار وتوفر')}</div>
          <Button data-fb="import:sample-valid" onClick={loadValidSample}>{t('حمّل العينة')}</Button>
        </div></Card>
        <Card><div className="flex flex-col gap-2 h-full">
          <div className="font-bold flex items-center gap-2"><Bug className="w-4 h-4" />{t('عينة فيها غلطات')}</div>
          <div className="text-xs text-dim flex-1">{t('وحدة ناقصة، قسم مش موجود، كود مستخدم، اسم متكرر، سعر مش رقم، قناة غلط، فرع مش موجود…')}</div>
          <Button data-fb="import:sample-errors" variant="warning" onClick={() => load(SAMPLE_ERRORS, t('عينة فيها غلطات'))}>{t('حمّل العينة')}</Button>
        </div></Card>
      </div>

      {!data ? <Card><Empty icon={<FileSpreadsheet className="w-10 h-10" />} text={t('مفيش ملف لسه — ارفع ملف أو حمّل عينة')} /></Card> : (
        <div className="space-y-4">
          <Card title={<span className="flex items-center gap-2"><FileSpreadsheet className="w-4 h-4" />{source}</span>} badge={<Pill tone="neutral">{t('{n} صف', { n: total })}</Pill>}
            actions={<>
              <Button size="sm" variant="ghost" onClick={() => { setData(null); setReport(null); }}><Trash2 className="w-3.5 h-3.5" />{t('شيل')}</Button>
              <Button data-fb="import:dry-run" loading={busy} onClick={dryRun}><PlayCircle className="w-4 h-4" />{t('جرّب من غير حفظ')}</Button>
              <Button data-fb="import:apply" variant={report?.kind === 'DRY_RUN' && report.ok ? 'success' : 'outline'} loading={busy} disabled={!report || report.kind === 'APPLIED'} onClick={apply}><CheckCircle2 className="w-4 h-4" />{t('طبّق الكل')}</Button>
            </>}>
            {warnings.map((w, i) => <div key={i} className="mb-2"><Banner tone="warning">{w}</Banner></div>)}
            {!report && <div className="text-xs text-dim mb-2">{t('لازم تجرّب الأول. التطبيق كله أو لا شيء.')}</div>}
            {report?.kind === 'DRY_RUN' && !report.ok && <div className="mb-2"><Banner tone="warning">{t('فيه غلطات في الشيت: لو طبقت دلوقتي هيترفض كله ومفيش حاجة هتتسجل. صلّح الغلطات اللي تحت وجرّب تاني.')}</Banner></div>}
            <Tabs<SheetId> value={view} onChange={setView} tabs={SHEET_IDS.map((s) => ({ id: s, label: <span className="inline-flex items-center gap-1.5">{sheetLabel(s)} <span className="num text-xs opacity-70">{data[s]?.length ?? 0}</span>{issuesBySheet.get(s)?.length ? <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold inline-flex items-center justify-center">{issuesBySheet.get(s)!.length}</span> : null}</span> }))} />
            <SheetPreview sheet={view} rows={data[view] ?? []} issues={issuesBySheet.get(view) ?? []} />
          </Card>
          {report && <ReportCard report={report} onOpenMenu={() => nav('menu')} />}
        </div>
      )}
    </div>
  );
}

function SheetPreview({ sheet, rows, issues }: { sheet: SheetId; rows: Row[]; issues: Issue[] }) {
  const cols = SHEETS[sheet] as readonly string[];
  const bad = (row: number, col: string) => issues.some((i) => i.row === row && (i.field === col || (i.field === 'name' && (col === 'name_ar' || col === 'name_en'))));
  const badRow = (row: number) => issues.some((i) => i.row === row);
  if (!rows.length) return <div className="text-sm text-dim py-4">{t('الشيت ده فاضي')}</div>;
  return (
    <div className="overflow-x-auto rounded-xl border line mt-3">
      <table className="w-full text-xs">
        <thead className="surface-1"><tr><th className="px-2 py-1.5 text-start text-soft">#</th>{cols.map((c) => <th key={c} className="px-2 py-1.5 text-start text-soft num">{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={cn('border-t line', badRow(i + 2) && 'bg-[color-mix(in_srgb,var(--error)_8%,transparent)]')}>
              <td className="px-2 py-1 num text-dim">{i + 2}</td>
              {cols.map((c) => <td key={c} className={cn('px-2 py-1 whitespace-nowrap', bad(i + 2, c) && 'text-[var(--error)] font-bold outline outline-1 outline-[var(--error)] rounded')}>{r[c] ?? ''}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-[11px] text-dim px-2 py-1">{t('رقم الصف زي Excel (الصف 1 هو العناوين)')}</div>
    </div>
  );
}

function ReportCard({ report, onOpenMenu }: { report: Report; onOpenMenu: () => void }) {
  const title = report.kind === 'APPLIED' ? t('اتطبق') : report.kind === 'REFUSED' ? t('اترفض — مفيش حاجة اتكتبت') : t('تقرير التجربة');
  const tone = report.kind === 'APPLIED' || report.ok ? 'success' : 'error';
  return (
    <Card title={<span className="flex items-center gap-2">{tone === 'success' ? <CheckCircle2 className="w-4 h-4 text-[var(--success)]" /> : <XCircle className="w-4 h-4 text-[var(--error)]" />}{title}</span>}
      badge={<Pill tone={report.kind === 'DRY_RUN' ? 'info' : tone}>{report.kind === 'DRY_RUN' ? t('تجربة من غير حفظ') : report.kind === 'APPLIED' ? t('اتحفظ') : t('ما اتحفظش')}</Pill>}
      actions={report.kind === 'APPLIED' ? <Button size="sm" variant="primary" onClick={onOpenMenu}>{t('افتح المنيو')}</Button> : undefined}>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {Object.entries(report.summary ?? {}).map(([k, v]) => <Pill key={k} tone="neutral">{sheetLabel(k)} <span className="num">{v}</span></Pill>)}
      </div>
      {report.issues.length > 0 ? (
        <Table head={[t('الشيت'), t('الصف'), t('العمود'), t('الكود'), t('المشكلة')]} rows={report.issues.map((i) => [
          sheetLabel(i.sheet), <span className="num">{i.row}</span>, <span className="num text-xs">{i.field}</span>, <Tech fallback={<span className="text-[11px] text-dim">—</span>}><span className="num text-[11px] text-[var(--error)]">{i.code}</span></Tech>, i.message,
        ])} />
      ) : report.kind === 'APPLIED'
        ? <Banner tone="success">{t('كل الصفوف اتكتبت في معاملة واحدة. الأصناف اللي ليها سعر في فرع بقت على منيو الفرع ده إلا لو شيت التوفر قال غير كده.')}</Banner>
        : <Banner tone="success">{t('مفيش غلطات — تقدر تطبق.')}</Banner>}
    </Card>
  );
}
