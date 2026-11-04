// ux-15: the life of a product on its page — retire (with a reason) instead of delete when it has sales, reinstate,
// delete only an unsold, unused product when the restaurant allows it (Product.Usage / Retire / Reinstate / Delete);
// its prices per channel and size with their history (the «الأسعار» screen's own editor); and the kitchen station each
// order type goes to (the same routing rules as «التحضير»). Centred popups, short labels.
import React, { useState } from 'react';
import { Archive, ArchiveRestore, ChefHat, Trash2 } from 'lucide-react';
import { useCommand, useDev, useQuery, useReasonMin } from '../../../app/hooks';
import { Banner, Button, Card, Field, Modal, Pill, Select, StateBadge, Table, Textarea } from '../../../ui';
import { t, L, tv } from '../../../i18n';
import { DateTime } from '../../../ui';
import { branchLabel } from '../../../demo/people';
import { stationName } from '../../../demo/humanLog';
import { channelLabel, useItems, usePolicy } from './common';
import { ProductPrices } from '../Prices';

const BLOCKER: Record<string, string> = {
  CHECKS: 'بيع في شيكات', COMBOS: 'ضمن وجبة', PROMOTIONS: 'ضمن عرض', MENUS: 'في قائمة محددة', RECIPES: 'له وصفة', STOCK: 'له صنف مخزن', DISPLAY: 'على شاشة العميل', HALF_AND_HALF: 'نصف ونصف',
};

/** Status and the retire / reinstate / delete actions (Data tab). */
export function ProductLifecycle({ p }: { p: any }) {
  const u = useQuery<any>('Product.Usage', { params: { productId: p.id } });
  const [dlg, setDlg] = useState<'retire' | 'reinstate' | 'delete' | null>(null);
  const d = u.data;
  const retired = !p.active;
  const canDelete = d?.removal?.mode === 'DELETE_UNSOLD' && d?.canDelete;
  return (
    <div className="rounded-xl border line p-3 space-y-2" data-fb="product:lifecycle">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold">{t('حالة الصنف')}</span>
        {retired ? <Pill tone="neutral" dot>{t('موقوف')}</Pill> : <Pill tone="success" dot>{t('معروض للبيع')}</Pill>}
        {d && <Pill tone="neutral">{t('مبيعات: {n} شيك', { n: d.usage.completedChecks })}</Pill>}
        {d?.usage.openChecks > 0 && <Pill tone="warning">{t('في شيكات مفتوحة: {n}', { n: d.usage.openChecks })}</Pill>}
        <div className="flex-1" />
        {!retired && <Button size="sm" variant="danger" data-fb="product:retire" onClick={() => setDlg('retire')}><Archive className="w-3.5 h-3.5" />{t('إيقاف الصنف')}</Button>}
        {retired && <Button size="sm" data-fb="product:reinstate" onClick={() => setDlg('reinstate')}><ArchiveRestore className="w-3.5 h-3.5" />{t('إعادة الصنف للبيع')}</Button>}
        {canDelete && <Button size="sm" variant="ghost" data-fb="product:delete" onClick={() => setDlg('delete')}><Trash2 className="w-3.5 h-3.5" />{t('حذف الصنف')}</Button>}
      </div>
      {retired && p.retired && <div className="text-xs text-dim">{t('أُوقف')} <DateTime v={p.retired.at} /> · {tv(p.retired.reason)}</div>}
      {dlg === 'retire' && d && <RetireModal p={p} usage={d} onClose={() => setDlg(null)} />}
      {dlg === 'reinstate' && <ReinstateModal p={p} onClose={() => setDlg(null)} />}
      {dlg === 'delete' && <DeleteModal p={p} onClose={() => setDlg(null)} />}
    </div>
  );
}

function RetireModal({ p, usage, onClose }: { p: any; usage: any; onClose: () => void }) {
  const { run, busy } = useCommand();
  const min = useReasonMin();
  const [reason, setReason] = useState('');
  const meals = usage.usage.combos.filter((c: any) => c.active);
  const promos = usage.usage.promotions.filter((x: any) => x.active);
  const save = async () => { if (await run('Product.Retire', { params: { productId: p.id }, body: { reason: reason.trim(), expectedVersion: p.version } }, { success: t('أُوقف الصنف') })) onClose(); };
  return (
    <Modal open onClose={onClose} size="sm" title={t('إيقاف «{n}»', { n: L(p.name) })} badge={<StateBadge ops={['Product.Retire', 'Product.Usage']} />}
      footer={<><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="danger" loading={busy} disabled={reason.trim().length < min || meals.length > 0} onClick={save} data-fb="product-retire:confirm">{t('إيقاف الصنف')}</Button></>}>
      <div className="space-y-3" data-fb="product-retire:popup">
        <div className="flex flex-wrap gap-1.5">
          <Pill tone="neutral">{t('مبيعات: {n} شيك', { n: usage.usage.completedChecks })}</Pill>
          <Pill tone="neutral">{t('يبقى في السجل والتقارير')}</Pill>
        </div>
        {meals.length > 0 && <Banner tone="error">{t('ضمن وجبة: {m}', { m: meals.map((m: any) => L(m.name)).join(t('، ')) })}</Banner>}
        {promos.length > 0 && <Banner tone="warning">{t('ضمن عرض: {m}', { m: promos.map((m: any) => L(m.name)).join(t('، ')) })}</Banner>}
        <Field label={t('السبب')} required hint={t('{n} أحرف على الأقل', { n: min })}><Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} data-fb="product-retire:reason" /></Field>
      </div>
    </Modal>
  );
}

