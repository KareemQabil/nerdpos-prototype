// Sizes of a product: name, code (SKU) and barcode per size, price difference or the size's own price per channel,
// add-on multiplier, calories, default size, order and on/off. Prices come from the server price list.
import React, { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Save, Ruler, Tag, Star } from 'lucide-react';
import { useCommand, useDev, useQuery } from '../../../app/hooks';
import { Banner, Button, Card, Field, Input, Modal, Money, Pill, StateBadge, Switch, Table } from '../../../ui';
import { Tech } from '../../../app/tech';
import { t, L } from '../../../i18n';
import { CHANNELS, LocInputs, channelLabel } from './common';

type Loc = { ar: string; en: string };
interface Draft { id: string; name: Loc; priceDelta: string; modifierMultiplier: string; active: boolean; sku: string; barcode: string; calories: string; isDefault: boolean; isNew?: boolean }

export function VariantsEditor({ p }: { p: any }) {
  const { run, busy } = useCommand();
  const { me, auth } = useDev();
  const branchId = me?.branchId ?? auth.branchId;
  const prices = useQuery<any>('Catalog.PriceList', { query: { branchId } });
  const row = (prices.data?.items ?? []).find((x: any) => x.productId === p.id);
  const [edit, setEdit] = useState<Draft | null>(null);
  const [own, setOwn] = useState<{ variant: any; channel: string; amount: string } | null>(null);
  const vs: any[] = [...(p.variants ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const base = (ch: string) => row?.prices?.[`${ch}:BASE`]?.current?.amount ?? null;
  const ownPrice = (vid: string, ch: string) => row?.prices?.[`${ch}:${vid}`]?.current?.amount ?? null;
  const save = async () => {
    if (!edit) return;
    const body: any = { name: edit.name, priceDelta: edit.priceDelta.trim() || '0', modifierMultiplier: edit.modifierMultiplier.trim() || '1', active: edit.active, sku: edit.sku.trim(), barcode: edit.barcode.trim(), calories: edit.calories.trim(), isDefault: edit.isDefault, attributes: [{ name: 'size', value: edit.name.en || edit.name.ar }], expectedVersion: p.version };
    const r = await run('Variant.Upsert', { params: { productId: p.id, variantId: edit.id }, body }, { success: edit.isNew ? t('الحجم اتضاف') : t('الحجم اتحفظ') });
    if (r) setEdit(null);
  };
  const move = async (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= vs.length) return;
    const a = vs[i], b = vs[j];
    const r1 = await run('Variant.Upsert', { params: { productId: p.id, variantId: a.id }, body: { sortOrder: b.sortOrder ?? (j + 1) * 10, attributes: a.attributes ?? [{ name: 'size', value: a.name.en }], active: a.active } });
    if (r1) await run('Variant.Upsert', { params: { productId: p.id, variantId: b.id }, body: { sortOrder: a.sortOrder ?? (i + 1) * 10, attributes: b.attributes ?? [{ name: 'size', value: b.name.en }], active: b.active } });
  };
  const setOwnPrice = async () => {
    if (!own) return;
    const r = await run('Catalog.SetPrice', { params: { productId: p.id }, body: { amount: own.amount.trim(), currency: 'EGP', branchId, channel: own.channel, variantId: own.variant.id } }, { success: t('سعر الحجم اتحفظ') });
    if (r) setOwn(null);
  };
  const newDraft = (): Draft => ({ id: 'v_' + Math.random().toString(36).slice(2, 7), name: { ar: '', en: '' }, priceDelta: '0', modifierMultiplier: '1', active: true, sku: p.sku ? `${p.sku}-` : '', barcode: '', calories: '', isDefault: !vs.length, isNew: true });
  return (
    <div className="space-y-4">
      <Card title={<span className="inline-flex items-center gap-2"><Ruler className="w-4 h-4" />{t('الأحجام')}</span>} badge={<StateBadge ops={['Variant.Upsert', 'Catalog.SetPrice']} />}
        actions={<Button size="sm" variant="primary" data-fb="variant:new" onClick={() => setEdit(newDraft())}><Plus className="w-3.5 h-3.5" />{t('حجم جديد')}</Button>}>
        <Table head={['', t('الحجم'), t('الكود والباركود'), ...CHANNELS.map((c) => channelLabel(c)), t('الإضافات'), t('الحالة'), '']} empty={t('مفيش أحجام — الصنف بسعر واحد')} rows={vs.map((v, i) => [
          <div className="flex flex-col"><button className="disabled:opacity-20" disabled={i === 0 || busy} onClick={() => move(i, -1)}><ArrowUp className="w-3.5 h-3.5" /></button><button className="disabled:opacity-20" disabled={i === vs.length - 1 || busy} onClick={() => move(i, 1)}><ArrowDown className="w-3.5 h-3.5" /></button></div>,
          <div><div className="font-bold inline-flex items-center gap-1">{L(v.name)} {v.isDefault && <Pill tone="primary"><Star className="w-3 h-3" />{t('الافتراضي')}</Pill>}</div>{v.calories != null && <div className="text-[11px] text-dim num">{v.calories} {t('سعر حراري')}</div>}</div>,
          <div className="text-xs num leading-tight"><div>{v.sku ?? '—'}</div><div className="text-dim">{v.barcode ?? ''}</div></div>,
          ...CHANNELS.map((ch) => {
            const o = ownPrice(v.id, ch);
            const b = base(ch);
            return (
              <button key={ch} data-fb={`variant:price:${v.id}:${ch}`} onClick={() => setOwn({ variant: v, channel: ch, amount: o ?? (b ? String(Number(b) + Number(v.priceDelta)) : '') })} className="text-start">
                {o ? <><Money v={o} /><div className="text-[10px] text-[var(--primary)]">{t('سعر خاص بالحجم')}</div></> : b ? <><span className="num">{(Number(b) + Number(v.priceDelta)).toFixed(2)}</span><div className="text-[10px] text-dim">{t('سعر الصنف')} {Number(v.priceDelta) >= 0 ? '+' : ''}{Number(v.priceDelta).toFixed(2)}</div></> : <span className="text-dim">—</span>}
              </button>
            );
          }),
          <span className="num text-xs">×{v.modifierMultiplier}</span>,
          v.active ? <Pill tone="success">{t('شغال')}</Pill> : <Pill tone="neutral">{t('موقوف')}</Pill>,
          <Button size="sm" data-fb={`variant:edit:${v.id}`} onClick={() => setEdit({ id: v.id, name: v.name, priceDelta: String(Number(v.priceDelta)), modifierMultiplier: String(v.modifierMultiplier), active: v.active, sku: v.sku ?? '', barcode: v.barcode ?? '', calories: v.calories != null ? String(v.calories) : '', isDefault: !!v.isDefault })}>{t('تعديل')}</Button>,
        ])} />
        <div className="text-[11px] text-dim mt-2">{t('السعر في الجدول للفرع ده. دوس على السعر عشان تحدد سعر خاص للحجم في القناة دي (بدل سعر الصنف + الفرق). مضاعف الإضافات بيغير سعر الإضافات حسب الحجم (مثلاً الكبير ×1.5).')}</div>
      </Card>

      <Modal open={!!edit} onClose={() => setEdit(null)} wide title={edit?.isNew ? t('حجم جديد') : t('تعديل الحجم')} badge={<StateBadge ops={['Variant.Upsert']} />}
        footer={<><Button onClick={() => setEdit(null)}>{t('إلغاء')}</Button><Button variant="primary" data-fb="variant:save" loading={busy} onClick={save}><Save className="w-4 h-4" />{t('حفظ الحجم')}</Button></>}>
        {edit && (
          <div className="space-y-3">
            <LocInputs value={edit.name} onChange={(name) => setEdit({ ...edit, name })} fb="variant" labelAr={t('اسم الحجم (مثلاً: كبير)')} labelEn={t('بالإنجليزي (Large)')} />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Field label={t('فرق السعر (ج.م)')} hint={t('عن سعر الصنف — ممكن بالسالب')}><Input data-fb="variant:delta" inputMode="decimal" value={edit.priceDelta} onChange={(e) => setEdit({ ...edit, priceDelta: e.target.value })} /></Field>
              <Field label={t('مضاعف الإضافات')} hint={t('1 = نفس السعر')}><Input data-fb="variant:mult" inputMode="decimal" value={edit.modifierMultiplier} onChange={(e) => setEdit({ ...edit, modifierMultiplier: e.target.value })} /></Field>
              <Field label={t('السعرات')}><Input data-fb="variant:calories" inputMode="numeric" value={edit.calories} onChange={(e) => setEdit({ ...edit, calories: e.target.value.replace(/[^0-9]/g, '') })} /></Field>
              <Field label={t('الحالة')}><Switch checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label={edit.active ? t('شغال') : t('موقوف')} /></Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label={<span className="inline-flex items-center gap-1"><Tag className="w-3.5 h-3.5" />{t('كود الحجم (SKU)')}</span>} hint={t('اختياري — فريد')}><Input data-fb="variant:sku" value={edit.sku} onChange={(e) => setEdit({ ...edit, sku: e.target.value })} dir="ltr" /></Field>
              <Field label={t('الباركود')} hint={t('اختياري — مايتكررش')}><Input data-fb="variant:barcode" value={edit.barcode} onChange={(e) => setEdit({ ...edit, barcode: e.target.value })} dir="ltr" inputMode="numeric" /></Field>
              <Field label={t('الحجم الافتراضي')} hint={t('اللي بيتختار أوتوماتيك على الكاشير')}><Switch checked={edit.isDefault} onChange={(v) => setEdit({ ...edit, isDefault: v })} label={edit.isDefault ? t('أيوه') : t('لأ')} /></Field>
            </div>
            <Tech><div className="text-[11px] text-dim">Variant.Upsert: attributes + barcode are contract fields; name, priceDelta, modifierMultiplier, sku, calories, isDefault, sortOrder are proposed.</div></Tech>
          </div>
        )}
      </Modal>

      <Modal open={!!own} onClose={() => setOwn(null)} title={t('سعر خاص للحجم')} badge={<StateBadge ops={['Catalog.SetPrice']} />}
        footer={<><Button onClick={() => setOwn(null)}>{t('إلغاء')}</Button><Button variant="primary" data-fb="variant:own-price:save" loading={busy} disabled={!own?.amount.trim()} onClick={setOwnPrice}><Save className="w-4 h-4" />{t('حفظ السعر')}</Button></>}>
        {own && (
          <div className="space-y-3">
            <div className="text-sm">{L(p.name)} — <b>{L(own.variant.name)}</b> · {channelLabel(own.channel)}</div>
            <Field label={t('السعر (ج.م)')} hint={t('بيبدأ من دلوقتي. للجدولة والسجل افتح شاشة الأسعار.')}><Input data-fb="variant:own-price" inputMode="decimal" value={own.amount} onChange={(e) => setOwn({ ...own, amount: e.target.value })} /></Field>
            <Banner tone="info">{t('السعر الخاص بيلغي "سعر الصنف + الفرق" للحجم ده في القناة دي بس. لو السياسة بتطلب موافقة على تغيير السعر هتظهر شاشة موافقة المدير.')}</Banner>
          </div>
        )}
      </Modal>
    </div>
  );
}
