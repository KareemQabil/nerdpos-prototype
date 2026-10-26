// Delivery zones: areas (أحياء) per zone with fee, minimum order and estimated time, on a simple map; plus the
// delivery rules (fee taxable, late threshold, driver limits).
import React, { useState } from 'react';
import { Map as MapIcon, Plus, Pencil, X, MapPin } from 'lucide-react';
import { useDev, useQuery, useCommand } from '../../app/hooks';
import { Section, StateBadge, Button, Card, Pill, Money, Modal, Field, Input, Switch, Banner, Spinner, Table } from '../../ui';
import { t, L } from '../../i18n';
import { cn, money } from '../../lib/format';
import { MiniMap } from './common';
import { PolicyCard } from '../customers/PolicyCard';

const COLORS = ['#22d3ee', '#a78bfa', '#34d399', '#f59e0b', '#f472b6', '#60a5fa', '#facc15', '#fb7185'];

export default function Zones() {
  const { can } = useDev();
  const q = useQuery<any>('DeliveryZone.List', { query: {} });
  const [edit, setEdit] = useState<any>(null);
  const [sel, setSel] = useState<string | null>(null);
  const zones: any[] = q.data?.items ?? [];
  return (
    <div data-screen="DL5" className="space-y-4">
      <Section title={t('مناطق التوصيل')} badge={<StateBadge ops={['DeliveryZone.Upsert', 'DeliveryZone.List']} />}
        sub={t('كل منطقة ليها أحياء، ورسوم توصيل، وأقل طلب، ووقت وصول متوقع. عنوان العميل بيتربط بالمنطقة من الحي.')}
        actions={can('delivery:configure') && <Button variant="primary" onClick={() => setEdit({})} data-fb="zone-new"><Plus className="w-4 h-4" />{t('منطقة جديدة')}</Button>} />
      {q.loading && !zones.length && <Spinner />}
      <div className="grid lg:grid-cols-[1.1fr_1fr] gap-4">
        <Card title={<span className="flex items-center gap-2"><MapIcon className="w-4 h-4" />{t('الخريطة')}</span>}>
          <MiniMap zones={zones} restaurant={q.data?.restaurant} height={360} selectedZone={sel} onZone={(z) => setSel(z.id)} />
          <div className="text-[11px] text-dim mt-2">{t('رسم تقريبي للمناطق حوالين المطعم — دوس على منطقة عشان تشوف تفاصيلها.')}</div>
        </Card>
        <div className="space-y-2">
          {zones.map((z) => (
            <div key={z.id} onClick={() => setSel(z.id)} className={cn('glass rounded-xl p-3 border-2 cursor-pointer', sel === z.id ? 'border-[var(--primary)]' : 'border-transparent', !z.active && 'opacity-60')} data-fb={`zone:${z.id}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="font-bold flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ background: z.color }} />{L(z.name)}{!z.active && <Pill tone="neutral">{t('واقف')}</Pill>}</div>
                {can('delivery:configure') && <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setEdit(z); }}><Pencil className="w-3.5 h-3.5" />{t('تعديل')}</Button>}
              </div>
              <div className="grid grid-cols-3 gap-2 mt-2 text-center">
                <div className="rounded-lg surface-1 py-1"><div className="text-[10px] text-dim">{t('رسوم التوصيل')}</div><Money v={z.fee} className="text-sm" /></div>
                <div className="rounded-lg surface-1 py-1"><div className="text-[10px] text-dim">{t('أقل طلب')}</div><Money v={z.minOrder} className="text-sm" /></div>
                <div className="rounded-lg surface-1 py-1"><div className="text-[10px] text-dim">{t('الوقت المتوقع')}</div><b className="num text-sm">{z.etaMinutes} {t('د')}</b></div>
              </div>
              <div className="flex flex-wrap gap-1 mt-2">{z.areas.map((a: string) => <Pill key={a} tone="neutral"><MapPin className="w-3 h-3" />{a}</Pill>)}</div>
              <div className="text-[11px] text-dim mt-1.5">{t('{c} عميل ساكن هنا', { c: z.customers })} · {t('{a} طلب مفتوح', { a: z.activeDeliveries })} · {t('{d} طلب اتوصل', { d: z.deliveredTotal })}</div>
            </div>
          ))}
        </div>
      </div>
      <PolicyCard policyId="DeliveryPolicy" title={t('قواعد التوصيل')} explain={(v) => t('مثال: طلب وقته المتوقع 30 دقيقة بيبقى "متأخر" بعد {m} دقيقة. الطيار ميشيلش أكتر من {n} طلبات في نفس الوقت.', { m: 30 + Number(v.graceMinutes ?? 0), n: v.maxActivePerDriver ?? 3 })} />
      {edit && <ZoneDialog z={edit} count={zones.length} onClose={() => setEdit(null)} />}
    </div>
  );
}

function ZoneDialog({ z, count, onClose }: { z: any; count: number; onClose: () => void }) {
  const { run, busy } = useCommand();
  const isNew = !z.id;
  const [f, setF] = useState({ nameAr: z.name?.ar ?? '', nameEn: z.name?.en ?? '', fee: z.fee ? money(z.fee, false).replace(/,/g, '') : '20', minOrder: z.minOrder ? money(z.minOrder, false).replace(/,/g, '') : '150', etaMinutes: String(z.etaMinutes ?? 45), active: z.active ?? true, color: z.color ?? COLORS[count % COLORS.length] });
  const [areas, setAreas] = useState<string[]>(z.areas ?? []);
  const [area, setArea] = useState('');
  const addArea = () => { const a = area.trim(); if (a && !areas.includes(a)) setAreas([...areas, a]); setArea(''); };
  const save = async () => {
    const r = await run('DeliveryZone.Upsert', { params: { zoneId: z.id ?? 'new' }, body: { name: { ar: f.nameAr, en: f.nameEn || f.nameAr }, areas, fee: f.fee, minOrder: f.minOrder, etaMinutes: Number(f.etaMinutes), active: f.active, color: f.color, expectedVersion: z.version } }, { success: t('المنطقة اتحفظت') });
    if (r) onClose();
  };
  return (
    <Modal open onClose={onClose} wide title={isNew ? t('منطقة توصيل جديدة') : `${t('تعديل')} ${L(z.name)}`} badge={<StateBadge ops={['DeliveryZone.Upsert']} />}
      footer={<><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" loading={busy} disabled={!f.nameAr.trim() || !areas.length} onClick={save} data-fb="zone-save">{t('حفظ')}</Button></>}>
      <div className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-2">
          <Field label={t('اسم المنطقة')}><Input value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} /></Field>
          <Field label={t('الاسم بالإنجليزي')}><Input value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} dir="ltr" /></Field>
          <Field label={t('رسوم التوصيل (ج.م)')}><Input value={f.fee} onChange={(e) => setF({ ...f, fee: e.target.value.replace(/[^0-9.]/g, '') })} inputMode="decimal" className="num" /></Field>
          <Field label={t('أقل طلب (ج.م)')}><Input value={f.minOrder} onChange={(e) => setF({ ...f, minOrder: e.target.value.replace(/[^0-9.]/g, '') })} inputMode="decimal" className="num" /></Field>
          <Field label={t('الوقت المتوقع (دقيقة)')}><Input value={f.etaMinutes} onChange={(e) => setF({ ...f, etaMinutes: e.target.value.replace(/[^0-9]/g, '') })} inputMode="numeric" className="num" /></Field>
          <Field label={t('اللون على الخريطة')}><div className="flex gap-1.5 flex-wrap">{COLORS.map((c) => <button key={c} type="button" onClick={() => setF({ ...f, color: c })} className={cn('w-7 h-7 rounded-full border-2', f.color === c ? 'border-white' : 'border-transparent')} style={{ background: c }} />)}</div></Field>
        </div>
        <Field label={t('الأحياء')} hint={t('الحي ميتكررش في منطقتين شغالين')}>
          <div className="flex gap-2"><Input value={area} onChange={(e) => setArea(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addArea(); } }} placeholder={t('اكتب اسم الحي واضغط إضافة')} data-fb="zone-area" /><Button onClick={addArea}><Plus className="w-4 h-4" />{t('إضافة')}</Button></div>
        </Field>
        <div className="flex flex-wrap gap-1.5">{areas.map((a) => <span key={a} className="inline-flex items-center gap-1 px-2.5 h-8 rounded-lg surface-2 text-sm">{a}<button onClick={() => setAreas(areas.filter((x) => x !== a))} className="text-dim hover:text-[var(--error)]"><X className="w-3.5 h-3.5" /></button></span>)}</div>
        <Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} label={t('التوصيل للمنطقة دي شغال')} />
      </div>
    </Modal>
  );
}