function ReinstateModal({ p, onClose }: { p: any; onClose: () => void }) {
  const { run, busy } = useCommand();
  const [reason, setReason] = useState('');
  const save = async () => { if (await run('Product.Reinstate', { params: { productId: p.id }, body: { reason: reason.trim() || undefined, expectedVersion: p.version } }, { success: t('عاد الصنف للبيع') })) onClose(); };
  return (
    <Modal open onClose={onClose} size="sm" title={t('إعادة «{n}» للبيع', { n: L(p.name) })} badge={<StateBadge ops={['Product.Reinstate']} />}
      footer={<><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" loading={busy} onClick={save} data-fb="product-reinstate:confirm">{t('إعادة الصنف للبيع')}</Button></>}>
      <Field label={t('ملاحظة')} hint={t('اختياري')}><Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} /></Field>
    </Modal>
  );
}

function DeleteModal({ p, onClose }: { p: any; onClose: () => void }) {
  const { run, busy } = useCommand();
  const { nav } = useDev();
  const min = useReasonMin();
  const [reason, setReason] = useState('');
  const save = async () => { if (await run('Product.Delete', { params: { productId: p.id }, body: { reason: reason.trim(), expectedVersion: p.version } }, { success: t('حُذف الصنف') })) { onClose(); nav('menu', {}); } };
  return (
    <Modal open onClose={onClose} size="sm" title={t('حذف «{n}»؟', { n: L(p.name) })} badge={<StateBadge ops={['Product.Delete']} />}
      footer={<><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="danger" loading={busy} disabled={reason.trim().length < min} onClick={save} data-fb="product-delete:confirm">{t('حذف الصنف')}</Button></>}>
      <div className="space-y-3">
        <Pill tone="neutral">{t('لم يُبع ولم يُستخدم. لا يمكن التراجع.')}</Pill>
        <Field label={t('السبب')} required hint={t('{n} أحرف على الأقل', { n: min })}><Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} data-fb="product-delete:reason" /></Field>
      </div>
    </Modal>
  );
}

/** Why a product cannot be deleted (shown next to the status when deleting is allowed but blocked). */
export function blockerText(code: string) { return t(BLOCKER[code] ?? code); }

/** «الأسعار»: the product's prices per channel and size on this branch, with their history and the next scheduled one. */
export function PricesTab({ p }: { p: any }) {
  const { me, auth } = useDev();
  const branches = useItems<any>('Branch.List');
  const sched = usePolicy<string>('PriceSchedulingPolicy');
  const branchId = me?.branchId ?? auth.branchId ?? branches.items[0]?.id;
  if (!branchId) return null;
  return <div data-fb="product:prices"><ProductPrices fixedProductId={p.id} branchId={branchId} branchName={branchLabel(branches.items.find((b) => b.id === branchId))} sched={sched} /></div>;
}

/** «المطبخ»: the station each order type goes to, and this product's own station (a routing rule on the product). */
export function KitchenTab({ p }: { p: any }) {
  const { run, busy } = useCommand();
  const u = useQuery<any>('Product.Usage', { params: { productId: p.id } });
  const stations = useItems<any>('KitchenStation.List');
  const rules = useItems<any>('RoutingRule.List');
  const own = rules.items.find((r) => r.match?.productId === p.id && !r.match?.channel && !r.match?.categoryId);
  const [pick, setPick] = useState<string | null>(null);
  const value = pick ?? (own?.active ? own.stationId : '');
  const SOURCE: Record<string, string> = { PRODUCT: 'قاعدة الصنف', CATEGORY: 'قاعدة القسم', DEFAULT: 'القاعدة العامة', NONE: 'بلا قاعدة' };
  const save = async () => {
    let r;
    if (own) r = await run('RoutingRule.Configure', { params: { ruleId: own.id }, body: value ? { stationId: value, active: true, expectedVersion: own.version } : { active: false, expectedVersion: own.version } }, { success: t('تم حفظ محطة الصنف') });
    else if (value) {
      const top = Math.min(...rules.items.map((x) => Number(x.priority)), 100);
      r = await run('RoutingRule.Create', { body: { priority: top - 1, match: { productId: p.id }, stationId: value } }, { success: t('تم حفظ محطة الصنف') });
    }
    if (r) setPick(null);
  };
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4" data-fb="product:kitchen">
      <Card title={<span className="inline-flex items-center gap-2"><ChefHat className="w-4 h-4" />{t('يذهب إلى')}</span>} badge={<StateBadge ops={['Product.Usage', 'RoutingRule.List']} />}>
        <Table head={[t('نوع الطلب'), t('المحطة'), t('حسب')]} rows={(u.data?.routing ?? []).map((r: any) => [
          channelLabel(r.channel),
          r.destination === 'NO_TICKET' ? <Pill tone="neutral">{t('بلا تذكرة مطبخ')}</Pill> : r.stationName ? <b>{stationName(r.stationName)}</b> : <Pill tone="warning">{t('بلا محطة')}</Pill>,
          <span className="text-xs text-dim">{t(SOURCE[r.source] ?? r.source)}</span>,
        ])} />
      </Card>
      <Card title={t('محطة هذا الصنف')} badge={<StateBadge ops={[own ? 'RoutingRule.Configure' : 'RoutingRule.Create']} />}>
        <div className="space-y-3">
          <Field label={t('المحطة')}><Select data-fb="product-kitchen:station" value={value} onChange={(e) => setPick(e.target.value)} options={[{ value: '', label: t('حسب القسم') }, ...stations.items.filter((s) => s.active).map((s) => ({ value: s.id, label: stationName(s.name) }))]} /></Field>
          <Button data-fb="product-kitchen:save" variant="primary" loading={busy} disabled={pick === null || (!own && !value)} onClick={save}>{t('حفظ')}</Button>
        </div>
      </Card>
    </div>
  );
}
